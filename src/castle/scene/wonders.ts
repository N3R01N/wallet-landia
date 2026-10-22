/**
 * The town's rare moments in 3D (docs/ENGAGEMENT.md, track C): the golden
 * courier with its sparkle trail, the pale ghost of a failed errand at night,
 * a shooting star across the sky, a coin dropped into the wishing well. What
 * happens is decided elsewhere (world/rare.ts, world/secrets.ts); this only
 * shows it, with the theme's models, and skips what the theme lacks.
 */

import * as THREE from 'three';
import { Figure } from './figure.js';
import type { Stage } from './castleView.js';
import type { Loaded } from '../assets/models.js';
import type { CourierLook } from '../world/rare.js';

const GOLD = 0xf2c14e;
const GOLD_GLOW = 0x8a5a10;
const GHOST = 0xe4ecff;
const GHOST_GLOW = 0x9fb8ff;
/** A sparkle off the golden courier this often (s), this big. */
const TRAIL_EVERY = 0.3;
const TRAIL_SCALE = 1.3;
/** The well's coin: its flight (s), and the sparkle where it lands. */
const COIN_FLIGHT = 0.7;
const WELL_SPARKLE = 2;
/**
 * The shooting star (the view is orthographic: sizes by the view's height and width): how far
 * along the view it crosses (m), how high in the view, half its run, its size.
 */
const STAR_AHEAD = 30;
const STAR_UP = 0.3;
const STAR_RUN = 0.4;
const STAR_SCALE = 0.05;

interface Dressed {
  obj: THREE.Object3D;
  look: CourierLook;
  /** The copies made for it (freed when it goes). */
  materials: THREE.Material[];
  trail: number;
}

interface Flight {
  figure: Figure | null;
  obj: THREE.Object3D;
  age: number;
  duration: number;
  /** Where it is at 0…1 of its flight. */
  at: (t: number) => THREE.Vector3;
  spin?: number;
  done?: () => void;
}

export class Wonders {
  readonly #stage: Stage;
  readonly #dressed: Dressed[] = [];
  readonly #flights: Flight[] = [];
  readonly #models = new Map<string, Loaded | null>();
  readonly #stop: () => void;

  constructor(stage: Stage) {
    this.#stage = stage;
    this.#stop = stage.onFrame((dt) => this.#update(dt));
    // ready before they are needed (a missing one is remembered as such)
    for (const n of ['fx.sparkle.burst', 'fx.coin', 'fx.shooting.star']) void this.#model(n);
  }

