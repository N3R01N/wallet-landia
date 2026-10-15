/**
 * Life in the world (docs/batches/15-life.md): birds circling over the town,
 * crows over the ruin, sheep and cows grazing in the fields, deer at the
 * forest's edge, fish jumping in the moat, butterflies over the meadows,
 * townsfolk strolling the avenue, the toll keeper at the booth. Each kind shows
 * once the theme has its model (nothing stands in for a missing one), and all
 * of it is decoration: none of it can be tapped except the people and grazers,
 * which react.
 */

import * as THREE from 'three';
import { Figure } from './figure.js';
import type { CastlePlan, Placement } from './plan.js';

/** What life needs from the view: a model's copy, its clips, whether the theme has it. */
export interface LifeHost {
  has(name: string): boolean;
  make(name: string): THREE.Object3D;
  clips(name: string): THREE.AnimationClip[];
  add(obj: THREE.Object3D): void;
}

interface Wanderer {
  figure: Figure;
  /** Where it may roam (a rectangle on the ground), where it heads, how fast (m/s). */
  area: { x0: number; x1: number; z0: number; z1: number };
  target: THREE.Vector3;
  speed: number;
  /** Resting until this time (s). */
  restUntil: number;
  walk: string;
  idle: string;
}

interface Flier {
  figure: Figure;
  centre: THREE.Vector3;
  radius: number;
  height: number;
  /** Radians a second (negative: the other way round), and where on the circle it is. */
  turn: number;
  angle: number;
  bob: number;
  gliding: boolean;
  switchAt: number;
}

const BIRDS = 9;
const CROWS = 4;
const BUTTERFLIES = 6;
/** A fish jumps every this many seconds, give or take half. */
const FISH_EVERY = 7;
const STROLLERS = 4;
const TOWNSFOLK = ['person.npc.base', 'person.npc.lending', 'person.npc.dex', 'person.npc.staking', 'person.npc.nft', 'person.npc.governance', 'person.npc.bridge', 'person.npc.other'];

export class Life {
  readonly #host: LifeHost;
  readonly #wanderers: Wanderer[] = [];
  readonly #fliers: Flier[] = [];
  readonly #figures: Figure[] = [];
  #fish: { figure: Figure; next: number; duration: number } | null = null;
  #tollkeeper: Figure | null = null;
  #time = 0;
  readonly #rand: () => number;
  readonly #water: { x: number; z: number }[];
  readonly #scratch = new THREE.Vector3();

  /** Every model life may use (to load with the rest). */
  static readonly MODELS = ['animal.bird', 'animal.crow', 'animal.sheep', 'animal.cow', 'animal.deer', 'animal.fish', 'animal.butterfly', 'person.tollkeeper'];

