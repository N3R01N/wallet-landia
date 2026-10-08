/**
 * The last pixel sprites of a themed town, in 3D: the courier (a raven, or a
 * quad-rotor drone in the sci-fi colony) and the caravan a hero tows when
 * carrying treasure (a cart or covered wagon, a van or lorry, a hover cargo
 * pod), bigger for richer loads. Built from primitives in metres, scaled to
 * tiles; +z is forward.
 */

import * as THREE from 'three';
import type { Style } from '../../../assets/theme.js';
import type { Tier } from '../../../domain/tiers.js';
import type { MaterialLibrary } from './materials.js';
import { METRES_PER_TILE } from './medieval.js';
import { glow, Kit, paint } from './vehicles.js';

/** Something that moves with an agent and animates itself. */
export interface Companion {
  object: THREE.Object3D;
  /** `speed` in tiles per second (wheels turn with it, wings beat faster). */
  update(dt: number, speed: number): void;
}

function finish(k: Kit, update: (dt: number, speed: number) => void): Companion {
  const root = new THREE.Group();
  root.add(k.g);
  root.scale.setScalar(1 / METRES_PER_TILE);
  return { object: root, update };
}

/** The courier: a raven with beating wings, or a drone with spinning rotors. */
export function buildCourier(style: Style, lib: MaterialLibrary): Companion {
  const k = new Kit(lib);
  let t = Math.random() * 10;
  if (style === 'scifi') {
    const body = paint('#d8dce4', 0.6, 0.3);
    k.box(0.36, 0.12, 0.36, body, 0, 0, 0);
    k.add(new THREE.SphereGeometry(0.08, 10, 8), glow('#40e0ff'), 0, -0.06, 0.15);
    const rotors: THREE.Object3D[] = [];
    for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [0.32, 0.32], [-0.32, 0.32]] as const) {
      k.rod([0, 0, 0], [x, 0.03, z], 0.025, lib.get('iron'));
      const r = new THREE.Group();
      r.position.set(x, 0.07, z);
      k.add(new THREE.BoxGeometry(0.34, 0.01, 0.05), lib.get('iron'), 0, 0, 0, [0, 0, 0], r);
      k.add(new THREE.BoxGeometry(0.05, 0.01, 0.34), lib.get('iron'), 0, 0, 0, [0, 0, 0], r);
      k.g.add(r);
      rotors.push(r);
    }
    k.box(0.12, 0.12, 0.12, paint('#e0a020'), 0, -0.14, 0); // the parcel
    return finish(k, (dt) => {
      t += dt;
      for (const r of rotors) r.rotation.y += dt * 40;
      k.g.rotation.z = Math.sin(t * 2) * 0.05;
    });
  }
  // a raven
  const black = paint('#1c1c24', 0.1, 0.55);
  k.add(new THREE.SphereGeometry(0.13, 12, 8), black, 0, 0, 0).scale.set(0.9, 0.8, 1.7);
  k.add(new THREE.SphereGeometry(0.09, 10, 8), black, 0, 0.06, 0.22);
  k.add(new THREE.ConeGeometry(0.035, 0.12, 6), paint('#3a3a40', 0.2, 0.5), 0, 0.05, 0.34, [Math.PI / 2, 0, 0]);
  k.box(0.16, 0.03, 0.2, black, 0, 0, -0.28);
  k.box(0.07, 0.07, 0.07, paint('#e0c060'), 0, -0.12, 0.05); // the letter
  const wings: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.08, 0.03, 0);
    k.add(new THREE.BoxGeometry(0.42, 0.02, 0.2), black, side * 0.21, 0, 0, [0, 0, 0], pivot);
    k.g.add(pivot);
    pivot.userData.side = side;
    wings.push(pivot);
  }
  return finish(k, (dt, speed) => {
    t += dt * (speed > 0.05 ? 1 : 0.3);
    for (const w of wings) w.rotation.z = (w.userData.side as number) * Math.sin(t * 13) * 0.8;
  });
}

