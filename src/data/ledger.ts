/**
 * The lifetime ledger: every transaction a wallet ever made, fetched once and
 * kept in the browser, so a player's whole story (their level, their badges)
 * can be read from it. After that only what is new is asked for.
 *
 * Three passes, all with the player's own Zerion key:
 * - `head`: everything after the newest one kept (on a first visit: the
 *   newest page). It walks pages until it meets what is kept; past
 *   `HEAD_MAX_PAGES` (a very busy absence) it notes the stretch it skipped as a
 *   gap, which `backfill` fills first. This is also the town's own "anything
 *   new?" request.
 * - `backfill`: one page older than the oldest kept (`filter[max_mined_at]`),
 *   so it can stop anywhere and carry on next time, even days later. The
 *   wallet's first transaction is reached when Zerion has no next page.
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
import { isSpam, minedAt, txKey } from './zerion/tx.js';

export { isSpam, minedAt, txKey };

/**
 * What the ledger asks Zerion for: newest first, both ends inclusive, at most
 * `pages` pages, spam included (a short page must mean the end). `more`:
 * Zerion has a page after the last one fetched.
 */
export type TxFetcher = (address: string, o: { since?: number; until?: number; pages: number }) => Promise<{ txs: TransactionResource[]; more: boolean }>;

export interface LedgerStatus {
  address: string;
  /** Some newer stretch is still missing (`complete` stays false until it is fetched). */
  gap: boolean;
  /** Transactions kept (spam included). */
  count: number;
  /** Of which spam (Zerion's trash flag): kept, never shown nor counted for the player. */
  spam: number;
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

/**
 * A stretch `head` could not reach (more than `HEAD_MAX_PAGES` new pages):
 * everything after `since` and up to `until` (inclusive, walked back like the
 * cursor). Its chunks go right after chunk `after` (the newest kept before it).
 */
interface Gap {
  since: number;
  until: number;
  after: number | null;
}

interface State extends Omit<LedgerStatus, 'gap'> {
  /** 2: "complete" means Zerion had no next page (1 trusted a short page, which spam filtering could cut early). */
  v: 2;
  /** The realm it was read for (it is in every key): fixed for the whole pass, whatever the player switches to meanwhile. */
  scope: string;
  /** Chunk ids, oldest first. */
  chunks: number[];
  nextChunk: number;
  /** Where the next backfill page starts (ms, inclusive); normally the oldest kept. */
  cursor: number | null;
  gaps?: Gap[];
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
/** Decoded chunks kept in memory (in transactions): the player is rebuilt from the whole ledger often, and unzipping it each time is the cost. */
const DECODED_CAP = 60_000;

const isPending = (t: TransactionResource): boolean => t.attributes.status === 'pending';

/** Newest first, each date parsed once. */
export function sortNewestFirst(txs: readonly TransactionResource[]): TransactionResource[] {
  return txs
    .map((t) => [minedAt(t), t] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, t]) => t);
}

function span(txs: readonly TransactionResource[]): { newest: number; oldest: number } {
  // a loop, not Math.max(...times): a saved file can hold more than a call may take arguments
  let newest = -Infinity;
  let oldest = Infinity;
  for (const t of txs) {
    const at = minedAt(t);
    if (at > newest) newest = at;
    if (at < oldest) oldest = at;
  }
  return { newest, oldest };
}

/**
 * Per store, shared by every Ledger over it (a new key makes a new Ledger
 * while the old one may still be mid-pass): the passes queued per wallet, and
 * the decoded chunks.
 */
interface Shared {
  busy: Map<string, Promise<unknown>>;
  decoded: Map<string, TransactionResource[]>;
  decodedTxs: number;
}
const shared = new WeakMap<KV, Shared>();

export class Ledger {
  readonly #kv: KV;
  readonly #fetch: TxFetcher;
  readonly #scope: () => string;
  readonly #cap: number;
  readonly #shared: Shared;

  /** `scope`: which realm the history is for (the chain set), so a different one keeps its own. */
  constructor(kv: KV, fetch: TxFetcher, scope: () => string = () => 'ethereum', cap = LEDGER_CAP) {
    this.#kv = kv;
    this.#fetch = fetch;
    this.#scope = scope;
    this.#cap = cap;
    if (!shared.has(kv)) shared.set(kv, { busy: new Map(), decoded: new Map(), decodedTxs: 0 });
    this.#shared = shared.get(kv)!;
  }

