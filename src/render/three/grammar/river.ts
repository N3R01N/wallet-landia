/**
 * A river for a theme's surroundings: a channel cut into the terrain along a
 * winding centreline, and a ribbon of flowing water in it. The water only
 * ever runs downhill: its level follows the lowest ground met so far from the
 * source, and can be pinned at one point (where it joins the town's
 * harbour). Where the hills stand higher than the water the river cuts a
 * gorge, with banks that steepen as they rise.
 *
 * Units are tiles.
 */

import * as THREE from 'three';
import type { Box2 } from './terrain.js';
import { wind } from '../wind.js';

export interface RiverSpec {
  /** The course, from the source downstream (tile points; smoothed). */
  points: [number, number][];
  /** Half the width of the water (tiles). Default 1.5. */
  halfWidth?: number;
  /** Depth of the bed below the water (tiles). Default 0.7. */
  depth?: number;
  /** Pin the water level where it passes this point (joins standing water). */
  pin?: { x: number; z: number; level: number };
  /** Where the river's own water is not drawn (the town draws it there). */
  under?: Box2;
}

const STEP = 0.5;
/** How far from the water's edge the banks may reach (tiles). */
const REACH = 12;
const CELL = 4;

/** Bank height above the water, `e` tiles from its edge: gentle, then steeper. */
const bank = (e: number): number => 0.05 + e * 0.45 + e * e * 0.08;

export class River {
  readonly halfWidth: number;
  readonly depth: number;
  /** Centreline samples, every STEP tiles. */
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  /** Water level at each sample (after `settle`). */
  level: number[] = [];
  readonly #spec: RiverSpec;
  readonly #cells = new Map<string, number[]>();

