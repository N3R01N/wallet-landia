import { describe, expect, it } from 'vitest';
import { Backfill, mayBackfill } from '../src/data/backfill.js';
import type { Ledger, LedgerStatus } from '../src/data/ledger.js';
import { ZerionError } from '../src/data/zerion/client.js';
import type { BudgetSnapshot } from '../src/data/zerion/budget.js';

/** A sleep that takes no time but lets the event loop turn (an instant promise would starve it). */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const budget = (remaining: number, limit = 300): BudgetSnapshot => ({ used: limit - remaining, limit, remaining, exhausted: remaining <= 0, resetsAt: 0 });

/** A stand-in ledger: each wallet needs `pages` backfill steps; records the order of the steps. */
function fakeLedger(pages: Record<string, number>, fail?: (address: string) => Error | null): { ledger: Ledger; steps: string[] } {
  const done = new Map(Object.keys(pages).map((a) => [a, 0]));
  const steps: string[] = [];
  const status = (a: string): LedgerStatus | null =>
    done.has(a) ? { address: a, count: done.get(a)! * 100, newest: 0, oldest: 0, complete: done.get(a)! >= pages[a]!, gap: false, capped: false, spam: 0, backfillRequests: done.get(a)! } : null;
  const ledger = {
    status: async (a: string) => status(a),
    backfill: async (a: string) => {
      const e = fail?.(a) ?? null;
      if (e) throw e;
      steps.push(a);
      done.set(a, done.get(a)! + 1);
      return 100;
    },
  } as unknown as Ledger;
  return { ledger, steps };
}

/** Runs the loop to its end with an instant clock (sleeps are counted, not waited). */
async function runToEnd(b: Backfill, addresses: string[], until: () => boolean): Promise<void> {
  b.start(addresses);
  for (let i = 0; i < 500 && !until(); i++) await new Promise((r) => setTimeout(r, 0));
}

describe('reaching back through a wallet’s whole history', () => {
  it('keeps a share of the day’s requests for the town', () => {
    expect(mayBackfill(budget(300), 0.4)).toBe(true);
    expect(mayBackfill(budget(121), 0.4)).toBe(true);
    expect(mayBackfill(budget(120), 0.4)).toBe(false);
    expect(mayBackfill(budget(0), 0.4)).toBe(false);
    expect(mayBackfill(budget(1200, 2000), 0.4)).toBe(true);
  });

  it('walks every wallet back, taking turns, until each reaches its first transaction', async () => {
    const { ledger, steps } = fakeLedger({ '0xa': 3, '0xb': 1, '0xc': 2 });
    let last: LedgerStatus[] = [];
    const b = new Backfill({ ledger, budget: () => budget(300), onProgress: (s) => (last = s), sleep: tick, visible: () => true });
    await runToEnd(b, ['0xa', '0xb', '0xc'], () => b.paused === 'done');
    expect(b.paused).toBe('done');
    expect(steps).toHaveLength(6);
    // a page each in turn: nobody waits for a big wallet to finish
    expect(steps.slice(0, 3).sort()).toEqual(['0xa', '0xb', '0xc']);
    expect(last.every((s) => s.complete)).toBe(true);
  });

  it('waits while the tab is hidden or the budget is low, and carries on after', async () => {
    const { ledger, steps } = fakeLedger({ '0xa': 2 });
    let visible = false;
    let left = 100;
    const b = new Backfill({ ledger, budget: () => budget(left), onProgress: () => undefined, sleep: tick, visible: () => visible });
    b.start(['0xa']);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(b.paused).toBe('hidden');
    visible = true;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(b.paused).toBe('budget');
    expect(steps).toEqual([]);
    left = 300;
    for (let i = 0; i < 50 && b.paused !== 'done'; i++) await new Promise((r) => setTimeout(r, 0));
    expect(steps).toEqual(['0xa', '0xa']);
    b.stop();
  });

  it('stops for good when the key is refused, and leaves wallets the town never loaded alone', async () => {
    const { ledger, steps } = fakeLedger({ '0xa': 5 }, () => new ZerionError('auth', 'no', 401, ''));
    const b = new Backfill({ ledger, budget: () => budget(300), onProgress: () => undefined, sleep: tick, visible: () => true });
    await runToEnd(b, ['0xa', '0xnever'], () => b.paused === 'auth');
    expect(b.paused).toBe('auth');
    expect(steps).toEqual([]);
  });
});
