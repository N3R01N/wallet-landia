/**
 * The town in districts (docs/TOWN_DISTRICTS.md): a side street per district
 * off the avenue, every building on its district's street, the same rules as
 * the avenue town: no overlaps, a paved way to every door, decor off the paths.
 */

import { describe, expect, it } from 'vitest';
import { DISTRICT_FOR, ISLAND_V2, MOAT_V2, pathRow, planCastle, routeTo, type CastlePlan } from '../src/castle/scene/plan.js';
import type { CastleWorld, WorldProtocol } from '../src/castle/world/world.js';
import { sizeFor } from '../src/castle/world/size.js';
import { buntingRows, planFestive } from '../src/castle/scene/festive.js';
import { secretPlacements } from '../src/castle/world/secrets.js';

const proto = (id: string, category: WorldProtocol['category'], usd: number): WorldProtocol => ({ id, name: id, category, tier: 1, signature: null, holdings: [], visits: 0, tvlUsd: usd, size: sizeFor(usd), iconUrl: null });

/** Sixteen protocols in every district, very different sizes, the categories mixed in the town's order. */
const TOWN: Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'> = {
  wallets: 2,
  tier: 3,
  protocols: [
    proto('aave', 'lending', 15e9),
    proto('uniswap', 'dex', 2.5e9),
    proto('lido', 'staking', 24e9),
    proto('opensea', 'nft', 3e8),
    proto('compound', 'lending', 1e9),
    proto('curve', 'dex', 2e9),
    proto('across', 'bridge', 8e7),
    proto('ens', 'governance', 1e6),
    proto('blur', 'nft', 3e7),
    proto('rocket', 'staking', 3e9),
    proto('tent', 'other', 1e5),
    proto('1inch', 'dex', 4e8),
    proto('morpho', 'lending', 2e9),
    proto('foundation', 'nft', 1e6),
    proto('stargate', 'bridge', 4e8),
    proto('furnace', 'other', 1e5),
  ],
};

const inBuilding = (plan: CastlePlan, x: number, z: number, margin = 0.05) => plan.buildings.find((b) => Math.abs(x - b.x) < b.half - margin && Math.abs(z - b.z) < b.half - margin);
const inTower = (plan: CastlePlan, x: number, z: number) => Math.hypot(x - plan.tower.x, z - plan.tower.z) < 1.6;
function sample(route: { x: number; z: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const c = route[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.25));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((c.x - a.x) * k) / n, z: a.z + ((c.z - a.z) * k) / n });
  }
  return out;
}

