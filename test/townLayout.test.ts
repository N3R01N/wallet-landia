import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import { findPath, MAP_H, MAP_W, tileAt, type TownPlan } from '../src/world/layout.js';
import { arrange, blockedReason, buildables, emptyLayout, landFor, onLand, planFromLayout, sanitizeLayout, suggestedLayout, type TownLayout } from '../src/world/townLayout.js';

const load = (dir: string): RawWallet[] => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawWallet);
const demo = load(resolve(__dirname, '../fixtures/demo'));
const guild = buildGuild(demo);

/** Can someone walk from this door to the tower's door? */
function reaches(plan: TownPlan, from: { x: number; y: number }): boolean {
  const path = findPath(plan, from, plan.tower.doorAt);
  const end = path.at(-1);
  return end !== undefined && Math.floor(end.x) === plan.tower.door.x && Math.floor(end.y) === plan.tower.door.y;
}

describe('a town the player builds', () => {
  it('starts empty: the tower, its square, the guildhall, the gate and its road; everyone lives outside the gate', () => {
    const plan = planFromLayout(guild, emptyLayout());
    expect(plan.buildings.map((b) => b.kind).sort()).toEqual(['gate', 'guildhall', 'tower']);
    for (const h of guild.heroes) expect(plan.homes.get(h.address)).toBe(plan.gate);
    for (const id of guild.protocols.keys()) expect(plan.byProtocol.get(id)).toBe(plan.gate);
    expect(reaches(plan, plan.gate.doorAt)).toBe(true);
    expect(plan.labels?.map((l) => l[0])).toEqual(['square']);
  });

  it('builds the suggested town whole: every building stands, and every door reaches the tower by road', () => {
    const layout = suggestedLayout(guild);
    expect(layout.placed.length).toBe(buildables(guild).length);
    const plan = planFromLayout(guild, layout);
    expect(plan.buildings.length - 3).toBe(layout.placed.length);
    for (const b of plan.buildings) if (b.kind !== 'tower') expect(reaches(plan, b.doorAt), b.id).toBe(true);
    for (const b of plan.buildings) {
      if (b.kind === 'tower' || b.kind === 'guildhall' || b.kind === 'gate') continue;
      const k = tileAt(plan, b.door.x, b.door.y);
      expect(k === 'road' || k === 'plaza', `${b.id}'s door is on ${k}`).toBe(true);
    }
    for (const h of guild.heroes) expect(plan.homes.get(h.address)?.kind).toBe('home');
  });

  it('builds a busy history\'s suggested town whole too (the captured wallets)', () => {
    const big = buildGuild(load(resolve(__dirname, '../fixtures')), { kind: 'count', count: 100 });
    const layout = suggestedLayout(big);
    const plan = planFromLayout(big, layout);
    expect(plan.buildings.length - 3).toBe(layout.placed.length);
    for (const b of plan.buildings) if (b.kind !== 'tower') expect(reaches(plan, b.doorAt), b.id).toBe(true);
  });

  it('lays the same roads for the same layout, every time', () => {
    const a = planFromLayout(guild, suggestedLayout(guild));
    const b = planFromLayout(guild, suggestedLayout(guild));
    expect(a.tiles.join()).toBe(b.tiles.join());
  });

  it('a building moved takes its road with it: the old road goes, a new one comes', () => {
    const one = buildables(guild).find((b) => b.kind !== 'home')!;
    const at = (x: number, y: number): TownLayout => ({ v: 1, placed: [{ id: one.id, x, y, rot: 0 }] });
    const left = planFromLayout(guild, at(4, 6));
    const right = planFromLayout(guild, at(40, 20));
    const roads = (p: TownPlan): number => p.tiles.filter((t) => t === 'road').length;
    const bare = roads(planFromLayout(guild, emptyLayout()));
    expect(roads(left)).toBeGreaterThan(bare);
    expect(roads(right)).toBeGreaterThan(bare);
    // nothing of the left one's road is left once it stands on the right
    expect(tileAt(right, 5, 9)).toBe('grass');
    expect(reaches(left, left.byProtocol.get(one.protocolId!)!.doorAt)).toBe(true);
    expect(reaches(right, right.byProtocol.get(one.protocolId!)!.doorAt)).toBe(true);
  });

  it('turns a building: its door, and its road, move round to the side it faces', () => {
    const one = buildables(guild).find((b) => b.kind !== 'home')!;
    for (const rot of [0, 1, 2, 3] as const) {
      const plan = planFromLayout(guild, { v: 1, placed: [{ id: one.id, x: 6, y: 24, rot }] });
      const b = plan.byProtocol.get(one.protocolId!)!;
      expect(b.rot).toBe(rot);
      const expected = [{ x: 7, y: 27 }, { x: 5, y: 25 }, { x: 7, y: 23 }, { x: 9, y: 25 }][rot];
      expect(b.door).toEqual(expected);
      expect(reaches(plan, b.doorAt)).toBe(true);
    }
  });

  it('leaves out what cannot stand: an id this history does not unlock, an overlap, the square, the water, off the map', () => {
    const [a, b] = buildables(guild);
    const plan = planFromLayout(guild, {
      v: 1,
      placed: [
        { id: a!.id, x: 4, y: 4, rot: 0 },
        { id: b!.id, x: 5, y: 5, rot: 0 }, // overlaps a
        { id: 'b:not-in-this-history', x: 10, y: 4, rot: 0 },
      ],
    });
    expect(plan.buildings.map((x) => x.id)).toEqual(['tower', 'guildhall', 'gate', a!.id]);
    const p0 = planFromLayout(guild, emptyLayout());
    const taken = new Uint8Array(MAP_W * MAP_H);
    expect(blockedReason(p0.tiles, taken, { x: 20, y: 14, w: 3, h: 3, rot: 0 })).toMatch(/square/);
    expect(blockedReason(p0.tiles, taken, { x: 40, y: 30, w: 3, h: 3, rot: 0 })).toMatch(/water/);
    expect(blockedReason(p0.tiles, taken, { x: MAP_W - 2, y: 4, w: 3, h: 3, rot: 0 })).toMatch(/edge/);
    expect(blockedReason(p0.tiles, taken, { x: 4, y: MAP_H - 3, w: 3, h: 3, rot: 0 })).toMatch(/door/);
    expect(blockedReason(p0.tiles, taken, { x: 4, y: 4, w: 3, h: 3, rot: 0 })).toBeNull();
  });

  it('reads back only well-formed layouts', () => {
    expect(sanitizeLayout(null)).toEqual(emptyLayout());
    expect(sanitizeLayout({ placed: 'x' })).toEqual(emptyLayout());
    const ok = sanitizeLayout({
      placed: [
        { id: 'b:aave-v3', x: 3, y: 4, rot: 1 },
        { id: 'b:aave-v3', x: 9, y: 9, rot: 0 }, // twice
        { id: 'home:0xABC', x: 1, y: 1, rot: 0 }, // not an address
        { id: 'b:uni', x: 1.5, y: 1, rot: 0 },
        { id: 'b:uni', x: 99, y: 1, rot: 0 },
        { id: 'b:uni', x: 2, y: 2, rot: 7 },
      ],
    });
    expect(ok.placed).toEqual([
      { id: 'b:aave-v3', x: 3, y: 4, rot: 1 },
      { id: 'b:uni', x: 2, y: 2, rot: 0 },
    ]);
  });
});

