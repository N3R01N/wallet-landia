/**
 * Windows that light one by one at dusk: each window (each connected patch of
 * glass) gets a seed, and so a darkness at which its lamp is lit, between 0.3
 * and 0.7. They go out in the reverse order at dawn; late at night some go
 * dark as their households sleep, and a few flicker (a hearth, a candle).
 * All in the shader, from a per-vertex attribute, so the town's windows stay
 * one draw call.
 */

import * as THREE from 'three';
import { wind } from './wind.js';
import { keep } from './dispose.js';

export const windowLight = {
  /** Darkness, 0 day … 1 night. */
  uWinNight: { value: 0 },
  /** How deep into the night (0 before ~22:00, 1 from ~01:00 to ~04:00, 0 again by ~06:00). */
  uWinLate: { value: 0 },
};

/** How bright a lit window is (the emissive hierarchy: under lamps and fire). */
const LIT = 1.7;

/** Late-night factor from the hour (0..24). */
export function lateness(hour: number): number {
  if (hour >= 22) return Math.min(1, (hour - 22) / 3);
  if (hour < 4) return Math.min(1, (hour + 2) / 3);
  if (hour < 6) return 1 - (hour - 4) / 2;
  return 0;
}

const hash = (x: number, y: number, z: number, k: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k * 4.581) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Seed each window of a merged, non-indexed glass geometry: triangles sharing a corner
 * are one window; its seeds (`winSeed`: when it lights, how it sleeps) hash its centre.
 */
export function seedWindows(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const tris = Math.floor(pos.count / 3);
  const parent = new Int32Array(tris).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const corners = new Map<string, number>();
  for (let v = 0; v < tris * 3; v++) {
    const key = `${Math.round(pos.getX(v) * 200)},${Math.round(pos.getY(v) * 200)},${Math.round(pos.getZ(v) * 200)}`;
    const t = Math.floor(v / 3);
    const other = corners.get(key);
    if (other === undefined) corners.set(key, t);
    else parent[find(t)] = find(other);
  }
  const sum = new Float64Array(tris * 4);
  for (let v = 0; v < tris * 3; v++) {
    const r = find(Math.floor(v / 3)) * 4;
    sum[r] = sum[r]! + pos.getX(v);
    sum[r + 1] = sum[r + 1]! + pos.getY(v);
    sum[r + 2] = sum[r + 2]! + pos.getZ(v);
    sum[r + 3] = sum[r + 3]! + 1;
  }
  const seeds = new Float32Array(pos.count * 2);
  for (let v = 0; v < tris * 3; v++) {
    const r = find(Math.floor(v / 3)) * 4;
    const n = sum[r + 3]!;
    const [x, y, z] = [sum[r]! / n, sum[r + 1]! / n, sum[r + 2]! / n];
    seeds[v * 2] = hash(x, y, z, 1);
    seeds[v * 2 + 1] = hash(x, y, z, 2);
  }
  geo.setAttribute('winSeed', new THREE.Float32BufferAttribute(seeds, 2));
}

const VERT_DECL = 'attribute vec2 winSeed;\nvarying vec2 vWinSeed;\nvoid main() {';
const FRAG_DECL = 'uniform float uWinNight;\nuniform float uWinLate;\nuniform float uWinTime;\nvarying vec2 vWinSeed;\nvoid main() {';
const FRAG = /* glsl */ `#include <emissivemap_fragment>
{
  float th = 0.3 + vWinSeed.x * 0.4;
  float on = smoothstep(th - 0.03, th + 0.03, uWinNight);
  // four in ten go to bed, each at its own hour
  float sleep = vWinSeed.y < 0.4 ? smoothstep(0.0, 0.08, uWinLate - (0.1 + vWinSeed.y * 2.0)) : 0.0;
  // one in ten is a hearth or a candle
  float flick = vWinSeed.y > 0.9 ? 0.78 + 0.22 * sin(uWinTime * 9.0 + vWinSeed.x * 60.0) * sin(uWinTime * 2.3 + vWinSeed.x * 17.0) : 1.0;
  totalEmissiveRadiance *= on * (1.0 - sleep) * flick * (0.75 + 0.5 * fract(vWinSeed.x * 7.31));
}`;

const lit = new WeakMap<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();

/**
 * The merged windows' material: a clone of the town's glass, lit window by window. Made once
 * per glass and kept like it, so a rebuilt town compiles nothing new.
 */
export function litWindowMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const cached = lit.get(src);
  if (cached) return cached;
  const m = keep(src.clone());
  lit.set(src, m);
  src.addEventListener('dispose', () => m.dispose()); // goes with its source (a theme switched away)
  m.emissiveIntensity = LIT;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windowLight);
    shader.uniforms.uWinTime = wind.uTime;
    shader.vertexShader = shader.vertexShader.replace('void main() {', VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinSeed = winSeed;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', FRAG_DECL).replace('#include <emissivemap_fragment>', FRAG);
  };
  m.customProgramCacheKey = () => 'lit-windows';
  return m;
}
