/**
 * Terrain for a theme (Phase 5): flat where the town stands, rising into
 * hills around it. Four PBR ground layers (grass, dirt, rock, forest floor)
 * are blended per vertex: rock where it is steep, dirt where feet and wheels
 * wear the verges, forest floor under the woods. A low-frequency tint and a
 * second, larger grass sample break up visible tiling.
 *
 * Units are tiles (x/z as in the town, y up); textures repeat in metres.
 */

import * as THREE from 'three';
import { makeRng } from '../../../util/rng.js';
import type { MaterialLibrary } from './materials.js';
import { METRES_PER_TILE } from './medieval.js';
import type { River } from './river.js';

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TerrainSpec {
  /** Kept perfectly flat (y = 0): where the town stands. */
  flat: Box2;
  /** Extent of the terrain mesh. */
  bounds: Box2;
  /** 0..1, how worn to dirt the ground is here (road verges, paths). */
  wear(x: number, z: number): number;
  /** 0..1, forest floor (under the woods). */
  woods(x: number, z: number): number;
  /** Optional 0..1 scale on the hills (an open meadow on one side). */
  relief?(x: number, z: number): number;
  /** Hollows (ponds): a bowl of radius r (tiles) and depth at (x, z). */
  dips?: { x: number; z: number; r: number; depth: number }[];
  /** A river cut through it (its water level is settled from this terrain). */
  river?: River;
  seed: number;
}

// --- noise ---------------------------------------------------------------------

/** Seeded 2D value noise with fractal sums, in [0, 1]. */
export function makeNoise(seed: number): { noise(x: number, z: number): number; fbm(x: number, z: number, octaves?: number): number } {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rng();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;
  const v = (x: number, z: number): number => vals[perm[(perm[x & 255]! + z) & 511]!]!;
  const s = (t: number): number => t * t * (3 - 2 * t);
  const noise = (x: number, z: number): number => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const fx = s(x - xi);
    const fz = s(z - zi);
    const a = v(xi, zi) + (v(xi + 1, zi) - v(xi, zi)) * fx;
    const b = v(xi, zi + 1) + (v(xi + 1, zi + 1) - v(xi, zi + 1)) * fx;
    return a + (b - a) * fz;
  };
  const fbm = (x: number, z: number, octaves = 4): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x, z) * amp;
      norm += amp;
      amp *= 0.5;
      x = x * 2.03 + 17.1;
      z = z * 2.03 - 9.7;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Distance from (x, z) to a box (0 inside). */
export function outside(b: Box2, x: number, z: number): number {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}

// --- the terrain ---------------------------------------------------------------

