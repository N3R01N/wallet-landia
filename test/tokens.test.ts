/**
 * What a token flies as: ETH (and its wrappers) as a diamond, stablecoins as
 * banknotes, bitcoin as ingots, the rest as coins with their own colour.
 */

import { describe, expect, it } from 'vitest';
import { iconColor, isStable, tokenStyle } from '../src/castle/scene/tokens.js';

describe('a token’s look', () => {
  it('ETH and its wrappers fly as the diamond, each in its colour', () => {
    expect(tokenStyle('ETH')).toEqual({ look: 'eth', model: 'fx.eth', color: '#627eea' });
    expect(tokenStyle('stETH').color).toBe('#00a3ff');
    expect(tokenStyle('rETH').color).toBe('#ff6e30');
    // value with no token named (a toll): ETH
    expect(tokenStyle('').look).toBe('eth');
    // a staking ETH we don't list is still ETH, in ETH's colour
    expect(tokenStyle('pufETH')).toEqual({ look: 'eth', model: 'fx.eth', color: '#627eea' });
  });

  it('stablecoins fly as banknotes in their brand colour (or measured)', () => {
    expect(tokenStyle('USDC')).toEqual({ look: 'note', model: 'fx.banknote', color: '#2775ca' });
    expect(tokenStyle('usdt').color).toBe('#009393');
    expect(tokenStyle('USDS')).toEqual({ look: 'note', model: 'fx.banknote', color: null });
    expect(isStable('DAI')).toBe(true);
    expect(isStable('ETH')).toBe(false);
  });

  it('bitcoin flies as an ingot; any other token as a coin, in its colour or measured', () => {
    expect(tokenStyle('WBTC').look).toBe('ingot');
    expect(tokenStyle('UNI')).toEqual({ look: 'coin', model: 'fx.coin', color: '#ff007a' });
    expect(tokenStyle('SOMETOKEN')).toEqual({ look: 'coin', model: 'fx.coin', color: null });
    // a long symbol ending in ETH is not taken for ETH
    expect(tokenStyle('NOTREALLYETH').look).toBe('coin');
  });
});

describe('a colour from an icon', () => {
  const px = (...colors: [number, number, number, number][]) => colors.flatMap((c) => Array.from({ length: 20 }, () => c)).flat();

  it('is the average of its clearly coloured pixels, ignoring white and see-through ones', () => {
    expect(iconColor(px([39, 117, 202, 255], [255, 255, 255, 255], [0, 0, 0, 0]))).toBe('#2775ca');
  });

  it('is dark for a black icon, and null for an all-white one', () => {
    expect(iconColor(px([20, 20, 20, 255], [255, 255, 255, 255]))).toBe('#141414');
    expect(iconColor(px([255, 255, 255, 255]))).toBeNull();
  });
});
