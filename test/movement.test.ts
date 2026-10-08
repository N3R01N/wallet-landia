import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Guild, Protocol } from '../src/domain/model.js';
import { MAP_H, MAP_W, SLOTS, SPARE, planTown, tileAt, type Placed, type Pt, type TownPlan } from '../src/world/layout.js';
import { doorSlot, flightRoute, walkRoute, FLY_CRUISE } from '../src/world/route.js';
import { Sim } from '../src/world/sim.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

/** The demo guild plus many extra protocols, so most building slots are used. */
function busyGuild(): Guild {
  const g = buildGuild(demo);
  const protocols = new Map(g.protocols);
  const kinds = ['bazaar', 'bank', 'temple', 'alchemist', 'council', 'tent', 'auction', 'harbour'] as const;
  for (let i = 0; i < 30; i++) {
    const p: Protocol = { id: `extra-${i}`, name: `Extra ${i}`, iconUrl: null, url: null, category: 'unknown', building: kinds[i % kinds.length]!, visits: 3 };
    protocols.set(p.id, p);
  }
  return { ...g, protocols };
}

const STREET = new Set(['road', 'plaza', 'path']);
const tileOf = (p: Pt): [number, number] => [Math.floor(p.x), Math.floor(p.y)];
const inFootprint = (plan: TownPlan, p: Pt): Placed | undefined =>
  plan.buildings.find((b) => b.kind !== 'gate' && p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);

describe('doors and footpaths', () => {
  it('no plot in the layout table covers another plot, or anybody\'s door', () => {
    const plots: [string, number, number, number, number][] = [
      ...Object.entries(SLOTS).flatMap(([d, list]) => list.map(([x, y]) => [d, x, y, 3, 3] as [string, number, number, number, number])),
      ...SPARE.map(([x, y]) => ['spare', x, y, 3, 3] as [string, number, number, number, number]),
      ['tower', 22, 14, 4, 4],
      ['guildhall', 15, 14, 4, 4],
    ];
    const inside = (px: number, py: number, b: (typeof plots)[number]): boolean => px >= b[1] && px < b[1] + b[3] && py >= b[2] && py < b[2] + b[4];
    for (const a of plots) {
      const door = [a[1] + Math.floor(a[3] / 2), a[2] + a[4]] as const;
      expect(door[1], `${a} door off the map`).toBeLessThan(MAP_H);
      for (const b of plots) {
        if (a === b) continue;
        expect(inside(door[0], door[1], b), `door of ${a} inside ${b}`).toBe(false);
        const overlap = !(a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1] || a[2] + a[4] <= b[2] || b[2] + b[4] <= a[2]);
        expect(overlap, `${a} overlaps ${b}`).toBe(false);
      }
    }
  });

  for (const [name, guild] of [['demo', buildGuild(demo)], ['busy', busyGuild()]] as const) {
    it(`every door is free and connected to the streets (${name} town)`, () => {
      const plan = planTown(guild);
      for (const b of plan.buildings) {
        const i = b.door.y * MAP_W + b.door.x;
        expect(plan.walkable[i], `${b.id} door blocked`).toBe(1);
        expect(inFootprint(plan, b.doorAt), `${b.id} door inside a building`).toBeUndefined();
        // the door tile is street, and the street network reaches a road
        expect(STREET.has(tileAt(plan, b.door.x, b.door.y)), `${b.id} door has no path`).toBe(true);
        const seen = new Set([i]);
        const queue = [i];
        let reached = false;
        while (queue.length > 0 && !reached) {
          const c = queue.shift()!;
          if (tileAt(plan, c % MAP_W, Math.floor(c / MAP_W)) === 'road') reached = true;
          for (const n of [c + 1, c - 1, c + MAP_W, c - MAP_W]) {
            if (n < 0 || n >= MAP_W * MAP_H || seen.has(n)) continue;
            if (!STREET.has(tileAt(plan, n % MAP_W, Math.floor(n / MAP_W)))) continue;
            seen.add(n);
            queue.push(n);
          }
        }
        expect(reached, `${b.id} footpath does not reach a road`).toBe(true);
      }
    });
  }
});