/** Grid lines: fine near the town, coarser towards the horizon; fine enough along a river for its banks. */
function axis(a0: number, a1: number, f0: number, f1: number, r0 = Infinity, r1 = -Infinity): number[] {
  const out: number[] = [];
  let a = a0;
  while (a < a1) {
    out.push(a);
    const d = Math.max(f0 - a, 0, a - f1);
    const step = d < 6 ? 0.5 : d < 30 ? 1.5 : 4;
    a += a >= r0 && a <= r1 ? Math.min(step, 0.75) : step;
  }
  out.push(a1);
  return out;
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly #spec: TerrainSpec;
  readonly #n: ReturnType<typeof makeNoise>;

  constructor(spec: TerrainSpec, lib: MaterialLibrary) {
    this.#spec = spec;
    this.#n = makeNoise(spec.seed);
    spec.river?.settle((x, z) => this.#natural(x, z));
    this.mesh = this.#build(lib);
  }

  /** Ground height (tiles) at a point. Zero over the town. */
  heightAt(x: number, z: number): number {
    const h = this.#natural(x, z);
    return this.#spec.river ? this.#spec.river.carve(x, z, h) : h;
  }

  /** The ground before any river cuts it. */
  #natural(x: number, z: number): number {
    const d = outside(this.#spec.flat, x, z);
    if (d <= 0) return 0;
    const rise = smooth(0, 16, d);
    const hills = this.#n.fbm(x * 0.03, z * 0.03, 4);
    const ridges = 1 - Math.abs(this.#n.fbm(x * 0.012 + 40, z * 0.012, 3) * 2 - 1);
    // gentle at first, rising towards the horizon so the valley feels enclosed
    const relief = this.#spec.relief?.(x, z) ?? 1;
    let h = (rise * (hills * 7 + ridges * 6 - 2.5) + Math.max(0, d - 20) * 0.12 + rise * 1.5) * relief;
    for (const p of this.#spec.dips ?? []) h -= p.depth * smooth(p.r, p.r * 0.45, Math.hypot(x - p.x, z - p.z));
    return h;
  }

  /** Steepness: rise over run. */
  slopeAt(x: number, z: number): number {
    const e = 0.5;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  #build(lib: MaterialLibrary): THREE.Mesh {
    const { bounds: b, flat } = this.#spec;
    const rb = this.#spec.river?.box;
    const xs = axis(b.x0, b.x1, flat.x0, flat.x1, rb?.x0, rb?.x1);
    const zs = axis(b.z0, b.z1, flat.z0, flat.z1, rb?.z0, rb?.z1);
    const nx = xs.length;
    const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    const splat = new Float32Array(nx * nz * 4);
    const col = new Float32Array(nx * nz * 3);
    const tint = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = xs[i]!;
        const z = zs[j]!;
        const k = j * nx + i;
        const y = this.heightAt(x, z);
        pos.set([x, y, z], k * 3);
        const slope = this.slopeAt(x, z);
        const rock = smooth(0.55, 1.0, slope + (this.#n.noise(x * 0.3, z * 0.3) - 0.5) * 0.3);
        const woods = this.#spec.woods(x, z) * (1 - rock);
        const patches = smooth(0.66, 0.8, this.#n.fbm(x * 0.12 + 7, z * 0.12, 3)) * 0.7;
        const dirt = Math.max(this.#spec.wear(x, z), patches) * (1 - rock) * (1 - woods * 0.6);
        const grass = Math.max(0, 1 - rock - woods - dirt);
        splat.set([grass, dirt, rock, woods], k * 4);
        // macro variation: sun-bleached and lush patches
        const m = this.#n.fbm(x * 0.05 - 3, z * 0.05 + 11, 3);
        tint.setHSL(0.13 + m * 0.06, 0.25, 0.42 + m * 0.18);
        tint.lerp(new THREE.Color(1, 1, 1), 0.55);
        col.set([tint.r, tint.g, tint.b], k * 3);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const c = a + nx;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const layers = ['grass', 'dirt', 'rock', 'forestFloor'] as const;
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, vertexColors: true });
    const uniforms = {
      uScale: { value: new THREE.Vector4(...layers.map((l) => METRES_PER_TILE / lib.size(l))) },
      ...Object.fromEntries(layers.flatMap((l, i) => [[`tC${i}`, { value: lib.tex(l, 'color') }], [`tN${i}`, { value: lib.tex(l, 'normal') }]])),
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vXZ;\nvarying vec3 vWN;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `varying vec4 vSplat;
varying vec2 vXZ;
varying vec3 vWN;
uniform vec4 uScale;
uniform sampler2D tC0, tC1, tC2, tC3, tN0, tN1, tN2, tN3;
vec4 terrainWeights() {
  vec4 w = max(vSplat, vec4(0.0));
  w = w * w;
  return w / max(dot(w, vec4(1.0)), 1e-4);
}
void main() {`,
        )
        .replace(
          '#include <map_fragment>',
          `vec2 tuv = vec2(vXZ.x, -vXZ.y);
vec4 tw = terrainWeights();
// grass twice, at two scales, so its repeat does not show
vec3 g = mix(texture2D(tC0, tuv * uScale.x).rgb, texture2D(tC0, tuv * uScale.x * 0.31 + 0.37).rgb, 0.45);
vec3 tcol = g * tw.x + texture2D(tC1, tuv * uScale.y).rgb * tw.y + texture2D(tC2, tuv * uScale.z).rgb * tw.z + texture2D(tC3, tuv * uScale.w).rgb * tw.w;
diffuseColor.rgb *= tcol;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  vec3 nm = (texture2D(tN0, tuv * uScale.x).xyz * tw.x + texture2D(tN1, tuv * uScale.y).xyz * tw.y + texture2D(tN2, tuv * uScale.z).xyz * tw.z + texture2D(tN3, tuv * uScale.w).xyz * tw.w) * 2.0 - 1.0;
  vec3 wn = normalize(normalize(vWN) + 0.7 * (nm.x * vec3(1.0, 0.0, 0.0) + nm.y * vec3(0.0, 0.0, -1.0)));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-splat';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}