  /**
   * Add a saved history (a file) to what is kept for a wallet: merged, so an
   * older file never costs what was gathered since. `complete`: the file
   * reaches back to the wallet's first transaction.
   */
  merge(address: string, txs: readonly TransactionResource[], complete: boolean): Promise<void> {
    return this.#serial(address, async () => {
      const scope = this.#scope();
      const old = await this.#state(address, scope);
      const byKey = new Map<string, TransactionResource>();
      if (old !== null) for (const id of old.chunks) for (const t of await this.#readChunk(old, id)) byKey.set(txKey(t), t);
      for (const t of txs) if (!isPending(t)) byKey.set(txKey(t), t);
      const fresh = this.#emptyState(address, scope);
      fresh.nextChunk = old?.nextChunk ?? 0;
      fresh.complete = complete || (old?.complete === true && (old.gaps ?? []).length === 0);
      fresh.backfillRequests = old?.backfillRequests ?? 0;
      // the new chunks and the state naming them first, the old chunks last: a
      // tab closed half way leaves stray chunks, never a state naming lost ones
      await this.#add(fresh, [...byKey.values()], 'newer');
      for (const id of old?.chunks ?? []) await this.#deleteChunk(old!, id);
    });
  }

  #key(scope: string, address: string, part: string): string {
    return `ledger:${scope}:${address.toLowerCase()}:${part}`;
  }

  async status(address: string): Promise<LedgerStatus | null> {
    const s = await this.#state(address, this.#scope());
    if (s === null) return null;
    const { address: a, count, newest, oldest, backfillRequests } = s;
    const gap = (s.gaps ?? []).length > 0;
    return { address: a, count, spam: s.spam ?? 0, newest, oldest, complete: s.complete && !gap, gap, capped: s.capped === true, backfillRequests };
  }

  /**
   * What is new since the newest kept, kept and returned (pending ones too,
   * for the town, though they are not kept). On a first visit: the newest page.
   */
  head(address: string): Promise<TransactionResource[]> {
    return this.#serial(address, async () => {
      const scope = this.#scope();
      const s = await this.#state(address, scope);
      if (s === null || s.newest === null) {
        const { txs: page, more } = await this.#fetch(address, { pages: 1 });
        const kept = page.filter((t) => !isPending(t));
        const fresh = this.#emptyState(address, scope);
        fresh.complete = !more;
        await this.#add(fresh, kept, 'newer');
        return page;
      }
      const since = s.newest - HEAD_OVERLAP_MS;
      const { txs: fetched, more } = await this.#fetch(address, { since, pages: HEAD_MAX_PAGES });
      const known = await this.#knownSince(s, since);
      const kept = fetched.filter((t) => !isPending(t) && !known.has(txKey(t)));
      if (more && kept.length > 0) {
        // stopped short of what is kept: note what lies between for backfill
        // (and keep this batch in chunks of its own, so the gap's go between)
        const gap: Gap = { since, until: span(kept).oldest, after: s.chunks.at(-1) ?? null };
        s.gaps = [...(s.gaps ?? []), gap];
        await this.#add(s, kept, 'newer', false);
      } else if (kept.length > 0) await this.#add(s, kept, 'newer');
      return fetched;
    });
  }

  /**
   * One page further back in time (one request). Returns how many new
   * transactions it found; 0 once the first transaction is reached.
   */
  backfill(address: string): Promise<number> {
    return this.#serial(address, async () => {
      const s = await this.#state(address, this.#scope());
      if (s === null || s.capped === true) return 0;
      if (s.count >= this.#cap) {
        s.capped = true;
        await this.#save(s);
        return 0;
      }
      if ((s.gaps ?? []).length > 0) return this.#fillGap(s);
      if (s.complete || s.cursor === null) return 0;
      const until = s.cursor;
      const { txs: page, more } = await this.#fetch(address, { until, pages: 1 });
      s.backfillRequests++;
      const known = await this.#knownUntil(s, until);
      const older = page.filter((t) => !isPending(t) && minedAt(t) <= until && !known.has(txKey(t)));
      // the end is when Zerion has no further page, not when a page is short
      if (!more) s.complete = true;
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

  /** One page of the newest gap, walking back from its `until` (one request). */
  async #fillGap(s: State): Promise<number> {
    const gap = s.gaps![0]!;
    const { txs: page, more } = await this.#fetch(s.address, { since: gap.since, until: gap.until, pages: 1 });
    s.backfillRequests++;
    // what can repeat: the boundary second with the page before, and the overlap with what was kept
    const at = gap.after === null ? -1 : s.chunks.indexOf(gap.after);
    const known = new Set<string>();
    for (const id of [s.chunks[at - 1], s.chunks[at], s.chunks[at + 1]]) if (id !== undefined) for (const t of await this.#readChunk(s, id)) known.add(txKey(t));
    const found = page.filter((t) => !isPending(t) && minedAt(t) <= gap.until && !known.has(txKey(t)));
    if (found.length > 0) {
      // walking back, each page is older than the last: its chunks go right after `after`
      const sorted = sortNewestFirst(found);
      const pieces: TransactionResource[][] = [];
      for (let i = 0; i < sorted.length; i += CHUNK_TARGET) pieces.unshift(sorted.slice(i, i + CHUNK_TARGET));
      const ids: number[] = [];
      for (const piece of pieces) {
        const id = s.nextChunk++;
        await this.#writeChunk(s, id, piece);
        ids.push(id);
      }
      s.chunks.splice(at + 1, 0, ...ids);
      s.count += found.length;
      s.spam = (s.spam ?? 0) + found.filter(isSpam).length;
      gap.until = span(found).oldest;
    } else if (more) gap.until -= 1000; // a crowded second, as in backfill
    if (!more || gap.until < gap.since) s.gaps = s.gaps!.slice(1);
    await this.#save(s);
    return found.length;
  }

  /** Everything kept, newest first. */
  async all(address: string): Promise<TransactionResource[]> {
    const s = await this.#state(address, this.#scope());
    if (s === null) return [];
    const out: TransactionResource[] = [];
    for (const id of s.chunks) for (const t of await this.#readChunk(s, id)) out.push(t);
    return sortNewestFirst(out);
  }

  /** The newest `n` kept, newest first (reads only the newest chunks). */
  async recent(address: string, n: number): Promise<TransactionResource[]> {
    const s = await this.#state(address, this.#scope());
    if (s === null) return [];
    const out: TransactionResource[] = [];
    for (let i = s.chunks.length - 1; i >= 0 && out.length < n; i--) out.push(...(await this.#readChunk(s, s.chunks[i]!)));
    return sortNewestFirst(out).slice(0, n);
  }

  // --- storage -----------------------------------------------------------------

  #emptyState(address: string, scope: string): State {
    return { v: 2, scope, address: address.toLowerCase(), count: 0, spam: 0, newest: null, oldest: null, complete: false, capped: false, backfillRequests: 0, chunks: [], nextChunk: 0, cursor: null };
  }

  async #state(address: string, scope: string): Promise<State | null> {
    const s = (await this.#kv.get<State | (Omit<State, 'v'> & { v: 1 })>(this.#key(scope, address, 'state'))) ?? null;
    if (s === null) return null;
    if (s.v === 1) {
      // gathered when a short page was taken for the end: look again from the oldest kept (one request if it really was)
      return { ...s, v: 2, scope, complete: false, spam: s.spam ?? 0, cursor: s.oldest ?? s.cursor };
    }
    return { ...s, scope };
  }

  async #save(s: State): Promise<void> {
    await this.#kv.put(this.#key(s.scope, s.address, 'state'), s);
  }

  /** A chunk's transactions (shared: callers must not change them). A chunk that cannot be read counts as missing. */
  async #readChunk(s: State, id: number): Promise<TransactionResource[]> {
    const key = this.#key(s.scope, s.address, `chunk:${id}`);
    const hit = this.#shared.decoded.get(key);
    if (hit !== undefined) {
      // most recently used last
      this.#shared.decoded.delete(key);
      this.#shared.decoded.set(key, hit);
      return hit;
    }
    const c = await this.#kv.get<Chunk>(key);
    if (c === undefined) return [];
    let txs: TransactionResource[];
    try {
      txs = JSON.parse(await unpack(c.data)) as TransactionResource[];
    } catch (error) {
      console.warn(`ledger: chunk ${id} of ${s.address} is unreadable`, error);
      return [];
    }
    this.#remember(key, txs);
    return txs;
  }

  async #writeChunk(s: State, id: number, txs: TransactionResource[]): Promise<void> {
    const key = this.#key(s.scope, s.address, `chunk:${id}`);
    const chunk: Chunk = { ...span(txs), count: txs.length, data: await pack(JSON.stringify(txs)) };
    this.#forget(key);
    await this.#kv.put(key, chunk);
    this.#remember(key, txs);
  }

  async #deleteChunk(s: State, id: number): Promise<void> {
    const key = this.#key(s.scope, s.address, `chunk:${id}`);
    this.#forget(key);
    await this.#kv.delete(key);
  }

  #remember(key: string, txs: TransactionResource[]): void {
    const d = this.#shared;
    this.#forget(key);
    d.decoded.set(key, txs);
    d.decodedTxs += txs.length;
    for (const [k, v] of d.decoded) {
      if (d.decodedTxs <= DECODED_CAP) break;
      d.decoded.delete(k);
      d.decodedTxs -= v.length;
    }
  }

  #forget(key: string): void {
    const d = this.#shared;
    const had = d.decoded.get(key);
    if (had === undefined) return;
    d.decoded.delete(key);
    d.decodedTxs -= had.length;
  }

  /** Keys kept at or after `since` (they are all in the newest chunks). */
  async #knownSince(s: State, since: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = s.chunks.length - 1; i >= 0; i--) {
      const txs = await this.#readChunk(s, s.chunks[i]!);
      for (const t of txs) out.add(txKey(t));
      if (txs.every((t) => minedAt(t) < since)) break;
    }
    return out;
  }

  /** Keys kept at or before `until` (they are all in the oldest chunks). */
  async #knownUntil(s: State, until: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const id of s.chunks) {
      const txs = await this.#readChunk(s, id);
      for (const t of txs) out.add(txKey(t));
      if (txs.every((t) => minedAt(t) > until)) break;
    }
    return out;
  }

  /**
   * Keep new transactions at the newer or the older end, topping up the end
   * chunk while it is small (`topUp` false: in chunks of their own).
   */
  async #add(s: State, txs: TransactionResource[], end: 'newer' | 'older', topUp = true): Promise<void> {
    if (txs.length > 0) {
      const endId = end === 'newer' ? s.chunks.at(-1) : s.chunks[0];
      const last = endId !== undefined && topUp ? await this.#readChunk(s, endId) : [];
      let batch = sortNewestFirst(txs);
      if (endId !== undefined && topUp && last.length < CHUNK_TARGET) {
        // top up the end chunk, then start new ones for the rest
        const room = CHUNK_TARGET - last.length;
        const take = end === 'newer' ? batch.slice(-room) : batch.slice(0, room);
        batch = end === 'newer' ? batch.slice(0, batch.length - take.length) : batch.slice(take.length);
        await this.#writeChunk(s, endId, sortNewestFirst([...last, ...take]));
      }
      // the rest in page-sized chunks, kept in time order
      const pieces: TransactionResource[][] = [];
      for (let i = 0; i < batch.length; i += CHUNK_TARGET) pieces.push(batch.slice(i, i + CHUNK_TARGET));
      if (end === 'newer') pieces.reverse(); // oldest piece first, so chunk ids run oldest → newest at this end
      for (const piece of pieces) {
        const id = s.nextChunk++;
        await this.#writeChunk(s, id, piece);
        if (end === 'newer') s.chunks.push(id);
        else s.chunks.unshift(id);
      }
      const { newest, oldest } = span(txs);
      s.count += txs.length;
      s.spam = (s.spam ?? 0) + txs.filter(isSpam).length;
      s.newest = Math.max(s.newest ?? -Infinity, newest);
      s.oldest = Math.min(s.oldest ?? Infinity, oldest);
      // only walking back moves the cursor: new arrivals must not undo a step past a crowded second
      if (end === 'older' || s.cursor === null) s.cursor = s.oldest;
    }
    await this.#save(s);
  }

  #serial<T>(address: string, run: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const busy = this.#shared.busy;
    const before = busy.get(key) ?? Promise.resolve();
    const next = before.then(run, run);
    busy.set(
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
