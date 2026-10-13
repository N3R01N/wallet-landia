/**
 * The farm: a small herd of the theme's animals grazing in a paddock on the
 * meadow. Each animal is the Quaternius model, sized to its real height, and
 * plays its own walk or idle clip; they wander round their paddock, pausing to
 * graze. The herd grows and shrinks with the guild's net worth (farmPlan.ts).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { METRES_PER_TILE } from './grammar/medieval.js';
import { prepareMaterials, singleMaterial } from './rigged.js';

/** The animals (the medieval theme's files), each at its height in metres. */
const SPECIES = [
  { url: '/themes/medieval/animals/Cow.fbx', height: 1.35 },
  { url: '/themes/medieval/animals/Sheep.fbx', height: 0.85 },
  { url: '/themes/medieval/animals/Pig.fbx', height: 0.7 },
] as const;

/** How far from the paddock's middle they wander, and how fast (tiles). */
const RADIUS = 2.2;
const SPEED = 0.35;

interface Source {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
}

let sources: Promise<Source[]> | null = null;

/** The animals as loaded once (shared by every herd). */
export function loadFarmSources(): Promise<Source[]> {
  sources ??= Promise.all(
    SPECIES.map(async (s) => {
      const f = await new FBXLoader().loadAsync(s.url);
      // as the mounts are: standard materials that the sky lights, one material per animal
      prepareMaterials(f, true);
      singleMaterial(f);
      return { scene: f, clips: f.animations, height: s.height };
    }),
  );
  return sources;
}

interface Beast {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  moving: boolean;
  target: { x: number; z: number };
  pause: number;
}

const clipNamed = (clips: readonly THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined =>
  clips.find((c) => c.name.toLowerCase().includes(name));

export class Farm {
  readonly group = new THREE.Group();
  readonly #sources: readonly Source[];
  readonly #centre: { x: number; z: number };
  #beasts: Beast[] = [];

  /** `centre`: the paddock's middle, in tiles (x, z). */
  constructor(sources: readonly Source[], centre: { x: number; z: number }) {
    this.#sources = sources;
    this.#centre = centre;
    this.group.name = 'farm';
  }

  /** The herd is this many animals (added or taken away as the net worth moves). */
  setHerd(n: number): void {
    while (this.#beasts.length < n) this.#beasts.push(this.#newBeast(this.#beasts.length));
    while (this.#beasts.length > n) this.#release(this.#beasts.pop()!);
  }

  #newBeast(i: number): Beast {
    const src = this.#sources[i % this.#sources.length]!;
    const root = SkeletonUtils.clone(src.scene);
    // measured with the model's own transforms applied (its FBX units are not metres)
    root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(src.height / Math.max(size.y, 1e-3) / METRES_PER_TILE);
    const mixer = new THREE.AnimationMixer(root);
    const walk = clipNamed(src.clips, 'walk');
    const idle = clipNamed(src.clips, 'idle');
    const beast: Beast = {
      root,
      mixer,
      walk: walk ? mixer.clipAction(walk) : null,
      idle: idle ? mixer.clipAction(idle) : null,
      moving: false,
      target: this.#spot(),
      pause: Math.random() * 3,
    };
    // start where they graze: somewhere in the paddock
    root.position.set(beast.target.x, 0, beast.target.z);
    this.group.add(root);
    this.#play(beast, false);
    return beast;
  }

  /** Take an animal out: off the scene, its clips stopped and its mixer let go (the mixer keeps the root otherwise). */
  #release(b: Beast): void {
    this.group.remove(b.root);
    b.mixer.stopAllAction();
    b.mixer.uncacheRoot(b.root);
  }

  #spot(): { x: number; z: number } {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RADIUS;
    return { x: this.#centre.x + Math.cos(a) * r, z: this.#centre.z + Math.sin(a) * r };
  }

  #play(b: Beast, walking: boolean): void {
    if (b.moving === walking && (b.walk?.isRunning() || b.idle?.isRunning())) return;
    b.moving = walking;
    const to = walking ? b.walk : b.idle;
    const from = walking ? b.idle : b.walk;
    from?.fadeOut(0.3);
    to?.reset().fadeIn(0.3).play();
  }

  /** Per frame: each animal walks to its spot, or pauses to graze, and its clip plays. */
  update(dt: number): void {
    for (const b of this.#beasts) {
      if (b.pause > 0) {
        b.pause -= dt;
        this.#play(b, false);
      } else {
        const dx = b.target.x - b.root.position.x;
        const dz = b.target.z - b.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) {
          b.target = this.#spot();
          b.pause = 2 + Math.random() * 4;
        } else {
          const step = Math.min(d, SPEED * dt);
          b.root.position.x += (dx / d) * step;
          b.root.position.z += (dz / d) * step;
          b.root.rotation.y = Math.atan2(dx, dz); // the models face +z
          this.#play(b, true);
        }
      }
      b.mixer.update(dt);
    }
  }

  /** How many animals graze here now (for tests). */
  get count(): number {
    return this.#beasts.length;
  }

  dispose(): void {
    for (const b of this.#beasts) this.#release(b);
    this.#beasts = [];
    this.group.removeFromParent();
  }
}
