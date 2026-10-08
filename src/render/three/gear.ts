/**
 * Class gear for heroes (built in code, like the vehicles): the paladin's
 * sword and shield, the ranger's bow and quiver, the bard's lute, the monk's
 * staff, the merchant's satchel and purse, the adventurer's sword and pack,
 * the sleeper's lantern. Each piece hangs on a bone of the universal
 * skeleton, so the animations carry it.
 *
 * Placement is written in the character's bind pose (arms out, palms down,
 * facing +z, metres): where the piece sits and which way its long axis
 * points. The rig turns that into the bone's own frame once.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import { glow, paint } from './grammar/vehicles.js';

type V3 = [number, number, number];

export interface GearPiece {
  /** The bone it hangs on. */
  bone: string;
  /** Where on it: the palm (between hand and fingers), the bone itself, or halfway to its child. */
  anchor: 'palm' | 'bone' | 'mid';
  /** Offset from the anchor (bind pose, metres). */
  offset: V3;
  /** Where the piece's long axis (+Y) points, and where its face (+Z) looks (bind pose). */
  axis: V3;
  face: V3;
  object: THREE.Object3D;
}

const wood = (): THREE.Material => paint('#6a4a2c', 0, 0.8);
const leather = (): THREE.Material => paint('#5a3418', 0, 0.85);
const steel = (): THREE.Material => paint('#c8ccd4', 0.9, 0.25);
const brass = (): THREE.Material => paint('#c8a040', 0.85, 0.3);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rot: V3 = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
}

/** A sword along +Y: grip at the origin, the blade above it. */
function sword(): THREE.Group {
  return group(
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), leather(), 0, 0, 0),
    mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), brass(), 0, 0.09, 0),
    mesh(new THREE.BoxGeometry(0.06, 0.72, 0.012), steel(), 0, 0.46, 0),
    mesh(new THREE.ConeGeometry(0.03, 0.08, 4), steel(), 0, 0.86, 0, [0, Math.PI / 4, 0]),
  );
}

function shield(crest: string): THREE.Group {
  return group(
    mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16), paint(crest, 0.2, 0.5), 0, 0, 0, [Math.PI / 2, 0, 0]),
    mesh(new THREE.TorusGeometry(0.32, 0.025, 6, 20), steel(), 0, 0, 0.005),
    mesh(new THREE.SphereGeometry(0.06, 10, 6), brass(), 0, 0, 0.03),
  );
}

function bow(): THREE.Group {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, -0.3, 0.1), new THREE.Vector3(0, 0, 0.13), new THREE.Vector3(0, 0.3, 0.1), new THREE.Vector3(0, 0.6, 0)]);
  return group(mesh(new THREE.TubeGeometry(curve, 16, 0.018, 5), wood()), mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.2, 3), paint('#e8e0c8', 0, 0.6)));
}

function quiver(): THREE.Group {
  const g = group(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 10), leather()));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 3), wood(), Math.sin(i * 2) * 0.03, 0.35, Math.cos(i * 2) * 0.03), mesh(new THREE.BoxGeometry(0.004, 0.05, 0.03), paint('#e8e8e8', 0, 0.6), Math.sin(i * 2) * 0.03, 0.43, Math.cos(i * 2) * 0.03));
  return g;
}

function lute(): THREE.Group {
  return group(
    mesh(new THREE.SphereGeometry(0.17, 14, 10), wood(), 0, 0, 0, [0, 0, 0]).translateY(0) as THREE.Mesh,
    mesh(new THREE.BoxGeometry(0.06, 0.42, 0.03), paint('#3a2414', 0, 0.7), 0, 0.3, 0.05),
    mesh(new THREE.BoxGeometry(0.08, 0.1, 0.03), paint('#3a2414', 0, 0.7), 0, 0.55, 0.02, [0.4, 0, 0]),
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 12), paint('#1a1008', 0, 0.9), 0, 0.02, 0.16, [Math.PI / 2, 0, 0]),
  );
}

function staff(): THREE.Group {
  return group(mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.7, 6), wood(), 0, 0.35, 0), mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12), brass(), 0, 1.22, 0));
}

function satchel(): THREE.Group {
  return group(mesh(new THREE.BoxGeometry(0.28, 0.22, 0.09), leather()), mesh(new THREE.BoxGeometry(0.29, 0.1, 0.095), paint('#4a2810', 0, 0.85), 0, 0.07, 0.003));
}

function purse(): THREE.Group {
  return group(mesh(new THREE.SphereGeometry(0.07, 10, 8), paint('#7a5020', 0, 0.8)), mesh(new THREE.SphereGeometry(0.025, 8, 6), brass(), 0, 0.07, 0));
}

