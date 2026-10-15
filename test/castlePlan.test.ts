import { describe, expect, it } from 'vitest';
import { AVENUE_HALF, ISLAND, ISLAND_V2, MOAT, MOAT_V2, SLOT_COUNT, assignSlots, layPlots, moveToSlot, pathShape, planCastle, routeFromHome, routeAlongWalls, routeBetweenWallets, routeTo, type CastlePlan } from '../src/castle/scene/plan.js';
import type { CastleWorld, WorldProtocol } from '../src/castle/world/world.js';
import { sizeFor } from '../src/castle/world/size.js';

const proto = (id: string, category: WorldProtocol['category'], tier: number, usd: number): WorldProtocol => ({
  id,
  name: id,
  category,
  tier,
  signature: null,
  holdings: [],
  visits: 0,
  tvlUsd: usd,
  size: sizeFor(usd),
  iconUrl: null,
});

type World = Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'>;

const DEMO: World = {
  wallets: 3,
  tier: 2,
  protocols: [
    proto('aave-v3', 'lending', 3, 15e9),
    proto('uniswap-v4', 'dex', 2, 2.5e9),
    proto('lido', 'staking', 4, 24e9),
    proto('ens', 'governance', 1, 1e6),
    proto('blur', 'nft', 0, 3e7),
    proto('across', 'bridge', 2, 8e7),
  ],
};

/** Ten protocols of very different sizes: both sides of the avenue filled. */
const FULL: World = {
  ...DEMO,
  protocols: [24e9, 15e9, 6e9, 2.5e9, 1.4e9, 9e8, 3e8, 5e7, 3e6, 1e6].map((usd, i) => proto(`p${i}`, 'dex', 1, usd)),
};

const inside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const inBuilding = (plan: CastlePlan, x: number, z: number, margin = 0.05) => plan.buildings.find((b) => Math.abs(x - b.x) < b.half - margin && Math.abs(z - b.z) < b.half - margin);
const inTower = (plan: CastlePlan, x: number, z: number) => Math.hypot(x - plan.tower.x, z - plan.tower.z) < 1.6;

/** Every point along a route, every 0.25 m. */
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

