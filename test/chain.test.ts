import { describe, expect, it } from 'vitest';
import { ethPriceFrom, initialChain, nextChain, tollOf } from '../src/world/chain.js';

describe('the chain at the tower', () => {
  it('ignores a repeated block', () => {
    const c = nextChain(initialChain(), { number: 2, busy: 0, baseFeeGwei: 9, txCount: 10 });
    expect(nextChain(c, { number: 2, busy: 1, baseFeeGwei: 99, txCount: 1 })).toBe(c);
  });

  it('reads the toll: dear or cheap by what a transfer costs, and where it is heading', () => {
    const at = (busy: number, gwei: number) => nextChain(initialChain(), { number: 1, busy, baseFeeGwei: gwei, txCount: 0 });
    const cheap = tollOf(at(0.3, 0.1), 4000);
    expect(cheap.transferUsd).toBeCloseTo(0.1e-9 * 21000 * 4000);
    expect(cheap.level).toBe('low');
    expect(cheap.trend).toBe(-1); // under half full: the fee falls
    const dear = tollOf(at(0.9, 60), 4000);
    expect(dear.level).toBe('high');
    expect(dear.trend).toBe(1);
    expect(dear.heat).toBeGreaterThan(cheap.heat);
    // no ETH price: judged by gwei alone
    expect(tollOf(at(0.5, 60), null)).toMatchObject({ transferUsd: null, level: 'high', trend: 0 });
    // before any block: calm, unknown
    expect(tollOf(initialChain(), 4000)).toMatchObject({ gwei: null, trend: 0, level: 'low' });
  });

  it('takes an ETH price from what the guild holds', () => {
    expect(ethPriceFrom([{ symbol: 'ETH', category: 'native', quantity: 2, usd: 8000 }, { symbol: 'USDC', category: 'stable', quantity: 5, usd: 5 }])).toBe(4000);
    expect(ethPriceFrom([])).toBeNull();
  });
});
