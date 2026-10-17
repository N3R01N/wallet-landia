/**
 * The battle's effects (docs/batches/23-siege-vfx.md): one-shot bursts (a hit's
 * sparks, a pop of puffs, a liquidation's detonation, a siege impact, the
 * Slashing lightning) played from each model's `pop` clip where something
 * happens, and projectiles (arrows, spell bolts) flown from shooter to target.
 * Capped, so a big melee can't flood the scene.
 */

import * as THREE from 'three';
import type { Stage } from '../../castle/scene/castleView.js';

export type Burst = 'fx.hit.spark' | 'fx.puff' | 'fx.detonation' | 'fx.siege.impact' | 'fx.lightning';
export type Projectile = 'fx.arrow' | 'fx.bolt';

const MODELS: readonly string[] = ['fx.hit.spark', 'fx.puff', 'fx.detonation', 'fx.siege.impact', 'fx.lightning', 'fx.arrow', 'fx.bolt'];
/** At most this many of each at once (the oldest make way). */
const CAP: Record<string, number> = { 'fx.hit.spark': 40, 'fx.puff': 20, 'fx.arrow': 60, 'fx.bolt': 30, 'fx.detonation': 6, 'fx.siege.impact': 8, 'fx.lightning': 2 };
/** Metres per second a projectile flies. */
const PROJECTILE_SPEED = 22;

interface Live {
  name: string;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  until: number;
  /** A projectile's flight. */
  from?: THREE.Vector3;
  to?: THREE.Vector3;
  start?: number;
}

export class BattleFx {
  readonly #stage: Stage;
  readonly #group = new THREE.Group();
  readonly #models = new Map<string, { scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null>();
  #live: Live[] = [];
  #time = 0;
  #stop: (() => void) | null = null;

  constructor(stage: Stage) {
    this.#stage = stage;
    stage.scene.add(this.#group);
    this.#stop = stage.onFrame((dt) => this.#update(dt));
  }

  async load(): Promise<void> {
    await Promise.all(MODELS.map(async (n) => this.#models.set(n, await this.#stage.load(n))));
  }

  /** A burst where something happens, turned to face `yaw` (a siege impact faces away from its wall). */
  burst(name: Burst, x: number, y: number, z: number, yaw = 0, scale = 1): void {
    const model = this.#models.get(name);
    if (!model) return;
    this.#makeRoom(name);
    const obj = model.scene.clone(true);
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    obj.scale.setScalar(scale);
    const clip = model.clips.find((c) => c.name === 'pop');
    let mixer: THREE.AnimationMixer | null = null;
    if (clip) {
      mixer = new THREE.AnimationMixer(obj);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    this.#group.add(obj);
    this.#live.push({ name, obj, mixer, until: this.#time + (clip?.duration ?? 0.5) + 0.05 });
  }

  /** A projectile from a shooter to its target (at chest height). */
  shoot(name: Projectile, from: THREE.Vector3, to: THREE.Vector3): void {
    const model = this.#models.get(name);
    if (!model) return;
    this.#makeRoom(name);
    const obj = model.scene.clone(true);
    const clip = model.clips.find((c) => c.name === 'idle');
    let mixer: THREE.AnimationMixer | null = null;
    if (clip) {
      mixer = new THREE.AnimationMixer(obj);
      mixer.clipAction(clip).play();
    }
    const flight = Math.max(0.12, from.distanceTo(to) / PROJECTILE_SPEED);
    obj.position.copy(from);
    obj.lookAt(to);
    this.#group.add(obj);
    this.#live.push({ name, obj, mixer, until: this.#time + flight, from: from.clone(), to: to.clone(), start: this.#time });
  }

  /** Clears everything playing. */
  clear(): void {
    for (const l of this.#live) this.#drop(l);
    this.#live = [];
  }

  dispose(): void {
    this.clear();
    this.#stop?.();
    this.#group.removeFromParent();
  }

  #makeRoom(name: string): void {
    const same = this.#live.filter((l) => l.name === name);
    if (same.length < (CAP[name] ?? 20)) return;
    const oldest = same[0]!;
    this.#drop(oldest);
    this.#live = this.#live.filter((l) => l !== oldest);
  }

  #drop(l: Live): void {
    l.mixer?.stopAllAction();
    l.mixer?.uncacheRoot(l.obj);
    l.obj.removeFromParent();
  }

  #update(dt: number): void {
    this.#time += dt;
    const keep: Live[] = [];
    for (const l of this.#live) {
      if (this.#time >= l.until) {
        this.#drop(l);
        continue;
      }
      l.mixer?.update(dt);
      if (l.from && l.to && l.start !== undefined) {
        const t = (this.#time - l.start) / (l.until - l.start);
        l.obj.position.lerpVectors(l.from, l.to, t);
        // a little arc for arrows
        if (l.name === 'fx.arrow') l.obj.position.y += Math.sin(Math.PI * t) * 0.8;
      }
      keep.push(l);
    }
    this.#live = keep;
  }
}
