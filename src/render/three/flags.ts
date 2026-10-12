/**
 * Flags and banners that ripple in the wind (the same wind as the trees:
 * wind.ts's clock, strength and direction).
 *
 * Cloth carries a `flutter` vertex attribute: xyz is the way it may move
 * (its length the reach), w how free that vertex is: 0 at the pole, 1 at the
 * free edge. A banner hung on a wall has w < 0: it only billows outward, so it
 * never sinks into the wall. Waves run from the pole to the free edge and
 * travel across town with the gusts. Cloth keeps its own material when merged
 * (`flutterMaterial`), and its shadow sways too.
 */

import * as THREE from 'three';
import { wind } from './wind.js';
import { keep } from './dispose.js';

export const FLUTTER = 'flutter';

const DECL = /* glsl */ `
attribute vec4 flutter;
uniform float uWindTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
void main() {`;

// The merged town mesh is in world space (its model matrix is identity), so `position` is where it stands.
const BEGIN = /* glsl */ `#include <begin_vertex>
{
  float fw = abs(flutter.w);
  float ph = fw * 5.5 - uWindTime * (4.5 + uWindStrength * 4.0) + dot(position.xz, uWindDir) * 0.6;
  float s = sin(ph) * 0.7 + sin(ph * 2.1 + 1.3) * 0.3;
  float reach = fw * fw * (0.45 + uWindStrength * 1.1);
  transformed += flutter.xyz * (flutter.w >= 0.0 ? s : 0.55 + 0.45 * s) * reach;
}`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uWindTime = wind.uTime;
  shader.uniforms.uWindStrength = wind.uStrength;
  shader.uniforms.uWindDir = wind.uDir;
  shader.vertexShader = shader.vertexShader.replace('void main() {', DECL).replace('#include <begin_vertex>', BEGIN);
}

const rippling = new WeakMap<THREE.Material, THREE.Material>();
let depth: THREE.MeshDepthMaterial | null = null;

/**
 * The cloth's material, rippling: a clone (the source also dresses rigid parts), made once
 * per source and kept like it, so a rebuilt town compiles nothing new.
 */
export function flutterMaterial(src: THREE.Material): THREE.Material {
  let m = rippling.get(src);
  if (!m) {
    m = keep(src.clone());
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => 'flutter';
    rippling.set(src, m);
    // goes with its source (a theme switched away)
    const mine = m;
    src.addEventListener('dispose', () => mine.dispose());
  }
  return m;
}

/** Its shadow, rippling the same way (one for all cloth). */
export function flutterDepth(): THREE.MeshDepthMaterial {
  if (!depth) {
    depth = keep(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    depth.onBeforeCompile = patch;
    depth.customProgramCacheKey = () => 'flutter-depth';
  }
  return depth;
}

/**
 * Tag a geometry as cloth: `weight` (0 pinned … 1 free; negative: billows outward only)
 * per vertex from its position, moving along `axis` (whose length is the reach).
 */
export function flutterGeometry(geo: THREE.BufferGeometry, axis: [number, number, number], weight: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const out = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    out.set(axis, i * 4);
    out[i * 4 + 3] = weight(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  geo.setAttribute(FLUTTER, new THREE.Float32BufferAttribute(out, 4));
  return geo;
}
