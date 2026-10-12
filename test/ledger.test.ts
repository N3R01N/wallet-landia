import { describe, expect, it } from 'vitest';
import { MemoryKV } from '../src/data/cache.js';
import { Ledger, txKey, type TxFetcher } from '../src/data/ledger.js';
import type { TransactionResource } from '../src/data/zerion/types.js';

const ADDR = '0xabc';
const T0 = Date.parse('2016-03-01T00:00:00Z');

function tx(i: number, at: number, status = 'confirmed', chain = 'ethereum'): TransactionResource {
  return {
    type: 'transactions',
    id: `id-${i}`,
    attributes: { hash: `0x${i.toString(16).padStart(64, '0')}`, mined_at: new Date(at).toISOString(), status, operation_type: 'send', transfers: [], approvals: [], fee: null },
    relationships: { chain: { data: { type: 'chains', id: chain } } },
  } as unknown as TransactionResource;
}

/** A pretend Zerion: newest first, inclusive time filters, 100 a page; counts requests (pages). */
function fakeZerion(history: TransactionResource[]): { fetch: TxFetcher; requests: () => number; history: TransactionResource[] } {
  let requests = 0;
  const at = (t: TransactionResource): number => Date.parse(t.attributes.mined_at);
  const fetch: TxFetcher = async (_address, o) => {
    const rows = history
      .filter((t) => (o.since === undefined || at(t) >= o.since) && (o.until === undefined || at(t) <= o.until))
      .sort((a, b) => at(b) - at(a));
    const out: TransactionResource[] = [];
    for (let p = 0; p < o.pages && p * 100 < rows.length; p++) {
      requests++;
      out.push(...rows.slice(p * 100, p * 100 + 100));
    }
    if (rows.length === 0) requests++;
    return out;
  };
  return { fetch, requests: () => requests, history };
}

/** A wallet ten years old: 1,234 transactions, an hour or more apart. */
function decade(n = 1234): TransactionResource[] {
  return Array.from({ length: n }, (_, i) => tx(i, T0 + i * 3_600_000 * 70));
}

async function fill(ledger: Ledger): Promise<number> {
  let steps = 0;
  while (!(await ledger.status(ADDR))!.complete && steps < 1000) {
    await ledger.backfill(ADDR);
    steps++;
  }
  return steps;
}

