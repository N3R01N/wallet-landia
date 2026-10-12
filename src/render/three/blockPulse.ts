/**
 * A new block: a band of light runs out along the streets from the Chronicle
 * Tower, brighter the fuller the block. One additive mesh over the street
 * tiles (roads, plaza, paths), drawn only while a pulse runs.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W, tileAt, type TownPlan } from '../../world/layout.js';

/** How far the band runs (tiles) over the bell's ring. */
const REACH = 34;

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec2 uCentre;
uniform float uRadius;
uniform float uGlow;
uniform vec3 uColour;
varying vec2 vXZ;
void main() {
  float d = distance(vXZ, uCentre);
  float off = (d - uRadius) / 1.3; // (squared by hand: pow() of a negative is undefined in GLSL)
  float band = exp(-off * off);
  // a fainter wake behind the front, and a soft start at the tower's foot
  float wake = d < uRadius ? 0.22 * (d / max(uRadius, 0.001)) : 0.0;
  float glow = (band + wake) * uGlow * smoothstep(1.0, 3.0, d) * (1.0 - smoothstep(${(REACH * 0.7).toFixed(1)}, ${REACH.toFixed(1)}, d));
  gl_FragColor = vec4(uColour * glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class BlockPulse {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  #centre = new THREE.Vector2();

  constructor(plan: TownPlan) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const k = tileAt(plan, x, z);
        if (k !== 'road' && k !== 'plaza' && k !== 'path') continue;
        const base = pos.length / 3;
        pos.push(x, 0.035, z + 1, x + 1, 0.035, z + 1, x + 1, 0.035, z, x, 0.035, z);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCentre: { value: this.#centre }, uRadius: { value: 0 }, uGlow: { value: 0 }, uColour: { value: new THREE.Color('#ffd27a') } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'block-pulse';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * The pulse at `k` (0 … 1 through the ring; outside: none) from (x, z),
   * `busy` the block's fullness (0..1), `night` 0..1 (it shows more at night).
   */
  update(k: number | null, x: number, z: number, busy: number, night: number): void {
    const on = k !== null && k >= 0 && k < 1;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.mesh.material.uniforms;
    this.#centre.set(x, z);
    // eases out: quick from the tower, slowing as it spreads
    u.uRadius!.value = REACH * (1 - (1 - k) * (1 - k));
    u.uGlow!.value = (1 - k) * (0.7 + busy * 1.8) * (0.8 + night * 0.7);
  }
}
