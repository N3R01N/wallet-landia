/**
 * The daily request budget.
 *
 * Two things have to hold or the counter is worse than nothing: it must survive
 * a reload (a count that resets when the page does would always read zero), and
 * it must never report more headroom than there is — being told there are
 * requests left when there are none is how a user ends up staring at a city
 * that silently stopped updating.
 */

import { describe, expect, it } from 'vitest';
import {
  DailyBudget,
  FREE_DAILY_REQUESTS,
  nextUtcMidnight,
  untilReset,
  utcDay,
  type BudgetSnapshot,
  type BudgetStorage,
} from '../src/data/zerion/budget.js';

/** A localStorage stand-in that can also be inspected. */
function memoryStorage(seed: Record<string, string> = {}): BudgetStorage & {
  data: Record<string, string>;
} {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const NOON = Date.parse('2026-08-09T12:00:00Z');

describe('the day the count belongs to', () => {
  it('is the UTC day, not the local one', () => {
    expect(utcDay(Date.parse('2026-08-09T23:59:59Z'))).toBe('2026-08-09');
    expect(utcDay(Date.parse('2026-08-10T00:00:00Z'))).toBe('2026-08-10');
  });

  it('resets at the next UTC midnight', () => {
    expect(nextUtcMidnight(NOON)).toBe(Date.parse('2026-08-10T00:00:00Z'));
    // Exactly on midnight, the reset that matters is the *next* one.
    const midnight = Date.parse('2026-08-10T00:00:00Z');
    expect(nextUtcMidnight(midnight)).toBe(Date.parse('2026-08-11T00:00:00Z'));
  });

  it('says how long is left in units anyone waits in', () => {
    expect(untilReset(NOON + 3_600_000 * 5, NOON)).toBe('in 5 hours');
    expect(untilReset(NOON + 3_600_000 + 1_800_000, NOON)).toBe('in 1h 30m');
    expect(untilReset(NOON + 120_000, NOON)).toBe('in 2 minutes');
    expect(untilReset(NOON + 20_000, NOON)).toBe('in under a minute');
    // Already past is not negative time.
    expect(untilReset(NOON - 5_000, NOON)).toBe('in under a minute');
  });
});

describe('DailyBudget', () => {
  const at = (now: number, storage?: BudgetStorage): DailyBudget =>
    new DailyBudget({ storage: storage ?? memoryStorage(), now: () => now });

  it('starts the day with the free plan’s 2,000', () => {
    const budget = at(NOON);
    expect(budget.limit).toBe(FREE_DAILY_REQUESTS);
    expect(budget.limit).toBe(2000);
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(2000);
    expect(budget.exhausted).toBe(false);
  });

  it('counts what is spent, and is exhausted at the limit and not before', () => {
    const budget = new DailyBudget({ storage: memoryStorage(), now: () => NOON, limit: 3 });
    budget.spend();
    budget.spend();
    expect(budget.remaining).toBe(1);
    expect(budget.exhausted).toBe(false);
    budget.spend();
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it('never reports a negative remainder, however far past the wall it goes', () => {
    const budget = new DailyBudget({ storage: memoryStorage(), now: () => NOON, limit: 2 });
    budget.spend(10);
    expect(budget.used).toBe(10);
    expect(budget.remaining).toBe(0);
  });

  it('survives a reload on the same UTC day', () => {
    const storage = memoryStorage();
    at(NOON, storage).spend(7);

    const reloaded = at(NOON + 60_000, storage);
    expect(reloaded.used).toBe(7);
  });

  it('starts fresh on the next UTC day, even without a reload', () => {
    const storage = memoryStorage();
    let now = NOON;
    const budget = new DailyBudget({ storage, now: () => now });
    budget.spend(1999);
    expect(budget.remaining).toBe(1);

    // The tab was left open past midnight.
    now = Date.parse('2026-08-10T00:00:01Z');
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(2000);
  });

  it('ignores a count written on a different day', () => {
    const storage = memoryStorage({
      'zenigard/budget/v1': JSON.stringify({ day: '2026-08-08', used: 300 }),
    });
    expect(at(NOON, storage).used).toBe(0);
  });

  it('starts at zero rather than throwing on unreadable storage', () => {
    const storage = memoryStorage({ 'zenigard/budget/v1': 'not json{' });
    expect(at(NOON, storage).used).toBe(0);
  });

  it('runs without storage at all, for tests and private modes', () => {
    const budget = new DailyBudget({ storage: null, now: () => NOON });
    budget.spend();
    expect(budget.used).toBe(1);
  });

  it('keeps working when storage refuses to be written to', () => {
    const storage: BudgetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const budget = new DailyBudget({ storage, now: () => NOON });
    expect(() => budget.spend()).not.toThrow();
    expect(budget.used).toBe(1);
  });

  describe('reconciling with what Zerion reports', () => {
    // a key on a 300-a-day plan
    const at = (now: number): DailyBudget => new DailyBudget({ storage: memoryStorage(), now: () => now, limit: 300 });

    it('believes the API when it says fewer are left than we counted', () => {
      // The same key spent from another tab, or yesterday's session.
      const budget = at(NOON);
      budget.spend(10);
      budget.observeRemaining(40);
      expect(budget.used).toBe(260);
      expect(budget.remaining).toBe(40);
    });

    it('does not hand back requests when the API claims more headroom', () => {
      // A paid plan's larger day limit, or a different reset boundary. Either
      // way, believing it would un-spend requests this browser knows it sent.
      const budget = at(NOON);
      budget.spend(100);
      budget.observeRemaining(295);
      expect(budget.used).toBe(100);
    });

    it('takes an empty report as the wall', () => {
      const budget = at(NOON);
      budget.observeRemaining(0);
      expect(budget.exhausted).toBe(true);
    });

    it('ignores a missing or nonsense header', () => {
      const budget = at(NOON);
      budget.spend(5);
      budget.observeRemaining(null);
      budget.observeRemaining(Number.NaN);
      budget.observeLimit(null);
      budget.observeLimit(0);
      budget.observeLimit(Number.NaN);
      expect(budget.used).toBe(5);
      expect(budget.limit).toBe(300);
    });

    it('takes the plan’s day limit from Zerion, bigger or smaller, and keeps what was spent', () => {
      // the guess said 300; the key is on a plan with 2,000 (once, 300 cut players off with 1,700 left)
      const budget = at(NOON);
      budget.spend(300);
      expect(budget.exhausted).toBe(true);
      budget.observeLimit(2000);
      expect(budget.limit).toBe(2000);
      expect(budget.used).toBe(300);
      expect(budget.remaining).toBe(1700);
      budget.observeLimit(250);
      expect(budget.exhausted).toBe(true);
    });
  });

  it('remembers the learned limit across reloads and days, and forgets it on reset (a new key)', () => {
    const storage = memoryStorage();
    let now = NOON;
    const first = new DailyBudget({ storage, now: () => now });
    first.observeLimit(5000);
    now = Date.parse('2026-08-11T09:00:00Z');
    const later = new DailyBudget({ storage, now: () => now });
    expect(later.limit).toBe(5000);
    expect(later.used).toBe(0);
    later.reset();
    expect(later.limit).toBe(FREE_DAILY_REQUESTS);
    expect(new DailyBudget({ storage, now: () => now }).limit).toBe(FREE_DAILY_REQUESTS);
  });

  it('reports every move to whoever is drawing it', () => {
    const seen: BudgetSnapshot[] = [];
    const budget = new DailyBudget({
      storage: memoryStorage(),
      now: () => NOON,
      limit: 2,
      onChange: (snapshot) => seen.push(snapshot),
    });
    budget.spend();
    budget.spend();
    expect(seen.map((s) => s.used)).toEqual([1, 2]);
    expect(seen.at(-1)?.exhausted).toBe(true);
    expect(seen.at(-1)?.resetsAt).toBe(Date.parse('2026-08-10T00:00:00Z'));
  });
});

describe('several tabs on one key', () => {
  it('count on from each other rather than overwrite each other', () => {
    const storage = memoryStorage();
    const a = new DailyBudget({ storage, now: () => NOON });
    const b = new DailyBudget({ storage, now: () => NOON });
    a.spend(10);
    b.spend(5); // b started at 0, but a has spent 10 since
    expect(b.used).toBe(15);
    a.spend(1);
    expect(a.used).toBe(16);
  });
});
