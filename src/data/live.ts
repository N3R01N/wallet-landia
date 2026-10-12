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

import { ZerionClient, ZerionError } from './zerion/client.js';
import type { DailyBudget } from './zerion/budget.js';
import {
  currentChains,
  fetchRawWallet,
  getNftPositions,
  getTransactionPages,
  getPortfolio,
  getPositions,
  realmScope,
  type RawWallet,
} from './zerion/endpoints.js';
import type { TransactionResource } from './zerion/types.js';
import type { KV } from './cache.js';
import { Ledger, isSpam, sortNewestFirst, txKey } from './ledger.js';

export const VALUATION_TTL = 5 * 60_000;
/** Reloading within this window does not even ask for the tail. */
export const HISTORY_TTL = 2 * 60_000;
/** When the fingerprint shows the wallet did not move: incoming tokens and prices still drift, slowly. */
export const QUIET_HISTORY_TTL = 30 * 60_000;
export const QUIET_VALUATION_TTL = 60 * 60_000;
/** Kept per wallet; the world shows up to 100. */
export const HISTORY_CAP = 250;

interface Entry {
  raw: RawWallet;
  valuationsAt: number;
  historyAt: number;
  /** The wallet's on-chain fingerprint when it was last brought up to date. */
  print?: string;
}

const PLAIN_OPS = new Set(['send', 'receive', 'approve', 'revoke']);

/** What new transactions call for re-measuring: plain token transfers (no protocol) move only tokens; anything else may move positions and NFTs too. */
export const remeasureFor = (fresh: readonly TransactionResource[]): 'tokens' | 'full' =>
  fresh.every((t) => PLAIN_OPS.has(t.attributes.operation_type) && !t.relationships?.dapp) ? 'tokens' : 'full';

/**
 * A measurement that may fail without failing the wallet (an NFT index still
 * warming up, a wallet never indexed): keep the old one. A refused key or a
 * spent quota is not that: it must reach the player.
 */
const orKeep = <T>(p: Promise<T>, old: T): Promise<T> =>
  p.catch((e: unknown) => {
    if (e instanceof ZerionError && (e.kind === 'auth' || e.kind === 'quota')) throw e;
    return old;
  });

/**
 * Cached per realm: a wallet fetched for other chains has a different history
 * (the tail is only ever fetched forward, so older history of a newly added
 * chain would otherwise never arrive). Ethereum alone keeps its old key.
 */
const key = (address: string): string => {
  const chains = currentChains();
  return chains.length === 1 && chains[0] === 'ethereum' ? `wallet:${address.toLowerCase()}` : `wallet:${chains.join('+')}:${address.toLowerCase()}`;
};

/**
 * Newer wins (a pending entry is replaced by its confirmed self); newest
 * first; capped. Spam stays out (the ledger keeps it, the town never shows
 * it), so it cannot push real transactions past the cap.
 */
