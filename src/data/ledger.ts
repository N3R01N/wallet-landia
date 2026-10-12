/**
 * The lifetime ledger: every transaction a wallet ever made, fetched once and
 * kept in the browser, so a player's whole story (their level, their badges)
 * can be read from it. After that only what is new is asked for.
 *
 * Three passes, all with the player's own Zerion key:
 * - `head`: everything after the newest one kept (on a first visit: the
 *   newest page). It walks pages until it meets what is kept, so there is
 *   never a gap. This is also the town's own "anything new?" request.
 * - `backfill`: one page older than the oldest kept (`filter[max_mined_at]`),
 *   so it can stop anywhere and carry on next time, even days later. A page
 *   shorter than a full one means the wallet's first transaction is reached.
 * - `all` / `recent`: read back what is kept, newest first.
 *
 * Zerion's answers are stored as they came (so a better mapper can re-read
 * them without spending requests), gzipped in chunks of about a page: a
 * transaction is ~6 KB of JSON and ~0.3 KB compressed. Pending transactions
 * are not kept (they come back confirmed); everything else is keyed like the
 * town's history (`chain:hash`).
 *
 * Kept per wallet and per realm (the chain set changes what the history is),
 * in the same key-value store as the cache. Losing it only costs requests.
 */

import type { KV } from './cache.js';
import { TX_PAGE_SIZE } from './zerion/endpoints.js';
import type { TransactionResource } from './zerion/types.js';

/** What the ledger asks Zerion for: newest first, both ends inclusive, at most `pages` pages. */
export type TxFetcher = (address: string, o: { since?: number; until?: number; pages: number }) => Promise<TransactionResource[]>;

export interface LedgerStatus {
  address: string;
  /** Transactions kept. */
  count: number;
  /** Mined time of the newest and oldest kept (ms), null while empty. */
  newest: number | null;
  oldest: number | null;
  /** The wallet's first transaction is reached: nothing older exists. */
  complete: boolean;
  /** Stopped short on purpose: a very busy wallet (a bot) past `LEDGER_CAP`; its history is partial. */
  capped: boolean;
  /** Pages fetched walking back so far (for progress and cost). */
  backfillRequests: number;
}

interface State extends LedgerStatus {
  v: 1;
  /** Chunk ids, oldest first. */
  chunks: number[];
  nextChunk: number;
  /** Where the next backfill page starts (ms, inclusive); normally the oldest kept. */
  cursor: number | null;
}

interface Chunk {
  newest: number;
  oldest: number;
  count: number;
  /** The transactions as JSON, gzipped when the browser can; plain text otherwise. */
  data: Uint8Array | string;
}

/** A chunk this small is topped up rather than a new one started (new transactions arrive a few at a time). */
const CHUNK_TARGET = TX_PAGE_SIZE;
/** Overlap when asking for what is new: transactions can be indexed a little after their mined time. */
const HEAD_OVERLAP_MS = 10 * 60_000;
/**
 * Walking back stops here (about 500 requests): past it a wallet is a bot or a
 * market maker, and its history is kept partial rather than eat days of quota.
 */
export const LEDGER_CAP = 50_000;
/** Pages `head` may walk when a wallet was busy while the player was away (it stops by itself when it meets what is kept). */
const HEAD_MAX_PAGES = 50;

export const txKey = (t: TransactionResource): string => (t.attributes.hash === '' ? t.id : `${t.relationships?.chain?.data.id ?? '?'}:${t.attributes.hash}`);
const minedAt = (t: TransactionResource): number => Date.parse(t.attributes.mined_at) || 0;
const newestFirst = (a: TransactionResource, b: TransactionResource): number => minedAt(b) - minedAt(a);

export class Ledger {
  readonly #kv: KV;
  readonly #fetch: TxFetcher;
  readonly #scope: () => string;
  readonly #cap: number;
  /** One pass at a time per wallet: a head and a backfill must not both rewrite the same state. */
  readonly #busy = new Map<string, Promise<unknown>>();

  /** `scope`: which realm the history is for (the chain set), so a different one keeps its own. */
  constructor(kv: KV, fetch: TxFetcher, scope: () => string = () => 'ethereum', cap = LEDGER_CAP) {
    this.#kv = kv;
    this.#fetch = fetch;
    this.#scope = scope;
    this.#cap = cap;
  }