describe('castle plan', () => {
  const plan = planCastle(DEMO);
  const full = planCastle(FULL);

  it('the water is the moat ring only: nothing on the island, nothing outside the moat', () => {
    expect(plan.water.length).toBeGreaterThan(0);
    for (const w of plan.water) {
      expect(inside(MOAT, w.x, w.z), `water ${w.x},${w.z} outside the moat`).toBe(true);
      expect(inside(ISLAND, w.x, w.z), `water ${w.x},${w.z} on the island`).toBe(false);
    }
  });

  it('the castle sits on the island; the bell tower stands in the middle of the plaza, in the town', () => {
    expect(inside(ISLAND, plan.keep.x, plan.keep.z)).toBe(true);
    expect(plan.tower.z).toBeCloseTo((plan.avenue.plazaStart + plan.avenue.plazaEnd) / 2);
    expect(inside(plan.town, plan.tower.x, plan.tower.z)).toBe(true);
    expect(plan.keep.z).toBeLessThan(plan.bridge.z);
    expect(plan.bridge.z).toBeLessThan(plan.tollbooth.z);
    expect(plan.tollbooth.z).toBeLessThan(plan.tower.z);
  });

  it('the drawbridge, then the toll line: the booth beside the road, the barrier across it', () => {
    expect(plan.gatehouse.z).toBeLessThan(plan.bridge.z);
    expect(plan.barrier.z).toBe(plan.tollbooth.z);
    expect(plan.barrier.z).toBeGreaterThan(0);
    expect(plan.tollbooth.x + 1).toBeLessThan(-0.5);
    expect(plan.barrier.x).toBeLessThan(-0.5);
    expect(plan.barrier.x + 2).toBeGreaterThan(0.5);
  });

  it('one tower per wallet on the walls, up to the slots; each at its wallet’s tier', () => {
    expect(plan.wallets).toHaveLength(3);
    expect(planCastle({ ...DEMO, wallets: 50 }).wallets.length).toBeLessThanOrEqual(9);
    const p = planCastle({ ...DEMO, walletTiers: [0, 4, 9] });
    expect(p.wallets.map((t) => t.name)).toEqual(['castle.tower.wallet.t0', 'castle.tower.wallet.t4', 'castle.tower.wallet.t6']);
    expect(plan.wallets[0]!.name).toBe('castle.tower.wallet');
  });

  it('a wing for each protocol category used; the keep takes the guild tier', () => {
    const wanted = new Set<string>(DEMO.protocols.map((p) => (p.category === 'bridge' ? 'other' : p.category)));
    expect(plan.wings.map((w) => w.name.replace('castle.wing.', '')).sort()).toEqual([...wanted].sort());
    expect(plan.keep.name).toBe('castle.keep.t2');
    expect(planCastle({ ...DEMO, tier: 9 }).keep.name).toBe('castle.keep.t6');
  });

  it('each protocol gets a building of its category and tier, scaled by its size: Aave’s billions dwarf a $1M protocol', () => {
    expect(plan.buildings).toHaveLength(DEMO.protocols.length);
    const aave = plan.buildings.find((b) => b.protocol.id === 'aave-v3')!;
    const ens = plan.buildings.find((b) => b.protocol.id === 'ens')!;
    // the v2 building of its size class (Aave's ~13.7 m plot: XL), the first themes' tier model as the fallback
    expect(aave.name).toBe('building.category.lending.xl');
    expect(aave.fallbacks).toEqual(['building.category.lending.t3']);
    expect(ens.name).toBe('building.category.governance.xs');
    expect(aave.scale).toBeCloseTo(sizeFor(15e9), 2);
    expect(aave.half).toBeGreaterThan(5 * ens.half);
    expect(ens.scale).toBeCloseTo(1, 2);
  });

  it('every door is at the avenue’s edge, facing it, and the building stands off the avenue', () => {
    for (const b of full.buildings) {
      expect(Math.abs(b.door.x)).toBeCloseTo(AVENUE_HALF);
      // on the path grid's row (half metres) nearest the plot's middle
      expect(Math.abs(b.door.z - b.z)).toBeLessThanOrEqual(0.5);
      expect(b.door.z % 1).toBeCloseTo(0.5);
      expect(Math.abs(b.x) - b.half).toBeGreaterThanOrEqual(AVENUE_HALF + b.half - 1e-3); // the front wall a size-wide step back
      expect(Math.sign(b.x)).toBe(Math.sign(b.door.x));
    }
  });

  it('the road is one network on the path grid: every tile touches another, every step meets the avenue', () => {
    const cells = new Set(full.road.map((t) => `${t.x},${t.z}`));
    const near = (x: number, z: number) => [`${x},${z - 1}`, `${x + 1},${z}`, `${x},${z + 1}`, `${x - 1},${z}`].filter((k) => cells.has(k));
    for (const t of full.road) {
      expect(Number.isInteger(t.x), `${t.x},${t.z}`).toBe(true);
      expect(t.z % 1, `${t.x},${t.z}`).toBeCloseTo(0.5);
      expect(near(t.x, t.z).length, `${t.x},${t.z} stands alone`).toBeGreaterThan(0);
    }
    for (const b of full.buildings) expect(cells.has(`0,${b.door.z}`) && cells.has(`${Math.sign(b.door.x)},${b.door.z}`), `${b.protocol.id}'s step`).toBe(true);
    // from the gate every tile is reached, tile to tile
    const seen = new Set(['0,0.5']);
    const todo = ['0,0.5'];
    while (todo.length) {
      const [x, z] = todo.pop()!.split(',').map(Number) as [number, number];
      for (const k of near(x, z)) if (!seen.has(k)) seen.add(k), todo.push(k);
    }
    expect(seen.size).toBe(cells.size);
  });

  it('each path tile’s shape comes from its neighbours', () => {
    const o = (n: boolean, e: boolean, s: boolean, w: boolean) => ({ n, e, s, w });
    expect(pathShape(o(true, false, true, false))).toMatchObject({ shape: 'straight', rot: 0 });
    expect(pathShape(o(false, true, false, true))).toMatchObject({ shape: 'straight', rot: Math.PI / 2 });
    expect(pathShape(o(false, true, true, false))).toMatchObject({ shape: 'bend', rot: 0 }); // +z and +x, as modelled
    expect(pathShape(o(true, false, false, true)).shape).toBe('bend');
    expect(pathShape(o(true, true, true, false))).toMatchObject({ shape: 'tee', rot: 0 });
    expect(pathShape(o(true, true, true, true)).shape).toBe('cross');
    expect(pathShape(o(false, false, true, false))).toMatchObject({ shape: 'end', rot: 0 });
    // a branch off the avenue lies along it until the theme has a tee
    expect(pathShape(o(true, false, true, true)).straightRot).toBe(0);
  });

  it('plots never overlap one another, and none stands beside the plaza', () => {
    const bs = full.buildings;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]!;
      expect(a.z + a.half <= full.avenue.plazaStart || a.z - a.half >= full.avenue.plazaEnd, `${a.protocol.id} beside the plaza`).toBe(true);
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j]!;
        const apart = Math.abs(a.x - b.x) >= a.half + b.half || Math.abs(a.z - b.z) >= a.half + b.half;
        expect(apart, `${a.protocol.id} overlaps ${b.protocol.id}`).toBe(true);
      }
    }
  });

  it('a signature building asks for its own model, its category building as the fallback', () => {
    const p = planCastle({ ...DEMO, protocols: [{ ...DEMO.protocols[0]!, signature: 'aave' }] });
    expect(p.buildings[0]!.name).toBe('building.protocol.aave');
    expect(p.buildings[0]!.fallbacks).toEqual(['building.category.lending.xl', 'building.category.lending.t3']);
  });

  it('every door is reached by a paved way that never crosses a building or the tower', () => {
    const paved = full.road.map((t) => ({ x: t.x, z: t.z }));
    for (const b of full.buildings) {
      const route = routeTo(full.avenue, b);
      expect(route[route.length - 1]).toMatchObject({ ...b.door, stop: 'hand-over' });
      for (const p of sample(route.slice(2))) {
        const hit = inBuilding(full, p.x, p.z);
        expect(hit, `${b.protocol.id}'s way crosses ${hit?.protocol.id} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeUndefined();
        expect(inTower(full, p.x, p.z), `${b.protocol.id}'s way crosses the tower`).toBe(false);
        if (p.z > 0.5 && Math.abs(p.x) <= AVENUE_HALF - 0.1) expect(paved.some((t) => Math.abs(t.x - p.x) <= 0.55 && Math.abs(t.z - p.z) <= 0.55), `unpaved ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(true);
      }
    }
    expect(full.road.length).toBe(full.lit.length);
  });

  it('an errand for someone outside the town pays the toll, goes round the tower and out at the avenue’s far end', () => {
    const r = routeTo(plan.avenue, null);
    expect(r.some((p) => p.stop === 'toll')).toBe(true);
    expect(r[r.length - 1]).toEqual({ x: 0, z: plan.avenue.end, stop: 'hand-over' });
    for (const p of sample(r)) expect(inTower(plan, p.x, p.z), `${p.x},${p.z} in the tower`).toBe(false);
  });

  it('build mode: arranged protocols get their plots, the rest fill the free ones in order; nonsense is ignored', () => {
    const ids = ['a', 'b', 'c'];
    expect([...assignSlots(ids)]).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    expect([...assignSlots(ids, { c: 0, b: 5 })]).toEqual([['b', 5], ['c', 0], ['a', 1]]);
    expect([...assignSlots(ids, { a: 3, b: 3, c: 99 })].sort()).toEqual([['a', 3], ['b', 0], ['c', 1]]);
    expect(assignSlots(ids, { a: 1.5 }).get('a')).toBe(0);
    const current = assignSlots(ids);
    expect(moveToSlot(current, 'a', 2)).toEqual({ a: 2, b: 1, c: 0 });
    expect(moveToSlot(current, 'a', 7)).toEqual({ a: 7, b: 1, c: 2 });
    expect(moveToSlot(current, 'zzz', 1)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('an arranged town still has clear ways to every door, no overlaps, and lists its empty plots', () => {
    const few: World = { ...FULL, protocols: FULL.protocols.slice(0, 7) };
    const arranged = Object.fromEntries(few.protocols.map((p, i) => [p.id, (i * 7) % SLOT_COUNT]));
    const town = planCastle(few, arranged);
    expect(town.buildings.map((b) => b.slot).sort()).toEqual(Object.values(arranged).sort());
    expect(town.freeSlots).toHaveLength(SLOT_COUNT - 7);
    for (const b of town.buildings) for (const p of sample(routeTo(town.avenue, b).slice(2))) expect(inBuilding(town, p.x, p.z), b.protocol.id).toBeUndefined();
  });

  it('plots: the plaza halfway, both sides', () => {
    const { list, avenue } = layPlots([1, 1, 1, 1]);
    expect(list.filter((p) => p.x < 0)).toHaveLength(2);
    expect(avenue.plazaEnd - avenue.plazaStart).toBeGreaterThan(10);
    expect(avenue.end).toBeGreaterThan(avenue.plazaEnd);
  });

  it('between two towers the way runs along the walls, turning at their corners', () => {
    const onWalls = (p: { x: number; z: number }) => p.x === ISLAND.x0 || p.x === ISLAND.x1 || p.z === ISLAND.z0;
    const straight = routeAlongWalls({ x: -6, z: -14 }, { x: 6, z: -14 });
    expect(straight).toEqual([{ x: -6, z: -14 }, { x: 6, z: -14, stop: 'hand-over' }]);
    const round = routeAlongWalls({ x: -8, z: -8 }, { x: 8, z: -4 });
    expect(round).toEqual([{ x: -8, z: -8 }, { x: -8, z: -14 }, { x: 8, z: -14 }, { x: 8, z: -4, stop: 'hand-over' }]);
    for (const p of [...straight, ...round]) expect(onWalls(p)).toBe(true);
    for (const t of planCastle({ ...DEMO, wallets: 9 }).wallets) expect(() => routeAlongWalls(t, { x: 0, z: -14 })).not.toThrow();
    expect(routeBetweenWallets(plan, 0, 1)).toEqual({ route: routeAlongWalls(plan.wallets[0]!, plan.wallets[1]!), height: 3 });
  });

  it('scenery stays off the moat and out of the town, and is the same every time', () => {
    expect(full.scenery.length).toBeGreaterThan(20);
    for (const sc of full.scenery) {
      expect(inside(MOAT, sc.x, sc.z), `${sc.name} on the moat`).toBe(false);
      expect(inside(full.town, sc.x, sc.z), `${sc.name} in the town`).toBe(false);
    }
    expect(planCastle(FULL).scenery).toEqual(full.scenery);
  });

  it('the town’s props and life keep off the paths, the plots, the tower and the moat’s land (or water, for what floats)', () => {
    const water = (x: number, z: number) => inside(MOAT, x, z) && !(x > ISLAND.x0 && x < ISLAND.x1 && z > ISLAND.z0 && z < ISLAND.z1);
    expect(full.decor.length).toBeGreaterThan(30);
    for (const d of full.decor) {
      expect(d.optional, d.name).toBe(true);
      if (d.key === 'flag') continue;
      const floats = d.name === 'moat.lily' || d.name === 'animal.duck';
      const reeds = d.name === 'moat.reeds';
      if (floats) expect(water(d.x, d.z), `${d.name} at ${d.x},${d.z} is not on the water`).toBe(true);
      else if (!reeds) expect(water(d.x, d.z), `${d.name} at ${d.x},${d.z} is in the moat`).toBe(false);
      if (d.name === 'prop.fence.segment' || floats || reeds) continue;
      expect(inBuilding(full, d.x, d.z, -0.4), `${d.name} at ${d.x},${d.z} on a plot`).toBeUndefined();
      for (const t of full.road) expect(Math.abs(d.x - t.x) < 0.75 && Math.abs(d.z - t.z) < 0.75, `${d.name} at ${d.x},${d.z} on the path`).toBe(false);
      expect(Math.hypot(d.x - full.tower.x, d.z - full.tower.z) > 2, `${d.name} in the tower`).toBe(true);
    }
    expect(full.decor.filter((d) => d.key === 'flag')).toHaveLength(full.wallets.length);
  });

  it('the courier walks from the gate, pays at the barrier, and ends at the first door', () => {
    const r = plan.courierRoute;
    expect(r[0]!.z).toBeLessThan(plan.bridge.z);
    const toll = r.find((p) => p.stop === 'toll')!;
    expect(toll.z).toBeLessThan(plan.barrier.z);
    expect(r[r.length - 1]).toMatchObject({ ...plan.buildings[0]!.door, stop: 'hand-over' });
  });
});

/** Layout 2 (docs/batches/01-castle-core.md): halls in the walls, the keep at the back, pieces meeting only wall segments. */
describe('castle plan, layout 2', () => {
  const six = planCastle({ ...DEMO, wallets: 6, walletTiers: [0, 2, 4, 6, 1, 9] }, {}, 2);
  const one = planCastle({ ...DEMO, wallets: 1 }, {}, 2);
  /** A piece's footprint on the ground (its model's size, turned to its wall). */
  const SIZES: Record<string, [number, number]> = {
    'castle.wall.segment': [1, 1],
    'castle.wall.corner': [2, 2],
    'castle.gatehouse': [4, 3.5],
    'castle.hall.wallet': [4, 4],
    'castle.keep': [8, 5.5],
    'castle.storehouse': [3, 3],
  };
  const box = (p: { name: string; x: number; z: number; rot?: number }) => {
    const [w, d] = SIZES[p.name.replace(/\.t\d$/, '')]!;
    const turned = Math.abs(Math.sin(p.rot ?? 0)) > 0.5;
    const [hx, hz] = turned ? [d / 2, w / 2] : [w / 2, d / 2];
    return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
  };
  const pieces = (plan: CastlePlan) => [...plan.walls, ...plan.wallets, plan.keep, plan.gatehouse, plan.storehouse!];

  it('couriers set out from their wallet’s hall door and come home to it, across the courtyard to the gate', () => {
    for (let i = 0; i < six.wallets.length; i++) {
      const way = routeFromHome(six, i);
      expect(way[0]).toMatchObject(six.wallets[i]!.door);
      expect(way[way.length - 1]).toMatchObject({ x: 0, z: -3 }); // the gate, under the gatehouse
      // from the door onto its lane, then along the lanes: every step after the first runs along x or z
      for (let k = 2; k < way.length; k++) expect(way[k]!.x === way[k - 1]!.x || way[k]!.z === way[k - 1]!.z).toBe(true);
    }
    expect(routeFromHome(six, 9)).toEqual([]);
  });

  it('a hall per wallet, up to six, each its wallet’s tier’s own hall; the keep and the gatehouse; the one hall, then the old towers as fallbacks', () => {
    expect(six.layout).toBe(2);
    expect(six.wallets.map((w) => w.name)).toEqual(['t0', 't2', 't4', 't6', 't1', 't6'].map((t) => `castle.hall.wallet.${t}`));
    expect(six.wallets[0]!.fallbacks?.[0]).toBe('castle.hall.wallet');
    expect(six.wallets.map((w) => w.tier)).toEqual([0, 2, 4, 6, 1, 6]);
    expect(planCastle({ ...DEMO, wallets: 20 }, {}, 2).wallets).toHaveLength(6);
    expect(six.wallets[0]!.fallbacks).toContain('castle.tower.wallet');
    expect(six.keep).toMatchObject({ name: 'castle.keep', tier: 2 });
    expect(six.wings).toEqual([]);
    // the first two flank the gate on the front wall
    expect(six.wallets.slice(0, 2).map((w) => [w.x, w.z])).toEqual([[-5, -4], [5, -4]]);
  });

  it('every piece stands on the island and none overlaps another', () => {
    for (const plan of [six, one]) {
      const all = pieces(plan);
      for (const p of all) {
        const b = box(p);
        expect(b.x0 >= ISLAND_V2.x0 - 1e-9 && b.x1 <= ISLAND_V2.x1 + 1e-9 && b.z0 >= ISLAND_V2.z0 - 1e-9 && b.z1 <= ISLAND_V2.z1 + 1e-9, `${p.name} at ${p.x},${p.z} off the island`).toBe(true);
      }
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = box(all[i]!);
          const b = box(all[j]!);
          const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 1e-6;
          expect(overlap, `${all[i]!.name} at ${all[i]!.x},${all[i]!.z} overlaps ${all[j]!.name} at ${all[j]!.x},${all[j]!.z}`).toBe(false);
        }
    }
  });

  it('no two buildings touch: a hall, the keep, the gatehouse or a corner meets only wall segments', () => {
    for (const plan of [six, one]) {
      const big = pieces(plan).filter((p) => p.name !== 'castle.wall.segment');
      for (let i = 0; i < big.length; i++)
        for (let j = i + 1; j < big.length; j++) {
          const a = box(big[i]!);
          const b = box(big[j]!);
          const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
          const gapZ = Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1);
          expect(Math.max(gapX, gapZ) > 0.25, `${big[i]!.name} at ${big[i]!.x},${big[i]!.z} touches ${big[j]!.name} at ${big[j]!.x},${big[j]!.z}`).toBe(true);
        }
    }
  });

  it('the curtain wall is closed: every metre of the island’s edge has a piece on it', () => {
    for (const plan of [six, one]) {
      const all = pieces(plan).map(box);
      const covered = (x: number, z: number) => all.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
      for (let x = ISLAND_V2.x0 + 0.5; x < ISLAND_V2.x1; x += 1) {
        expect(covered(x, ISLAND_V2.z1 - 0.5), `front wall at x ${x}`).toBe(true);
        expect(covered(x, ISLAND_V2.z0 + 0.5), `back wall at x ${x}`).toBe(true);
      }
      for (let z = ISLAND_V2.z0 + 0.5; z < ISLAND_V2.z1; z += 1) {
        expect(covered(ISLAND_V2.x0 + 0.5, z), `left wall at z ${z}`).toBe(true);
        expect(covered(ISLAND_V2.x1 - 0.5, z), `right wall at z ${z}`).toBe(true);
      }
    }
  });

  it('between two halls the courier crosses the courtyard on the ground, clear of every building, to the door', () => {
    const blocks = pieces(six).map(box);
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) {
        if (a === b) continue;
        const way = routeBetweenWallets(six, a, b)!;
        expect(way.height).toBe(0);
        expect(way.route[0]).toEqual(six.wallets[a]!.door);
        expect(way.route[way.route.length - 1]).toEqual({ ...six.wallets[b]!.door, stop: 'hand-over' });
        for (const p of sample(way.route)) for (const k of blocks) expect(p.x > k.x0 + 0.05 && p.x < k.x1 - 0.05 && p.z > k.z0 + 0.05 && p.z < k.z1 - 0.05, `${a}→${b} at ${p.x},${p.z} inside a building`).toBe(false);
      }
    expect(routeBetweenWallets(one, 0, 3)).toBeNull();
  });

  it('no water tile reaches onto the island, and the ground tiles cover it to the edge', () => {
    const onIsland = (t: { x: number; z: number }) => t.x - 1 < ISLAND_V2.x1 && t.x + 1 > ISLAND_V2.x0 && t.z - 1 < ISLAND_V2.z1 && t.z + 1 > ISLAND_V2.z0;
    for (const w of six.water) expect(onIsland(w), `water at ${w.x},${w.z} overlaps the island`).toBe(false);
    const ground = six.ground.filter(onIsland);
    expect(ground.length * 4).toBe((ISLAND_V2.x1 - ISLAND_V2.x0) * (ISLAND_V2.z1 - ISLAND_V2.z0));
  });

  it('the moat is wider; its plants and ducks float on it; scenery keeps off it', () => {
    expect(six.moat).toEqual(MOAT_V2);
    const water = (x: number, z: number) => inside(MOAT_V2, x, z) && !(x > ISLAND_V2.x0 && x < ISLAND_V2.x1 && z > ISLAND_V2.z0 && z < ISLAND_V2.z1);
    for (const d of six.decor) if (d.name === 'moat.lily' || d.name === 'animal.duck') expect(water(d.x, d.z), `${d.name} at ${d.x},${d.z}`).toBe(true);
    expect(six.decor.filter((d) => d.key === 'flag')).toEqual([]);
    for (const sc of six.scenery) expect(inside(MOAT_V2, sc.x, sc.z), `${sc.name} on the moat`).toBe(false);
  });
});


describe('paving under the buildings', () => {
  it('every building stands on cobbles, its whole plot covered, no cell twice', () => {
    const plan = planCastle({ wallets: 1, tier: 0, protocols: [24e9, 6e9, 3e8, 1e6].map((usd, i) => ({ id: `p${i}`, name: `p${i}`, category: 'dex', tier: 0, signature: null, holdings: [], visits: 0, tvlUsd: usd, size: sizeFor(usd), iconUrl: null })) }, {}, 2);
    const keys = new Set(plan.ground.map((g) => `${g.x},${g.z}`));
    expect(keys.size).toBe(plan.ground.length);
    for (const b of plan.buildings)
      for (let x = b.x - b.half + 0.5; x < b.x + b.half; x += 1)
        for (let z = b.z - b.half + 0.5; z < b.z + b.half; z += 1) {
          const cx = Math.floor(x / 2) * 2 + 1;
          const cz = Math.floor(z / 2) * 2 + 1;
          expect(keys.has(`${cx},${cz}`), `${b.protocol.id}: no cobbles at ${x},${z}`).toBe(true);
        }
  });
});
