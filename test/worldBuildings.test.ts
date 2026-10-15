import { describe, expect, it } from 'vitest';
import { worldFromGuild } from '../src/castle/world/world.js';
import type { Guild } from '../src/domain/model.js';

const proto = (id: string, visits: number, category = 'dex') => [id, { id, name: id, iconUrl: null, url: null, category, building: 'bazaar', visits }] as const;
const stash = (protocolId: string, grossUsd: number) => ({ protocolId, entries: [{ name: protocolId, symbol: 'X', kind: 'deposit', module: null, quantity: 1, usd: grossUsd, chainId: 'ethereum' }], netUsd: grossUsd, grossUsd, tier: 0, hasRewards: false, hasDebt: false });
const item = (symbol: string, usd: number) => ({ id: symbol, chainId: 'ethereum', name: symbol, symbol, category: 'token', quantity: 1, usd, tier: 0, iconUrl: null });

function guild(over: { items?: ReturnType<typeof item>[]; stashes?: ReturnType<typeof stash>[]; protocols?: (readonly [string, unknown])[] }): Guild {
  return {
    heroes: [{ address: '0xa', label: 'A', name: 'A', netWorth: 0, tokenWorth: 0, nftWorth: 0, tier: 0, items: over.items ?? [], nfts: [], spamCount: 0, stashes: over.stashes ?? [], suggestedClass: 'merchant', verbCounts: {}, lastActiveAt: null }],
    protocols: new Map(over.protocols ?? []),
    journeys: [],
  } as unknown as Guild;
}

describe('which buildings the town shows', () => {
  it('a protocol’s staking receipt kept in the wallet is a stake there: stETH builds Lido', () => {
    const w = worldFromGuild(guild({ items: [item('stETH', 150_000), item('CVX', 1)], protocols: [proto('lido', 1, 'staking')] }));
    const lido = w.protocols.find((p) => p.id === 'lido');
    expect(lido).toBeDefined();
    expect(lido!.holdings[0]).toMatchObject({ label: 'stETH (in the wallet)', usd: 150_000 });
    // a governance token is not a stake
    expect(w.protocols.some((p) => p.id === 'convex')).toBe(false);
  });

  it('a receipt for a protocol the history never touched still builds it', () => {
    const w = worldFromGuild(guild({ items: [item('rETH', 2_000)] }));
    expect(w.protocols.map((p) => p.id)).toContain('rocket-pool');
  });

  it('dust ($0 positions) never takes a plot from a protocol the couriers use', () => {
    const dust = Array.from({ length: 16 }, (_, i) => `dust${i}`);
    const w = worldFromGuild(guild({ stashes: dust.map((d) => stash(d, 0.2)), protocols: [...dust.map((d) => proto(d, 0)), proto('busy', 40)] }));
    expect(w.protocols.map((p) => p.id)).toContain('busy');
  });
});
