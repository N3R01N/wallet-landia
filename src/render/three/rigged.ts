/**
 * Rigged characters as a theme bundle describes them (theme.characters in
 * pack.json; the medieval bundle uses the CC0 Quaternius kits):
 * base body + outfit + hair on one shared 65-joint skeleton, animated by the
 * Universal Animation Library. No retargeting: every part uses the same bone
 * names and bind pose (docs/RESEARCH_REALISM.md).
 *
 * - The outfits need only the base body's head (the readme says so; the free
 *   body is one mesh), so the head is cut out by bone weights.
 * - Animation: idle / walk / run cross-fade; playback rate follows speed so
 *   the feet do not slide.
 * - Mounts per value tier: a model, its height and tint, its clips, where the
 *   rider sits. Wings are placeholders until real creatures are sourced.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterSpec, MountSpec } from '../../assets/theme.js';
import type { AnimState, CharacterLook, CharacterProvider, SandboxCharacter } from './themes.js';

/** World scale: one tile is this many metres, so a person is about one tile tall. */
import { METRES_PER_TILE } from './grammar/medieval.js';
export { METRES_PER_TILE };
const FADE = 0.3;

interface Animal {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

interface Kit {
  spec: CharacterSpec;
  clips: Map<string, THREE.AnimationClip>;
  bodies: { male: THREE.Group; female: THREE.Group };
  /** Outfits, hair and eyebrows by URL. */
  parts: Map<string, THREE.Group>;
  /** Mount models by URL. */
  animals: Map<string, Animal>;
}

// --- loading -----------------------------------------------------------------

/** Load every file a theme's characters use (`spec` holds URLs: a resolved theme). */
export async function loadKit(spec: CharacterSpec): Promise<Kit> {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (url: string): Promise<THREE.Group> => gltf.loadAsync(url).then((g) => g.scene);
  const anim = await gltf.loadAsync(spec.animations);
  const [male, female] = await Promise.all([load(spec.bodies.male), load(spec.bodies.female)]);
  const partUrls = new Set<string>([
    ...Object.values(spec.outfits).flatMap((p) => [p.male, p.female]),
    ...spec.hair.male,
    ...spec.hair.female,
    ...[spec.eyebrows?.male, spec.eyebrows?.female].filter((u): u is string => u !== undefined),
  ]);
  const parts = new Map(await Promise.all([...partUrls].map(async (u) => [u, await load(u)] as const)));
  const animals = new Map<string, Animal>();
  for (const m of Object.values(spec.mounts)) {
    if (animals.has(m.model)) continue;
    try {
      const animal =
        m.format === 'fbx'
          ? await new FBXLoader().loadAsync(m.model).then((f) => ({ scene: f, clips: f.animations }))
          : await gltf.loadAsync(m.model).then((g) => ({ scene: g.scene, clips: g.animations }));
      prepareMaterials(animal.scene, true);
      animals.set(m.model, animal);
    } catch (error) {
      console.warn('mount unavailable', m.model, error);
    }
  }
  for (const scene of [male, female, ...parts.values()]) prepareMaterials(scene);
  return { spec, clips: new Map(anim.animations.map((c) => [c.name, c])), bodies: { male, female }, parts, animals };
}

/** Shadows on, and Phong/Lambert materials (FBX) swapped for PBR so the sky lights them consistently. */
function prepareMaterials(scene: THREE.Object3D, toStandard = false): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds do not follow the animation
    if (toStandard) {
      const swap = (m: THREE.Material): THREE.Material => {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
        const src = m as THREE.MeshPhongMaterial;
        return new THREE.MeshStandardMaterial({ color: src.color?.clone() ?? new THREE.Color('#888'), map: src.map ?? null, roughness: 0.85, vertexColors: src.vertexColors });
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    }
  });
}

// --- assembly ----------------------------------------------------------------

const headCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** The body's head and neck only: triangles whose vertices all belong mostly to Head/neck_01. */
function headOnly(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const hit = headCache.get(mesh.geometry);
  if (hit) return hit;
  const geo = mesh.geometry;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const keep = new Set(mesh.skeleton.bones.map((b, i) => (/^(Head|neck_01)$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
  const dominant = (v: number): number => {
    let best = 0;
    let bi = si.getX(v);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w > best) {
        best = w;
        bi = si.getComponent(v, k);
      }
    }
    return bi;
  };
  const index = geo.index;
  const count = index ? index.count : geo.getAttribute('position').count;
  const out: number[] = [];
  for (let t = 0; t < count; t += 3) {
    const a = index ? index.getX(t) : t;
    const b = index ? index.getX(t + 1) : t + 1;
    const c = index ? index.getX(t + 2) : t + 2;
    if (keep.has(dominant(a)) && keep.has(dominant(b)) && keep.has(dominant(c))) out.push(a, b, c);
  }
  const head = geo.clone();
  head.setIndex(out);
  headCache.set(geo, head);
  return head;
}

/** Put a part's skinned meshes on the character's skeleton (same bone names), and drop the part's own bones. */
function attach(part: THREE.Object3D, skeleton: THREE.Skeleton): void {
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const ownBones: THREE.Object3D[] = [];
  part.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      const bones = m.skeleton.bones.map((b) => byName.get(b.name) ?? b);
      m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
    }
    if ((o as THREE.Bone).isBone && (o.parent === null || !(o.parent as THREE.Bone).isBone)) ownBones.push(o);
  });
  // Only one set of named bones may remain, or animation tracks bind ambiguously.
  for (const b of ownBones) b.removeFromParent();
}

function largestSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let best: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!best || m.geometry.getAttribute('position').count > best.geometry.getAttribute('position').count)) best = m;
  });
  return best;
}

// --- a character ----------------------------------------------------------------

/** Riding pose on top of the chair-sitting clip (radians). */
const STRADDLE = { thigh: 0.8, spread: 0.15, roll: 0.55, calf: 0.6 };
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _q5 = new THREE.Quaternion();
const _q6 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Where a rider sits: between the two bones the theme names (for the medieval
 * horse, a third of the way from Torso to Shoulders: just behind the withers),
 * on the surface of the mesh (a ray cast down onto the skinned mesh at rest).
 */
function backTop(root: THREE.Object3D, seat: MountSpec['seat']): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const parent = root.parent;
  const from = seat ? root.getObjectByName(seat.from) : undefined;
  const to = seat ? root.getObjectByName(seat.to) : undefined;
  const at =
    from && to && seat
      ? from.getWorldPosition(new THREE.Vector3()).lerp(to.getWorldPosition(new THREE.Vector3()), seat.t)
      : new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  const box = new THREE.Box3().setFromObject(root);
  const ray = new THREE.Raycaster(new THREE.Vector3(at.x, box.max.y + 1, at.z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(root, true)[0];
  const top = new THREE.Vector3(at.x, hit ? hit.point.y : box.min.y + (box.max.y - box.min.y) * 0.62, at.z);
  return parent ? parent.worldToLocal(top) : top;
}

interface Mount {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  run?: THREE.AnimationAction;
  current?: THREE.AnimationAction;
  wings: THREE.Object3D[];
  /** The top of the mount's back where the rider sits (tiles, local to the character). */
  saddle: THREE.Vector3;
  /** Natural speeds of its walk and run clips (m/s). */
  speeds: { walk: number; run: number };
}

class RiggedCharacter implements SandboxCharacter {
  readonly object = new THREE.Group();
  readonly #rider = new THREE.Group();
  readonly #mixer: THREE.AnimationMixer;
  readonly #actions = new Map<string, THREE.AnimationAction>();
  #current: THREE.AnimationAction | null = null;
  #state: AnimState = 'idle';
  #yaw = 0;
  #mount: Mount | null = null;
  readonly #bones = new Map<string, THREE.Bone>();
  /** Riding axes in the rider's frame, measured from the sitting pose. */
  #ride: { fwd: THREE.Vector3; across: THREE.Vector3; left: number } | null = null;
  /** Per bone: the clip's rotation and what the straddle turned it into. */
  readonly #posed = new Map<THREE.Bone, { clip: THREE.Quaternion; out: THREE.Quaternion }>();
  #t = 0;
  #speeds = { walk: 1.25, run: 3 };

  constructor(kit: Kit, look: CharacterLook) {
    const female = look.seed % 2 === 1;
    const sex = female ? 'female' : 'male';
    const body = SkeletonUtils.clone(kit.bodies[sex]) as THREE.Group;
    this.#rider.add(body);
    const spec = kit.spec;
    const bodyMesh = largestSkinned(body);
    if (bodyMesh && spec.bodyParts === 'head') bodyMesh.geometry = headOnly(bodyMesh);
    const skeleton = bodyMesh?.skeleton;
    const outfit = look.kind === 'villager' ? (spec.outfits.villager ?? spec.outfits.default) : (spec.outfits[look.cls] ?? spec.outfits.default);
    const hairs = spec.hair[sex];
    const urls = [outfit?.[sex], hairs.length > 0 ? hairs[look.seed % hairs.length] : undefined, spec.eyebrows?.[sex]];
    const parts = urls.map((u) => (u ? kit.parts.get(u) : undefined));
    for (const src of parts) {
      if (!src || !skeleton) continue;
      const part = SkeletonUtils.clone(src);
      this.#rider.add(part);
      attach(part, skeleton);
    }
    this.#rider.scale.setScalar(1 / METRES_PER_TILE);
    this.object.add(this.#rider);

    this.#mixer = new THREE.AnimationMixer(this.#rider);
    for (const state of ['idle', 'walk', 'run', 'sit'] as const) {
      const c = kit.clips.get(spec.clips[state]);
      if (c) this.#actions.set(state, this.#mixer.clipAction(c));
    }
    this.#speeds = spec.speeds;

    const mount = look.kind === 'hero' ? spec.mounts[`t${look.tier}` as keyof CharacterSpec['mounts']] : undefined;
    const animal = mount ? kit.animals.get(mount.model) : undefined;
    if (mount && animal) this.#mountUp(animal, mount);
    if (skeleton) for (const b of skeleton.bones) this.#bones.set(b.name, b);
    this.#play(this.#mount ? 'sit' : 'idle', 0);
    this.#mixer.update(Math.random() * 2); // desynchronise the crowd
    this.#seat();
  }

  /** The mount for this hero's tier, as the theme describes it (medieval: donkey, horse, warhorse, then winged placeholders). */
  #mountUp(animal: Animal, spec: MountSpec): void {
    const root = SkeletonUtils.clone(animal.scene);
    const box = new THREE.Box3().setFromObject(animal.scene);
    const size = box.getSize(new THREE.Vector3());
    const metres = spec.height; // overall height incl. head
    const s = metres / Math.max(size.y, 1e-3) / METRES_PER_TILE;
    root.scale.multiplyScalar(s);
    const tint = spec.tint;
    if (tint) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
          const c = (x as THREE.MeshStandardMaterial).clone();
          c.color.multiply(new THREE.Color(tint)).multiplyScalar(1.6);
          return c;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0]!;
      });
    }
    const wings: THREE.Object3D[] = [];
    if (spec.wings) {
      // Placeholder wings until a CC0 griffin and dragon are sourced.
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, 0.35), new THREE.Vector2(1.5, 0.05), new THREE.Vector2(1.05, -0.2), new THREE.Vector2(0.55, -0.3)]);
      const mat = new THREE.MeshStandardMaterial({ color: spec.wings.color, side: THREE.DoubleSide, roughness: 0.8 });
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
        wing.castShadow = true;
        // A wing spans about half a horse length, from the shoulders.
        const span = spec.wings.span;
        wing.scale.set(side * span, span, span);
        const pivot = new THREE.Group();
        pivot.position.set(0, (metres * 0.55) / METRES_PER_TILE, 0.12);
        pivot.rotation.x = -Math.PI / 2;
        pivot.add(wing);
        wing.position.x = side * 0.1;
        pivot.userData.side = side;
        this.object.add(pivot);
        wings.push(pivot);
      }
    }
    const mixer = new THREE.AnimationMixer(root);
    // Clips are named "Armature|Idle" etc.: match whole names, in the theme's order
    // of preference (a loose /eat/ once picked "Death" and the horse kept falling over).
    const find = (names: string[]): THREE.AnimationAction | undefined => {
      for (const n of names) {
        const c = animal.clips.find((x) => x.name === n || x.name.split('|').pop() === n);
        if (c) return mixer.clipAction(c);
      }
      return undefined;
    };
    const m: Mount = { root, mixer, wings, saddle: backTop(root, spec.seat), speeds: spec.speeds ?? { walk: 1.6, run: 5 } };
    const idle = find(spec.clips.idle);
    const walk = find(spec.clips.walk);
    const run = find(spec.clips.run);
    if (idle) m.idle = idle;
    if (walk) m.walk = walk;
    if (run) m.run = run;
    this.#mount = m;
    this.object.add(root);
  }

  /** Put the rider's pelvis on the horse's back (measured, not guessed). */
  #seat(): void {
    const m = this.#mount;
    const pelvis = this.#bones.get('pelvis');
    if (!m || !pelvis) return;
    this.#rider.position.set(0, 0, 0);
    this.object.updateMatrixWorld(true);
    const p = this.object.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3()));
    // the pelvis bone sits mid-hip; the seat is a little below it
    this.#rider.position.set(-p.x, m.saddle.y - p.y + 0.12 / METRES_PER_TILE, m.saddle.z - p.z);
  }

  /**
   * Turn the chair-sitting pose into a straddle: thighs down and apart, calves
   * hanging. Axes come from the pose itself (sitting thighs point forward), so
   * nothing depends on which way the model was authored.
   */
  #straddle(): void {
    if (!this.#ride) {
      const pos = (n: string): THREE.Vector3 => this.#rider.worldToLocal(this.#bones.get(n)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3());
      const fwd = pos('calf_l').sub(pos('thigh_l')).add(pos('calf_r').sub(pos('thigh_r'))).setY(0).normalize();
      const across = new THREE.Vector3(0, 1, 0).cross(fwd); // rotating about this pitches forward → down
      const left = Math.sign(pos('thigh_l').sub(pos('pelvis')).dot(across)) || 1;
      this.#ride = { fwd, across, left };
    }
    const { fwd, across, left } = this.#ride;
    const up = _up;
    const riderQ = this.#rider.getWorldQuaternion(_q0);
    const inv = _q1.copy(riderQ).invert();
    const turn = (name: string, local: THREE.Quaternion): void => {
      const bone = this.#bones.get(name);
      if (!bone?.parent) return;
      // The mixer only writes a bone when the clip's value changes; if it did
      // not this frame, start again from the clip's pose, not from last frame's turn.
      const prev = this.#posed.get(bone);
      if (prev && bone.quaternion.equals(prev.out)) bone.quaternion.copy(prev.clip);
      const clip = bone.quaternion.clone();
      const delta = _q2.copy(riderQ).multiply(local).multiply(inv);
      const world = bone.getWorldQuaternion(_q3);
      const parent = bone.parent.getWorldQuaternion(_q4).invert();
      bone.quaternion.copy(parent.multiply(delta.multiply(world)));
      bone.updateMatrixWorld(true);
      this.#posed.set(bone, { clip, out: bone.quaternion.clone() });
    };
    for (const [side, sign] of [['l', left], ['r', -left]] as const) {
      // pitch the thigh down, open it a little, then roll it out round the horse's barrel
      const thigh = _q5.setFromAxisAngle(fwd, sign * STRADDLE.roll).multiply(_q6.setFromAxisAngle(up, sign * STRADDLE.spread));
      turn(`thigh_${side}`, thigh.multiply(_q6.setFromAxisAngle(across, STRADDLE.thigh)));
      // the calf hangs back down along the horse's side
      turn(`calf_${side}`, _q5.setFromAxisAngle(fwd, -sign * STRADDLE.roll * 0.7).multiply(_q6.setFromAxisAngle(across, -STRADDLE.calf)));
    }
  }

  #play(name: string, fade = FADE): void {
    const next = this.#actions.get(name);
    if (!next || next === this.#current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.#current?.fadeOut(fade);
    this.#current = next;
  }

  setState(state: AnimState): void {
    this.#state = state;
    if (this.#mount) {
      const mt = this.#mount;
      const next = state === 'run' ? (mt.run ?? mt.walk) : state === 'walk' ? (mt.walk ?? mt.idle) : mt.idle;
      if (next && next !== mt.current) {
        next.reset().fadeIn(FADE).play();
        mt.current?.fadeOut(FADE);
        mt.current = next;
      }
      this.#play('sit');
      return;
    }
    this.#play(state);
  }

  update(dt: number, speed: number, heading: number): void {
    this.#t += dt;
    const moving = this.#state !== 'idle' && speed > 0.01;
    if (this.#current === null || (this.#mount === null && this.#current !== this.#actions.get(moving ? this.#state : 'idle'))) this.setState(this.#state);
    // Feet follow the ground: playback rate from real speed (no sliding).
    const metres = speed * METRES_PER_TILE;
    if (this.#current && !this.#mount) this.#current.timeScale = moving ? THREE.MathUtils.clamp(metres / (this.#state === 'run' ? this.#speeds.run : this.#speeds.walk), 0.5, 1.8) : 1;
    if (this.#mount?.current) this.#mount.current.timeScale = moving ? THREE.MathUtils.clamp(metres / (this.#state === 'run' ? this.#mount.speeds.run : this.#mount.speeds.walk), 0.5, 2) : 1;
    // Turn smoothly towards the direction of travel (models face +z).
    if (moving) {
      const target = Math.atan2(Math.cos(heading), Math.sin(heading));
      let d = target - this.#yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.#yaw += d * (1 - Math.exp(-10 * dt));
      this.object.rotation.y = this.#yaw;
    }
    this.#mixer.update(dt);
    if (this.#mount) {
      this.object.updateMatrixWorld(true);
      this.#straddle();
    }
    this.#mount?.mixer.update(dt);
    for (const w of this.#mount?.wings ?? []) w.rotation.z = (w.userData.side as number) * (0.25 + Math.sin(this.#t * (moving ? 7 : 2)) * (moving ? 0.5 : 0.12));
  }

  dispose(): void {
    this.#mixer.stopAllAction();
    this.#mount?.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}

export function riggedProvider(kit: Kit, label = 'Rigged characters'): CharacterProvider {
  return {
    label,
    create: (look) => new RiggedCharacter(kit, look),
  };
}
