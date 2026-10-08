// Ported from wallet-landia-v3 (src/data/zerion/client.ts) on 2026-10-08.
/**
 * The one place that talks to api.zerion.io.
 *
 * Responsibilities: auth, error classification, rate-limit behaviour and
 * pagination. It knows nothing about cities, positions or tokens — it returns
 * raw JSON:API resources and the mappers take it from there.
 *
 * `fetch` and `sleep` are injectable so the retry and pagination logic can be
 * tested without a network or real delays.
 */

import type { ZerionErrorBody, ZerionList, ZerionSingle } from './types.js';
import {
  DIRECT_BASE,
  authHeader,
  baseUrl,
  buildUrl,
  configuredTransport,
  type Transport,
} from './transport.js';
import { Pacer } from './pacer.js';
import { untilReset, type DailyBudget } from './budget.js';

export type ErrorKind =
  | 'auth' // 401/403 — key missing, wrong, or lacking access
  | 'bad-request' // 400 — usually an untracked address or malformed filter
  | 'not-found'
  | 'rate-limit' // 429 and out of retries
  | 'quota' // day/month budget exhausted; retrying cannot help
  | 'server'
  | 'network'; // request never completed — offline, DNS, or CORS

export class ZerionError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly url: string;

  constructor(kind: ErrorKind, message: string, status: number | null, url: string) {
    super(message);
    this.name = 'ZerionError';
    this.kind = kind;
    this.status = status;
    this.url = url;
  }

  /** Whether the same request might succeed later without user action. */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'server' || this.kind === 'rate-limit';
  }
}

export interface RateLimitSnapshot {
  /** Requests allowed per second on this plan — what the pacer aims at. */
  secondLimit: number | null;
  secondRemaining: number | null;
  secondReset: number | null;
  dayRemaining: number | null;
  monthRemaining: number | null;
  tier: string | null;
}

export interface ClientOptions {
  apiKey: string;
  transport?: Transport;
  /** Passed as `currency=` on every request that accepts it. */
  currency?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /**
   * Starting pace before the API reports its own. Left alone, the client is
   * pessimistic on the first request and adopts the real limit from there.
   */
  requestsPerSecond?: number;
  /** Retries per request on 429. */
  maxRetries?: number;
  /** Hard ceiling on pages `getAll` will follow, so a bad filter can't spin. */
  maxPages?: number;
  onRateLimit?: (snapshot: RateLimitSnapshot) => void;
  /**
   * The day's request budget. Every request that reaches the API is counted
   * against it, and once it is spent the client stops sending — see
   * `budget.ts`. Omit it and the client is unmetered, which is what the tests
   * and the fixture path want.
   */
  budget?: DailyBudget;
}

export type QueryParams = Record<string, string | number | undefined>;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PAGES = 20;

export class ZerionClient {
  readonly transport: Transport;
  readonly currency: string;

  readonly #apiKey: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxRetries: number;
  readonly #maxPages: number;
  readonly #onRateLimit: ((snapshot: RateLimitSnapshot) => void) | undefined;
  readonly #pacer: Pacer;
  readonly #budget: DailyBudget | undefined;
  readonly #now: () => number;

  #lastRateLimit: RateLimitSnapshot | null = null;

  constructor(options: ClientOptions) {
    this.#apiKey = options.apiKey;
    this.transport = options.transport ?? configuredTransport();
    this.currency = options.currency ?? 'usd';
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.#onRateLimit = options.onRateLimit;
    this.#budget = options.budget;
    this.#now = options.now ?? Date.now;

    const pacerOptions: ConstructorParameters<typeof Pacer>[0] = {};
    if (options.requestsPerSecond !== undefined) {
      pacerOptions.requestsPerSecond = options.requestsPerSecond;
    }
    if (options.now !== undefined) pacerOptions.now = options.now;
    if (options.sleep !== undefined) pacerOptions.sleep = options.sleep;
    this.#pacer = new Pacer(pacerOptions);
  }

  /** Rate-limit headers from the most recent response, for the HUD. */
  get rateLimit(): RateLimitSnapshot | null {
    return this.#lastRateLimit;
  }

  /** Current spacing between requests, in ms. For the HUD and for diagnosis. */
  get requestGapMs(): number {
    return this.#pacer.minGapMs;
  }

  /** The day's budget, if this client was given one to spend from. */
  get budget(): DailyBudget | null {
    return this.#budget ?? null;
  }

