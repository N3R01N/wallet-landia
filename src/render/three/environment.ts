/**
 * Image-based lighting from CC0 Poly Haven skies (see public/env/CREDITS.md).
 * One HDRI gives the sky, the ambient light and the reflections — the single
 * biggest realism lever found in docs/RESEARCH_REALISM.md.
 *
 * HDRIs are prefiltered with PMREM so reflections blur correctly with
 * roughness, cached per sky, and chosen by the hour (or pinned).
 */

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export type SkyId = 'day' | 'sunset' | 'night' | 'overcast';

export const SKIES: Record<SkyId, { file: string; label: string; intensity: number; background: number }> = {
  day: { file: 'kloofendal_48d_partly_cloudy_puresky.hdr', label: 'Midday, partly cloudy', intensity: 0.75, background: 1 },
  sunset: { file: 'qwantani_sunset_puresky.hdr', label: 'Sunset', intensity: 0.8, background: 1 },
  night: { file: 'qwantani_night_puresky.hdr', label: 'Clear night', intensity: 0.35, background: 0.55 },
  overcast: { file: 'kloofendal_overcast_puresky.hdr', label: 'Overcast (storm)', intensity: 0.7, background: 0.9 },
};

/** Which sky fits an hour of the day (local time, 0–24). */
export function skyForHour(hour: number, storm = false): SkyId {
  if (storm) return 'overcast';
  if (hour < 5.5 || hour >= 20.5) return 'night';
  if (hour < 8 || hour >= 17.5) return 'sunset';
  return 'day';
}

export class EnvironmentController {
  readonly #scene: THREE.Scene;
  readonly #pmrem: THREE.PMREMGenerator;
  readonly #cache = new Map<SkyId, THREE.Texture | 'loading' | 'failed'>();
  readonly #base: string;
  #current: SkyId | null = null;
  /** Show the sky as the background (otherwise the caller's background stays). */
  showBackground = true;
  /** Called when a sky someone asked for finishes loading; the caller re-applies it with use(). */
  onReady: (() => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, base = '/env') {
    this.#scene = scene;
    this.#pmrem = new THREE.PMREMGenerator(renderer);
    this.#base = base;
  }

  get current(): SkyId | null {
    return this.#current;
  }

  /** True once a sky is lighting the scene (callers then dim their fill lights). */
  get active(): boolean {
    return this.#current !== null && this.#cache.get(this.#current) instanceof THREE.Texture;
  }

  /** Switch to a sky (loads it once). `null` turns image-based lighting off. */
  use(id: SkyId | null, fallbackBackground: THREE.Color): void {
    if (id === null) {
      this.#current = null;
      this.#scene.environment = null;
      this.#scene.background = fallbackBackground;
      return;
    }
    const hit = this.#cache.get(id);
    if (hit === undefined) this.#load(id);
    if (!(hit instanceof THREE.Texture)) {
      // Keep whatever is lit now until the new sky arrives.
      if (this.#current !== id && !(this.#cache.get(this.#current ?? 'day') instanceof THREE.Texture)) this.#scene.background = fallbackBackground;
      this.#pending = id;
      return;
    }
    this.#pending = null;
    this.#current = id;
    const sky = SKIES[id];
    this.#scene.environment = hit;
    this.#scene.environmentIntensity = sky.intensity;
    if (this.showBackground) {
      this.#scene.background = hit;
      this.#scene.backgroundIntensity = sky.background;
      this.#scene.backgroundBlurriness = 0;
    } else {
      this.#scene.background = fallbackBackground;
    }
  }

  #pending: SkyId | null = null;

  #load(id: SkyId): void {
    this.#cache.set(id, 'loading');
    new HDRLoader().load(
      `${this.#base}/${SKIES[id].file}`,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const env = this.#pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        this.#cache.set(id, env);
        if (this.#pending === id) this.onReady?.();
      },
      undefined,
      () => this.#cache.set(id, 'failed'),
    );
  }

  /** Load every sky up front, so switching by hour never flashes. */
  preload(): void {
    for (const id of Object.keys(SKIES) as SkyId[]) if (!this.#cache.has(id)) this.#load(id);
  }
}
