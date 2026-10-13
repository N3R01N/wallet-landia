import { describe, expect, it } from 'vitest';
import { populationFor } from '../src/world/population.js';

describe('the population follows the net worth', () => {
  it('grows with wealth, on a log scale, and is capped', () => {
    expect(populationFor(0)).toBe(4);
    expect(populationFor(1_000)).toBe(6);
    expect(populationFor(100_000)).toBe(16);
    expect(populationFor(1e12)).toBe(40);
    expect(populationFor(1_000)).toBeLessThan(populationFor(100_000));
  });
  it('is never negative or NaN', () => {
    expect(populationFor(-5)).toBe(4);
    expect(populationFor(Number.NaN)).toBe(4);
  });
});
