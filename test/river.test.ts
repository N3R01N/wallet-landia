import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { River } from '../src/render/three/grammar/river.js';

/** A valley floor at 0 that rises to the east and dips in the middle. */
const ground = (x: number, z: number): number => (x > 20 ? (x - 20) * 0.3 : 0) + Math.sin(z * 0.2) * 0.8 + 1;

describe('River', () => {
  const course: [number, number][] = [[40, -30], [30, -10], [10, 0], [12, 20], [8, 40]];

  it('only ever runs downhill, below the ground it crosses', () => {
    const r = new River({ points: course });
    r.settle(ground);
    for (let i = 1; i < r.level.length; i++) expect(r.level[i]!).toBeLessThanOrEqual(r.level[i - 1]! + 1e-9);
    for (let i = 0; i < r.level.length; i++) expect(r.level[i]!).toBeLessThanOrEqual(ground(r.xs[i]!, r.zs[i]!) - 0.5 + 1e-9);
  });

  it('meets standing water at its level where pinned', () => {
    const r = new River({ points: course, pin: { x: 10, z: 0, level: 0.03 } });
    r.settle(() => 0);
    expect(r.levelNear(10, 0)).toBeCloseTo(0.03, 5);
    // upstream never below the pin, and level with it just downstream
    expect(r.levelNear(30, -10)).toBeGreaterThanOrEqual(0.03);
    expect(r.levelNear(11, 3)).toBeCloseTo(0.03, 5);
  });

  it('cuts a channel below the water, and leaves distant ground alone', () => {
    const r = new River({ points: course });
    r.settle(ground);
    const x = r.xs[40]!;
    const z = r.zs[40]!;
    expect(r.carve(x, z, ground(x, z))).toBeLessThan(r.levelNear(x, z) - 0.5);
    expect(r.carve(x + 40, z, 7)).toBe(7);
  });

  it('draws water facing up, broken where the town has its own', () => {
    // through a harbour, like the town's: in across one edge, out across another
    const r = new River({ points: [[40, -20], [30, -2], [20, 0], [10, 0], [10, 10], [12, 30]], under: { x0: 0, x1: 20, z0: -5, z1: 5 } });
    r.settle(ground);
    const geo = r.water().geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.index!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      expect(n.y).toBeGreaterThan(0);
      // no triangle inside the town's water
      const mx = (a.x + b.x + c.x) / 3;
      const mz = (a.z + b.z + c.z) / 3;
      expect(mx > 0.5 && mx < 19.5 && mz > -4.5 && mz < 4.5).toBe(false);
    }
  });
});
