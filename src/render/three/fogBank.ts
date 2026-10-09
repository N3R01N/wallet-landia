/**
 * Fog of war in 3D: banks of soft mist over buildings no hero has visited yet.
 * One instanced mesh of camera-facing puffs for the whole town (one draw
 * call); each building's puffs share an opacity that falls to nothing as the
 * fog lifts, and rise a little as they go.
 */

import * as THREE from 'three';
import { makeRng } from '../../util/rng.js';

export interface FogSite {
  /** Footprint (tiles): x/z of the near corner, width and depth. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Roof height (tiles). */
  top: number;
}

const VERT = /* glsl */ `
  attribute vec3 iCenter;
  attribute float iSize;
  attribute float iAlpha;
  attribute float iSeed;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  #include <fog_pars_vertex>
  void main() {
    vUv = position.xy + 0.5;
    // lifting fog rises and swells as it thins
    float lift = 1.0 - iAlpha;
    vec3 c = iCenter + vec3(sin(uTime * 0.3 + iSeed * 6.0) * 0.15, lift * 1.5 + sin(uTime * 0.4 + iSeed * 9.0) * 0.08, 0.0);
    vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
    mvPosition.xy += position.xy * iSize * (1.0 + lift * 0.4);
    // stand in front of the walls it wraps (a flat puff inside a building would be cut by them)
    mvPosition.z += iSize * 0.75;
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = iAlpha;
    vShade = clamp(iCenter.y / 4.0, 0.0, 1.0);
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform float uNight;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0 || vAlpha <= 0.0) discard;
    float soft = smoothstep(1.0, 0.55, d);
    // lit from above: brighter towards the top of each puff and of the bank
    vec3 col = mix(vec3(0.55, 0.59, 0.65), vec3(0.84, 0.87, 0.9), clamp(0.5 + p.y * 0.8 + vShade * 0.3, 0.0, 1.0));
    col *= 1.0 - uNight * 0.75;
    gl_FragColor = vec4(col, soft * vAlpha * 0.97);
    #include <fog_fragment>
  }
`;

export class FogBank {
  readonly mesh: THREE.Mesh;
  /** Each site's range of puffs: [first, count]. */
  readonly #ranges: [number, number][] = [];
  readonly #alpha: THREE.InstancedBufferAttribute;
  readonly #last: number[];
  readonly #mat: THREE.ShaderMaterial;

  constructor(sites: FogSite[], seed = 3) {
    const rng = makeRng(seed);
    const centers: number[] = [];
    const sizes: number[] = [];
    const seeds: number[] = [];
    for (const s of sites) {
      const first = sizes.length;
      const span = Math.max(s.w, s.d);
      const n = Math.round(10 + s.w * s.d * 1.4);
      // a heap of mist: puffs on a dome over the footprint, up past the roof
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng());
        const h = rng();
        const spread = 1 - h * 0.6;
        centers.push(s.x + s.w / 2 + Math.cos(a) * r * (s.w / 2) * spread, 0.3 + h * (s.top + 0.2), s.z + s.d / 2 + Math.sin(a) * r * (s.d / 2) * spread);
        sizes.push(span * (0.7 + rng() * 0.4) * (1 - h * 0.3) + 0.8);
        seeds.push(rng());
      }
      // a cap over the roof, so tall buildings are hidden too
      centers.push(s.x + s.w / 2, s.top + 0.3, s.z + s.d / 2);
      sizes.push(span * 0.9 + 1);
      seeds.push(rng());
      this.#ranges.push([first, sizes.length - first]);
    }
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    this.#alpha = new THREE.InstancedBufferAttribute(new Float32Array(sizes.length).fill(1), 1);
    this.#alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAlpha', this.#alpha);
    geo.instanceCount = sizes.length;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(24, 2, 18), 60);
    this.#last = sites.map(() => 1);
    this.#mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsLib.fog, uTime: { value: 0 }, uNight: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(geo, this.#mat);
    this.mesh.name = 'fog-of-war';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
  }

  /** How hidden each site is (1 hidden … 0 clear), in the order they were given. */
  update(time: number, night: number, hidden: (i: number) => number): void {
    this.#mat.uniforms.uTime!.value = time;
    this.#mat.uniforms.uNight!.value = night;
    let any = false;
    let changed = false;
    this.#ranges.forEach(([first, count], i) => {
      const a = hidden(i);
      if (a > 0) any = true;
      if (a === this.#last[i]) return;
      this.#last[i] = a;
      for (let k = first; k < first + count; k++) this.#alpha.setX(k, a);
      changed = true;
    });
    if (changed) this.#alpha.needsUpdate = true;
    this.mesh.visible = any;
  }
}
