/**
 * Smoke and steam from chimneys and stacks: one point cloud for the whole
 * town, animated entirely in the shader (no per-particle work on the CPU).
 * Each emitter owns a few puffs on staggered lifetimes; a puff rises, swells,
 * drifts with the wind (shared with the grass and trees) and fades.
 */

import * as THREE from 'three';
import { wind } from './wind.js';

export interface Emitter {
  x: number;
  y: number;
  z: number;
  color: string;
}

const PUFFS = 14;

const VERT = /* glsl */ `
  attribute vec3 aEmitter;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uTime;
  uniform float uStrength;
  uniform vec2 uDir;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    float life = fract(uTime * 0.16 + aSeed);
    float rise = life * 2.6;
    vec2 drift = uDir * life * (0.6 + uStrength * 2.4) + vec2(sin(aSeed * 40.0 + uTime), cos(aSeed * 31.0 + uTime * 0.8)) * 0.12 * life;
    vec3 p = aEmitter + vec3(drift.x, rise, drift.y);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (0.7 + life * 2.6) * uScale / -mvPosition.z; // world size (tiles) in pixels
    #include <fog_vertex>
    vColor = aColor;
    vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - life) * 0.55;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uNight;
  #include <fog_pars_fragment>
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * (1.0 - uNight * 0.7), vAlpha * (1.0 - d));
    #include <fog_fragment>
  }
`;

export class Smoke {
  readonly points: THREE.Points;
  readonly #mat: THREE.ShaderMaterial;

  constructor(emitters: Emitter[]) {
    const n = emitters.length * PUFFS;
    const pos = new Float32Array(n * 3);
    const em = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const c = new THREE.Color();
    emitters.forEach((e, i) => {
      c.set(e.color);
      for (let k = 0; k < PUFFS; k++) {
        const j = i * PUFFS + k;
        em.set([e.x, e.y, e.z], j * 3);
        pos.set([e.x, e.y, e.z], j * 3);
        col.set([c.r, c.g, c.b], j * 3);
        seed[j] = k / PUFFS + i * 0.37;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEmitter', new THREE.BufferAttribute(em, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    // the puffs travel up to ~3 tiles from their chimney
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 4;
    this.#mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: wind.uTime,
        uStrength: wind.uStrength,
        uDir: wind.uDir,
        uScale: { value: 400 },
        uNight: { value: 0 },
      },
    });
    this.points = new THREE.Points(geo, this.#mat);
    this.points.name = 'smoke';
    this.points.renderOrder = 2;
  }

  /** Points are sized in pixels: the camera's projection scale turns tiles into pixels. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.#mat.uniforms.uScale!.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  setNight(night: number): void {
    this.#mat.uniforms.uNight!.value = night;
  }
}