  #budgetMessage(): string {
    const budget = this.#budget;
    if (budget === undefined) return 'Out of requests for today.';
    return (
      `All ${budget.limit} of today's Zerion requests are spent. ` +
      `No new data can be loaded until the quota resets at midnight UTC, ` +
      `${untilReset(budget.resetsAt, this.#now())}.`
    );
  }

  /** One resource. */
  async getOne<T>(path: string, params: QueryParams = {}): Promise<T> {
    const body = await this.#request<ZerionSingle<T>>(buildUrl(this.transport, path, params));
    return body.data;
  }

  /** One page of a list. */
  async getPage<T>(path: string, params: QueryParams = {}): Promise<ZerionList<T>> {
    return this.#request<ZerionList<T>>(buildUrl(this.transport, path, params));
  }

  /**
   * Every page, following `links.next`.
   *
   * `signal` lets a city that the user navigated away from stop paginating; the
   * page cap is a second line of defence against an unbounded history.
   */
  async getAll<T>(
    path: string,
    params: QueryParams = {},
    options: { maxPages?: number; signal?: AbortSignal } = {},
  ): Promise<T[]> {
    const cap = options.maxPages ?? this.#maxPages;
    const out: T[] = [];
    let url: string | undefined = buildUrl(this.transport, path, params);

    for (let page = 0; page < cap && url !== undefined; page++) {
      if (options.signal?.aborted) break;
      const body: ZerionList<T> = await this.#request<ZerionList<T>>(url, options.signal);
      out.push(...body.data);
      const next = body.links?.next;
      url = next === undefined ? undefined : this.#localizeNext(next);
    }

    return out;
  }

  /**
   * `links.next` comes back as an absolute api.zerion.io URL. Under the proxy
   * transport that would bypass the proxy — and hit the CORS wall the proxy
   * exists to avoid — so rewrite it back onto our own origin.
   */
  #localizeNext(next: string): string {
    if (this.transport === 'direct') return next;
    return next.startsWith(DIRECT_BASE)
      ? `${baseUrl('proxy')}${next.slice(DIRECT_BASE.length)}`
      : next;
  }

  async #request<T>(url: string, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      // Checked before the queue, and again on every retry: a request that
      // cannot be spent should not wait its turn first, and a retry costs
      // exactly as much as the attempt it repeats.
      if (this.#budget?.exhausted === true) {
        throw new ZerionError('quota', this.#budgetMessage(), null, url);
      }

      // Every attempt queues, including retries — otherwise a retried batch is
      // still a batch, and reproduces the burst that got it throttled.
      await this.#pacer.acquire();
      if (signal?.aborted) throw abortError();

      let response: Response;
      try {
        const init: RequestInit = {
          headers: { accept: 'application/json', authorization: authHeader(this.#apiKey) },
        };
        if (signal) init.signal = signal;
        response = await this.#fetch(url, init);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new ZerionError(
          'network',
          `Request never completed (${describe(error)}). Offline, blocked, or CORS.`,
          null,
          url,
        );
      }

      // A response means the request was received and billed, whatever its
      // status: a 400 or a 429 is spent just as surely as a 200. A `fetch` that
      // threw is not counted — it never completed, and the reconciliation below
      // corrects the count if the API saw it anyway.
      this.#budget?.spend();

      const limits = readRateLimit(response.headers);
      this.#lastRateLimit = limits;
      this.#pacer.observeLimit(limits.secondLimit);
      this.#budget?.observeRemaining(limits.dayRemaining);
      this.#onRateLimit?.(limits);

      if (response.ok) return (await response.json()) as T;

      if (response.status === 429) {
        // A spent day or month budget will not recover on this timescale;
        // retrying just burns requests against a wall.
        if (limits.dayRemaining === 0 || limits.monthRemaining === 0) {
          throw new ZerionError('quota', quotaMessage(limits), 429, url);
        }
        if (attempt < this.#maxRetries) {
          // Hold the whole queue back, not just this request. The next
          // `acquire()` does the waiting.
          this.#pacer.penalize(retryDelayMs(limits, attempt));
          continue;
        }
        throw new ZerionError(
          'rate-limit',
          `Rate limited, and ${this.#maxRetries} retries did not clear it. ` +
            `Requests are spaced ${this.#pacer.minGapMs}ms apart` +
            (limits.secondLimit === null
              ? ' and the plan did not report a per-second limit.'
              : `; the plan allows ${limits.secondLimit}/s.`),
          429,
          url,
        );
      }

      throw new ZerionError(
        kindForStatus(response.status),
        await errorMessage(response),
        response.status,
        url,
      );
    }
  }
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400) return 'bad-request';
  if (status === 404) return 'not-found';
  return 'server';
}

/**
 * Zerion reports the exact wait in `RateLimit-Org-Second-Reset`, so use it.
 * Without it, back off exponentially rather than hammering.
 */
export function retryDelayMs(limits: RateLimitSnapshot, attempt: number): number {
  if (limits.secondReset !== null && limits.secondReset >= 0) {
    return Math.min(limits.secondReset * 1000 + 50, 5_000);
  }
  return Math.min(250 * 2 ** attempt, 5_000);
}

export function readRateLimit(headers: Headers): RateLimitSnapshot {
  const num = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    secondLimit: num('RateLimit-Org-Second-Limit'),
    secondRemaining: num('RateLimit-Org-Second-Remaining'),
    secondReset: num('RateLimit-Org-Second-Reset'),
    dayRemaining: num('RateLimit-Org-Day-Remaining'),
    monthRemaining: num('RateLimit-Org-Month-Remaining'),
    tier: headers.get('RateLimit-Org-Tier'),
  };
}

function quotaMessage(limits: RateLimitSnapshot): string {
  const which = limits.dayRemaining === 0 ? 'daily' : 'monthly';
  return `Zerion ${which} request quota is exhausted. Retrying will not help — wait for the reset or raise the plan.`;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ZerionErrorBody;
    const first = body.errors?.[0];
    if (first) {
      const text = [first.title, first.detail].filter(Boolean).join(': ');
      if (text !== '') return text;
    }
  } catch {
    /* no JSON body — fall through */
  }
  return response.statusText || `HTTP ${response.status}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Matches what `fetch` throws on abort, so callers can treat the two alike. */
function abortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}
