import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Guild, Journey } from '../src/domain/model.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import { tierOf } from '../src/domain/tiers.js';
import { MAX_BUILDINGS, MAX_HOLDINGS, errandOf, newErrands, worldFromGuild } from '../src/castle/world/world.js';

const dir = new URL('../fixtures/demo/', import.meta.url);
const raws = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as RawWallet);
const guild = buildGuild(raws);
const world = worldFromGuild(guild);

describe('castle world from the guild', () => {
  it('one tower per wallet, and the keep at the guild’s value tier', () => {
    expect(world.wallets).toBe(guild.heroes.length);
    expect(world.tier).toBe(tierOf(guild.heroes.reduce((t, h) => t + h.netWorth, 0)));
  });

  it('a building for each protocol the guild holds value in or used, most valuable first, at most the town’s slots', () => {
    expect(world.protocols.length).toBeGreaterThan(0);
    expect(world.protocols.length).toBeLessThanOrEqual(MAX_BUILDINGS);
    const tiers = world.protocols.map((p) => p.tier);
    // held value orders them, so tiers never rise down the list among protocols with holdings
    const withHoldings = tiers.filter((t) => t > 0);
    expect(withHoldings).toEqual([...withHoldings].sort((a, b) => b - a));
    for (const p of world.protocols) expect(['lending', 'dex', 'staking', 'nft', 'governance', 'bridge', 'other']).toContain(p.category);
  });

  it('errands: one per transaction with a courier, oldest first, going to a building in town or the far end', () => {
    const shown = new Set(world.protocols.map((p) => p.id));
    expect(world.errands.length).toBeGreaterThan(0);
    for (const e of world.errands) if (e.protocolId) expect(shown.has(e.protocolId)).toBe(true);
    const times = world.errands.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('a wallet’s own failed transaction is an errand that fails; someone else’s failure is none; who signed decides the direction', () => {
    const base: Journey = { ...guild.journeys[0]!, counterpartyHero: null, status: 'confirmed' };
    expect(errandOf({ ...base, status: 'failed', initiated: true }, new Set())).toMatchObject({ direction: 'out', failed: true });
    expect(errandOf({ ...base, status: 'failed', initiated: false }, new Set())).toBeNull();
    expect(errandOf({ ...base, initiated: true }, new Set())).toMatchObject({ direction: 'out', failed: false });
    expect(errandOf({ ...base, initiated: false }, new Set())).toMatchObject({ direction: 'in', failed: false });
  });

  it('goods between two of the guild’s wallets go along the walls, from the sender’s tower to the receiver’s', () => {
    const towers = new Map([
      ['0xa', 0],
      ['0xb', 1],
    ]);
    const base: Journey = { ...guild.journeys[0]!, status: 'confirmed', hero: '0xa', counterpartyHero: '0xb', initiated: true };
    expect(errandOf(base, new Set(), towers)).toMatchObject({ direction: 'inside', fromTower: 0, toTower: 1 });
    // the receiving side of the same send: the same way round
    expect(errandOf({ ...base, hero: '0xb', counterpartyHero: '0xa', initiated: false }, new Set(), towers)).toMatchObject({ fromTower: 0, toTower: 1 });
    // a wallet with no tower: no errand
    expect(errandOf({ ...base, counterpartyHero: '0xc' }, new Set(), towers)).toBeNull();
  });

  it('a send between the guild’s wallets is one errand, though both wallets’ histories have it', () => {
    const keys = world.errands.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(world.walletIds).toEqual(guild.heroes.map((h) => h.address));
  });

  it('a protocol with a signature building is known by its family, whatever its version', () => {
    const g: Guild = {
      ...guild,
      protocols: new Map([['aave-v3', { id: 'aave-v3', name: 'Aave V3', iconUrl: null, url: null, category: 'lending', building: 'bank', visits: 2 }]]),
    };
    expect(worldFromGuild(g).protocols[0]).toMatchObject({ id: 'aave-v3', category: 'lending', signature: 'aave' });
  });

  it('each building lists what the guild keeps there, largest first, from the guild’s own wallets', () => {
    const wallets = new Set(guild.heroes.map((h) => h.address));
    expect(world.protocols.some((p) => p.holdings.length > 0)).toBe(true);
    for (const p of world.protocols) {
      expect(p.holdings.length).toBeLessThanOrEqual(MAX_HOLDINGS);
      const sizes = p.holdings.map((h) => Math.abs(h.usd));
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      for (const h of p.holdings) expect(wallets.has(h.wallet)).toBe(true);
    }
  });

  it('an errand carries its transaction: hash, chain, kind, value, and the toll only when the guild paid it', () => {
    for (const e of world.errands) {
      expect(e.hash).toMatch(/^0x[0-9a-f]+$/i);
      expect(e.chainId).toBeTruthy();
      if (e.direction === 'in') expect(e.feeUsd).toBeNull();
    }
  });

  it('new errands are the ones the last world did not have', () => {
    const older = { ...world, errands: world.errands.slice(0, -2) };
    expect(newErrands(older, world).map((e) => e.key)).toEqual(world.errands.slice(-2).map((e) => e.key));
    expect(newErrands(world, world)).toEqual([]);
    expect(newErrands(null, world)).toHaveLength(world.errands.length);
  });
});
