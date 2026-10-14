import { describe, expect, it } from 'vitest';
import { ISLAND, MOAT, TOWN, TOWER_AT, planCastle, routeAlongWalls, routeTo } from '../src/castle/scene/plan.js';
import type { CastleWorld } from '../src/castle/world/world.js';

const DEMO: Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'> = {
  wallets: 3,
  tier: 2,
  protocols: [
    { id: 'aave-v3', name: 'Aave', category: 'lending', tier: 3, signature: null, holdings: [], visits: 0 },
    { id: 'uniswap-v4', name: 'Uniswap', category: 'dex', tier: 2, signature: null, holdings: [], visits: 0 },
    { id: 'lido', name: 'Lido', category: 'staking', tier: 4, signature: null, holdings: [], visits: 0 },
    { id: 'ens', name: 'ENS', category: 'governance', tier: 1, signature: null, holdings: [], visits: 0 },
    { id: 'blur', name: 'Blur', category: 'nft', tier: 0, signature: null, holdings: [], visits: 0 },
    { id: 'across', name: 'Across', category: 'bridge', tier: 2, signature: null, holdings: [], visits: 0 },
  ],
};

/** Ten protocols: both columns of the town filled. */
const FULL: Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'> = {
  ...DEMO,
  protocols: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, category: 'dex' as const, tier: 1, signature: null, holdings: [], visits: 0 })),
};

const inside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

