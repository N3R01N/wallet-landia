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

describe('size classes', () => {
  it('a footprint takes the nearest class, by ratio', async () => {
    const { sizeClassOf } = await import('../src/castle/assets/manifest.js');
    expect([1.2, 2, 2.4, 3, 4, 5, 6.5, 8, 10, 12, 16].map(sizeClassOf)).toEqual(['xs', 'xs', 'xs', 's', 'm', 'm', 'l', 'l', 'xl', 'xl', 'xl']);
  });
});

describe('preview towns', () => {
  it('?preview= puts landmarks at their real value, and categories at a given value, into town', async () => {
    const { previewWorld } = await import('../src/castle/world/world.js');
    const base = { wallets: 1, walletIds: ['0x1'], walletTiers: [0], tier: 0, protocols: [], errands: [], ethUsd: null } as unknown as Parameters<typeof previewWorld>[0];
    const w = previewWorld(base, 'lido, lending:5e6, nonsense');
    expect(w.protocols.map((p) => [p.signature, p.category])).toEqual([['lido', 'staking'], [null, 'lending']]);
    expect(w.protocols[0]!.size).toBeCloseTo(sizeFor(tvlOf('lido')!), 3);
    expect(w.protocols[1]!.size).toBeCloseTo(sizeFor(5e6), 3);
    expect(previewWorld(base, 'nonsense')).toBe(base);
  });
});

describe('protocol logos', () => {
  it('small protocols a wallet may hold have a logo too (Tokemak under its new name, Mooniswap, Botto)', async () => {
    const { logoPath } = await import('../src/castle/world/logos.js');
    expect(logoPath('tokemak')).toBe('logos/autofinance.webp');
    expect(logoPath('mooniswap')).toMatch(/^logos\/mooniswap\./);
    expect(logoPath('botto')).toMatch(/^logos\/botto\./);
    expect(logoPath('aave-v3')).toMatch(/^logos\/aave\./);
  });
});