  /**
   * Replace what is kept for a wallet with these transactions (a history
   * loaded from a file). `complete`: they reach back to its first one.
   */
  replace(address: string, txs: readonly TransactionResource[], complete: boolean): Promise<void> {
    return this.#serial(address, async () => {
      const old = await this.#state(address);
      for (const id of old?.chunks ?? []) await this.#kv.put(this.#key(address, `chunk:${id}`), undefined);
      const fresh = this.#emptyState(address);
      fresh.nextChunk = old?.nextChunk ?? 0;
      const seen = new Set<string>();
      const kept = txs.filter((t) => t.attributes.status !== 'pending' && !seen.has(txKey(t)) && (seen.add(txKey(t)), true));
      fresh.complete = complete;
      await this.#add(fresh, kept, 'newer');
    });
  }

  #key(address: string, part: string): string {
    return `ledger:${this.#scope()}:${address.toLowerCase()}:${part}`;
  }

  async status(address: string): Promise<LedgerStatus | null> {
    const s = await this.#state(address);
    if (s === null) return null;
    const { address: a, count, newest, oldest, complete, backfillRequests } = s;
    return { address: a, count, newest, oldest, complete, capped: s.capped === true, backfillRequests };
  }

  /**
   * What is new since the newest kept, kept and returned (pending ones too,
   * for the town, though they are not kept). On a first visit: the newest page.
   */
  head(address: string): Promise<TransactionResource[]> {
    return this.#serial(address, async () => {
      const s = await this.#state(address);
      if (s === null || s.newest === null) {
        const page = await this.#fetch(address, { pages: 1 });
        const kept = page.filter((t) => t.attributes.status !== 'pending');
        const fresh = this.#emptyState(address);
        fresh.complete = page.length < TX_PAGE_SIZE;
        await this.#add(fresh, kept, 'newer');
        return page;
      }
      const fetched = await this.#fetch(address, { since: s.newest - HEAD_OVERLAP_MS, pages: HEAD_MAX_PAGES });
      const known = await this.#knownSince(s, s.newest - HEAD_OVERLAP_MS);
      const kept = fetched.filter((t) => t.attributes.status !== 'pending' && !known.has(txKey(t)));
      if (kept.length > 0) await this.#add(s, kept, 'newer');
      return fetched;
    });
  }

  /**
   * One page further back in time (one request). Returns how many new
   * transactions it found; 0 once the first transaction is reached.
   */
  backfill(address: string): Promise<number> {
    return this.#serial(address, async () => {
      const s = await this.#state(address);
      if (s === null || s.complete || s.capped === true || s.cursor === null) return 0;
      if (s.count >= this.#cap) {
        s.capped = true;
        await this.#save(s);
        return 0;
      }
      const until = s.cursor;
      const page = await this.#fetch(address, { until, pages: 1 });
      s.backfillRequests++;
      const known = await this.#knownUntil(s, until);
      const older = page.filter((t) => t.attributes.status !== 'pending' && minedAt(t) <= until && !known.has(txKey(t)));
      if (page.length < TX_PAGE_SIZE) s.complete = true;
      if (older.length > 0) await this.#add(s, older, 'older');
      else if (!s.complete) {
        // a full page of what we already have: more than a page shares this
        // second. Step back past it (losing at most what shares that second).
        s.cursor = until - 1000;
        await this.#save(s);
        return 0;
      }
      if (older.length === 0) await this.#save(s);
      return older.length;
    });
  }

  /** Everything kept, newest first. */
  async all(address: string): Promise<TransactionResource[]> {
    const s = await this.#state(address);
    if (s === null) return [];
    const out: TransactionResource[] = [];
    for (const id of s.chunks) out.push(...(await this.#readChunk(address, id)));
    return out.sort(newestFirst);
  }

  /** The newest `n` kept, newest first (reads only the newest chunks). */
  async recent(address: string, n: number): Promise<TransactionResource[]> {
    const s = await this.#state(address);
    if (s === null) return [];
    const out: TransactionResource[] = [];
    for (let i = s.chunks.length - 1; i >= 0 && out.length < n; i--) out.push(...(await this.#readChunk(address, s.chunks[i]!)));
    return out.sort(newestFirst).slice(0, n);
  }

  // --- storage -----------------------------------------------------------------

  #emptyState(address: string): State {
    return { v: 1, address: address.toLowerCase(), count: 0, newest: null, oldest: null, complete: false, capped: false, backfillRequests: 0, chunks: [], nextChunk: 0, cursor: null };
  }

  async #state(address: string): Promise<State | null> {
    return (await this.#kv.get<State>(this.#key(address, 'state'))) ?? null;
  }

  async #save(s: State): Promise<void> {
    await this.#kv.put(this.#key(s.address, 'state'), s);
  }

  async #readChunk(address: string, id: number): Promise<TransactionResource[]> {
    const c = await this.#kv.get<Chunk>(this.#key(address, `chunk:${id}`));
    return c === undefined ? [] : (JSON.parse(await unpack(c.data)) as TransactionResource[]);
  }

  async #writeChunk(address: string, id: number, txs: TransactionResource[]): Promise<void> {
    const times = txs.map(minedAt);
    const chunk: Chunk = { newest: Math.max(...times), oldest: Math.min(...times), count: txs.length, data: await pack(JSON.stringify(txs)) };
    await this.#kv.put(this.#key(address, `chunk:${id}`), chunk);
  }

  /** Keys kept at or after `since` (they are all in the newest chunks). */
  async #knownSince(s: State, since: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = s.chunks.length - 1; i >= 0; i--) {
      const txs = await this.#readChunk(s.address, s.chunks[i]!);
      for (const t of txs) out.add(txKey(t));
      if (txs.every((t) => minedAt(t) < since)) break;
    }
    return out;
  }

  /** Keys kept at or before `until` (they are all in the oldest chunks). */
  async #knownUntil(s: State, until: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const id of s.chunks) {
      const txs = await this.#readChunk(s.address, id);
      for (const t of txs) out.add(txKey(t));
      if (txs.every((t) => minedAt(t) > until)) break;
    }
    return out;
  }

  /** Keep new transactions at the newer or the older end, topping up the end chunk while it is small. */
  async #add(s: State, txs: TransactionResource[], end: 'newer' | 'older'): Promise<void> {
    if (txs.length > 0) {
      const endId = end === 'newer' ? s.chunks.at(-1) : s.chunks[0];
      const last = endId !== undefined ? await this.#readChunk(s.address, endId) : [];
      let batch = txs.slice().sort(newestFirst);
      if (endId !== undefined && last.length < CHUNK_TARGET) {
        // top up the end chunk, then start new ones for the rest
        const room = CHUNK_TARGET - last.length;
        const take = end === 'newer' ? batch.slice(-room) : batch.slice(0, room);
        batch = end === 'newer' ? batch.slice(0, batch.length - take.length) : batch.slice(take.length);
        await this.#writeChunk(s.address, endId, [...last, ...take].sort(newestFirst));
      }
      // the rest in page-sized chunks, kept in time order
      const pieces: TransactionResource[][] = [];
      for (let i = 0; i < batch.length; i += CHUNK_TARGET) pieces.push(batch.slice(i, i + CHUNK_TARGET));
      if (end === 'newer') pieces.reverse(); // oldest piece first, so chunk ids run oldest → newest at this end
      for (const piece of pieces) {
        const id = s.nextChunk++;
        await this.#writeChunk(s.address, id, piece);
        if (end === 'newer') s.chunks.push(id);
        else s.chunks.unshift(id);
      }
      const times = txs.map(minedAt);
      s.count += txs.length;
      s.newest = Math.max(s.newest ?? -Infinity, ...times);
      s.oldest = Math.min(s.oldest ?? Infinity, ...times);
      s.cursor = s.oldest;
    }
    await this.#save(s);
  }

  #serial<T>(address: string, run: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const before = this.#busy.get(key) ?? Promise.resolve();
    const next = before.then(run, run);
    this.#busy.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}

// --- compression ---------------------------------------------------------------

async function pack(text: string): Promise<Uint8Array | string> {
  if (typeof CompressionStream === 'undefined') return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unpack(data: Uint8Array | string): Promise<string> {
  if (typeof data === 'string') return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