  constructor(spec: RiverSpec) {
    this.#spec = spec;
    this.halfWidth = spec.halfWidth ?? 1.5;
    this.depth = spec.depth ?? 0.7;
    const curve = new THREE.CatmullRomCurve3(spec.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const n = Math.max(2, Math.ceil(curve.getLength() / STEP));
    for (const p of curve.getSpacedPoints(n)) {
      this.xs.push(p.x);
      this.zs.push(p.z);
    }
    // a spatial hash: each cell lists the segments that may reach it
    const reach = this.halfWidth + REACH;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const x0 = Math.min(this.xs[i]!, this.xs[i + 1]!) - reach;
      const x1 = Math.max(this.xs[i]!, this.xs[i + 1]!) + reach;
      const z0 = Math.min(this.zs[i]!, this.zs[i + 1]!) - reach;
      const z1 = Math.max(this.zs[i]!, this.zs[i + 1]!) + reach;
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
          const key = `${cx},${cz}`;
          const list = this.#cells.get(key);
          if (list) list.push(i);
          else this.#cells.set(key, [i]);
        }
      }
    }
  }

  /** Extent of the course (for finer terrain there). */
  get box(): Box2 {
    const pad = this.halfWidth + REACH;
    return { x0: Math.min(...this.xs) - pad, x1: Math.max(...this.xs) + pad, z0: Math.min(...this.zs) - pad, z1: Math.max(...this.zs) + pad };
  }

  /** Nearest point of the centreline: distance, and where along it (sample index, fractional). */
  nearest(x: number, z: number): { d: number; at: number } {
    const list = this.#cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    let d = Infinity;
    let at = 0;
    for (const i of list ?? []) {
      const ax = this.xs[i]!;
      const az = this.zs[i]!;
      const vx = this.xs[i + 1]! - ax;
      const vz = this.zs[i + 1]! - az;
      const t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      const e = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (e < d) {
        d = e;
        at = i + t;
      }
    }
    return { d, at };
  }

  /** Distance from the water's edge (negative in the water); Infinity well away from it. */
  edgeDist(x: number, z: number): number {
    return this.nearest(x, z).d - this.halfWidth;
  }

  #levelAt(at: number): number {
    const i = Math.min(Math.floor(at), this.level.length - 2);
    const f = at - i;
    return this.level[i]! * (1 - f) + this.level[i + 1]! * f;
  }

  /** Fix the water level from the ground the course crosses (before carving). */
  settle(ground: (x: number, z: number) => number): void {
    const n = this.xs.length;
    const natural = this.xs.map((x, i) => ground(x, this.zs[i]!) - 0.5);
    const pin = this.#spec.pin;
    let p = -1;
    if (pin) {
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(this.xs[i]! - pin.x, this.zs[i]! - pin.z);
        if (d < best) [best, p] = [d, i];
      }
    }
    // smooth what the course meets, then let the water only run downhill
    let lv = natural;
    for (let pass = 0; pass < 6; pass++) lv = lv.map((v, i) => (lv[Math.max(0, i - 2)]! + lv[Math.max(0, i - 1)]! + v + lv[Math.min(n - 1, i + 1)]! + lv[Math.min(n - 1, i + 2)]!) / 5);
    // water only runs downhill
    const out = new Array<number>(n);
    let run = Infinity;
    for (let i = 0; i < n; i++) {
      run = Math.min(run, lv[i]!, natural[i]!);
      out[i] = run;
    }
    if (pin && p >= 0) {
      for (let i = 0; i <= p; i++) out[i] = Math.max(out[i]!, pin.level);
      // below the pin it falls gently away from the standing water, never above the ground
      const fall = 0.04;
      run = pin.level;
      for (let i = p; i < n; i++) {
        // level with the standing water until clear of it
        if (i - p > 5 / STEP) run = Math.min(Math.max(Math.min(run, lv[i]!), run - fall), natural[i]! + 0.55);
        out[i] = run;
      }
    }
    this.level = out;
  }

  /** The ground with the channel cut into it. */
  carve(x: number, z: number, h: number): number {
    const { d, at } = this.nearest(x, z);
    const e = d - this.halfWidth;
    if (e > REACH) return h;
    const w = this.#levelAt(at);
    if (e < 0) {
      const t = d / this.halfWidth;
      return Math.min(h, w - this.depth * (1 - t * t) + 0.05 * t * t);
    }
    return Math.min(h, w + bank(e));
  }

  /** Water level at the nearest point of the course. */
  levelNear(x: number, z: number): number {
    return this.#levelAt(this.nearest(x, z).at);
  }

  /** The water: a ribbon along the course, flowing downstream. */
  water(): THREE.Mesh {
    const under = this.#spec.under;
    const inside = (x: number, z: number): boolean => !!under && x > under.x0 && x < under.x1 && z > under.z0 && z < under.z1;
    const n = this.xs.length;
    // runs of the course outside the town's water, ending exactly on its edge
    type Pt = { x: number; z: number; at: number; edge: boolean };
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const x = this.xs[i]!;
      const z = this.zs[i]!;
      const isIn = inside(x, z);
      if (i > 0 && isIn !== inside(this.xs[i - 1]!, this.zs[i - 1]!)) {
        const px = this.xs[i - 1]!;
        const pz = this.zs[i - 1]!;
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 24; k++) {
          const m = (lo + hi) / 2;
          if (inside(px + (x - px) * m, pz + (z - pz) * m) === isIn) hi = m;
          else lo = m;
        }
        const t = (lo + hi) / 2;
        run.push({ x: px + (x - px) * t, z: pz + (z - pz) * t, at: i - 1 + t, edge: true });
        if (isIn) {
          runs.push(run);
          run = [];
        }
      }
      if (!isIn) run.push({ x, z, at: i, edge: false });
    }
    runs.push(run);

    const hw = this.halfWidth + 0.3;
    const pos: number[] = [];
    const flow: number[] = [];
    const edge: number[] = [];
    const idx: number[] = [];
    for (const r of runs) {
      if (r.length < 2) continue;
      for (let k = 0; k < r.length; k++) {
        const p = r[k]!;
        const q = r[Math.min(r.length - 1, k + 1)]!;
        const o = r[Math.max(0, k - 1)]!;
        const tl = Math.hypot(q.x - o.x, q.z - o.z) || 1;
        const tx = (q.x - o.x) / tl;
        const tz = (q.z - o.z) / tl;
        let nx = -tz;
        let nz = tx;
        if (p.edge && under) {
          // end square to the town's edge, so the water meets the harbour cleanly
          const onX = Math.min(Math.abs(p.x - under.x0), Math.abs(p.x - under.x1)) < Math.min(Math.abs(p.z - under.z0), Math.abs(p.z - under.z1));
          const across = onX ? Math.abs(tx) : Math.abs(tz);
          // (unless it meets the edge at a glancing angle, where a square end would fold over)
          if (across > 0.6) [nx, nz] = onX ? [0, (Math.sign(nz) || 1) / across] : [(Math.sign(nx) || 1) / across, 0];
        }
        const y = this.#levelAt(Math.min(p.at, n - 1));
        const base = pos.length / 3;
        pos.push(p.x - nx * hw, y, p.z - nz * hw, p.x, y, p.z, p.x + nx * hw, y, p.z + nz * hw);
        for (let s = 0; s < 3; s++) flow.push(tx, tz);
        edge.push(1, 0, 1);
        if (k > 0) {
          const a = base - 3;
          idx.push(a, a + 1, base, a + 1, base + 1, base, a + 1, a + 2, base + 1, a + 2, base + 2, base + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, riverMaterial());
    mesh.receiveShadow = true;
    mesh.name = 'river';
    return mesh;
  }
}

/**
 * Flowing water: ripples carried downstream along each vertex's flow
 * direction (two phases blended, so the pattern never stretches), lighter and
 * clearer in the shallows by the banks.
 */
export function riverMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#27506a', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = wind.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec2 flow;\nattribute float edge;\nvarying vec2 vFlow;\nvarying float vEdge;\nvarying vec3 vWaterPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = flow;\nvEdge = edge;\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 vFlow;\nvarying float vEdge;\nvarying vec3 vWaterPos;\nuniform float uWaterTime;\nvec2 ripple(vec2 p, float t) {\n  return vec2(cos(p.x * 2.1 + t * 0.7) * 0.5 + cos((p.x + p.y) * 3.3 - t) * 0.3 + cos(p.x * 6.1 + p.y * 2.3) * 0.2,\n              cos(p.y * 2.3 - t * 0.6) * 0.5 + cos((p.y - p.x) * 3.7 + t * 0.9) * 0.3 + cos(p.y * 5.9 - p.x * 1.7) * 0.2);\n}\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.46, 0.42), smoothstep(0.55, 1.0, vEdge) * 0.6);\ndiffuseColor.a *= 1.0 - smoothstep(0.75, 1.0, vEdge) * 0.45;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float t = uWaterTime * 0.35;
  float f0 = fract(t);
  float f1 = fract(t + 0.5);
  vec2 sp = vFlow * 1.6;
  vec2 r = ripple(vWaterPos.xz - sp * f0, uWaterTime) * (1.0 - abs(1.0 - 2.0 * f0))
         + ripple(vWaterPos.xz - sp * f1 + 0.37, uWaterTime) * (1.0 - abs(1.0 - 2.0 * f1));
  vec3 wn = normalize(vec3(r.x * 0.12, 1.0, r.y * 0.12));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'river-flow';
  return mat;
}
