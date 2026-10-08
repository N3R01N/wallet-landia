/**
 * Rigged characters from the CC0 Quaternius kits (public/themes/medieval):
 * base body + outfit + hair on one shared 65-joint skeleton, animated by the
 * Universal Animation Library. No retargeting: every part uses the same bone
 * names and bind pose (docs/RESEARCH_REALISM.md).
 *
 * - The outfits need only the base body's head (the readme says so; the free
 *   body is one mesh), so the head is cut out by bone weights.
 * - Animation: idle / walk / run cross-fade; playback rate follows speed so
 *   the feet do not slide.
 * - Mounts: the Farm Animals horse, sized and tinted per value tier. Griffin
 *   and dragon wings are placeholders until real creatures are sourced.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { HeroClass } from '../domain/model.js';
import type { AnimState, CharacterLook, CharacterProvider, SandboxCharacter } from './themes.js';

/** World scale: one tile is this many metres, so a person is about one tile tall. */
import { METRES_PER_TILE } from '../render/three/grammar/medieval.js';
export { METRES_PER_TILE };
/** Natural speeds of the in-place clips at timeScale 1 (m/s), tuned so feet stay planted. */
const CLIP_SPEED = { walk: 1.25, run: 3.0 };
const FADE = 0.3;

interface Kit {
  clips: Map<string, THREE.AnimationClip>;
  bodies: { male: THREE.Group; female: THREE.Group };
  outfits: Map<string, THREE.Group>;
  hair: Map<string, THREE.Group>;
  horse: { scene: THREE.Group; clips: THREE.AnimationClip[] } | null;
}

/** Which free outfit each class wears (the free kit has Peasant and Ranger). */
const OUTFIT_OF: Record<HeroClass, 'Peasant' | 'Ranger'> = {
  merchant: 'Peasant',
  monk: 'Peasant',
  sleeper: 'Peasant',
  paladin: 'Ranger',
  ranger: 'Ranger',
  bard: 'Ranger',
  adventurer: 'Ranger',
};
const HAIR = { male: ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard'], female: ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale'] };

// --- loading -----------------------------------------------------------------

export async function loadMedievalKit(base = '/themes/medieval'): Promise<Kit> {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (p: string): Promise<THREE.Group> => gltf.loadAsync(`${base}/${p}`).then((g) => g.scene);
  const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as { hair: string[]; outfits: string[] };
  const anim = await gltf.loadAsync(`${base}/anim/ual.glb`);
  const [male, female] = await Promise.all([load('base/Superhero_Male_FullBody.glb'), load('base/Superhero_Female_FullBody.glb')]);
  const outfits = new Map(await Promise.all(manifest.outfits.map(async (n) => [n, await load(`outfits/${n}.glb`)] as const)));
  const hair = new Map(await Promise.all(manifest.hair.map(async (n) => [n, await load(`hair/${n}.glb`)] as const)));
  let horse: Kit['horse'] = null;
  try {
    const fbx = await new FBXLoader().loadAsync(`${base}/animals/Horse.fbx`);
    horse = { scene: fbx, clips: fbx.animations };
  } catch (error) {
    console.warn('horse unavailable', error);
  }
  for (const scene of [male, female, ...outfits.values(), ...hair.values()]) prepareMaterials(scene);
  if (horse) prepareMaterials(horse.scene, true);
  return { clips: new Map(anim.animations.map((c) => [c.name, c])), bodies: { male, female }, outfits, hair, horse };
}