describe('arranging for the player', () => {
  it('keeps what is already placed, and adds the rest', () => {
    const [first] = buildables(guild);
    const mine: TownLayout = { v: 1, placed: [{ id: first!.id, x: 4, y: 24, rot: 2 }] };
    const out = arrange(guild, mine);
    expect(out.placed[0]).toEqual(mine.placed[0]);
    expect(out.placed.length).toBe(buildables(guild).length);
  });

  it('on a small piece of land, builds only on it (what does not fit waits)', () => {
    const land = landFor(1);
    const out = arrange(guild, emptyLayout(), land);
    for (const e of out.placed) expect(onLand(land, { x: e.x, y: e.y, w: 3, h: 3 }), e.id).toBe(true);
    const plan = planFromLayout(guild, out);
    expect(plan.buildings.length - 3).toBe(out.placed.length);
  });
});

describe('land', () => {
  it('grows with the level, around the tower, to the whole map', () => {
    let last = 0;
    for (const level of [1, 4, 5, 9, 10, 15, 19, 20, 60]) {
      const l = landFor(level);
      const area = (l.x1 - l.x0) * (l.y1 - l.y0);
      expect(area).toBeGreaterThanOrEqual(last);
      last = area;
      expect(l.x0).toBeGreaterThanOrEqual(0);
      expect(l.x1).toBeLessThanOrEqual(MAP_W);
      expect(onLand(l, { x: 22, y: 14, w: 4, h: 4 })).toBe(true); // the tower
    }
    expect(landFor(1).nextAt).toBe(5);
    expect(landFor(12).nextAt).toBe(15);
    expect(landFor(20)).toEqual({ x0: 0, y0: 0, x1: MAP_W, y1: MAP_H, nextAt: null });
  });
});
