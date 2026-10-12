/**
 * Cloud shadows: soft patches of shade drifting over the town and its
 * surroundings with the wind. A small tiling noise texture, sampled at each
 * lit fragment's spot on the ground (projected along the sun, so a roof and
 * the street beside it agree), dims the sunlight only: direct diffuse and
 * specular, never the sky's fill, so shade under a cloud is cooler, not black.
 *
 * Patched into the town's lit materials at build time (`shadeClouds`), chained
 * after any patch they already have. Strength 0 (night, storm, quality low)
 * skips the work behind a uniform branch.
 */

import * as THREE from 'three';
import { makeRng } from '../../util/rng.js';
import { keep } from './dispose.js';

export const clouds = {
  uCloudTex: { value: null as THREE.Texture | null },
  /** Drift (texture units), along the wind. */
  uCloudShift: { value: new THREE.Vector2() },
  /** 0 = no cloud shadows … ~0.45 = a bright day with deep patches. */
  uCloudStrength: { value: 0 },
  /** Ground offset per unit of height, along the sunlight (the sun stands still). */
  uCloudSkew: { value: new THREE.Vector2() },
};

/** Tiles covered by one repeat of the cloud texture. */
export const CLOUD_SCALE = 54;
const SIZE = 128;

/** Tileable value noise, a few octaves: soft blobs of cloud with ragged edges. Made once, deterministic. */
function cloudTexture(): THREE.DataTexture {
  const rng = makeRng(9091);
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1;
  for (const cells of [4, 8, 16, 32]) {
    const lattice = Float32Array.from({ length: cells * cells }, () => rng());
    const at = (i: number, j: number): number => lattice[((j % cells) * cells + (i % cells)) | 0]!;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const fx = (x / SIZE) * cells;
        const fy = (y / SIZE) * cells;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const u = (fx - i) * (fx - i) * (3 - 2 * (fx - i));
        const v = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
        const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
        const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
        out[y * SIZE + x] = out[y * SIZE + x]! + (top + (bottom - top) * v) * amp;
      }
    }
    amp *= 0.5;
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let p = 0; p < SIZE * SIZE; p++) data.fill(Math.round((out[p]! / 1.875) * 255), p * 4, p * 4 + 4);
  const t = new THREE.DataTexture(data, SIZE, SIZE);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return keep(t);
}

const VERT_DECL = 'uniform vec2 uCloudSkew;\nvarying vec2 vCloudXZ;\nvoid main() {';
// its own world position (not worldpos_vertex's, which only some programs have); instancing included
const VERT = /* glsl */ `#include <worldpos_vertex>
{
  vec4 cw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
  cw = modelMatrix * cw;
  vCloudXZ = cw.xz - cw.y * uCloudSkew;
}`;
const FRAG_DECL = `uniform sampler2D uCloudTex;\nuniform vec2 uCloudShift;\nuniform float uCloudStrength;\nvarying vec2 vCloudXZ;\nvoid main() {`;
const FRAG = /* glsl */ `#include <lights_fragment_end>
if (uCloudStrength > 0.001) {
  vec2 cuv = vCloudXZ / ${CLOUD_SCALE.toFixed(1)};
  float n = texture2D(uCloudTex, cuv + uCloudShift).r * 0.7 + texture2D(uCloudTex, cuv * 2.3 - uCloudShift * 1.6 + 0.37).r * 0.3;
  float shade = 1.0 - uCloudStrength * smoothstep(0.47, 0.68, n);
  reflectedLight.directDiffuse *= shade;
  reflectedLight.directSpecular *= shade;
}`;

const shaded = new WeakSet<THREE.Material>();

function lit(m: THREE.Material): boolean {
  const x = m as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
  return x.isMeshStandardMaterial === true || x.isMeshLambertMaterial === true || x.isMeshPhongMaterial === true;
}

/** Chain the cloud patch onto one lit material (once). */
function addClouds(m: THREE.Material): void {
  if (shaded.has(m) || !lit(m)) return;
  shaded.add(m);
  clouds.uCloudTex.value ??= cloudTexture();
  const before = m.onBeforeCompile.bind(m);
  // read now: the default key is the *old* hook's source, which tells patched programs apart
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, clouds);
    shader.vertexShader = shader.vertexShader.replace('void main() {', VERT_DECL).replace('#include <worldpos_vertex>', VERT);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', FRAG_DECL).replace('#include <lights_fragment_end>', FRAG);
  };
  m.customProgramCacheKey = () => `${key}|clouds`;
  m.needsUpdate = true;
}

/** Give every lit material under `root` cloud shadows (already patched ones are skipped). */
export function shadeClouds(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!(o as THREE.Mesh).isMesh || !mats) return;
    if (Array.isArray(mats)) for (const m of mats) addClouds(m);
    else addClouds(mats);
  });
}
