import { describe, expect, it } from 'vitest';
import { SIZE_MAX, SIZE_MIN, sizeFor, tvlOf, TVL_UPDATED } from '../src/castle/world/size.js';

describe('sizes by value', () => {
  it('$1M is a 2 × 2 m house; ten times the value about 1.6 times the size; a thousand times about 4', () => {
    expect(sizeFor(1e6)).toBeCloseTo(1);
    expect(sizeFor(1e7)).toBeCloseTo(10 ** 0.2, 3);
    expect(sizeFor(1e9)).toBeCloseTo(10 ** 0.6, 3);
  });

  it('a protocol of billions dwarfs a castle of a million, within readable bounds', () => {
    expect(sizeFor(15e9) / sizeFor(1e6)).toBeGreaterThan(6);
    expect(sizeFor(1e15)).toBe(SIZE_MAX);
    expect(sizeFor(10)).toBe(SIZE_MIN);
    expect(sizeFor(Number.NaN)).toBe(1); // unknown: a house
  });

  it('the snapshot knows the big protocols by family, whatever their version', () => {
    expect(TVL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tvlOf('aave-v3')).toBeGreaterThan(1e9);
    expect(tvlOf('aave-v2')).toBe(tvlOf('aave-v3'));
    expect(tvlOf('lido')).toBeGreaterThan(1e9);
    expect(tvlOf('no-such-protocol-xyz')).toBeNull();
  });
});
