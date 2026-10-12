/**
 * The 3D town's light: sky and fog colour, sun and fill through day, night and
 * storm (lightning while a siege is at its height), the emissive hierarchy,
 * the theme's sky images, the tint on unlit billboards, and the wind.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W } from '../../world/layout.js';
import type { Sim } from '../../world/sim.js';
import { currentHour, nightFactor } from '../overlay.js';
import { EnvironmentController, skyForHour } from './environment.js';
import type { ImagePipeline, Quality } from './pipeline.js';
import type { Theme } from './themes.js';
import { doorwayMaterial } from './doors.js';
import { wind } from './wind.js';
import type { SpriteMaterials } from './spriteMaterials.js';

export class DayNight {
  readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  readonly #hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 1.1);
  readonly #sky = new THREE.Color('#9fd3f0');
  readonly #gl: THREE.WebGLRenderer;
  readonly #scene: THREE.Scene;
  #env: EnvironmentController | null = null;
  #flash = 0;
  /** This frame's darkness (0 day … 1 night) and storm (0 … 1), after `update`. */
  night = 0;
  gloom = 0;
  // scratch for the per-frame path: no garbage every frame
  #dayColour = new THREE.Color('#9fd3f0');
  #duskColour = new THREE.Color('#1c2450');
  #stormColour = new THREE.Color('#3a3e48');
  #flashColour = new THREE.Color('#e8ecff');
  #nightTint = new THREE.Color('#7f88b8');
  #gloomTint = new THREE.Color('#9a9aa6');

  constructor(gl: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.#gl = gl;
    this.#scene = scene;
    scene.background = this.#sky;
    const fog = new THREE.Fog(this.#sky, 110, 230);
    fog.color = this.#sky; // shared, not copied: the fog follows the sky through night and storm
    scene.fog = fog;
    scene.add(this.#hemi, this.sun, this.sun.target);
    this.sun.position.set(MAP_W / 2 - 22, 42, MAP_H / 2 + 26);
    this.sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    this.sun.castShadow = true;
    // The town is a bounded receiver region, so one shadow map is the right
    // tool (shadow-systems skill). The light is fixed, so there is no texel
    // crawl to snap away; bias is sized to the world-space texel instead.
    const sc = this.sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 120;
  }

  applyShadowTier(quality: Quality): void {
    const size = quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    const texel = 76 / size; // world units per shadow texel
    this.sun.shadow.normalBias = texel * 1.1;
    this.sun.shadow.bias = -0.0004;
  }

  /** A themed town is lit by its sky images; the built-in look by the plain sky colour. */
  setTheme(theme: Theme | null): void {
    if (theme) {
      this.#env ??= new EnvironmentController(this.#gl, this.#scene);
    } else {
      this.#env?.use(null, this.#sky);
      this.#scene.background = this.#sky;
    }
  }

  update(dt: number, sim: Sim, theme: Theme | null, lit: { windows: THREE.MeshStandardMaterial; fire: THREE.MeshStandardMaterial }, sprites: SpriteMaterials, pipeline: ImagePipeline): void {
    const night = (this.night = nightFactor());
    const gloom = (this.gloom = sim.gloom);
    // A siege brings lightning: brief flashes while the storm is at its height.
    if (gloom > 0.6 && Math.random() < dt * 0.6) this.#flash = 1;
    this.#flash = Math.max(0, this.#flash - dt * 5);
    this.#sky.copy(this.#dayColour).lerp(this.#duskColour, night).lerp(this.#stormColour, gloom * 0.8).lerp(this.#flashColour, this.#flash * 0.6);
    // a rising market brings a brighter day (a falling one brings rain: the sim's gloom)
    const mood = sim.priceMove?.mood;
    const shine = mood === 'boom' ? 1.18 : mood === 'up' ? 1.08 : 1;
    this.sun.intensity = 2.2 * shine * (1 - night * 0.8) * (1 - gloom * 0.6) + this.#flash * 2;
    this.sun.color.setHex(night > 0.5 ? 0x9fb0ff : 0xfff1d6);
    this.#hemi.intensity = 1.1 * (1 - night * 0.55) * (1 - gloom * 0.4) + this.#flash;
    // Emissive hierarchy (bloom skill): fire > lamp bulbs > windows > lit walls.
    // Only the first three exceed the HDR bloom threshold, and only at night.
    lit.windows.emissiveIntensity = night * 1.7;
    doorwayMaterial.emissiveIntensity = 0.04 + night * 0.7;
    // flames never burn quite steady
    const t = sim.elapsed;
    const flicker = 1 + Math.sin(t * 11) * 0.06 + Math.sin(t * 17.3 + 1.7) * 0.05 + Math.sin(t * 29.1) * 0.03;
    lit.fire.emissiveIntensity = (1.4 + night * 2.2) * flicker;
    // A themed town is lit by its sky (image-based); the fill light steps back.
    if (theme && this.#env) {
      const byHour = skyForHour(currentHour(), gloom > 0.5);
      const id = byHour === 'day' ? theme.defaultSky : byHour;
      if (id !== this.#env.current) this.#env.use(id, this.#sky);
      if (this.#env.active) this.#hemi.intensity *= 0.3;
    }
    // Billboards are unlit; tint them so people do not glow at midnight.
    sprites.tint.setRGB(1, 1, 1).lerp(this.#nightTint, night * 0.85).lerp(this.#gloomTint, gloom * 0.5);
    sprites.retint();
    pipeline.setNight(Math.max(night, gloom * 0.5));
    // Wind: a breeze, rising with the storm.
    wind.uTime.value = sim.elapsed;
    wind.uStrength.value = 0.3 + gloom * 0.7;
  }
}
