import { describe, expect, it } from 'vitest';
import { harvestOf, loanHealth, priceMove } from '../src/domain/risk.js';
import type { Stash, StashEntry } from '../src/domain/model.js';

const entry = (kind: StashEntry['kind'], usd: number): StashEntry => ({ name: '', symbol: 'X', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });
const stash = (protocolId: string, ...entries: StashEntry[]): Stash => ({ protocolId, entries, netUsd: entries.reduce((s, e) => s + e.usd, 0), grossUsd: 0, tier: 3, hasRewards: entries.some((e) => e.kind === 'reward'), hasDebt: entries.some((e) => e.kind === 'loan') });

describe('loan health', () => {
  it('estimates a health factor from collateral and debt, from safe to near liquidation', () => {
    expect(loanHealth(stash('a', entry('deposit', 10_000)))).toBeNull();
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -2_000)))).toMatchObject({ health: 4, level: 'safe', ltv: 0.2 });
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -5_000)))?.level).toBe('watch'); // 1.6
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -6_500)))?.level).toBe('danger'); // 1.23
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -7_500)))?.level).toBe('critical'); // 1.07
  });
});

describe('harvests and the market', () => {
  it('sizes a harvest: a little, some, a lot', () => {
    expect(harvestOf(stash('a', entry('reward', 0.5)))).toBeNull();
    expect(harvestOf(stash('a', entry('reward', 12)))?.size).toBe('little');
    expect(harvestOf(stash('a', entry('reward', 300)))?.size).toBe('some');
    expect(harvestOf(stash('a', entry('reward', 2500)))?.size).toBe('lot');
  });

  it('reads how ETH moved since the last visit', () => {
    expect(priceMove(3300, { usd: 3000, at: 0 })).toMatchObject({ mood: 'boom' });
    expect(priceMove(3060, { usd: 3000, at: 0 }).mood).toBe('up');
    expect(priceMove(3010, { usd: 3000, at: 0 }).mood).toBe('flat');
    expect(priceMove(2900, { usd: 3000, at: 0 }).mood).toBe('down');
    expect(priceMove(2500, { usd: 3000, at: 0 }).pct).toBeCloseTo(-16.67, 1);
  });
});
