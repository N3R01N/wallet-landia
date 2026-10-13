import { describe, expect, it } from 'vitest';
import { herdFor, paddockSpot } from '../src/world/farmPlan.js';
import { MAP_H, MAP_W } from '../src/world/layout.js';

describe('the herd follows the net worth', () => {
  it('grows on a log scale, and is capped', () => {
    expect(herdFor(0)).toBe(0);
    expect(herdFor(10_000)).toBe(2);
    expect(herdFor(1e12)).toBe(8);
    expect(herdFor(-1)).toBe(0);
  });
});

describe('the paddock stands away from the buildings', () => {
  it('finds open meadow clear of the houses, near the middle of the town', () => {
    const walkable = new Uint8Array(MAP_W * MAP_H).fill(1);
    const buildings = [{ x: 10, y: 10, w: 4, h: 4 }];
    const spot = paddockSpot(walkable, buildings);
    expect(spot).not.toBeNull();
    const dx = Math.max(10 - spot!.x, 0, spot!.x - 13);
    const dy = Math.max(10 - spot!.y, 0, spot!.y - 13);
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(4);
  });
  it('gives nothing when no meadow is walkable', () => {
    expect(paddockSpot(new Uint8Array(MAP_W * MAP_H), [])).toBeNull();
  });
});