describe('castle plan', () => {
  const plan = planCastle(DEMO);

  it('the water is the moat ring only: nothing on the island, nothing outside the moat', () => {
    expect(plan.water.length).toBeGreaterThan(0);
    for (const w of plan.water) {
      expect(inside(MOAT, w.x, w.z), `water ${w.x},${w.z} outside the moat`).toBe(true);
      expect(inside(ISLAND, w.x, w.z), `water ${w.x},${w.z} on the island`).toBe(false);
    }
  });

  it('the castle sits on the island, the town in front of it', () => {
    expect(inside(ISLAND, plan.keep.x, plan.keep.z)).toBe(true);
    expect(inside(TOWN, plan.tower.x, plan.tower.z)).toBe(true);
    expect(plan.tower.z).toBe(TOWER_AT.z);
    expect(plan.keep.z).toBeLessThan(plan.bridge.z); // castle at the back
    expect(plan.bridge.z).toBeLessThan(plan.tollbooth.z);
    expect(plan.tollbooth.z).toBeLessThan(plan.tower.z); // the booth before the town
  });

  it('the drawbridge, then the toll line: the booth beside the road, the barrier across it', () => {
    expect(plan.gatehouse.z).toBeLessThan(plan.bridge.z);
    expect(plan.barrier.z).toBe(plan.tollbooth.z);
    expect(plan.barrier.z).toBeGreaterThan(TOWN.z0);
    // the booth's 2 m footprint stays off the road (x −0.5 … 0.5)
    expect(plan.tollbooth.x + 1).toBeLessThan(-0.5);
    // the 2 m arm reaches across the road from its post
    expect(plan.barrier.x).toBeLessThan(-0.5);
    expect(plan.barrier.x + 2).toBeGreaterThan(0.5);
  });

  it('one tower per wallet on the walls, up to the slots', () => {
    expect(plan.towers).toHaveLength(3);
    for (const t of plan.towers) expect(inside(ISLAND, t.x, t.z) || t.z === ISLAND.z0 || t.x === ISLAND.x0 || t.x === ISLAND.x1 || t.z === ISLAND.z1).toBe(true);
    expect(planCastle({ ...DEMO, wallets: 50 }).towers.length).toBeLessThanOrEqual(9);
  });

  it('each wallet’s tower shows that wallet’s own tier, falling back to the plain tower', () => {
    const p = planCastle({ ...DEMO, walletTiers: [0, 4, 9] });
    expect(p.towers.map((t) => t.name)).toEqual(['castle.tower.wallet.t0', 'castle.tower.wallet.t4', 'castle.tower.wallet.t6']);
    expect(p.towers[1]!.fallbacks).toEqual(['castle.tower.wallet']);
    expect(plan.towers[0]!.name).toBe('castle.tower.wallet'); // tiers unknown
  });

  it('a wing for each protocol category used, in the order of the wing slots', () => {
    const wanted = new Set<string>(DEMO.protocols.map((p) => (p.category === 'bridge' ? 'other' : p.category)));
    expect(plan.wings.map((w) => w.name.replace('castle.wing.', '')).sort()).toEqual([...wanted].sort());
  });

  it('the keep takes the guild tier', () => {
    expect(plan.keep.name).toBe('castle.keep.t2');
    expect(planCastle({ ...DEMO, tier: 9 }).keep.name).toBe('castle.keep.t6');
  });

  it('each protocol gets a building of its category and tier, beside the road', () => {
    expect(plan.buildings).toHaveLength(DEMO.protocols.length);
    const aave = plan.buildings[0]!;
    expect(aave.name).toBe('building.category.lending.t3');
    for (const b of plan.buildings) expect(Math.abs(b.x)).toBeGreaterThanOrEqual(3);
    // no two buildings share a slot
    const slots = new Set(plan.buildings.map((b) => `${b.x},${b.z}`));
    expect(slots.size).toBe(plan.buildings.length);
  });

  it('the road runs from the bridge to the tower, with a side path to each inner door; every tile has its glow', () => {
    expect(plan.road.length).toBe(plan.lit.length);
    const main = plan.road.filter((t) => t.x === 0);
    expect(Math.min(...main.map((t) => t.z))).toBeCloseTo(TOWN.z0 + 0.5);
    expect(Math.max(...main.map((t) => t.z))).toBeLessThan(TOWER_AT.z - 1);
    for (const b of plan.buildings.filter((b) => Math.abs(b.x) <= 4)) {
      expect(plan.road.some((t) => t.x === b.door.x && t.z === b.z), `path to ${b.protocol.id}`).toBe(true);
    }
  });

  it('a building’s door point is 2 m out on its front, towards the road; its person stands between', () => {
    for (const b of plan.buildings) {
      expect(Math.hypot(b.door.x - b.x, b.door.z - b.z)).toBeCloseTo(2);
      expect(Math.abs(b.door.x)).toBeLessThan(Math.abs(b.x)); // faces the road
      expect(Math.hypot(b.npc.x - b.x, b.npc.z - b.z)).toBeLessThan(2);
    }
  });

  it('scenery stays off the moat and out of the town, and is the same every time', () => {
    expect(plan.scenery.length).toBeGreaterThan(20);
    for (const sc of plan.scenery) {
      expect(inside(MOAT, sc.x, sc.z), `${sc.name} on the moat`).toBe(false);
      expect(inside(TOWN, sc.x, sc.z), `${sc.name} in the town`).toBe(false);
    }
    expect(planCastle(DEMO).scenery).toEqual(plan.scenery);
  });

  it('a protocol with a signature building asks for it, with its category building as the fallback', () => {
    const p = planCastle({ ...DEMO, protocols: [{ ...DEMO.protocols[0]!, signature: 'aave' }] });
    expect(p.buildings[0]!.name).toBe('building.protocol.aave');
    expect(p.buildings[0]!.fallbacks).toEqual(['building.category.lending.t3']);
    expect(plan.buildings[0]!.fallbacks).toBeUndefined();
  });

  it('every door is reached by a paved way that never crosses another building', () => {
    const full = planCastle(FULL);
    const paved = new Set(full.road.map((t) => `${t.x},${t.z}`));
    for (const b of full.buildings) {
      const route = routeTo(b);
      expect(route[route.length - 1]).toMatchObject({ ...b.door, stop: 'hand-over' });
      // sample the way from the road on, every 0.25 m
      const onRoad = route.findIndex((p) => p.z > TOWN.z0);
      for (let i = Math.max(1, onRoad); i < route.length; i++) {
        const a = route[i - 1]!;
        const c = route[i]!;
        const n = Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.25);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((c.x - a.x) * k) / n;
          const z = a.z + ((c.z - a.z) * k) / n;
          for (const o of full.buildings) {
            const inside = Math.abs(x - o.x) < 0.95 && Math.abs(z - o.z) < 0.95;
            expect(inside, `${b.protocol.id}'s way crosses ${o.protocol.id} at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);
          }
          if (z > TOWN.z0 + 1) expect(paved.has(`${Math.round(x)},${Math.round(z)}`) || paved.has(`${x.toFixed(1)},${z.toFixed(1)}`) || [...paved].some((key) => { const [px, pz] = key.split(',').map(Number); return Math.abs(px! - x) <= 0.5 && Math.abs(pz! - z) <= 0.5; }), `unpaved ${x.toFixed(2)},${z.toFixed(2)} on the way to ${b.protocol.id}`).toBe(true);
        }
      }
    }
  });

  it('between two towers the way runs along the walls, turning at their corners', () => {
    const onWalls = (p: { x: number; z: number }) => p.x === ISLAND.x0 || p.x === ISLAND.x1 || p.z === ISLAND.z0;
    const straight = routeAlongWalls({ x: -6, z: -14 }, { x: 6, z: -14 });
    expect(straight).toEqual([{ x: -6, z: -14 }, { x: 6, z: -14, stop: 'hand-over' }]);
    const round = routeAlongWalls({ x: -8, z: -8 }, { x: 8, z: -4 });
    expect(round).toEqual([{ x: -8, z: -8 }, { x: -8, z: -14 }, { x: 8, z: -14 }, { x: 8, z: -4, stop: 'hand-over' }]);
    const back = routeAlongWalls({ x: 8, z: -4 }, { x: -8, z: -8 });
    expect(back.map((p) => [p.x, p.z])).toEqual([[8, -4], [8, -14], [-8, -14], [-8, -8]]);
    for (const p of [...straight, ...round, ...back]) expect(onWalls(p)).toBe(true);
    // every tower slot is on the walls
    for (const t of planCastle({ ...DEMO, wallets: 9 }).towers) expect(() => routeAlongWalls(t, { x: 0, z: -14 })).not.toThrow();
  });

  it('an errand for someone outside the town goes to the road’s far end, paying the toll on the way', () => {
    const r = routeTo(null);
    expect(r.some((p) => p.stop === 'toll')).toBe(true);
    expect(r[r.length - 1]!.stop).toBeUndefined();
    expect(r[r.length - 1]!.z).toBeLessThan(TOWER_AT.z);
  });

  it('the town’s props and life keep off the road, the paths, the buildings and the moat’s land (or water, for what floats)', () => {
    const full = planCastle(FULL);
    const paved = full.road.map((t) => ({ x: t.x, z: t.z }));
    const water = (x: number, z: number) => inside(MOAT, x, z) && !(x > ISLAND.x0 && x < ISLAND.x1 && z > ISLAND.z0 && z < ISLAND.z1);
    expect(full.decor.length).toBeGreaterThan(30);
    for (const d of full.decor) {
      expect(d.optional, d.name).toBe(true);
      if (d.key === 'flag') continue; // on the towers
      const floats = d.name === 'moat.lily' || d.name === 'animal.duck';
      const reeds = d.name === 'moat.reeds';
      if (floats) expect(water(d.x, d.z), `${d.name} at ${d.x},${d.z} is not on the water`).toBe(true);
      else if (!reeds) expect(water(d.x, d.z), `${d.name} at ${d.x},${d.z} is in the moat`).toBe(false);
      if (d.name === 'prop.fence.segment' || floats || reeds) continue;
      for (const b of full.buildings) expect(Math.abs(d.x - b.x) < 1.3 && Math.abs(d.z - b.z) < 1.3, `${d.name} on ${b.protocol.id}`).toBe(false);
      for (const t of paved) expect(Math.abs(d.x - t.x) < 0.75 && Math.abs(d.z - t.z) < 0.75, `${d.name} at ${d.x},${d.z} on the path`).toBe(false);
      expect(Math.hypot(d.x - TOWER_AT.x, d.z - TOWER_AT.z) > 2, `${d.name} in the tower`).toBe(true);
    }
    // a flag on every tower
    expect(full.decor.filter((d) => d.key === 'flag')).toHaveLength(full.towers.length);
  });

  it('the courier walks from the gate over the bridge, stops at the barrier for the toll, and ends at the first door', () => {
    const r = plan.courierRoute;
    expect(r[0]!.z).toBeLessThan(plan.bridge.z); // starts inside the gate
    const toll = r.find((p) => p.stop === 'toll')!;
    expect(toll.z).toBeLessThan(plan.barrier.z); // waits before the barrier
    expect(toll.x).toBe(0);
    const last = r[r.length - 1]!;
    expect(last.stop).toBe('hand-over');
    expect(last).toMatchObject(plan.buildings[0]!.door);
    for (let i = 1; i < r.length; i++) expect(r[i]!.z).toBeGreaterThanOrEqual(r[i - 1]!.z);
  });
});