describe('a town in districts', () => {
  const plan = planCastle(TOWN, {}, 2, true);

  it('a street per district, in the order of its first protocol, left and right in turn; every building on its own district’s street', () => {
    expect(plan.streets.map((t) => t.district)).toEqual(['bankers', 'market', 'temple', 'gallery', 'harbour', 'council', 'commons']);
    expect(plan.streets.map((t) => t.side)).toEqual([-1, 1, -1, 1, -1, 1, -1]);
    expect(plan.buildings).toHaveLength(16);
    for (const b of plan.buildings) {
      expect(b.street, b.protocol.id).not.toBeNull();
      expect(b.street!.district, b.protocol.id).toBe(DISTRICT_FOR[b.protocol.category]);
      const street = plan.streets.find((t) => t.district === b.street!.district)!;
      expect(Math.sign(b.x), `${b.protocol.id} on its street's side`).toBe(street.side);
      expect(Math.abs(b.x) - b.half, `${b.protocol.id} within its street`).toBeLessThanOrEqual(street.end + 1e-6);
    }
  });

  it('the plaza is the hub: a ring round the tower, the first two districts’ streets leaving it left and right; crossroads before and after it', () => {
    const ring = plan.avenue.ring!;
    expect(ring).toBeDefined();
    const cells = new Set(plan.road.map((t) => `${t.x},${t.z}`));
    // the ring: a closed square round the tower, clear of it
    for (let x = -ring.x; x <= ring.x; x++) expect(cells.has(`${x},${ring.z0}`) && cells.has(`${x},${ring.z1}`), `ring at ${x}`).toBe(true);
    for (let z = ring.z0; z <= ring.z1; z++) expect(cells.has(`${-ring.x},${z}`) && cells.has(`${ring.x},${z}`), `ring at ${z}`).toBe(true);
    expect(ring.z0).toBeLessThan(plan.tower.z - 1.6);
    expect(ring.z1).toBeGreaterThan(plan.tower.z + 1.6);
    const [w, e, a, b, c, d, f] = plan.streets;
    expect([w!.z, e!.z]).toEqual([ring.row, ring.row]);
    expect(cells.has(`${-ring.x - 1},${ring.row}`) && cells.has(`${ring.x + 1},${ring.row}`)).toBe(true);
    expect(a!.z).toBe(b!.z);
    expect(a!.z).toBeLessThan(plan.avenue.plazaStart);
    expect(c!.z).toBe(d!.z);
    expect(c!.z).toBeGreaterThan(plan.avenue.plazaEnd);
    expect(f!.z).toBeGreaterThan(c!.z);
    // no plot on the square itself
    for (const x of plan.buildings) {
      const onSquare = Math.abs(x.x) - x.half < 9 && x.z + x.half > plan.avenue.plazaStart && x.z - x.half < plan.avenue.plazaEnd;
      expect(onSquare, `${x.protocol.id} on the square`).toBe(false);
    }
  });

  it('the square’s corners keep the well, the benches, the monuments and the notice board, clear of the ring, the streets and one another', () => {
    const sp = plan.plazaSpots;
    const all = [sp.well, ...sp.benches, ...sp.monuments, sp.board];
    for (const p of all) {
      for (const t of plan.road) expect(Math.abs(p.x - t.x) < 1.1 && Math.abs(p.z - t.z) < 1.1, `${p.x},${p.z} on the road at ${t.x},${t.z}`).toBe(false);
      expect(inBuilding(plan, p.x, p.z, -1), `${p.x},${p.z} on a plot`).toBeUndefined();
      expect(Math.hypot(p.x - plan.tower.x, p.z - plan.tower.z)).toBeGreaterThan(3);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i]!.x - all[j]!.x, all[i]!.z - all[j]!.z), `${i} and ${j}`).toBeGreaterThan(1.5);
    const monuments = secretPlacements(plan, { moments: ['dao-year', 'ens-airdrop', 'merge'], wanderer: false });
    expect(monuments.map((m) => [m.x, m.z])).toEqual(sp.monuments.map((m) => [m.x, m.z]));
  });

  it('shorter than the same town on one avenue', () => {
    const avenue = planCastle(TOWN, {}, 2, false);
    expect(plan.avenue.end).toBeLessThan(avenue.avenue.end);
  });

  it('doors at the street’s edge on the path grid, the building facing the street, standing off it', () => {
    for (const b of plan.buildings) {
      const t = b.street!.z;
      expect(t % 1).toBeCloseTo(0.5);
      expect(Number.isInteger(b.door.x), b.protocol.id).toBe(true);
      expect(Math.abs(b.door.z - t)).toBeCloseTo(1.5);
      expect(Math.sign(b.z - t)).toBe(Math.sign(b.door.z - t));
      expect(Math.abs(b.z - t) - b.half).toBeGreaterThanOrEqual(1.5 + b.half - 1e-3);
      // facing the street: +z (rot 0) from the near side, −z (rot π) from the far side
      expect(b.rot).toBeCloseTo(b.z < t ? 0 : Math.PI);
    }
  });

  it('plots never overlap one another', () => {
    const bs = plan.buildings;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const b = bs[j]!;
        expect(Math.abs(a.x - b.x) >= a.half + b.half || Math.abs(a.z - b.z) >= a.half + b.half, `${a.protocol.id} overlaps ${b.protocol.id}`).toBe(true);
      }
  });

  it('the road is one network on the path grid, every street off the avenue and every step on its street', () => {
    const cells = new Set(plan.road.map((t) => `${t.x},${t.z}`));
    const near = (x: number, z: number) => [`${x},${z - 1}`, `${x + 1},${z}`, `${x},${z + 1}`, `${x - 1},${z}`].filter((k) => cells.has(k));
    for (const t of plan.road) expect(Number.isInteger(t.x) && Math.abs((t.z % 1) - 0.5) < 1e-6, `${t.x},${t.z}`).toBe(true);
    const ring = plan.avenue.ring!;
    for (const t of plan.streets) {
      const from = t.z === ring.row ? ring.x : 0;
      expect(cells.has(`${t.side * from},${t.z}`) && cells.has(`${t.side * (from + 1)},${t.z}`), `${t.district} off the ${from ? 'ring' : 'avenue'}`).toBe(true);
    }
    for (const b of plan.buildings) expect(cells.has(`${b.door.x},${pathRow(b.street!.z + Math.sign(b.door.z - b.street!.z))}`), `${b.protocol.id}'s step`).toBe(true);
    const seen = new Set(['0,0.5']);
    const todo = ['0,0.5'];
    while (todo.length) {
      const [x, z] = todo.pop()!.split(',').map(Number) as [number, number];
      for (const k of near(x, z)) if (!seen.has(k)) seen.add(k), todo.push(k);
    }
    expect(seen.size).toBe(cells.size);
  });

  it('every door is reached up the avenue and along its street, never through a building or the tower', () => {
    const paved = plan.road.map((t) => ({ x: t.x, z: t.z }));
    for (const b of plan.buildings) {
      const route = routeTo(plan.avenue, b);
      expect(route[route.length - 1]).toMatchObject({ ...b.door, stop: 'hand-over' });
      for (const p of sample(route.slice(2))) {
        const hit = inBuilding(plan, p.x, p.z);
        expect(hit, `${b.protocol.id}'s way crosses ${hit?.protocol.id} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeUndefined();
        expect(inTower(plan, p.x, p.z), `${b.protocol.id}'s way crosses the tower`).toBe(false);
        // the way keeps to the paving (within half a tile), up to the door's point at the street's edge
        if (p.z > 0.5 && Math.abs(p.z - b.door.z) > 0.6) expect(paved.some((t) => Math.abs(t.x - p.x) <= 0.55 && Math.abs(t.z - p.z) <= 0.55), `${b.protocol.id}: unpaved ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('the town’s props keep off the paths, the plots and the tower', () => {
    const water = (x: number, z: number) => x >= MOAT_V2.x0 && x <= MOAT_V2.x1 && z >= MOAT_V2.z0 && z <= MOAT_V2.z1 && !(x > ISLAND_V2.x0 && x < ISLAND_V2.x1 && z > ISLAND_V2.z0 && z < ISLAND_V2.z1);
    for (const d of plan.decor) {
      if (d.key === 'flag' || /^(moat\.|animal\.duck|prop\.fence)/.test(d.name)) continue;
      expect(water(d.x, d.z), `${d.name} in the moat`).toBe(false);
      expect(inBuilding(plan, d.x, d.z, -0.4), `${d.name} at ${d.x},${d.z} on a plot`).toBeUndefined();
      for (const t of plan.road) expect(Math.abs(d.x - t.x) < 0.75 && Math.abs(d.z - t.z) < 0.75, `${d.name} at ${d.x},${d.z} on the path`).toBe(false);
      expect(Math.hypot(d.x - plan.tower.x, d.z - plan.tower.z) > 2, `${d.name} in the tower`).toBe(true);
    }
  });

  it('every building stands on cobbles, its plot covered, no cell twice; scenery keeps out of the town', () => {
    const keys = new Set(plan.ground.map((g) => `${g.x},${g.z}`));
    expect(keys.size).toBe(plan.ground.length);
    for (const b of plan.buildings)
      for (let x = b.x - b.half + 0.5; x < b.x + b.half; x += 1)
        for (let z = b.z - b.half + 0.5; z < b.z + b.half; z += 1) expect(keys.has(`${Math.floor(x / 2) * 2 + 1},${Math.floor(z / 2) * 2 + 1}`), `${b.protocol.id}: no cobbles at ${x},${z}`).toBe(true);
    for (const s of plan.scenery) expect(s.x > plan.town.x0 && s.x < plan.town.x1 && s.z > plan.town.z0 && s.z < plan.town.z1, `${s.name} at ${s.x},${s.z} in the town`).toBe(false);
  });

  it('build mode swaps two buildings within a street; the streets keep their order', () => {
    const lending = plan.buildings.filter((b) => b.street!.district === 'bankers').map((b) => b.protocol.id);
    expect(lending).toEqual(['aave', 'compound', 'morpho']);
    const slots = Object.fromEntries(plan.buildings.map((b) => [b.protocol.id, b.slot]));
    const swapped = planCastle(TOWN, { ...slots, aave: slots.morpho!, morpho: slots.aave! }, 2, true);
    expect(swapped.buildings.filter((b) => b.street!.district === 'bankers').sort((a, b) => a.slot - b.slot).map((b) => b.protocol.id)).toEqual(['morpho', 'compound', 'aave']);
    expect(swapped.streets.map((t) => t.district)).toEqual(plan.streets.map((t) => t.district));
    expect(plan.freeSlots).toEqual([]);
  });

  it('festive dressing: pumpkins at the street doors, no bunting across a street’s mouth', () => {
    for (const z of buntingRows(plan)) for (const t of plan.streets) expect(Math.abs(t.z - z)).toBeGreaterThan(2.5);
    const pumpkins = planFestive(plan, { festival: false, snow: false, pumpkins: true, storm: false } as never, false).filter((d) => d.name === 'prop.pumpkin');
    expect(pumpkins).toHaveLength(plan.buildings.length);
    for (const p of pumpkins) {
      expect(inBuilding(plan, p.x, p.z, -0.2), `pumpkin at ${p.x},${p.z} on a plot`).toBeUndefined();
      for (const t of plan.road) expect(Math.abs(p.x - t.x) < 0.6 && Math.abs(p.z - t.z) < 0.6, `pumpkin at ${p.x},${p.z} on the path`).toBe(false);
    }
  });

  it('a small town: one district is one street, off the plaza’s ring', () => {
    const small = planCastle({ wallets: 1, tier: 0, protocols: [proto('uniswap', 'dex', 1e9), proto('curve', 'dex', 1e8)] }, {}, 2, true);
    expect(small.streets).toHaveLength(1);
    expect(small.streets[0]!.z).toBe(small.avenue.ring!.row);
    expect(small.buildings.every((b) => b.street?.district === 'market')).toBe(true);
  });
});
