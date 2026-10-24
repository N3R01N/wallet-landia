// Ported from wallet-landia-v3 (src/data/zerion/budget.ts) on 2026-10-08.
/**
 * The daily request budget, counted here rather than discovered at the wall.
 *
 * Zerion's free plan allows 2,000 requests a day. Nothing on screen used to say
 * how many of those were left until one of them came back 429 — and by then the
 * city had already stopped loading. So every request that reaches the API is
 * counted as it happens, the count is on screen the whole time, and the last one
 * is the last one: past the limit the client refuses to send rather than
 * spending a request to be told it has none.
 *
 * ## Which day
 *
 * UTC, like the sky. A count that rolls over at local midnight would reset at a
 * different moment than the quota it is tracking, which is the one thing this
 * must not do — and "resets at midnight UTC" is at least a fact a person can
 * check, where "resets at midnight" is a different promise in every timezone.
 *
 * ## Counted, and corrected
 *
 * The local count is what makes the number live: it moves the moment a request
 * goes out, without waiting for anything. But it is only ever *this* browser's
 * view — the same key used from a phone, another tab, or yesterday's session
 * spends from the same day's quota. So when a response carries
 * `RateLimit-Org-Day-Remaining`, that is the API's own count and it wins.
 * `observeRemaining` takes the pessimistic side of the two: if Zerion says 40
 * are left and we counted 200 spent, 40 is the truth and the count catches up.
 *
 * ## Whose limit
 *
 * The plan's size is Zerion's to say, not ours: it was 300 a day, then 2,000,
 * and a paid key has more. A limit written down here once cut players off at
 * 300 with 1,700 still left. So `RateLimit-Org-Day-Limit` on any answer sets
 * the limit (`observeLimit`), it is kept across days, and the free plan's
 * number is only the guess before Zerion has answered once.
 */

/** Requests a day on Zerion's free (Developer) plan, as of 2026-10 (zerion.io/api): the guess until Zerion says. */
export const FREE_DAILY_REQUESTS = 2000;

const STORAGE_KEY = 'zenigard/budget/v1';
const DAY_MS = 86_400_000;

/** The slice of the Storage API used here, so tests can pass a plain object. */
export interface BudgetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BudgetSnapshot {
  /** Requests sent today, as far as this browser and the API agree. */
  used: number;
  limit: number;
  /** Never negative: a budget cannot be more than empty. */
  remaining: number;
  exhausted: boolean;
  /** Next UTC midnight, in epoch ms. */
  resetsAt: number;
}

interface Stored {
  /** UTC date, `YYYY-MM-DD`. A different one means a fresh count. */
  day: string;
  used: number;
  /** The day limit Zerion last reported for this key (kept across days). */
  limit?: number;
}

/** The UTC date a moment falls on, as `YYYY-MM-DD`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight UTC after `ms`, in epoch ms. */
export function nextUtcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS;
}

/**
 * How long until the budget resets, in words.
 *
 * Rounded to whole hours and minutes: nobody waits out a quota to the second,
 * and a ticking number would demand a re-render every second to stay true.
 */
