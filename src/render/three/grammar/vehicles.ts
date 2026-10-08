/**
 * Mounts built in code (Phase 6): no CC0 rigged vehicles exist, and these
 * are simple enough to model from primitives. Modern: bicycle, scooter,
 * motorbike, helicopter, private jet. Sci-fi: hover scooter, hoverbike, heavy
 * hoverbike, skiff, starship. Painted in the theme's tint; tyres, chrome and
 * glass from the theme's iron, timber (frame) and glass roles.
 *
 * Built in metres facing +z, origin on the ground, scaled to tiles. The rider
 * is seated at `seat`; wheels and rotors spin, hover craft bob.
 */

import * as THREE from 'three';
import type { VehicleKind } from '../../../assets/theme.js';
import type { MaterialLibrary } from './materials.js';
import { METRES_PER_TILE } from './medieval.js';

export interface Vehicle {
  /** In tiles; origin on the ground, +z forward. */
  root: THREE.Group;
  /** Where the rider's pelvis goes (tiles, local to root). */
  seat: THREE.Vector3;
  /** Astride (bikes) or seated (cockpits). */
  pose: 'straddle' | 'sit';
  /** Hover craft float and bob; wheeled ones stand. */
  hover: number;
  /** Wheels turn with distance (radius in m); rotors spin at a rate (rad/s). */
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; radius?: number; rate?: number }[];
}

export const paints = new Map<string, THREE.MeshStandardMaterial>();
export function paint(color: string, metal = 0.35, rough = 0.32): THREE.MeshStandardMaterial {
  const key = `${color}|${metal}|${rough}`;
  let m = paints.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    paints.set(key, m);
  }
  return m;
}
export const glow = (color: string): THREE.MeshStandardMaterial => {
  const key = `glow|${color}`;
  let m = paints.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 2.2 });
    paints.set(key, m);
  }
  return m;
};

export class Kit {
  readonly g = new THREE.Group();
  constructor(readonly lib: MaterialLibrary) {}

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = this.g): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rot?: [number, number, number]): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rot);
  }

  /** A tube along z (fuselages, pods). */
  pod(r0: number, r1: number, len: number, mat: THREE.Material, x: number, y: number, z: number, segs = 14): THREE.Mesh {
    return this.add(new THREE.CylinderGeometry(r1, r0, len, segs), mat, x, y, z, [Math.PI / 2, 0, 0]);
  }

  /** A wheel turning about x: tyre, rim and hub. */
  wheel(r: number, width: number, x: number, z: number, spinners: Vehicle['spinners']): void {
    const w = new THREE.Group();
    w.position.set(x, r, z);
    this.add(new THREE.TorusGeometry(r - 0.045, 0.045, 8, 20), this.lib.get('iron', '#202020'), 0, 0, 0, [0, Math.PI / 2, 0], w);
    this.add(new THREE.CylinderGeometry(r - 0.08, r - 0.08, width * 0.3, 16), paint('#b8bcc4', 0.9, 0.25), 0, 0, 0, [0, 0, Math.PI / 2], w);
    for (let k = 0; k < 3; k++) this.add(new THREE.BoxGeometry(width * 0.32, (r - 0.08) * 2, 0.025), paint('#9aa0a8', 0.9, 0.3), 0, 0, 0, [(k * Math.PI) / 3, 0, 0], w);
    this.g.add(w);
    spinners.push({ obj: w, axis: 'x', radius: r });
  }

  /** A rod between two points. */
  rod(a: [number, number, number], b: [number, number, number], r: number, mat: THREE.Material): void {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.castShadow = true;
    this.g.add(m);
  }
}

