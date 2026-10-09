import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Guild, Journey, Protocol } from '../src/domain/model.js';
import { findPath, MAP_H, MAP_W, planTown } from '../src/world/layout.js';
import { schedule } from '../src/world/sim.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

function withProtocols(n: number): Guild {
  const g = buildGuild(demo);
  const protocols = new Map(g.protocols);
  for (let i = 0; i < n; i++) {
    const p: Protocol = { id: `extra-${i}`, name: `Extra ${i}`, iconUrl: null, url: null, category: i % 2 ? 'dex' : 'unknown', building: i % 2 ? 'bazaar' : 'tent', visits: 0 };
    protocols.set(p.id, p);
  }
  return { ...g, protocols };
}

describe('planTown', () => {
  it('never drops a place, even when the town is full', () => {
    const guild = withProtocols(80);
    const plan = planTown(guild);
    for (const id of guild.protocols.keys()) expect(plan.byProtocol.has(id)).toBe(true);
  });

  it('places every hero home and every protocol, with no overlaps', () => {
    const guild = withProtocols(12);
    const plan = planTown(guild);
    expect(plan.homes.size).toBe(guild.heroes.length);
    expect(plan.byProtocol.size).toBe(guild.protocols.size);
    const cells = new Set<string>();
    for (const b of plan.buildings) {
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(MAP_W);
          expect(y).toBeLessThan(MAP_H);
          const key = `${x},${y}`;
          expect(cells.has(key), `overlap at ${key} (${b.id})`).toBe(false);
          cells.add(key);
        }
    }
  });

  it('is deterministic: the same guild builds the same town', () => {
    const a = planTown(buildGuild(demo));
    const b = planTown(buildGuild(demo));
    expect(a.buildings.map((x) => [x.id, x.x, x.y])).toEqual(b.buildings.map((x) => [x.id, x.x, x.y]));
  });

  it('does not move existing buildings when a new protocol appears', () => {
    const before = planTown(buildGuild(demo));
    const after = planTown(withProtocols(1));
    for (const [id, p] of before.byProtocol) {
      const q = after.byProtocol.get(id);
      if (q && q.district === p.district) expect([q.x, q.y]).toEqual([p.x, p.y]);
    }
  });

  it('can walk from every home to every building door', () => {
    const plan = planTown(buildGuild(demo));
    for (const home of plan.homes.values()) {
      for (const b of plan.buildings) {
        const path = findPath(plan, home.doorAt, b.doorAt);
        const end = path[path.length - 1];
        expect(end).toEqual(b.doorAt); // tile centres: the door point itself
        for (const p of path) expect(plan.walkable[Math.floor(p.y) * MAP_W + Math.floor(p.x)]).toBe(1);
      }
    }
  });
});

describe('schedule', () => {
  const j = (time: number): Journey => ({ time }) as Journey;
  it('keeps order and compresses long idle gaps', () => {
    const s = schedule([j(0), j(60_000), j(60_000 + 30 * 86_400_000)]);
    expect(s.map((x) => x.at)).toEqual([...s.map((x) => x.at)].sort((a, b) => a - b));
    const shortGap = s[1]!.at - s[0]!.at;
    const longGap = s[2]!.at - s[1]!.at;
    expect(longGap).toBeGreaterThan(shortGap);
    expect(longGap).toBeLessThanOrEqual(18);
  });
});

describe('Quest Replay', () => {
  const guild = buildGuild(demo);
  const plan = planTown(guild);

  it('routes an outgoing journey home → toll → each stop → home, numbered', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    const j = guild.journeys.find((x) => x.initiated && x.feeUsd !== null && x.feeUsd > 0 && x.steps[0]?.target.kind === 'building')!;
    const r = sim.routeFor(j);
    expect(r.stops.map((s) => s.label)).toEqual(['Toll', ...j.steps.map((s) => s.verb), 'Home']);
    expect(r.stops.map((s) => s.n)).toEqual(r.stops.map((_, i) => i + 1));
    expect(r.points[0]).toEqual(r.points[r.points.length - 1]); // a round trip
    // continuous along walkable ground (straight runs may be long single segments)
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1]!;
      const b = r.points[i]!;
      for (let t = 0; t <= 1; t += 0.05) {
        const x = Math.floor(a.x + (b.x - a.x) * t);
        const y = Math.floor(a.y + (b.y - a.y) * t);
        expect(plan.walkable[y * MAP_W + x]).toBe(1);
      }
    }
  });

  it('routes an incoming journey from its source to the home', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    const j = guild.journeys.find((x) => !x.initiated)!;
    const r = sim.routeFor(j);
    expect(r.stops.map((s) => s.label)).toEqual(['From', 'Home']);
  });

  it('holds the timeline while a solo quest plays, then lets go', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    const j = guild.journeys.find((x) => x.initiated)!;
    sim.solo(j);
    expect(sim.soloing).toBe(true);
    const t0 = sim.t;
    for (let i = 0; i < 20; i++) sim.step(0.1);
    expect(sim.t).toBeCloseTo(t0, 5);
    for (let i = 0; i < 3000 && sim.soloing; i++) sim.step(0.1);
    expect(sim.soloing).toBe(false);
  });
});