function pack(): THREE.Group {
  return group(mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), paint('#6a5a3a', 0, 0.9)), mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 10), paint('#8a3a2a', 0, 0.9), 0, 0.26, 0, [0, 0, Math.PI / 2]));
}

function lantern(): THREE.Group {
  const light = glow('#ffc870');
  return group(mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), light, 0, -0.16, 0), mesh(new THREE.ConeGeometry(0.1, 0.07, 4), paint('#2a2420', 0.7, 0.4), 0, -0.05, 0, [0, Math.PI / 4, 0]), mesh(new THREE.TorusGeometry(0.04, 0.008, 4, 10), paint('#2a2420', 0.7, 0.4), 0, 0.0, 0));
}

/**
 * The gear a hero of this class carries. Directions are in the bind pose:
 * +z forward, +y up, +x the character's left.
 */
export function gearFor(cls: HeroClass, crest: string): GearPiece[] {
  const back: Pick<GearPiece, 'bone' | 'anchor'> = { bone: 'spine_03', anchor: 'bone' };
  switch (cls) {
    case 'paladin':
      return [
        { bone: 'hand_r', anchor: 'palm', offset: [0, -0.02, 0], axis: [0, 0.35, 1], face: [-1, 0, 0], object: sword() },
        { bone: 'lowerarm_l', anchor: 'mid', offset: [0, 0.09, 0], axis: [1, 0, 0], face: [0, 1, 0], object: shield(crest) },
      ];
    case 'ranger':
      return [
        { ...back, offset: [0, 0.05, -0.17], axis: [0.5, 1, 0], face: [0, 0, -1], object: bow() },
        { ...back, offset: [-0.12, 0.05, -0.15], axis: [0.35, 1, 0], face: [0, 0, -1], object: quiver() },
      ];
    case 'bard':
      return [{ ...back, offset: [0, -0.05, -0.2], axis: [-0.6, 1, 0], face: [0, 0, -1], object: lute() }];
    case 'monk':
      return [{ bone: 'hand_r', anchor: 'palm', offset: [0, -0.02, 0], axis: [0, 0.15, 1], face: [-1, 0, 0], object: staff() }];
    case 'merchant':
      return [
        { bone: 'pelvis', anchor: 'bone', offset: [0.2, -0.05, 0.02], axis: [0, 1, 0], face: [1, 0, 0], object: satchel() },
        { bone: 'pelvis', anchor: 'bone', offset: [-0.17, -0.08, 0.08], axis: [0, 1, 0], face: [-1, 0, 0], object: purse() },
      ];
    case 'adventurer':
      return [
        { bone: 'pelvis', anchor: 'bone', offset: [0.19, -0.1, 0.02], axis: [0.15, -1, -0.5], face: [1, 0, 0], object: sword() },
        { ...back, offset: [0, -0.05, -0.2], axis: [0, 1, 0], face: [0, 0, -1], object: pack() },
      ];
    case 'sleeper':
      return [{ bone: 'hand_l', anchor: 'palm', offset: [0, -0.03, 0], axis: [0, 1, 0], face: [0, 0, 1], object: lantern() }];
    default:
      return [];
  }
}

/**
 * Hang the pieces on the skeleton. `frame` is the space the bind-pose
 * directions are written in (the rider group, before it is scaled or turned).
 */
export function attachGear(pieces: GearPiece[], bones: Map<string, THREE.Bone>, frame: THREE.Object3D): void {
  frame.updateMatrixWorld(true);
  const toFrame = frame.matrixWorld.clone().invert();
  const pos = (b: THREE.Object3D): THREE.Vector3 => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toFrame);
  for (const p of pieces) {
    const bone = bones.get(p.bone);
    if (!bone) continue;
    // where it sits (bind pose, frame space)
    const at = pos(bone);
    if (p.anchor === 'palm') {
      const finger = bones.get(p.bone.replace('hand', 'middle_01'));
      if (finger) at.lerp(pos(finger), 0.6);
    } else if (p.anchor === 'mid') {
      const child = bone.children.find((c) => (c as THREE.Bone).isBone);
      if (child) at.lerp(pos(child), 0.5);
    }
    at.add(new THREE.Vector3(...p.offset));
    // which way it points: +Y along the axis, +Z towards the face
    const y = new THREE.Vector3(...p.axis).normalize();
    const z = new THREE.Vector3(...p.face).projectOnPlane(y).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const want = new THREE.Matrix4().makeBasis(x, y, z).setPosition(at);
    // into the bone's frame: bone (in frame space) × local = want
    const boneInFrame = toFrame.clone().multiply(bone.matrixWorld);
    const local = boneInFrame.invert().multiply(want);
    local.decompose(p.object.position, p.object.quaternion, p.object.scale);
    p.object.name = `gear-${p.bone}`;
    bone.add(p.object);
  }
}
