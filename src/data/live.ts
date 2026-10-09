/**
 * Live wallets from Zerion, straight from the browser with the player's key.
 *
 * The free plan is 300 requests a day, so the cache shapes everything:
 * - history is events: kept forever, only the newer tail is fetched (1 request);
 * - valuations (balances, positions, NFTs) are a measurement of now: refetched
 *   whole (4 requests) once they are older than VALUATION_TTL;
 * - a cold wallet costs ~5 requests, a reload within the TTL costs 0–1;
 * - with the wallet's on-chain fingerprint (nonce and ETH balance, free from
 *   the public RPC) a revisit costs nothing while it is unchanged: the cache
 *   is trusted for much longer, and a change fetches only the new tail and
 *   re-measures only what that tail can have moved.
 */

import { ZerionClient } from './zerion/client.js';
import type { DailyBudget } from './zerion/budget.js';
import {
  fetchRawWallet,
  getNftPositions,
  getPortfolio,
  getPositions,
  getTransactions,
  type RawWallet,
} from './zerion/endpoints.js';
import type { TransactionResource } from './zerion/types.js';
import type { KV } from './cache.js';

export const VALUATION_TTL = 5 * 60_000;
/** Reloading within this window does not even ask for the tail. */
export const HISTORY_TTL = 2 * 60_000;
/** When the fingerprint shows the wallet did not move: incoming tokens and prices still drift, slowly. */
export const QUIET_HISTORY_TTL = 30 * 60_000;
export const QUIET_VALUATION_TTL = 60 * 60_000;
/** Reach back a little, so a pending tx that has since settled is corrected. */
const OVERLAP_MS = 10 * 60_000;
/** Kept per wallet; the world shows up to 100. */
export const HISTORY_CAP = 250;

interface Entry {
  raw: RawWallet;
  valuationsAt: number;
  historyAt: number;
  /** The wallet's on-chain fingerprint when it was last brought up to date. */
  print?: string;
}

/** Only token transfers (no protocol): re-measuring the tokens is enough. */
const plainOnly = (fresh: readonly TransactionResource[]): boolean =>
  fresh.every((t) => ['send', 'receive', 'approve', 'revoke'].includes(t.attributes.operation_type) && !t.relationships?.dapp);

const key = (address: string): string => `wallet:${address.toLowerCase()}`;

function txKey(t: TransactionResource): string {
  return t.attributes.hash === '' ? t.id : `${t.relationships?.chain?.data.id ?? '?'}:${t.attributes.hash}`;
}

/** Newer wins (a pending entry is replaced by its confirmed self); newest first; capped. */
export function mergeHistory(old: readonly TransactionResource[], fresh: readonly TransactionResource[], cap = HISTORY_CAP): TransactionResource[] {
  const byKey = new Map<string, TransactionResource>();
  for (const t of old) byKey.set(txKey(t), t);
  for (const t of fresh) byKey.set(txKey(t), t);
  return [...byKey.values()].sort((a, b) => Date.parse(b.attributes.mined_at) - Date.parse(a.attributes.mined_at)).slice(0, cap);
}

export interface LiveOptions {
  apiKey: string;
  budget: DailyBudget;
  cache: KV;
  now?: () => number;
  client?: ZerionClient;
}

export class LiveLoader {
  readonly client: ZerionClient;
  readonly #cache: KV;
  readonly #now: () => number;

  constructor(o: LiveOptions) {
    this.client = o.client ?? new ZerionClient({ apiKey: o.apiKey, transport: 'direct', budget: o.budget });
    this.#cache = o.cache;
    this.#now = o.now ?? Date.now;
  }