  constructor(host: LifeHost, plan: CastlePlan) {
    this.#host = host;
    let seed = 1;
    this.#rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    this.#water = plan.water.map((w) => ({ x: w.x, z: w.z }));
    const r = this.#rand;
    const town = plan.town;
    const scenery = (name: string) => plan.scenery.filter((s) => s.name === name);

    // birds over the town, in two loose flocks round the plaza and the castle
    if (host.has('animal.bird')) {
      const centres = [new THREE.Vector3(0, 0, (plan.avenue.plazaStart + plan.avenue.plazaEnd) / 2), new THREE.Vector3(0, 0, (plan.island.z0 + plan.island.z1) / 2)];
      for (let i = 0; i < BIRDS; i++) this.#flier('animal.bird', centres[i % 2]!, 14 + r() * 10, 16 + r() * 8, (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.15));
    }
    // crows over the ruin (or the castle's back)
    const ruin = scenery('scenery.ruin')[0];
    if (host.has('animal.crow')) {
      const at = ruin ? new THREE.Vector3(ruin.x, 0, ruin.z) : new THREE.Vector3(plan.island.x1 + 10, 0, plan.island.z0);
      for (let i = 0; i < CROWS; i++) this.#flier('animal.crow', at, 5 + r() * 4, 11 + r() * 4, 0.45 + r() * 0.2);
    }
    // grazers: sheep and cows in the fields (or on the grass beside the town), deer by the forest
    const fields = [...scenery('scenery.field.wheat'), ...scenery('scenery.field.crops'), ...scenery('scenery.meadow')];
    const pasture = (p: Placement | undefined, w = 8) => (p ? { x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - w / 2, z1: p.z + w / 2 } : { x0: town.x0 - 14, x1: town.x0 - 6, z0: 2, z1: 16 });
    if (host.has('animal.sheep')) for (let i = 0; i < 6; i++) this.#wanderer('animal.sheep', pasture(fields[i % Math.max(1, fields.length)], 9), 0.5);
    if (host.has('animal.cow')) for (let i = 0; i < 3; i++) this.#wanderer('animal.cow', pasture(fields[(i + 1) % Math.max(1, fields.length)], 9), 0.6);
    const forests = scenery('scenery.forest.patch');
    if (host.has('animal.deer')) for (let i = 0; i < 2; i++) this.#wanderer('animal.deer', pasture(forests[i % Math.max(1, forests.length)], 16), 0.9);
    // butterflies round the town's flowers and meadows
    if (host.has('animal.butterfly')) {
      const spots = [...plan.decor.filter((d) => d.name === 'prop.flowers'), ...scenery('scenery.meadow')];
      for (let i = 0; i < BUTTERFLIES && spots.length; i++) {
        const s = spots[i % spots.length]!;
        this.#flier('animal.butterfly', new THREE.Vector3(s.x, 0, s.z), 0.8 + r() * 1.2, 0.8 + r() * 0.8, 1.2 + r());
      }
    }
    // a fish now and then in the moat
    if (host.has('animal.fish') && this.#water.length) {
      const figure = this.#figure('animal.fish', ['jump']);
      figure.object.visible = false;
      this.#fish = { figure, next: 3, duration: host.clips('animal.fish').find((c) => c.name === 'jump')?.duration ?? 1.2 };
    }
    // townsfolk strolling the avenue (those with a walk)
    const strollers = TOWNSFOLK.filter((n) => host.has(n) && host.clips(n).some((c) => c.name === 'walk'));
    for (let i = 0; i < STROLLERS && strollers.length; i++) {
      const avenue = { x0: -1.2, x1: 1.2, z0: 2, z1: plan.avenue.plazaStart - 1 };
      this.#wanderer(strollers[i % strollers.length]!, i % 2 ? avenue : { x0: -1.2, x1: 1.2, z0: plan.avenue.plazaEnd + 1, z1: plan.avenue.end - 2 }, 1.1);
    }
    // the toll keeper at the booth's window, facing the road
    if (host.has('person.tollkeeper')) {
      const k = this.#figure('person.tollkeeper', ['toll', 'refuse', 'tap']);
      const b = plan.tollbooth;
      k.object.position.set(b.x + 1.3, 0, b.z);
      k.object.rotation.y = Math.PI / 2;
      k.play('idle');
      this.#tollkeeper = k;
    }
  }

