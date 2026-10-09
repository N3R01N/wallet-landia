import { describe, expect, it } from 'vitest';
import { LiveLoader, mergeHistory } from '../src/data/live.js';
import { MemoryKV } from '../src/data/cache.js';
import { DailyBudget } from '../src/data/zerion/budget.js';
import { ZerionClient } from '../src/data/zerion/client.js';
import type { TransactionResource } from '../src/data/zerion/types.js';

const ADDR = '0x8ebfe0a1b5989c87f3c34bec8c160cf9e80b2a78';

function tx(hash: string, minedAt: string, status: 'confirmed' | 'pending' = 'confirmed'): TransactionResource {
  return {
    type: 'transactions',
    id: hash,
    attributes: {
      operation_type: 'send',
      hash,
      mined_at_block: 1,
      mined_at: minedAt,
      sent_from: ADDR,
      sent_to: '0x1',
      status,
      nonce: 1,
      fee: { value: 1, price: null },
      transfers: [],
    },
    relationships: { chain: { data: { type: 'chains', id: 'ethereum' } } },
  };
}

/** A fake Zerion: counts requests, serves a growing tx feed. */
function fakeZerion(feed: TransactionResource[]): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/portfolio')) return json({ data: { type: 'portfolio', id: ADDR, attributes: { total: { positions: 1000 } } } });
    if (url.includes('/transactions/')) {
      const since = Number(new URL(url).searchParams.get('filter[min_mined_at]') ?? 0);
      return json({ data: feed.filter((t) => Date.parse(t.attributes.mined_at) >= since), links: {} });
    }
    return json({ data: [], links: {} });
  }) as typeof fetch;
  return { fetch: f, urls };
}

describe('LiveLoader request budget', () => {
  it('cold 5, warm reload 0, stale history 1 (+2 for the tokens a new transaction moved), stale valuations 5', async () => {
    const feed = [tx('0xa', '2026-10-07T10:00:00Z')];
    const z = fakeZerion(feed);
    let now = Date.parse('2026-10-08T12:00:00Z');
    const budget = new DailyBudget({ storage: null, now: () => now });
    const client = new ZerionClient({ apiKey: 'k', transport: 'direct', fetch: z.fetch, budget, requestsPerSecond: 1000 });
    const loader = new LiveLoader({ apiKey: 'k', budget, cache: new MemoryKV(), client, now: () => now });

    await loader.load(ADDR, 'me');
    expect(z.urls.length).toBe(5);

    now += 60_000; // a reload a minute later
    await loader.load(ADDR, 'me');
    expect(z.urls.length).toBe(5);

    now += 2 * 60_000; // history stale, valuations not
    feed.push(tx('0xb', '2026-10-08T12:02:00Z'));
    const raw = await loader.load(ADDR, 'me');
    expect(z.urls.length).toBe(8);
    expect(raw.transactions.map((t) => t.attributes.hash)).toEqual(['0xb', '0xa']);

    now += 10 * 60_000; // both stale
    await loader.load(ADDR, 'me');
    expect(z.urls.length).toBe(13);
    expect(budget.used).toBe(13);
  });

  it('with a fingerprint, an unmoved wallet comes from the cache; a moved one costs only what it moved', async () => {
    const feed = [tx('0xa', '2026-10-07T10:00:00Z')];
    const z = fakeZerion(feed);
    let now = Date.parse('2026-10-08T12:00:00Z');
    const budget = new DailyBudget({ storage: null, now: () => now });
    const client = new ZerionClient({ apiKey: 'k', transport: 'direct', fetch: z.fetch, budget, requestsPerSecond: 1000 });
    const loader = new LiveLoader({ apiKey: 'k', budget, cache: new MemoryKV(), client, now: () => now });

    await loader.load(ADDR, 'them', { print: '1:100' });
    expect(z.urls.length).toBe(5); // a first visit fetches everything

    now += 20 * 60_000; // back 20 minutes later, nothing moved: free
    await loader.load(ADDR, 'them', { print: '1:100' });
    expect(z.urls.length).toBe(5);

    now += 1 * 60_000; // they sent tokens: the new tail (1) and their tokens (2)
    feed.push(tx('0xb', '2026-10-08T12:20:00Z'));
    const raw = await loader.load(ADDR, 'them', { print: '2:90' });
    expect(z.urls.length).toBe(8);
    expect(raw.transactions.map((t) => t.attributes.hash)).toEqual(['0xb', '0xa']);

    now += 31 * 60_000; // quiet, but incoming tokens could have arrived: the tail only
    await loader.load(ADDR, 'them', { print: '2:90' });
    expect(z.urls.length).toBe(9);

    now += 30 * 60_000; // an hour since the last full measure: prices drift, measure again (the tail is 30 min old: not yet)
    await loader.load(ADDR, 'them', { print: '2:90' });
    expect(z.urls.length).toBe(9 + 4);
  });

  it('a protocol transaction re-measures positions and NFTs too', async () => {
    const feed = [tx('0xa', '2026-10-07T10:00:00Z')];
    const z = fakeZerion(feed);
    let now = Date.parse('2026-10-08T12:00:00Z');
    const budget = new DailyBudget({ storage: null, now: () => now });
    const client = new ZerionClient({ apiKey: 'k', transport: 'direct', fetch: z.fetch, budget, requestsPerSecond: 1000 });
    const loader = new LiveLoader({ apiKey: 'k', budget, cache: new MemoryKV(), client, now: () => now });
    await loader.load(ADDR, 'them', { print: '1:100' });
    now += 10 * 60_000;
    const swap = tx('0xc', '2026-10-08T12:05:00Z');
    swap.attributes.operation_type = 'trade';
    feed.push(swap);
    await loader.load(ADDR, 'them', { print: '2:100' });
    expect(z.urls.length).toBe(5 + 1 + 4);
  });

  it('refreshHistory costs one request and reports what is new', async () => {
    const feed = [tx('0xa', '2026-10-07T10:00:00Z')];
    const z = fakeZerion(feed);
    const now = Date.parse('2026-10-08T12:00:00Z');
    const budget = new DailyBudget({ storage: null, now: () => now });
    const client = new ZerionClient({ apiKey: 'k', transport: 'direct', fetch: z.fetch, budget, requestsPerSecond: 1000 });
    const loader = new LiveLoader({ apiKey: 'k', budget, cache: new MemoryKV(), client, now: () => now });
    await loader.load(ADDR, 'me');
    feed.push(tx('0xc', '2026-10-08T11:59:00Z'));
    const r = await loader.refreshHistory(ADDR);
    expect(r?.added).toBe(1);
    expect(z.urls.length).toBe(6);
  });
});