describe('walking routes', () => {
  const plan = planTown(busyGuild());
  const doors = plan.buildings.map((b) => b.doorAt);

  it('stay on the streets, never enter a building, and are continuous', () => {
    let points = 0;
    const problems: string[] = [];
    for (const from of doors) {
      for (const to of doors) {
        if (from === to) continue;
        const route = walkRoute(plan, from, to);
        // Sample along every segment, not just the corners.
        let prev = from;
        for (const q of route) {
          const n = Math.max(1, Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 0.1));
          for (let k = 1; k <= n; k++) {
            const p = { x: prev.x + ((q.x - prev.x) * k) / n, y: prev.y + ((q.y - prev.y) * k) / n };
            points++;
            const [tx, ty] = tileOf(p);
            if (inFootprint(plan, p)) problems.push(`inside a building at ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
            else if (plan.walkable[ty * MAP_W + tx] !== 1) problems.push(`unwalkable ${tx},${ty}`);
            else if (!STREET.has(tileAt(plan, tx, ty))) problems.push(`off-street at ${tx},${ty} on ${from.x},${from.y} → ${to.x},${to.y}`);
          }
          prev = q;
        }
        expect(route[route.length - 1]).toEqual(to);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(points).toBeGreaterThan(50_000);
  }, 60_000);

  it('keep to the right, so opposite directions do not share a line', () => {
    const a = plan.tower.doorAt;
    const b = plan.gate.doorAt;
    const there = walkRoute(plan, a, b).slice(2, -2);
    const back = walkRoute(plan, b, a).slice(2, -2);
    const shared = there.filter((p) => back.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.05));
    expect(shared.length).toBe(0);
  });
});

describe('flights', () => {
  const plan = planTown(busyGuild());

  it('clear every roof: anywhere over a building, the flyer is at cruise height', () => {
    for (const from of plan.buildings.map((b) => b.doorAt)) {
      for (const to of plan.buildings.map((b) => b.doorAt)) {
        const pts = [{ ...from, z: 0 }, ...flightRoute(from, to)];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          for (let t = 0; t <= 1; t += 0.02) {
            const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
            if (inFootprint(plan, p)) expect(p.z, `low over a building at ${p.x.toFixed(2)},${p.y.toFixed(2)}`).toBeGreaterThanOrEqual(FLY_CRUISE - 1e-6);
          }
        }
      }
    }
    expect(FLY_CRUISE).toBeGreaterThan(7.2); // above the Chronicle Tower
  });
});

describe('door slots', () => {
  it('give each waiting person their own spot on the door tile', () => {
    const plan = planTown(buildGuild(demo));
    const b = plan.tower;
    const spots = Array.from({ length: 8 }, (_, n) => doorSlot(b, n));
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y)).toBeGreaterThan(0.05);
    for (const s of spots) {
      expect(inFootprint(plan, s)).toBeUndefined();
      expect(plan.walkable[Math.floor(s.y) * MAP_W + Math.floor(s.x)]).toBe(1);
    }
  });
});

describe('the living town', () => {
  it('never puts a walker inside a building, over a long replay', () => {
    const guild = buildGuild(demo);
    const sim = new Sim(guild, planTown(guild));
    sim.speed = 4;
    let checks = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(0.05);
      for (const a of sim.agents) {
        if (a.alt > 0.5) continue; // high in the air is fine
        const inside = inFootprint(sim.plan, a);
        expect(inside, `${a.kind} ${a.id} inside ${inside?.id} at ${a.x.toFixed(2)},${a.y.toFixed(2)} (alt ${a.alt.toFixed(2)})`).toBeUndefined();
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(10_000);
  });
});
