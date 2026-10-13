/**
 * The farm: a small herd of the theme's animals in a fenced paddock on the
 * meadow. Each animal is the Quaternius model, sized to its real height, and
 * plays its own walk or idle clip. They wander the paddock, pausing to graze,
 * and keep their distance from each other and from the fence (their hitbox is
 * a radius, farmPlan.ts). The herd grows and shrinks with the guild's net worth.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { METRES_PER_TILE } from './grammar/medieval.js';
import { prepareMaterials, singleMaterial } from './rigged.js';
import { PADDOCK, separateHerd, type Rect } from '../../world/farmPlan.js';

/** The animals (the medieval theme's files), each at its height in metres. */
const SPECIES = [
  { url: '/themes/medieval/animals/Cow.fbx', height: 1.35 },
  { url: '/themes/medieval/animals/Sheep.fbx', height: 0.85 },
  { url: '/themes/medieval/animals/Pig.fbx', height: 0.7 },
] as const;

/** How fast they walk (tiles a second), and how far in from the fence they stop. */
const SPEED = 0.35;
const EDGE = 0.45;

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

/** A fence round the paddock, posts and two rails a side, with a gap on the town's side for the gate. */
function buildFence(r: Rect, wood: THREE.Material, post: THREE.BufferGeometry): THREE.Group {
  const g = new THREE.Group();
  g.name = 'paddock-fence';
  const rail = (ax: number, az: number, bx: number, bz: number, y: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.06), wood);
    m.position.set((ax + bx) / 2, y, (az + bz) / 2);
    m.rotation.y = -Math.atan2(bz - az, bx - ax);
    g.add(m);
  };
  // the sides, each as a line of posts with rails through them; the gate is the middle of the z1 side
  const sides: [number, number, number, number][] = [
    [r.x0, r.z0, r.x1, r.z0],
    [r.x0, r.z1, r.x1, r.z1],
    [r.x0, r.z0, r.x0, r.z1],
    [r.x1, r.z0, r.x1, r.z1],
  ];
  const gateMid = Math.floor((r.x0 + r.x1) / 2);
  for (const [ax, az, bx, bz] of sides) {
    const gap = bz === r.z1 && az === r.z1; // the town's side (the gate)
    const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    for (let i = 0; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const z = az + ((bz - az) * i) / steps;
      if (gap && Math.abs(x - gateMid) < 1) continue;
      const p = new THREE.Mesh(post, wood);
      p.position.set(x, 0.475, z);
      g.add(p);
    }
    if (gap) {
      rail(ax, az, gateMid - 0.5, bz, 0.3);
      rail(gateMid + 0.5, bz, bx, bz, 0.3);
      rail(ax, az, gateMid - 0.5, bz, 0.65);
      rail(gateMid + 0.5, bz, bx, bz, 0.65);
    } else {
      rail(ax, az, bx, bz, 0.3);
      rail(ax, az, bx, bz, 0.65);
    }
  }
  return g;
}

export class Farm {
  readonly group = new THREE.Group();
  readonly #sources: readonly Source[];
  readonly #rect: Rect;
  readonly #points: { x: number; z: number }[] = [];
  #beasts: Beast[] = [];
  readonly #fence: THREE.Group;
  readonly #wood = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.9 });
  readonly #post = new THREE.BoxGeometry(0.1, 0.95, 0.1);

  /** `rect`: the paddock's tiles. */
  constructor(sources: readonly Source[], rect: Rect) {
    this.#sources = sources;
    this.#rect = rect;
    this.group.name = 'farm';
    this.#fence = buildFence(rect, this.#wood, this.#post);
    this.group.add(this.#fence);
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
    this.#points.push(beast.target);
    this.#play(beast, false);
    return beast;
  }

  /** Take an animal out: off the scene, its clips stopped and its mixer let go (the mixer keeps the root otherwise). */
  #release(b: Beast): void {
    this.group.remove(b.root);
    b.mixer.stopAllAction();
    b.mixer.uncacheRoot(b.root);
    const i = this.#beasts.indexOf(b);
    if (i >= 0) this.#points.splice(i, 1);
  }

  /** A spot inside the fence, away from its edge. */
  #spot(): { x: number; z: number } {
    const r = this.#rect;
    return {
      x: r.x0 + EDGE + Math.random() * (r.x1 - r.x0 - 2 * EDGE),
      z: r.z0 + EDGE + Math.random() * (r.z1 - r.z0 - 2 * EDGE),
    };
  }

  #play(b: Beast, walking: boolean): void {
    if (b.moving === walking && (b.walk?.isRunning() || b.idle?.isRunning())) return;
    b.moving = walking;
    const to = walking ? b.walk : b.idle;
    const from = walking ? b.idle : b.walk;
    from?.fadeOut(0.3);
    to?.reset().fadeIn(0.3).play();
  }

  /** Per frame: each animal walks to its spot, or pauses to graze; then they keep their distance. */
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
    // hitboxes: the animals keep apart and inside the fence
    for (let i = 0; i < this.#beasts.length; i++) {
      const p = this.#points[i]!;
      p.x = this.#beasts[i]!.root.position.x;
      p.z = this.#beasts[i]!.root.position.z;
    }
    separateHerd(this.#points, PADDOCK.radius, this.#rect);
    for (let i = 0; i < this.#beasts.length; i++) {
      const b = this.#beasts[i]!;
      b.root.position.x = this.#points[i]!.x;
      b.root.position.z = this.#points[i]!.z;
    }
  }

  /** The paddock's tiles (the people's plan keeps out of them). */
  get rect(): Rect {
    return this.#rect;
  }

  /** How many animals graze here now (for tests). */
  get count(): number {
    return this.#beasts.length;
  }

  dispose(): void {
    for (const b of this.#beasts) this.#release(b);
    this.#beasts = [];
    this.#fence.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.#wood.dispose();
    this.#post.dispose();
    this.group.removeFromParent();
  }
}