describe('the lifetime ledger', () => {
  it('fetches the newest page first, then walks back to the first transaction, one request a page', async () => {
    const z = fakeZerion(decade());
    const ledger = new Ledger(new MemoryKV(), z.fetch);
    const first = await ledger.head(ADDR);
    expect(first).toHaveLength(100);
    expect(z.requests()).toBe(1);
    const s0 = (await ledger.status(ADDR))!;
    expect(s0).toMatchObject({ count: 100, complete: false });

    const steps = await fill(ledger);
    const s = (await ledger.status(ADDR))!;
    expect(s.complete).toBe(true);
    expect(s.count).toBe(1234);
    expect(s.oldest).toBe(T0);
    // ~one request per hundred (the inclusive boundary repeats one a page)
    expect(steps).toBeLessThanOrEqual(13);
    expect(z.requests()).toBe(1 + steps);

    const all = await ledger.all(ADDR);
    expect(all).toHaveLength(1234);
    expect(new Set(all.map(txKey)).size).toBe(1234);
    expect(all.map((t) => Date.parse(t.attributes.mined_at))).toEqual([...all.map((t) => Date.parse(t.attributes.mined_at))].sort((a, b) => b - a));
  });

  it('on a restart asks only for what is new (one request), and keeps no duplicates', async () => {
    const z = fakeZerion(decade(300));
    const kv = new MemoryKV();
    const ledger = new Ledger(kv, z.fetch);
    await ledger.head(ADDR);
    await fill(ledger);
    const before = z.requests();
    const last = Date.parse(z.history.at(-1)!.attributes.mined_at);
    z.history.push(tx(9001, last + 60_000), tx(9002, last + 120_000), tx(9003, last + 30 * 60_000, 'pending'));
    // a new session: a fresh Ledger over the same storage
    const again = new Ledger(kv, z.fetch);
    const fresh = await again.head(ADDR);
    expect(z.requests() - before).toBe(1);
    expect(fresh.map((t) => t.id)).toEqual(expect.arrayContaining(['id-9001', 'id-9002', 'id-9003'])); // the town sees the pending one
    const s = (await again.status(ADDR))!;
    expect(s.count).toBe(302); // the pending one is not kept
    expect(new Set((await again.all(ADDR)).map(txKey)).size).toBe(302);
    expect((await again.recent(ADDR, 2)).map((t) => t.id)).toEqual(['id-9002', 'id-9001']);
  });

  it('after a long absence walks every new page, so there is no gap', async () => {
    const z = fakeZerion(decade(150));
    const ledger = new Ledger(new MemoryKV(), z.fetch);
    await ledger.head(ADDR);
    const last = Date.parse(z.history.at(-1)!.attributes.mined_at);
    for (let i = 0; i < 260; i++) z.history.push(tx(5000 + i, last + (i + 1) * 3_600_000));
    await ledger.head(ADDR);
    await fill(ledger);
    expect((await ledger.status(ADDR))!.count).toBe(410);
  });

  it('carries on where it stopped, even in a new session, and gets past a crowded second', async () => {
    // 250 transactions in the very same second (a busy bot), then older ones
    const crowd = Array.from({ length: 250 }, (_, i) => tx(i, T0 + 10_000_000));
    const older = Array.from({ length: 40 }, (_, i) => tx(1000 + i, T0 + i * 1000));
    const z = fakeZerion([...older, ...crowd]);
    const kv = new MemoryKV();
    await new Ledger(kv, z.fetch).head(ADDR);
    await new Ledger(kv, z.fetch).backfill(ADDR); // a second session
    const ledger = new Ledger(kv, z.fetch);
    await fill(ledger);
    const s = (await ledger.status(ADDR))!;
    expect(s.complete).toBe(true);
    // the older ones all arrive; of the crowded second, at least the first page's worth
    const ids = new Set((await ledger.all(ADDR)).map((t) => t.id));
    for (const t of older) expect(ids.has(t.id)).toBe(true);
    expect(s.count).toBeGreaterThanOrEqual(140);
  });

  it('a short wallet is complete after its first page', async () => {
    const z = fakeZerion(decade(42));
    const ledger = new Ledger(new MemoryKV(), z.fetch);
    await ledger.head(ADDR);
    expect((await ledger.status(ADDR))!).toMatchObject({ count: 42, complete: true });
    expect(await ledger.backfill(ADDR)).toBe(0);
    expect(z.requests()).toBe(1);
  });

  it('keeps each realm (chain set) and each wallet apart', async () => {
    const kv = new MemoryKV();
    let scope = 'ethereum';
    const ledger = new Ledger(kv, fakeZerion(decade(10)).fetch, () => scope);
    await ledger.head(ADDR);
    scope = 'ethereum+base';
    expect(await ledger.status(ADDR)).toBeNull();
    expect(await ledger.status('0xdef')).toBeNull();
    scope = 'ethereum';
    expect((await ledger.status(ADDR))!.count).toBe(10);
  });

  it('stores pages compressed', async () => {
    const kv = new MemoryKV();
    const ledger = new Ledger(kv, fakeZerion(decade(100)).fetch);
    await ledger.head(ADDR);
    const chunk = await kv.get<{ data: Uint8Array | string; count: number }>('ledger:ethereum:0xabc:chunk:0');
    expect(chunk?.count).toBe(100);
    expect(chunk?.data).toBeInstanceOf(Uint8Array);
    expect((chunk!.data as Uint8Array).length).toBeLessThan(JSON.stringify(await ledger.all(ADDR)).length / 4);
  });
});

describe('very busy wallets and saved histories', () => {
  it('stops walking back at the cap and says the history is partial', async () => {
    const z = fakeZerion(decade(1000));
    const ledger = new Ledger(new MemoryKV(), z.fetch, () => 'ethereum', 300);
    await ledger.head(ADDR);
    for (let i = 0; i < 20; i++) await ledger.backfill(ADDR);
    const s = (await ledger.status(ADDR))!;
    expect(s.capped).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.count).toBeGreaterThanOrEqual(300);
    expect(s.count).toBeLessThan(400);
  });

  it('replaces a wallet’s history from a file, then carries on from it', async () => {
    const z = fakeZerion(decade(250));
    const kv = new MemoryKV();
    const ledger = new Ledger(kv, z.fetch);
    await ledger.head(ADDR); // 100 kept
    await ledger.replace(ADDR, [...z.history, z.history[0]!, tx(77_777, T0, 'pending')], true);
    const s = (await ledger.status(ADDR))!;
    expect(s).toMatchObject({ count: 250, complete: true, oldest: T0 });
    expect(new Set((await ledger.all(ADDR)).map(txKey)).size).toBe(250);
    // afterwards only what is new is asked for
    const before = z.requests();
    await ledger.head(ADDR);
    expect(z.requests() - before).toBe(1);
  });
});
