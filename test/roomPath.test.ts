import { describe, expect, it } from 'vitest';
import { walkPath, type Footprint } from '../src/render/three/roomPath.js';

const floor: Footprint = { x0: -2.5, x1: 2.5, z0: -2, z1: 2 };
const table: Footprint = { x0: -1.6, x1: 0.2, z0: -0.15, z1: 0.65 };

/** Whether a straight walk between two points of a path crosses the footprint (sampled). */
const crosses = (a: { x: number; z: number }, b: { x: number; z: number }, f: Footprint): boolean => {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) return true;
  }
  return false;
};

describe('how the hero walks round the furniture', () => {
  it('a walk round the table never goes through it', () => {
    const from = { x: -1.0, z: -0.8 };
    const to = { x: -1.0, z: 1.0 };
    const path = walkPath(from, to, [table], floor);
    let at = from;
    for (const p of path) {
      expect(crosses(at, p, table)).toBe(false);
      at = p;
    }
    expect(path[path.length - 1]).toEqual(to);
  });

  it('a clear walk goes there in a few turns', () => {
    const path = walkPath({ x: 1.5, z: 1.5 }, { x: 2.0, z: 1.8 }, [table], floor);
    expect(path[path.length - 1]).toEqual({ x: 2.0, z: 1.8 });
    expect(path.length).toBeLessThanOrEqual(6);
  });

  it('a spot inside furniture is walked to from beside it', () => {
    const path = walkPath({ x: 1.5, z: 1.5 }, { x: -0.5, z: 0.3 }, [table], floor);
    expect(path.length).toBeGreaterThan(0);
  });
});