export function mergeHistory(old: readonly TransactionResource[], fresh: readonly TransactionResource[], cap = HISTORY_CAP): TransactionResource[] {
  const byKey = new Map<string, TransactionResource>();
  for (const t of old) if (!isSpam(t)) byKey.set(txKey(t), t);
  for (const t of fresh) if (!isSpam(t)) byKey.set(txKey(t), t);
  return sortNewestFirst([...byKey.values()]).slice(0, cap);
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
  /** Every transaction each wallet ever made, kept in the browser (the town's own history requests feed it). */
  readonly ledger: Ledger;
  readonly #cache: KV;
  readonly #now: () => number;
  /** One read-modify-write of a wallet's cache entry at a time (a block check and a refresh must not undo each other). */
  readonly #busy = new Map<string, Promise<unknown>>();

  constructor(o: LiveOptions) {
    this.client = o.client ?? new ZerionClient({ apiKey: o.apiKey, budget: o.budget }); // the configured transport
    this.#cache = o.cache;
    this.#now = o.now ?? Date.now;
    this.ledger = new Ledger(
      o.cache,
      async (address, q) => {
        // with Zerion's word on whether more pages follow (the only sure sign of an end, or of a gap)
        const { data, more } = await getTransactionPages(this.client, address, {
          spam: true,
          pages: q.pages,
          ...(q.since !== undefined ? { since: q.since } : {}),
          ...(q.until !== undefined ? { until: q.until } : {}),
        });
        return { txs: data, more };
      },
      realmScope,
    );
  }

  /**
   * The wallet as fresh as needed, spending as little as possible. `print` is
   * its fingerprint right now (see `walletFingerprints`), when the RPC answered.
   */
  async load(address: string, label: string, opts: { print?: string; fresh?: boolean } = {}): Promise<RawWallet> {
    const addr = address.toLowerCase();
    // the realm as it was asked for: a switch half way must not file this wallet under the other one
    const k = key(addr);
    return this.#serial(k, async () => {
      const now = this.#now();
      const cached = await this.#cache.get<Entry>(k);
      if (cached === undefined) {
        // the newest page comes through the ledger, which keeps it (and later reaches back from it);
        // a ledger already kept (an imported history, a cache cleared) gives the town its recent past too
        const transactions = async (): Promise<TransactionResource[]> => mergeHistory(await this.ledger.recent(addr, HISTORY_CAP), await this.ledger.head(addr));
        const raw = await fetchRawWallet(this.client, addr, { label, transactions });
        raw.capturedAt = now;
        await this.#cache.put(k, { raw, valuationsAt: now, historyAt: now, ...(opts.print ? { print: opts.print } : {}) } satisfies Entry);
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
      else if (fresh.length > 0) revalue = remeasureFor(fresh);
      if (revalue === 'full') raw = await this.#remeasureFull(raw);
      else if (revalue === 'tokens') raw = await this.#remeasureTokens(raw);
      raw.capturedAt = now;
      const print = opts.print ?? cached.print;
      await this.#cache.put(k, {
        raw,
        valuationsAt: revalue === 'full' ? now : cached.valuationsAt,
        historyAt: historyDue ? now : cached.historyAt,
        ...(print !== undefined ? { print } : {}),
      } satisfies Entry);
      return raw;
    });
  }

  /** One request: anything new since the last transaction we know of? */
  refreshHistory(address: string, print?: string): Promise<{ raw: RawWallet; added: number; fresh: TransactionResource[] } | null> {
    const k = key(address);
    return this.#serial(k, async () => {
      const cached = await this.#cache.get<Entry>(k);
      if (cached === undefined) return null;
      const { raw, added, fresh } = await this.#refreshTail(cached.raw);
      const now = this.#now();
      raw.capturedAt = now;
      await this.#cache.put(k, { ...cached, raw, historyAt: now, ...(print !== undefined ? { print } : {}) } satisfies Entry);
      return { raw, added, fresh };
    });
  }

  async #refreshTail(raw: RawWallet): Promise<{ raw: RawWallet; added: number; fresh: TransactionResource[] }> {
    // through the ledger: one request for what is new, kept for good (it asks from its own newest, so nothing is missed)
    const fetched = (await this.ledger.head(raw.address)).filter((t) => !isSpam(t));
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
  remeasure(address: string, mode: 'full' | 'tokens' | 'total'): Promise<RawWallet | null> {
    const k = key(address);
    return this.#serial(k, async () => {
      const cached = await this.#cache.get<Entry>(k);
      if (cached === undefined) return null;
      const raw =
        mode === 'full'
          ? await this.#remeasureFull(cached.raw)
          : mode === 'tokens'
            ? await this.#remeasureTokens(cached.raw)
            : { ...cached.raw, portfolio: await orKeep(getPortfolio(this.client, cached.raw.address), cached.raw.portfolio) };
      const now = this.#now();
      raw.capturedAt = now;
      await this.#cache.put(k, { ...cached, raw, valuationsAt: mode === 'full' ? now : cached.valuationsAt } satisfies Entry);
      return raw;
    });
  }

  /** Portfolio and token balances (2 requests), after plain transfers. */
  async #remeasureTokens(raw: RawWallet): Promise<RawWallet> {
    const [portfolio, simple] = await Promise.all([orKeep(getPortfolio(this.client, raw.address), raw.portfolio), getPositions(this.client, raw.address, 'only_simple')]);
    return { ...raw, portfolio, simple };
  }

  async #remeasureFull(raw: RawWallet): Promise<RawWallet> {
    const [portfolio, simple, complex, nfts] = await Promise.all([
      orKeep(getPortfolio(this.client, raw.address), raw.portfolio),
      getPositions(this.client, raw.address, 'only_simple'),
      getPositions(this.client, raw.address, 'only_complex'),
      orKeep(getNftPositions(this.client, raw.address), raw.nfts),
    ]);
    return { ...raw, portfolio, simple, complex, nfts: Array.isArray(nfts) ? nfts : raw.nfts };
  }

  #serial<T>(k: string, run: () => Promise<T>): Promise<T> {
    const before = this.#busy.get(k) ?? Promise.resolve();
    const next = before.then(run, run);
    const settled = next.catch(() => undefined);
    this.#busy.set(k, settled);
    // forget it once nothing else queued behind it
    void settled.then(() => {
      if (this.#busy.get(k) === settled) this.#busy.delete(k);
    });
    return next;
  }
}
