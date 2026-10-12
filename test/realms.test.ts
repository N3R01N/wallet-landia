import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Goods, Journey } from '../src/domain/model.js';
import { linkBridges, realmGuild, realmOf, realmSummaries } from '../src/domain/realms.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

const coin = (symbol: string, quantity: number): Goods => ({ symbol, quantity, usd: quantity * 3000, isNft: false });

function journey(o: Partial<Journey> & Pick<Journey, 'key' | 'chainId' | 'time' | 'verb'>, give: Goods[], get: Goods[]): Journey {
  return {
    hash: o.key,
    hero: '0xaaa',
    status: 'confirmed',
    feeUsd: 1,
    feeNative: 0.0003,
    block: 1,
    method: null,
    initiated: give.length > 0,
    steps: [{ verb: o.verb, target: { kind: 'gate' }, give, get }],
    valueUsd: 1000,
    tier: 3,
    drama: 1,
    counterparty: null,
    counterpartyHero: null,
    label: '',
    ...o,
  };
}

describe('realms', () => {
  it('a town per chain: only what is kept and done there, every hero still at home', () => {
    const guild = buildGuild(demo);
    const chains = new Set(guild.journeys.map((j) => j.chainId));
    expect(chains.size).toBeGreaterThan(1); // the demo wanders onto L2s
    for (const id of ['ethereum', 'base', 'arbitrum', 'optimism']) {
      const g = realmGuild(guild, id);
      expect(g.heroes.map((h) => h.address)).toEqual(guild.heroes.map((h) => h.address));
      expect(g.journeys.every((j) => j.chainId === id)).toBe(true);
      for (const h of g.heroes) {
        expect(h.items.every((i) => i.chainId === id)).toBe(true);
        for (const s of h.stashes) expect(s.entries.every((e) => e.chainId === id)).toBe(true);
        // the same person: same tier, so the same mount and home
        expect(h.tier).toBe(guild.heroes.find((x) => x.address === h.address)!.tier);
      }
      // every quest's building stands in that town
      for (const j of g.journeys) for (const st of j.steps) if (st.target.kind === 'building') expect(g.protocols.has(st.target.protocolId)).toBe(true);
    }
    // nothing is lost: the realms add up to the whole
    const total = ['ethereum', 'base', 'arbitrum', 'optimism', ...chains].filter((c, i, a) => a.indexOf(c) === i).reduce((n, c) => n + realmGuild(guild, c).journeys.length, 0);
    expect(total).toBe(guild.journeys.length);
  });

  it('summarises each realm for the map, the asked ones first', () => {
    const guild = buildGuild(demo);
    const sums = realmSummaries(guild, ['ethereum', 'base', 'arbitrum', 'optimism']);
    expect(sums.slice(0, 4).map((s) => s.realm.id)).toEqual(['ethereum', 'base', 'arbitrum', 'optimism']);
    expect(sums[0]!.realm.kind).toBe('kingdom');
    expect(sums[1]!.realm.kind).toBe('province');
    expect(sums.find((s) => s.realm.id === 'base')!.usd).toBeGreaterThan(0);
    expect(realmOf('zksync-era').name).toBe('Zksync Era');
  });

  it('links a bridge crossing to its arrival on the other chain', () => {
    const out = journey({ key: 'ethereum:0x1', chainId: 'ethereum', time: 1_000_000, verb: 'bridge' }, [coin('ETH', 1)], []);
    const elsewhere = journey({ key: 'base:0x2', chainId: 'base', time: 1_200_000, verb: 'receive', hero: '0xbbb' }, [], [coin('ETH', 0.998)]);
    const arrival = journey({ key: 'base:0x3', chainId: 'base', time: 1_300_000, verb: 'receive' }, [], [coin('WETH', 0.997)]);
    const tooMuch = journey({ key: 'arbitrum:0x4', chainId: 'arbitrum', time: 1_250_000, verb: 'receive' }, [], [coin('ETH', 1.5)]);
    const list = [out, elsewhere, tooMuch, arrival];
    linkBridges(list);
    expect(out.bridge).toEqual({ from: 'ethereum', to: 'base', pair: 'base:0x3' });
    expect(arrival.bridge).toEqual({ from: 'ethereum', to: 'base', pair: 'ethereum:0x1' });
    expect(elsewhere.bridge).toBeUndefined(); // another hero's
    expect(tooMuch.bridge).toBeUndefined();
  });

  it('takes a plausible arrival, the closest in time, never a later swap', () => {
    const out = journey({ key: 'ethereum:0x1', chainId: 'ethereum', time: 1_000_000, verb: 'bridge' }, [coin('ETH', 1)], []);
    const swap = journey({ key: 'base:0x2', chainId: 'base', time: 1_100_000, verb: 'swap' }, [coin('USDC', 10)], [coin('ETH', 0.99)]);
    const later = journey({ key: 'base:0x3', chainId: 'base', time: 1_900_000, verb: 'receive' }, [], [coin('ETH', 0.99)]);
    const closest = journey({ key: 'base:0x4', chainId: 'base', time: 1_300_000, verb: 'receive' }, [], [coin('ETH', 0.995)]);
    linkBridges([out, swap, later, closest]);
    expect(out.bridge?.pair).toBe('base:0x4');
    expect(swap.bridge).toBeUndefined();
    expect(later.bridge).toBeUndefined();
  });

  it('a crossing whose arrival is not in sight still says it crossed', () => {
    const out = journey({ key: 'base:0x9', chainId: 'base', time: 5, verb: 'bridge' }, [coin('USDC', 500)], []);
    const late = journey({ key: 'ethereum:0xa', chainId: 'ethereum', time: 5 + 7 * 3_600_000, verb: 'receive' }, [], [coin('USDC', 499)]);
    linkBridges([out, late]);
    expect(out.bridge).toEqual({ from: 'base', to: null, pair: null });
    expect(late.bridge).toBeUndefined();
  });
});