/** The caravan a hero tows: bigger and richer with the load's tier. */
export function buildCaravan(style: Style, tier: Tier, lib: MaterialLibrary, crest: string): Companion {
  const k = new Kit(lib);
  const spinners: { obj: THREE.Object3D; radius: number }[] = [];
  const wheel = (r: number, x: number, z: number): void => {
    const list: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; radius?: number; rate?: number }[] = [];
    k.wheel(r, 0.08, x, z, list);
    for (const s of list) spinners.push({ obj: s.obj, radius: s.radius ?? r });
  };
  const big = tier >= 4;
  const s = 0.85 + tier * 0.07;
  let hover = 0;
  let t = Math.random() * 10;
  if (style === 'scifi') {
    k.box(1.0 * s, 0.5 * s, 1.6 * s, lib.get('plaster'), 0, 0.75, 0);
    k.box(0.9 * s, 0.05, 1.5 * s, glow('#40e0ff'), 0, 0.47, 0);
    k.box(1.02 * s, 0.08, 1.62 * s, lib.get('timber'), 0, 1.0 * s + 0.02, 0);
    if (big) k.box(0.7 * s, 0.35, 0.9 * s, paint(crest), 0, 1.25 * s, 0);
    k.rod([0, 0.75, 0.8 * s], [0, 0.75, 1.4], 0.03, lib.get('iron')); // the tow beam
    hover = 0.15;
  } else if (style === 'modern') {
    const L = big ? 3.4 : 2.4;
    k.box(1.4, big ? 1.7 : 1.3, L, paint('#e8e8ea'), 0, (big ? 1.7 : 1.3) / 2 + 0.35, -0.2);
    k.box(1.4, 1.0, 0.9, paint(crest), 0, 0.85, L / 2 + 0.25);
    k.box(1.2, 0.45, 0.04, lib.glass, 0, 1.12, L / 2 + 0.72);
    k.box(1.42, 0.12, L - 0.2, paint(crest), 0, 0.6, -0.2);
    for (const z of [-L / 2 + 0.3, L / 2 + 0.25]) for (const x of [-0.62, 0.62]) wheel(0.3, x, z);
  } else {
    // a handcart, or a covered wagon for a rich load
    k.box(1.0 * s, 0.08, 1.4 * s, lib.get('planks'), 0, 0.55, 0);
    for (const side of [-1, 1]) k.box(0.05, 0.3, 1.4 * s, lib.get('planks'), side * 0.5 * s, 0.72, 0);
    wheel(0.42, -0.58 * s, 0);
    wheel(0.42, 0.58 * s, 0);
    k.rod([-0.3, 0.55, 0.7 * s], [-0.3, 0.4, 1.4], 0.03, lib.get('timber'));
    k.rod([0.3, 0.55, 0.7 * s], [0.3, 0.4, 1.4], 0.03, lib.get('timber'));
    if (big) {
      for (const z of [-0.5, 0, 0.5]) k.add(new THREE.TorusGeometry(0.5 * s, 0.025, 6, 12, Math.PI), lib.get('timber'), 0, 0.75, z * s);
      k.add(new THREE.CylinderGeometry(0.5 * s, 0.5 * s, 1.3 * s, 12, 1, true, -Math.PI / 2, Math.PI), lib.get('cloth', '#e8dcc0'), 0, 0.75, 0, [Math.PI / 2, 0, 0]);
    }
    const crates = Math.min(4, 1 + Math.floor(tier / 2));
    for (let i = 0; i < crates; i++) k.box(0.32, 0.32, 0.32, lib.get('planks'), ((i % 2) - 0.5) * 0.4, 0.75, (Math.floor(i / 2) - 0.5) * 0.45);
    if (tier >= 5) k.box(0.4, 0.26, 0.3, lib.get('gold'), 0, 0.98, 0);
  }
  k.g.position.y = hover;
  return finish(k, (dt, speed) => {
    t += dt;
    const metres = speed * METRES_PER_TILE * dt;
    for (const w of spinners) w.obj.rotation.x += metres / w.radius;
    if (hover > 0) k.g.position.y = hover + Math.sin(t * 2.4) * 0.04;
  });
}
