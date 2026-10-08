/**
 * Water for themed scenes (the harbour, ponds): deep and glossy, mirroring
 * the sky's HDRI, with ripples from a few moving sine waves on the normal.
 */

import * as THREE from 'three';
import { wind } from './wind.js';

/**
 * Ripples on still water: a few moving sine waves tilt the normal, so the sky
 * reflection (the theme's HDRI) shimmers. Shares the wind's clock.
 */
export function rippling(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = wind.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vWaterPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'varying vec3 vWaterPos;\nuniform float uWaterTime;\nvoid main() {').replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
{
  vec2 p = vWaterPos.xz;
  float t = uWaterTime;
  float dx = cos(p.x * 1.7 + t * 1.3) * 0.5 + cos((p.x + p.y) * 2.9 - t * 1.9) * 0.3 + cos(p.x * 5.3 + p.y * 2.1 + t * 2.7) * 0.15;
  float dz = cos(p.y * 1.9 - t * 1.1) * 0.5 + cos((p.y - p.x) * 3.1 + t * 1.7) * 0.3 + cos(p.y * 4.7 - p.x * 1.3 - t * 2.3) * 0.15;
  vec3 wn = normalize(vec3(dx * 0.09, 1.0, dz * 0.09));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
    );
  };
  mat.customProgramCacheKey = () => 'water-ripples';
  return mat;
}

/** A shared water material. */
export function waterMaterial(): THREE.MeshStandardMaterial {
  return rippling(new THREE.MeshStandardMaterial({ color: '#27506a', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 }));
}
