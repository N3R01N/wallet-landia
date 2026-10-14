import { describe, expect, it } from 'vitest';
import { castleBadges } from '../src/castle/world/castleBadges.js';
import type { CastleWorld, WorldProtocol } from '../src/castle/world/world.js';

const proto = (category: WorldProtocol['category']): WorldProtocol => ({ id: category, name: category, category, tier: 1, signature: null, holdings: [], visits: 0 });
const world = (over: Partial<CastleWorld> = {}): CastleWorld => ({ wallets: 1, walletIds: ['0xa'], walletTiers: [2], ethUsd: null, tier: 2, protocols: [proto('dex')], errands: [], ...over });
const byId = (w: CastleWorld, signed = 0) => new Map(castleBadges(w, { signed }).map((b) => [b.id, b]));

describe('castle badges', () => {
  it('towers: three for Castle Builder, eight for Gatehouse Lord', () => {
    expect(byId(world({ wallets: 2 })).get('castle-builder')?.progress).toBeCloseTo(2 / 3);
    expect(byId(world({ wallets: 3 })).get('castle-builder')?.progress).toBe(1);
    expect(byId(world({ wallets: 3 })).get('gatehouse-lord')?.status).toBe('3 of 8 towers');
    expect(byId(world({ wallets: 9 })).get('gatehouse-lord')?.progress).toBe(1);
  });

  it('Gilded takes the Mythic keep', () => {
    expect(byId(world({ tier: 5 })).get('gilded')?.progress).toBeLessThan(1);
    expect(byId(world({ tier: 6 })).get('gilded')?.progress).toBe(1);
  });

  it('Full Moat takes every wing; bridges share the other wing', () => {
    const five = world({ protocols: (['lending', 'dex', 'staking', 'nft', 'governance'] as const).map(proto) });
    expect(byId(five).get('full-moat')?.status).toBe('5 of 6 wings');
    expect(byId(world({ protocols: [...five.protocols, proto('bridge')] })).get('full-moat')?.progress).toBe(1);
  });

  it('Bridge Keeper counts signed transactions, none before the player is worked out', () => {
    expect(byId(world(), 999).get('bridge-keeper')?.progress).toBeLessThan(1);
    expect(byId(world(), 1000).get('bridge-keeper')?.progress).toBe(1);
    expect(castleBadges(world(), null).find((b) => b.id === 'bridge-keeper')?.progress).toBe(0);
  });
});