  /** Dresses a courier: gold (and a sparkle trail) or a pale ghost; its own copies of the materials. */
  dress(courier: THREE.Object3D, look: CourierLook | null): void {
    if (!look) return;
    const materials: THREE.Material[] = [];
    courier.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (m: THREE.Material): THREE.Material => {
        if (!m.visible) return m; // the invisible tap target
        const c = m.clone();
        materials.push(c);
        if (c instanceof THREE.MeshStandardMaterial) {
          c.map = null;
          c.color.setHex(look === 'gold' ? GOLD : GHOST);
          c.emissive.setHex(look === 'gold' ? GOLD_GLOW : GHOST_GLOW);
          c.emissiveIntensity = look === 'gold' ? 0.6 : 1.4;
          c.metalness = look === 'gold' ? 0.5 : 0;
          c.roughness = look === 'gold' ? 0.3 : 0.9;
        } else if ('color' in c && c.color instanceof THREE.Color) c.color.setHex(look === 'gold' ? GOLD : GHOST);
        // never see-through: a pale glow, not alpha
        c.transparent = false;
        c.opacity = 1;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    courier.userData.look = look;
    this.#dressed.push({ obj: courier, look, materials, trail: 0 });
  }

  /** A coin tossed into the well at (x, z), and a sparkle where it falls in. */
  dropCoin(at: { x: number; z: number }): void {
    const loaded = this.#models.get('fx.coin');
    const from = new THREE.Vector3(at.x - 1.4, 1.2, at.z + 1.4);
    const to = new THREE.Vector3(at.x, 0.6, at.z);
    const landed = () => this.#sparkle(new THREE.Vector3(at.x, 0.4, at.z), WELL_SPARKLE);
    if (!loaded) {
      landed();
      return;
    }
    const obj = loaded.scene.clone();
    obj.scale.setScalar(2);
    this.#stage.scene.add(obj);
    this.#flights.push({
      figure: null,
      obj,
      age: 0,
      duration: COIN_FLIGHT,
      at: (t) => from.clone().lerp(to, t).setY(from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 1.6),
      spin: 14,
      done: landed,
    });
  }

  /** A shooting star crosses the sky in front of the camera (none when the theme has no model). */
  shootingStar(): boolean {
    const loaded = this.#models.get('fx.shooting.star');
    const pop = loaded?.clips.find((c) => c.name === 'pop');
    if (!loaded || !pop) return false;
    // across the top of the view, left to right and a little down, whichever way the camera looks
    const cam = this.#stage.camera as THREE.OrthographicCamera;
    const zoom = cam.zoom || 1;
    const wide = (cam.right - cam.left) / zoom;
    const high = (cam.top - cam.bottom) / zoom;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const centre = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(cam.getWorldDirection(new THREE.Vector3()), STAR_AHEAD).addScaledVector(up, high * STAR_UP);
    const from = centre.clone().addScaledVector(right, -wide * STAR_RUN).addScaledVector(up, high * 0.08);
    const to = centre.clone().addScaledVector(right, wide * STAR_RUN).addScaledVector(up, -high * 0.08);
    const figure = new Figure(loaded.scene.clone(), [pop], ['pop']);
    figure.object.scale.setScalar(high * STAR_SCALE);
    figure.object.position.copy(from);
    figure.object.lookAt(to); // the star leads along +Z
    this.#stage.scene.add(figure.object);
    figure.react('pop', false);
    this.#flights.push({ figure, obj: figure.object, age: 0, duration: pop.duration, at: (t) => from.clone().lerp(to, t) });
    return true;
  }

  /** Test hook: the colours of a dressed courier's materials (hex), and its look. */
  looks(): { look: CourierLook; colors: string[] }[] {
    return this.#dressed.map((d) => ({ look: d.look, colors: d.materials.map((m) => ('color' in m && m.color instanceof THREE.Color ? `#${m.color.getHexString()}` : '')) }));
  }

  dispose(): void {
    this.#stop();
    for (const d of this.#dressed) for (const m of d.materials) m.dispose();
    this.#dressed.length = 0;
    for (const f of this.#flights) f.obj.removeFromParent();
    this.#flights.length = 0;
  }

  async #model(name: string): Promise<Loaded | null> {
    if (this.#models.has(name)) return this.#models.get(name)!;
    const loaded = await this.#stage.load(name).catch(() => null);
    this.#models.set(name, loaded);
    return loaded;
  }

  /** A small burst of stars (the theme's `fx.sparkle.burst`; none without it). */
  #sparkle(at: THREE.Vector3, scale: number): void {
    const loaded = this.#models.get('fx.sparkle.burst');
    const pop = loaded?.clips.find((c) => c.name === 'pop');
    if (!loaded || !pop) return;
    const figure = new Figure(loaded.scene.clone(), [pop], ['pop']);
    figure.object.position.copy(at);
    figure.object.scale.setScalar(scale);
    this.#stage.scene.add(figure.object);
    figure.react('pop', false);
    this.#flights.push({ figure, obj: figure.object, age: 0, duration: pop.duration, at: () => at });
  }

  #update(dt: number): void {
    for (let i = this.#dressed.length - 1; i >= 0; i--) {
      const d = this.#dressed[i]!;
      // home again: its copies go
      if (!d.obj.parent) {
        for (const m of d.materials) m.dispose();
        this.#dressed.splice(i, 1);
        continue;
      }
      if (d.look !== 'gold' || !d.obj.visible) continue;
      d.trail -= dt;
      if (d.trail <= 0) {
        d.trail = TRAIL_EVERY;
        const p = d.obj.getWorldPosition(new THREE.Vector3());
        p.x += (Math.random() - 0.5) * 0.5;
        p.z += (Math.random() - 0.5) * 0.5;
        p.y += 0.4 + Math.random() * 0.8;
        this.#sparkle(p, TRAIL_SCALE);
      }
    }
    for (let i = this.#flights.length - 1; i >= 0; i--) {
      const f = this.#flights[i]!;
      f.age += dt;
      const t = Math.min(1, f.age / f.duration);
      f.obj.position.copy(f.at(t));
      if (f.spin) f.obj.rotation.y += f.spin * dt;
      f.figure?.update(dt);
      if (t < 1) continue;
      f.obj.removeFromParent();
      f.figure?.dispose();
      this.#flights.splice(i, 1);
      f.done?.();
    }
  }
}