describe('fog of war', () => {
  const guild = buildGuild(demo);
  const plan = planTown(guild);
  const protocolBuildings = plan.buildings.filter((b) => b.protocolId !== undefined);

  it('hides every protocol building at the start, and nothing when off', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    expect(protocolBuildings.every((b) => sim.fogOver(b) === 0)).toBe(true);
    sim.fog = true;
    expect(protocolBuildings.length).toBeGreaterThan(0);
    expect(protocolBuildings.every((b) => sim.fogOver(b) === 1)).toBe(true);
    // homes, the tower and the gate are always known
    expect(plan.buildings.filter((b) => b.protocolId === undefined).every((b) => sim.fogOver(b) === 0)).toBe(true);
  });

  it('lifts where a hero went before the cursor, and is charted at the end', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    sim.fog = true;
    const mid = sim.scheduled[Math.floor(sim.scheduled.length / 2)]!;
    sim.seek(mid.at + 0.01);
    const visited = new Set(sim.scheduled.filter((s) => s.at <= mid.at).flatMap((s) => s.journey.steps.flatMap((st) => (st.target.kind === 'building' ? [st.target.protocolId] : []))));
    for (const b of protocolBuildings) expect(sim.fogOver(b)).toBe(visited.has(b.protocolId!) ? 0 : 1);
    sim.seek(sim.duration);
    expect(protocolBuildings.every((b) => sim.fogOver(b) === 0)).toBe(true);
  });

  it('lifts gently as the replay plays a visit', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    sim.fog = true;
    sim.speed = 4;
    const first = () => protocolBuildings.find((b) => sim.revealed.has(b.protocolId!));
    for (let i = 0; i < 20_000 && !first(); i++) sim.step(0.05);
    const b = first()!;
    expect(b).toBeDefined();
    const at = sim.fogOver(b);
    expect(at).toBeGreaterThan(0.5);
    for (let i = 0; i < 40; i++) sim.step(0.05);
    expect(sim.fogOver(b)).toBe(0);
  });
});

describe('griffins and dragons', () => {
  it('keep to the roads, hovering low, with the caravan rolling a steady way behind', async () => {
    const { Sim, CARAVAN_BACK } = await import('../src/world/sim.js');
    const base = buildGuild(demo);
    const guild = { ...base, heroes: base.heroes.map((h, i) => (i === 0 ? { ...h, tier: 6 as const } : h)) };
    const plan = planTown(guild);
    const sim = new Sim(guild, plan);
    sim.speed = 4;
    const hero = sim.agents.find((a) => a.hero?.address === guild.heroes[0]!.address)!;
    let travelled = 0;
    for (let i = 0; i < 20_000 && travelled < 400; i++) {
      sim.step(0.05);
      if (hero.path.length === 0) continue;
      travelled++;
      expect(hero.flying).toBe(false);
      expect(hero.alt).toBeCloseTo(0.5, 5);
      const back = hero.trail[CARAVAN_BACK];
      if (back) {
        const near = hero.trail[0]!;
        // a trail point every ~0.12 tiles: the caravan stays ~1.4 tiles (along the way) behind
        let along = Math.hypot(hero.x - near.x, hero.y - near.y);
        for (let k = 0; k < CARAVAN_BACK; k++) along += Math.hypot(hero.trail[k]!.x - hero.trail[k + 1]!.x, hero.trail[k]!.y - hero.trail[k + 1]!.y);
        expect(along).toBeGreaterThan(1.3);
        expect(along).toBeLessThan(1.8);
      }
    }
    expect(travelled).toBeGreaterThan(50);
  });
});

describe('NFT goods', () => {
  it('carry the NFT’s own name and picture, not just its collection', () => {
    const dir = resolve(__dirname, '../fixtures');
    const captured: RawWallet[] = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawWallet);
    if (captured.length === 0) return; // no captured wallets in this checkout
    const g = buildGuild(captured);
    const nfts = g.journeys.flatMap((j) => j.steps.flatMap((s) => [...s.give, ...s.get])).filter((x) => x.isNft);
    expect(nfts.length).toBeGreaterThan(0);
    const named = nfts.filter((x) => x.name !== undefined);
    expect(named.length).toBeGreaterThan(0);
    expect(nfts.some((x) => x.image?.startsWith('https://'))).toBe(true);
    // a journey moving one NFT names it in its label
    const j = g.journeys.find((x) => x.steps.length === 1 && [...x.steps[0]!.give, ...x.steps[0]!.get].filter((y) => y.isNft && y.name).length === 1 && x.steps[0]!.give.concat(x.steps[0]!.get).every((y) => y.isNft));
    if (j) expect(j.label).toContain([...j.steps[0]!.give, ...j.steps[0]!.get].find((y) => y.isNft)!.name!);
  });
});

describe('replaying a quest that came to the hero', () => {
  it('names the messenger who carries it, so the camera can follow them', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const guild = buildGuild(demo);
    const sim = new Sim(guild, planTown(guild));
    const j = guild.journeys.find((x) => !x.initiated && x.verb !== 'liquidated' && x.verb !== 'airdrop')!;
    sim.solo(j);
    const actor = sim.soloActor!;
    expect(actor.kind).toBe('raven');
    expect(sim.findAgent(actor.id)).toBe(actor);
    // it flies to the hero's door, delivers, and leaves; then it is gone
    for (let i = 0; i < 4000 && !actor.gone; i++) sim.step(0.05);
    expect(actor.gone).toBe(true);
    expect(sim.findAgent(actor.id)).toBeUndefined();
    expect(sim.findAgent(j.hero)).toBeDefined(); // the camera goes back to the hero
  });
});