describe('mergeHistory', () => {
  it('replaces a pending entry with its confirmed self and keeps newest first', () => {
    const merged = mergeHistory([tx('0xa', '2026-10-01T00:00:00Z', 'pending')], [tx('0xa', '2026-10-01T00:00:10Z'), tx('0xb', '2026-10-02T00:00:00Z')]);
    expect(merged.map((t) => [t.attributes.hash, t.attributes.status])).toEqual([['0xb', 'confirmed'], ['0xa', 'confirmed']]);
  });
  it('caps the history', () => {
    const many = Array.from({ length: 30 }, (_, i) => tx(`0x${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    expect(mergeHistory([], many, 10)).toHaveLength(10);
  });
});

describe('LiveLoader valuations', () => {
  it('re-measuring costs 4 (full), 2 (tokens) or 1 (total) requests', async () => {
    const z = fakeZerion([tx('0xa', '2026-10-07T10:00:00Z')]);
    const now = Date.parse('2026-10-08T12:00:00Z');
    const budget = new DailyBudget({ storage: null, now: () => now });
    const client = new ZerionClient({ apiKey: 'k', transport: 'direct', fetch: z.fetch, budget, requestsPerSecond: 1000 });
    const loader = new LiveLoader({ apiKey: 'k', budget, cache: new MemoryKV(), client, now: () => now });
    await loader.load(ADDR, 'me');
    await loader.refreshValuations(ADDR, 'full');
    expect(z.urls.length).toBe(9);
    await loader.refreshValuations(ADDR, 'total');
    expect(z.urls.length).toBe(10);
    expect(z.urls[9]).toContain('/portfolio');
    await loader.refreshValuations(ADDR, 'tokens');
    expect(z.urls.length).toBe(12);
  });
});
