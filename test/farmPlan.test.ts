import { describe, expect, it } from 'vitest';
import { PADDOCK, blockPaddock, herdFor, paddockRect, paddockSpot, separateHerd } from '../src/world/farmPlan.js';
import { MAP_H, MAP_W } from '../src/world/layout.js';

describe('the herd follows the net worth', () => {
  it('grows on a log scale, and is capped', () => {
    expect(herdFor(0)).toBe(0);
    expect(herdFor(10_000)).toBe(2);
    expect(herdFor(1e12)).toBe(8);
    expect(herdFor(-1)).toBe(0);
  });
});

describe('the paddock stands on open meadow, clear of the buildings', () => {
  const walkable = new Uint8Array(MAP_W * MAP_H).fill(1);
  it('is fully walkable and far enough from every building', () => {
    const buildings = [{ x: 10, y: 10, w: 4, h: 4 }];
    const spot = paddockSpot(walkable, buildings);
    expect(spot).not.toBeNull();
    const r = paddockRect(spot!);
    expect(r.x1 - r.x0).toBe(PADDOCK.w);
    expect(r.z1 - r.z0).toBe(PADDOCK.h);
    // no tile of the building within `clear` of the paddock
    const gapX = Math.max(10 - (r.x1 - 1), r.x0 - 13, 0);
    const gapZ = Math.max(10 - (r.z1 - 1), r.z0 - 13, 0);
    expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(PADDOCK.clear);
  });
  it('gives nothing when there is no room for the paddock', () => {
    expect(paddockSpot(new Uint8Array(MAP_W * MAP_H), [])).toBeNull();
  });
});

describe('people keep out of the paddock', () => {
  it('blocks every tile of it on the plan', () => {
    const walkable = new Uint8Array(MAP_W * MAP_H).fill(1);
    const r = paddockRect({ x: 20, y: 15 });
    blockPaddock(walkable, r);
    for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) expect(walkable[z * MAP_W + x]).toBe(0);
    expect(walkable[(r.z0 - 1) * MAP_W + r.x0]).toBe(1); // the ground just outside stays open
  });
});

describe('the animals keep apart and inside the fence', () => {
  const r = paddockRect({ x: 20, y: 15 });
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

  it('pushes overlapping animals apart', () => {
    const herd = [
      { x: 20, z: 15 },
      { x: 20.05, z: 15 },
      { x: 20, z: 15.1 },
    ];
    separateHerd(herd, PADDOCK.radius, r);
    for (let i = 0; i < herd.length; i++) for (let j = i + 1; j < herd.length; j++) expect(dist(herd[i]!, herd[j]!)).toBeGreaterThanOrEqual(2 * PADDOCK.radius - 0.02);
  });
  it('holds every animal inside the fence', () => {
    const herd = [
      { x: r.x0 - 3, z: r.z0 - 3 },
      { x: r.x1 + 3, z: r.z1 + 3 },
    ];
    separateHerd(herd, PADDOCK.radius, r);
    for (const p of herd) {
      expect(p.x).toBeGreaterThanOrEqual(r.x0 + PADDOCK.radius - 1e-9);
      expect(p.x).toBeLessThanOrEqual(r.x1 - PADDOCK.radius + 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(r.z0 + PADDOCK.radius - 1e-9);
      expect(p.z).toBeLessThanOrEqual(r.z1 - PADDOCK.radius + 1e-9);
    }
  });
});