export function buildVehicle(kind: VehicleKind, lib: MaterialLibrary, tint = '#c0392b'): Vehicle {
  const k = new Kit(lib);
  const body = paint(tint);
  const dark = lib.get('iron');
  const chrome = paint('#c8ccd4', 0.95, 0.2);
  const glass = lib.glass;
  const spinners: Vehicle['spinners'] = [];
  let seat = new THREE.Vector3(0, 0.9, 0);
  let pose: Vehicle['pose'] = 'straddle';
  let hover = 0;

  switch (kind) {
    case 'bicycle': {
      k.wheel(0.34, 0.05, 0, 0.55, spinners);
      k.wheel(0.34, 0.05, 0, -0.5, spinners);
      const frame = (a: [number, number, number], b: [number, number, number]): void => k.rod(a, b, 0.022, body);
      frame([0, 0.34, -0.5], [0, 0.42, -0.02]);
      frame([0, 0.42, -0.02], [0, 0.85, -0.12]);
      frame([0, 0.85, -0.12], [0, 0.88, 0.38]);
      frame([0, 0.42, -0.02], [0, 0.88, 0.38]);
      frame([0, 0.88, 0.38], [0, 0.34, 0.55]);
      frame([0, 0.34, -0.5], [0, 0.85, -0.12]);
      k.rod([0, 0.88, 0.38], [0, 1.02, 0.36], 0.018, chrome);
      k.rod([-0.25, 1.02, 0.36], [0.25, 1.02, 0.36], 0.016, chrome);
      k.box(0.14, 0.04, 0.24, dark, 0, 0.9, -0.14);
      seat = new THREE.Vector3(0, 0.88, -0.12);
      break;
    }
    case 'scooter': {
      k.wheel(0.22, 0.12, 0, 0.62, spinners);
      k.wheel(0.22, 0.12, 0, -0.55, spinners);
      k.box(0.36, 0.08, 0.9, body, 0, 0.3, 0.05); // floorboard
      k.add(new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 0.35, -0.45, [0, 0, 0]).scale.set(0.9, 1.1, 1.4);
      k.box(0.4, 0.75, 0.18, body, 0, 0.62, 0.55, [-0.25, 0, 0]); // leg shield
      k.rod([0, 0.95, 0.62], [0, 1.1, 0.6], 0.025, chrome);
      k.rod([-0.3, 1.1, 0.6], [0.3, 1.1, 0.6], 0.02, chrome);
      k.add(new THREE.SphereGeometry(0.07, 10, 8), glow('#fff4d0'), 0, 1.0, 0.7);
      k.box(0.3, 0.1, 0.5, dark, 0, 0.78, -0.35);
      seat = new THREE.Vector3(0, 0.78, -0.3);
      break;
    }
    case 'motorbike': {
      k.wheel(0.32, 0.14, 0, 0.72, spinners);
      k.wheel(0.32, 0.16, 0, -0.68, spinners);
      k.box(0.34, 0.32, 0.5, dark, 0, 0.45, 0.02); // engine
      k.add(new THREE.SphereGeometry(0.22, 14, 10), body, 0, 0.82, 0.28).scale.set(1, 0.75, 1.5); // tank
      k.box(0.3, 0.12, 0.6, dark, 0, 0.8, -0.32);
      k.box(0.26, 0.14, 0.4, body, 0, 0.78, -0.75, [0.25, 0, 0]);
      k.rod([0, 0.32, 0.72], [0, 1.0, 0.55], 0.03, chrome);
      k.rod([-0.34, 1.02, 0.52], [0.34, 1.02, 0.52], 0.022, chrome);
      k.rod([0.14, 0.35, 0.0], [0.16, 0.42, -0.85], 0.04, chrome); // exhaust
      k.add(new THREE.SphereGeometry(0.08, 10, 8), glow('#fff4d0'), 0, 0.92, 0.66);
      seat = new THREE.Vector3(0, 0.82, -0.28);
      break;
    }
    case 'helicopter': {
      k.add(new THREE.SphereGeometry(0.95, 18, 12), body, 0, 1.25, 0.2).scale.set(0.85, 0.8, 1.25);
      k.add(new THREE.SphereGeometry(0.8, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), glass, 0, 1.25, 0.65, [Math.PI / 2.4, 0, 0]).scale.set(0.9, 1, 0.9);
      k.pod(0.32, 0.1, 2.6, body, 0, 1.45, -1.9);
      k.box(0.05, 0.7, 0.5, body, 0, 1.75, -3.1);
      for (const sx of [-0.6, 0.6]) {
        k.box(0.06, 0.06, 2.1, dark, sx, 0.12, 0.2);
        k.rod([sx, 0.15, 0.7], [sx * 0.7, 0.62, 0.6], 0.03, dark);
        k.rod([sx, 0.15, -0.3], [sx * 0.7, 0.62, -0.3], 0.03, dark);
      }
      k.box(0.12, 0.25, 0.12, dark, 0, 2.15, 0.1);
      const rotor = new THREE.Group();
      rotor.position.set(0, 2.3, 0.1);
      k.add(new THREE.BoxGeometry(5.4, 0.04, 0.22), dark, 0, 0, 0, [0, 0, 0], rotor);
      k.add(new THREE.BoxGeometry(0.22, 0.04, 5.4), dark, 0, 0, 0, [0, 0, 0], rotor);
      k.g.add(rotor);
      spinners.push({ obj: rotor, axis: 'y', rate: 22 });
      const tail = new THREE.Group();
      tail.position.set(0.08, 1.8, -3.1);
      k.add(new THREE.BoxGeometry(0.03, 1.0, 0.12), dark, 0, 0, 0, [0, 0, 0], tail);
      k.g.add(tail);
      spinners.push({ obj: tail, axis: 'x', rate: 30 });
      seat = new THREE.Vector3(0, 0.95, 0.35);
      pose = 'sit';
      break;
    }
    case 'jet': {
      k.pod(0.55, 0.3, 5.2, body, 0, 1.2, -0.2, 18);
      k.add(new THREE.ConeGeometry(0.55, 1.4, 18), body, 0, 1.2, 3.1, [Math.PI / 2, 0, 0]);
      k.add(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 1.55, 1.4).scale.set(0.9, 0.7, 1.6);
      for (const sx of [-1, 1]) {
        k.box(2.4, 0.08, 1.2, body, sx * 1.4, 1.0, -0.4, [0, sx * 0.35, 0]);
        k.pod(0.22, 0.2, 1.2, chrome, sx * 0.62, 1.5, -2.0);
        k.add(new THREE.CircleGeometry(0.17, 12), glow('#ffb060'), sx * 0.62, 1.5, -2.62, [0, Math.PI, 0]);
      }
      k.box(0.08, 1.1, 0.9, body, 0, 1.95, -2.5, [-0.4, 0, 0]);
      for (const z of [1.6, -1.0]) k.rod([0, 0.0, z], [0, 0.75, z], 0.05, dark);
      seat = new THREE.Vector3(0, 1.15, 1.4);
      pose = 'sit';
      break;
    }
    case 'hoverboard': {
      // a hover scooter: a saddle on a glowing sled
      k.box(0.5, 0.12, 1.4, body, 0, 0.42, 0);
      k.box(0.44, 0.06, 1.3, glow('#40e0ff'), 0, 0.34, 0);
      k.box(0.18, 0.5, 0.18, dark, 0, 0.7, -0.2);
      k.box(0.32, 0.1, 0.42, dark, 0, 0.96, -0.2);
      k.rod([0, 0.48, 0.55], [0, 1.05, 0.5], 0.03, chrome);
      k.rod([-0.25, 1.05, 0.5], [0.25, 1.05, 0.5], 0.02, chrome);
      seat = new THREE.Vector3(0, 0.98, -0.2);
      hover = 0.25;
      break;
    }
    case 'hoverbike':
    case 'hoverbikeHeavy': {
      const heavy = kind === 'hoverbikeHeavy';
      const s = heavy ? 1.25 : 1;
      k.pod(0.26 * s, 0.14 * s, 2.0 * s, body, 0, 0.75, 0.05);
      k.add(new THREE.SphereGeometry(0.26 * s, 14, 10), body, 0, 0.75, 1.05 * s).scale.set(1, 0.8, 1.6);
      k.add(new THREE.SphereGeometry(0.2 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.92, 0.75 * s, [0.5, 0, 0]);
      for (const sx of [-1, 1]) {
        k.pod(0.14 * s, 0.12 * s, 0.9 * s, dark, sx * 0.34 * s, 0.55, -0.55 * s);
        k.add(new THREE.CircleGeometry(0.11 * s, 12), glow('#40e0ff'), sx * 0.34 * s, 0.55, -1.01 * s, [0, Math.PI, 0]);
        if (heavy) k.box(0.5, 0.05, 0.8, body, sx * 0.55, 0.7, -0.4, [0, 0, sx * 0.3]);
      }
      k.box(0.3 * s, 0.05, 1.4 * s, glow('#40e0ff'), 0, 0.48, 0);
      k.rod([-0.32 * s, 1.0, 0.55 * s], [0.32 * s, 1.0, 0.55 * s], 0.025, chrome);
      k.box(0.28, 0.1, 0.5, dark, 0, 0.98, -0.25);
      seat = new THREE.Vector3(0, 0.98, -0.25);
      hover = 0.35;
      break;
    }
    case 'skiff': {
      k.add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), body, 0, 0.9, 0).scale.set(0.9, 0.55, 2);
      k.box(1.7, 0.08, 3.6, lib.get('planks'), 0, 0.9, 0);
      k.add(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.98, 1.0, [0.6, 0, 0]).scale.set(1.2, 0.7, 1);
      for (const sx of [-1, 1]) {
        k.box(1.4, 0.06, 0.9, body, sx * 1.4, 0.85, -0.8, [0, sx * 0.4, sx * -0.15]);
        k.pod(0.2, 0.18, 1.1, dark, sx * 0.65, 0.95, -1.7);
        k.add(new THREE.CircleGeometry(0.15, 12), glow('#40e0ff'), sx * 0.65, 0.95, -2.26, [0, Math.PI, 0]);
      }
      seat = new THREE.Vector3(0, 0.98, 0.1);
      pose = 'sit';
      hover = 0.5;
      break;
    }
    case 'starship': {
      k.add(new THREE.SphereGeometry(1, 20, 12), body, 0, 1.3, 0).scale.set(1.0, 0.55, 2.8);
      k.add(new THREE.SphereGeometry(0.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 1.6, 1.0).scale.set(1, 0.8, 1.6);
      for (const sx of [-1, 1]) {
        k.box(3.0, 0.1, 1.6, body, sx * 1.9, 1.1, -1.1, [0, sx * 0.45, sx * -0.12]);
        k.box(0.08, 0.9, 0.9, body, sx * 3.3, 1.45, -1.8, [0, 0, sx * 0.2]);
        k.pod(0.32, 0.28, 1.6, chrome, sx * 0.85, 1.25, -2.4);
        k.add(new THREE.CircleGeometry(0.26, 14), glow('#ff70e0'), sx * 0.85, 1.25, -3.21, [0, Math.PI, 0]);
      }
      for (let i = 0; i < 6; i++) k.box(0.04, 0.04, 0.4, glow('#40e0ff'), Math.sin(i) * 0.9, 1.0, 1.4 - i * 0.6);
      seat = new THREE.Vector3(0, 1.3, 0.9);
      pose = 'sit';
      hover = 0.6;
      break;
    }
  }
  // the big craft at four fifths: they share streets with people
  const shrink = kind === 'jet' || kind === 'starship' || kind === 'helicopter' ? 0.8 : 1;
  k.g.scale.setScalar(shrink);
  seat.multiplyScalar(shrink);
  const root = new THREE.Group();
  root.add(k.g);
  root.scale.setScalar(1 / METRES_PER_TILE);
  root.name = `vehicle-${kind}`;
  return { root, seat: seat.clone().divideScalar(METRES_PER_TILE).add(new THREE.Vector3(0, hover / METRES_PER_TILE, 0)), pose, hover, spinners };
}