  #figure(name: string, once: string[] = []): Figure {
    const obj = this.#host.make(name);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = name.startsWith('person.') || name === 'animal.cow';
    });
    const f = new Figure(obj, this.#host.clips(name), once);
    this.#host.add(obj);
    this.#figures.push(f);
    return f;
  }

  #flier(name: string, centre: THREE.Vector3, radius: number, height: number, turn: number): void {
    const figure = this.#figure(name);
    figure.play(figure.has('fly') ? 'fly' : 'idle');
    this.#fliers.push({ figure, centre: centre.clone(), radius, height, turn, angle: this.#rand() * Math.PI * 2, bob: this.#rand() * 6, gliding: false, switchAt: this.#rand() * 4 });
  }

  #wanderer(name: string, area: Wanderer['area'], speed: number): void {
    const figure = this.#figure(name, ['tap']);
    const r = this.#rand;
    figure.object.position.set(area.x0 + r() * (area.x1 - area.x0), 0, area.z0 + r() * (area.z1 - area.z0));
    const walk = figure.has('walk') ? 'walk' : 'idle';
    figure.play('idle');
    this.#wanderers.push({ figure, area, target: figure.object.position.clone(), speed, restUntil: r() * 5, walk, idle: 'idle' });
  }

  /** The toll keeper takes a courier's toll, or turns a failed one back. */
  toll(failed: boolean): void {
    this.#tollkeeper?.react(failed ? 'refuse' : 'toll', false);
  }

  /** Figures that react to a tap (people and grazers): their objects. */
  get tappable(): THREE.Object3D[] {
    return [...this.#wanderers.map((w) => w.figure.object), ...(this.#tollkeeper ? [this.#tollkeeper.object] : [])];
  }

  /** The figure for a tapped object. */
  figureOf(obj: THREE.Object3D): Figure | null {
    return this.#figures.find((f) => f.object === obj) ?? null;
  }

  update(dt: number): void {
    this.#time += dt;
    const t = this.#time;
    for (const f of this.#fliers) {
      f.angle += f.turn * dt * (f.gliding ? 0.8 : 1);
      if (t > f.switchAt && f.figure.has('glide')) {
        f.gliding = !f.gliding;
        f.figure.play(f.gliding ? 'glide' : 'fly');
        f.switchAt = t + (f.gliding ? 2 + this.#rand() * 3 : 3 + this.#rand() * 5);
      }
      const x = f.centre.x + Math.cos(f.angle) * f.radius;
      const z = f.centre.z + Math.sin(f.angle) * f.radius;
      const y = f.height + Math.sin(t * 0.7 + f.bob) * 0.8;
      const o = f.figure.object;
      // facing along its way round the circle
      o.rotation.y = -f.angle + (f.turn > 0 ? Math.PI : 0);
      o.position.set(x, y, z);
      f.figure.update(dt);
    }
    for (const w of this.#wanderers) {
      const o = w.figure.object;
      if (t < w.restUntil) {
        w.figure.update(dt);
        continue;
      }
      this.#scratch.subVectors(w.target, o.position);
      const d = this.#scratch.length();
      if (d < 0.1) {
        // there: graze a while, then pick somewhere else in its area
        w.figure.play(w.idle);
        w.restUntil = t + 3 + this.#rand() * 8;
        w.target.set(w.area.x0 + this.#rand() * (w.area.x1 - w.area.x0), 0, w.area.z0 + this.#rand() * (w.area.z1 - w.area.z0));
      } else {
        w.figure.play(w.walk);
        const step = Math.min(d, w.speed * dt);
        o.position.addScaledVector(this.#scratch.normalize(), step);
        o.rotation.y = Math.atan2(this.#scratch.x, this.#scratch.z);
      }
      w.figure.update(dt);
    }
    if (this.#fish) {
      const fish = this.#fish;
      if (!fish.figure.object.visible && t > fish.next) {
        const spot = this.#water[Math.floor(this.#rand() * this.#water.length)]!;
        fish.figure.object.position.set(spot.x + (this.#rand() - 0.5), 0, spot.z + (this.#rand() - 0.5));
        fish.figure.object.rotation.y = this.#rand() * Math.PI * 2;
        fish.figure.object.visible = true;
        fish.figure.rest();
        fish.figure.react('jump', false);
        fish.next = t + fish.duration;
      } else if (fish.figure.object.visible && t > fish.next) {
        fish.figure.object.visible = false;
        fish.next = t + FISH_EVERY * (0.5 + this.#rand());
      }
      fish.figure.update(dt);
    }
    this.#tollkeeper?.update(dt);
  }

  dispose(): void {
    for (const f of this.#figures) {
      f.object.removeFromParent();
      f.dispose();
    }
    this.#figures.length = 0;
  }
}
