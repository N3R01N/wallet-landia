import { afterAll, describe, expect, it } from 'vitest';

// A browser enough for Session: storage with a dummy key, a visible tab.
const store = new Map<string, string>();
const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const g = globalThis as unknown as Record<string, unknown>;
g.window = { localStorage: ls, addEventListener: () => {} };
g.localStorage = ls;
g.document = { visibilityState: 'visible', hidden: false };
store.set('zenigard/zerion-key', 'zk_dummy_not_a_real_key');

const BUSY = `0x${'1'.repeat(40)}`;
let nonce = 1;
let zerion = 0;
let clock = Date.UTC(2026, 9, 23, 1, 0, 0);
const realNow = Date.now;
const t0 = realNow();
Date.now = () => clock + (realNow() - t0);
afterAll(() => {
  Date.now = realNow;
});

let seq = 0;
const tx = (at: number) => ({
  type: 'transactions',
  id: `tx${seq}`,
  attributes: { operation_type: 'trade', hash: `0x${(seq++).toString(16).padStart(64, '0')}`, mined_at: new Date(at).toISOString(), status: 'confirmed', sent_from: BUSY, sent_to: BUSY, transfers: [], flags: { is_trash: false } },
  relationships: { chain: { data: { id: 'ethereum' } } },
});
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'RateLimit-Org-Second-Limit': '1000' } });
g.fetch = async (url: string, init?: { method?: string; body?: string }) => {
  if (init?.method === 'POST') {
    // the public RPC: the busy wallet's nonce moves every block
    const calls = JSON.parse(init.body ?? '[]') as { id: number; method: string }[];
    return json(calls.map((c) => ({ id: c.id, result: c.method === 'eth_getTransactionCount' ? `0x${nonce.toString(16)}` : '0x1' })));
  }
  zerion++;
  const u = String(url);
  // always another full page: a wallet busier than any page cap
  if (u.includes('/transactions/')) return json({ data: Array.from({ length: 100 }, () => tx(Date.now() - 1000)), links: { next: `https://api.zerion.io/v1/wallets/x/transactions/?page=${seq}` } });
  if (u.includes('/portfolio')) return json({ data: { type: 'portfolio', id: 'p', attributes: { total: { positions: 0 }, positions_distribution_by_type: {}, changes: {} } } });
  return json({ data: [], links: {} });
};

describe('a visited town on every block', () => {
  it('spends at most one page per wallet every couple of minutes, not up to 50 pages a block', async () => {
    const { Session } = await import('../src/data/session.js');
    const { loadPrefs } = await import('../src/settings.js');
    const s = new Session(loadPrefs(), { onTown() {}, onUpdate() {}, onStatus() {}, onBudget() {} });
    await s.visit([BUSY], 'link');
    await new Promise((r) => setTimeout(r, 20)); // the first fingerprint is a baseline
    const perBlock: number[] = [];
    for (let b = 0; b < 5; b++) {
      nonce++;
      clock += 12_000;
      const before = zerion;
      await s.onBlock();
      perBlock.push(zerion - before);
    }
    // one refresh (a page and a re-measure) in the first block, then nothing until the interval is up
    expect(perBlock[0]).toBeLessThanOrEqual(5);
    expect(perBlock.slice(1)).toEqual([0, 0, 0, 0]);
  }, 60_000);
});