/** Shadows on, and FBX's Phong materials swapped for PBR so the sky lights them consistently. */
function prepareMaterials(scene: THREE.Object3D, toStandard = false): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds do not follow the animation
    if (toStandard) {
      const swap = (m: THREE.Material): THREE.Material => {
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
 * Where a rider sits: just behind the withers (a third of the way from the
 * Torso bone to the Shoulders; the horse's "Back" bone is over its rump), on
 * the surface of the mesh (a ray cast down onto the skinned mesh at rest).
 */
function backTop(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const parent = root.parent;
  const torso = root.getObjectByName('Torso');
  const shoulders = root.getObjectByName('Shoulders');
  const at =
    torso && shoulders
      ? torso.getWorldPosition(new THREE.Vector3()).lerp(shoulders.getWorldPosition(new THREE.Vector3()), 0.33)
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
  /** The top of the horse's back above its Back bone (tiles, local to the character). */
  saddle: THREE.Vector3;
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

  constructor(kit: Kit, look: CharacterLook) {
    const female = look.seed % 2 === 1;
    const sex = female ? 'female' : 'male';
    const body = SkeletonUtils.clone(kit.bodies[sex]) as THREE.Group;
    this.#rider.add(body);
    const bodyMesh = largestSkinned(body);
    if (bodyMesh) bodyMesh.geometry = headOnly(bodyMesh);
    const skeleton = bodyMesh?.skeleton;
    const outfitName = `${female ? 'Female' : 'Male'}_${look.kind === 'villager' ? 'Peasant' : OUTFIT_OF[look.cls]}`;
    const parts = [kit.outfits.get(outfitName), kit.hair.get(HAIR[sex][look.seed % 3]!), kit.hair.get(female ? 'Eyebrows_Female' : 'Eyebrows_Regular')];
    for (const src of parts) {
      if (!src || !skeleton) continue;
      const part = SkeletonUtils.clone(src);
      this.#rider.add(part);
      attach(part, skeleton);
    }
    this.#rider.scale.setScalar(1 / METRES_PER_TILE);
    this.object.add(this.#rider);

    this.#mixer = new THREE.AnimationMixer(this.#rider);
    for (const [state, clip] of [['idle', 'Idle_Loop'], ['walk', 'Walk_Loop'], ['run', 'Jog_Fwd_Loop'], ['sit', 'Sitting_Idle_Loop']] as const) {
      const c = kit.clips.get(clip);
      if (c) this.#actions.set(state, this.#mixer.clipAction(c));
    }

    if (look.kind === 'hero' && look.tier >= 2 && kit.horse) this.#mountUp(kit.horse, look);
    if (skeleton) for (const b of skeleton.bones) this.#bones.set(b.name, b);
    this.#play(this.#mount ? 'sit' : 'idle', 0);
    this.#mixer.update(Math.random() * 2); // desynchronise the crowd
    this.#seat();
  }

  /** Tier 2 donkey · 3 horse · 4 warhorse · 5 griffin · 6 dragon (5 and 6 are placeholders). */
  #mountUp(horse: NonNullable<Kit['horse']>, look: CharacterLook): void {
    const root = SkeletonUtils.clone(horse.scene);
    const box = new THREE.Box3().setFromObject(horse.scene);
    const size = box.getSize(new THREE.Vector3());
    const tier = look.tier;
    const metres = tier === 2 ? 1.5 : 2.0; // overall height incl. head
    const s = metres / Math.max(size.y, 1e-3) / METRES_PER_TILE;
    root.scale.multiplyScalar(s);
    const tint = tier === 2 ? '#8a8a8a' : tier === 4 ? '#4a4048' : tier === 5 ? '#d8b060' : tier === 6 ? '#a8302a' : null;
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
    if (tier >= 5) {
      // Placeholder wings until a CC0 griffin and dragon are sourced.
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, 0.35), new THREE.Vector2(1.5, 0.05), new THREE.Vector2(1.05, -0.2), new THREE.Vector2(0.55, -0.3)]);
      const mat = new THREE.MeshStandardMaterial({ color: tier === 5 ? '#f2ead8' : '#5a1a18', side: THREE.DoubleSide, roughness: 0.8 });
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
        wing.castShadow = true;
        // A wing spans about half a horse length, from the shoulders.
        const span = tier === 6 ? 0.62 : 0.48;
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
    // Clips are named "Armature|Idle" etc. Match whole names: a loose /eat/ once
    // picked "Death" as the idle, and the horse kept falling over.
    const find = (...names: string[]): THREE.AnimationAction | undefined => {
      const c = horse.clips.find((x) => names.includes(x.name.split('|').pop() ?? ''));
      return c ? mixer.clipAction(c) : undefined;
    };
    const m: Mount = { root, mixer, wings, saddle: backTop(root) };
    const idle = find('Idle', 'Eating');
    const walk = find('Walk', 'WalkSlow');
    const run = find('Gallop', 'Run');
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
    if (this.#current && !this.#mount) this.#current.timeScale = moving ? THREE.MathUtils.clamp(metres / (this.#state === 'run' ? CLIP_SPEED.run : CLIP_SPEED.walk), 0.5, 1.8) : 1;
    if (this.#mount?.current) this.#mount.current.timeScale = moving ? THREE.MathUtils.clamp(metres / (this.#state === 'run' ? 5 : 1.6), 0.5, 2) : 1;
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

export function riggedProvider(kit: Kit): CharacterProvider {
  return {
    label: 'Rigged CC0 characters (Quaternius base + outfits + Universal Animation Library)',
    create: (look) => new RiggedCharacter(kit, look),
  };
}
