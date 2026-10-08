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
        const path = findPath(plan, home.door, b.door);
        const end = path[path.length - 1];
        expect(end).toEqual({ x: b.door.x, y: b.door.y });
        for (const p of path.slice(0, -1)) expect(plan.walkable[p.y * MAP_W + p.x]).toBe(1);
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
    expect(longGap).toBeLessThanOrEqual(9);
  });
});