export function untilReset(ms: number, now: number): string {
  const left = Math.max(0, ms - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.round((left % 3_600_000) / 60_000);
  if (hours === 0) return minutes <= 1 ? 'in under a minute' : `in ${minutes} minutes`;
  if (minutes === 0) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `in ${hours}h ${minutes}m`;
}

export interface DailyBudgetOptions {
  storage?: BudgetStorage | null;
  now?: () => number;
  /** The limit until Zerion reports one (default: the free plan's). */
  limit?: number;
  /** Called whenever the count moves, so the HUD can follow without polling. */
  onChange?: (snapshot: BudgetSnapshot) => void;
}

export class DailyBudget {
  readonly #storage: BudgetStorage | null;
  readonly #now: () => number;
  readonly #onChange: ((snapshot: BudgetSnapshot) => void) | undefined;

  readonly #guess: number;
  #limit: number;
  #day: string;
  #used = 0;

  constructor(options: DailyBudgetOptions = {}) {
    this.#storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.#now = options.now ?? Date.now;
    this.#guess = Math.max(1, Math.floor(options.limit ?? FREE_DAILY_REQUESTS));
    this.#limit = this.#guess;
    this.#onChange = options.onChange;

    this.#day = utcDay(this.#now());
    this.#load();
    // other tabs on the same key spend from the same quota: follow their count as it moves
    if (this.#storage !== null && typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        const before = this.#used;
        this.#rollover();
        this.#merge();
        if (this.#used !== before) this.#onChange?.(this.snapshot());
      });
    }
  }

  /** Requests allowed today: what Zerion last said, else the guess. */
  get limit(): number {
    return this.#limit;
  }

  get used(): number {
    this.#rollover();
    return this.#used;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get exhausted(): boolean {
    return this.remaining === 0;
  }

  get resetsAt(): number {
    return nextUtcMidnight(this.#now());
  }

  snapshot(): BudgetSnapshot {
    return {
      used: this.used,
      limit: this.limit,
      remaining: this.remaining,
      exhausted: this.exhausted,
      resetsAt: this.resetsAt,
    };
  }

  /** Count one request against today. */
  spend(count = 1): void {
    this.#rollover();
    // another tab may have spent since: count on from the higher of the two
    this.#merge();
    this.#used += Math.max(0, Math.floor(count));
    this.#commit();
  }

  /**
   * Reconcile with what the API says is left.
   *
   * Takes whichever count is worse, never better: a header that reports more
   * headroom than we counted is describing a *different* day boundary or a
   * different plan, and believing it would hand back requests that are gone.
   */
  observeRemaining(reported: number | null): void {
    if (reported === null || !Number.isFinite(reported)) return;
    this.#rollover();
    const implied = Math.max(0, this.limit - Math.max(0, Math.floor(reported)));
    if (implied <= this.#used) return;
    this.#used = implied;
    this.#commit();
  }

  /**
   * Take the plan's day limit from Zerion (`RateLimit-Org-Day-Limit`). Unlike
   * the remaining count this is believed both ways: a bigger plan really does
   * have more, and the count already spent stays spent.
   */
  observeLimit(reported: number | null): void {
    if (reported === null || !Number.isFinite(reported) || reported < 1) return;
    const limit = Math.floor(reported);
    if (limit === this.#limit) return;
    this.#limit = limit;
    this.#commit();
  }

  /** Start the day over, and forget the learned limit. For tests, and for a user who has changed keys. */
  reset(): void {
    this.#day = utcDay(this.#now());
    this.#used = 0;
    this.#limit = this.#guess;
    this.#commit();
  }

  /** Drop the count when the UTC day has turned over since it was written. */
  #rollover(): void {
    const today = utcDay(this.#now());
    if (today === this.#day) return;
    this.#day = today;
    this.#used = 0;
    this.#commit();
  }

  /** Take the stored count when it is today's and higher (written by another tab). */
  #merge(): void {
    const before = this.#used;
    this.#load();
    if (this.#used < before) this.#used = before;
  }

  #load(): void {
    let raw: string | null | undefined;
    try {
      raw = this.#storage?.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (raw === null || raw === undefined) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const stored = parsed as Partial<Stored>;
      // the plan's limit outlives the day it was reported on
      if (typeof stored.limit === 'number' && Number.isFinite(stored.limit) && stored.limit >= 1) this.#limit = Math.floor(stored.limit);
      // Yesterday's count is not this day's business, and a corrupt one is
      // worth less than starting from zero.
      if (stored.day !== this.#day) return;
      if (typeof stored.used === 'number' && Number.isFinite(stored.used)) {
        this.#used = Math.max(0, Math.floor(stored.used));
      }
    } catch {
      /* unreadable — today starts at zero */
    }
  }

  #commit(): void {
    const stored: Stored = { day: this.#day, used: this.#used, ...(this.#limit !== this.#guess ? { limit: this.#limit } : {}) };
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // A full or blocked storage must not take the app down with it; the count
      // simply stops surviving a reload.
    }
    this.#onChange?.(this.snapshot());
  }
}

function defaultStorage(): BudgetStorage | null {
  try {
    return globalThis.localStorage as BudgetStorage;
  } catch {
    return null;
  }
}