  /**
   * The wallet as fresh as needed, spending as little as possible. `print` is
   * its fingerprint right now (see `walletFingerprints`), when the RPC answered.
   */
  async load(address: string, label: string, opts: { force?: boolean; print?: string; fresh?: boolean } = {}): Promise<RawWallet> {
    const addr = address.toLowerCase();
    const now = this.#now();
    const cached = await this.#cache.get<Entry>(key(addr));
    if (cached === undefined || opts.force === true) {
      const raw = await fetchRawWallet(this.client, addr, { label });
      raw.capturedAt = now;
      await this.#cache.put(key(addr), { raw, valuationsAt: now, historyAt: now, ...(opts.print ? { print: opts.print } : {}) } satisfies Entry);
      return raw;
    }
    // with both fingerprints we know whether the wallet moved; without, go by age
    const known = opts.print !== undefined && cached.print !== undefined;
    const moved = known && opts.print !== cached.print;
    // `fresh`: the player asked for it now (the tail and a full measure, not the whole history again)
    const historyDue = opts.fresh === true || moved || now - cached.historyAt > (known ? QUIET_HISTORY_TTL : HISTORY_TTL);
    let raw: RawWallet = { ...cached.raw, label };
    let fresh: TransactionResource[] = [];
    if (historyDue) ({ raw, fresh } = await this.#refreshTail(raw));
    // what to re-measure: what the new transactions can have moved, else only if it is old
    let revalue: 'full' | 'tokens' | null = null;
    if (opts.fresh === true || now - cached.valuationsAt > (known ? QUIET_VALUATION_TTL : VALUATION_TTL)) revalue = 'full';
    else if (fresh.length > 0) revalue = plainOnly(fresh) ? 'tokens' : 'full';
    if (revalue === 'full') raw = await this.#refreshValuations(raw);
    else if (revalue === 'tokens') raw = await this.#refreshTokens(raw);
    raw.capturedAt = now;
    const print = opts.print ?? cached.print;
    await this.#cache.put(key(addr), {
      raw,
      valuationsAt: revalue === 'full' ? now : cached.valuationsAt,
      historyAt: historyDue ? now : cached.historyAt,
      ...(print !== undefined ? { print } : {}),
    } satisfies Entry);
    return raw;
  }

  /** One request: anything new since the last transaction we know of? */
  async refreshHistory(address: string, print?: string): Promise<{ raw: RawWallet; added: number; fresh: TransactionResource[] } | null> {
    const cached = await this.#cache.get<Entry>(key(address));
    if (cached === undefined) return null;
    const { raw, added, fresh } = await this.#refreshTail(cached.raw);
    const now = this.#now();
    raw.capturedAt = now;
    await this.#cache.put(key(address), { ...cached, raw, historyAt: now, ...(print !== undefined ? { print } : {}) } satisfies Entry);
    return { raw, added, fresh };
  }

  async #refreshTail(raw: RawWallet): Promise<{ raw: RawWallet; added: number; fresh: TransactionResource[] }> {
    const newest = raw.transactions.reduce((m, t) => Math.max(m, Date.parse(t.attributes.mined_at) || 0), 0);
    const fetched = await getTransactions(this.client, raw.address, newest > 0 ? { since: newest - OVERLAP_MS } : {});
    const known = new Set(raw.transactions.map(txKey));
    const fresh = fetched.filter((t) => !known.has(txKey(t)));
    return { raw: { ...raw, transactions: mergeHistory(raw.transactions, fetched) }, added: fresh.length, fresh };
  }

  /**
   * Re-measure a wallet, spending only what the change calls for:
   * - `full`: portfolio, tokens, DeFi positions and NFTs (4 requests);
   * - `tokens`: portfolio and token balances (2), after a plain send/receive;
   * - `total`: the portfolio total only (1), for price drift.
   */
  async refreshValuations(address: string, mode: 'full' | 'tokens' | 'total'): Promise<RawWallet | null> {
    const cached = await this.#cache.get<Entry>(key(address));
    if (cached === undefined) return null;
    const portfolio = (): Promise<RawWallet['portfolio']> => getPortfolio(this.client, cached.raw.address).catch(() => cached.raw.portfolio);
    const raw =
      mode === 'full'
        ? await this.#refreshValuations(cached.raw)
        : mode === 'tokens'
          ? { ...cached.raw, ...(await Promise.all([portfolio(), getPositions(this.client, cached.raw.address, 'only_simple')]).then(([p, simple]) => ({ portfolio: p, simple }))) }
          : { ...cached.raw, portfolio: await portfolio() };
    const now = this.#now();
    raw.capturedAt = now;
    await this.#cache.put(key(address), { ...cached, raw, valuationsAt: mode === 'full' ? now : cached.valuationsAt } satisfies Entry);
    return raw;
  }

  /** Portfolio and token balances (2 requests), after plain transfers. */
  async #refreshTokens(raw: RawWallet): Promise<RawWallet> {
    const [portfolio, simple] = await Promise.all([getPortfolio(this.client, raw.address).catch(() => raw.portfolio), getPositions(this.client, raw.address, 'only_simple')]);
    return { ...raw, portfolio, simple };
  }

  async #refreshValuations(raw: RawWallet): Promise<RawWallet> {
    const [portfolio, simple, complex, nfts] = await Promise.all([
      getPortfolio(this.client, raw.address).catch(() => raw.portfolio),
      getPositions(this.client, raw.address, 'only_simple'),
      getPositions(this.client, raw.address, 'only_complex'),
      getNftPositions(this.client, raw.address).catch(() => raw.nfts),
    ]);
    return { ...raw, portfolio, simple, complex, nfts: Array.isArray(nfts) ? nfts : raw.nfts };
  }
}
