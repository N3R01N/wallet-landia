/**
 * Doors that open. A door's leaf (or two leaves, or a pair of sliding panels)
 * is kept out of the merged building meshes, on its own hinge, so it can swing
 * open as someone goes in or out and fall shut behind them, knocking once
 * against the frame. Behind it a dark doorway stands in for the room inside;
 * it glows warm at night, like the windows.
 *
 * Both looks use it: the built-in diorama (in tiles) and the grammar-built
 * themes (in metres; `u` is how big a metre is in the door's units).
 */

import * as THREE from 'three';

/** plank: boards and iron straps · glass: a framed pane · slide: two panels that part · plain: one flat leaf. */
export type DoorStyle = 'plank' | 'glass' | 'slide' | 'plain';

interface Leaf {
  obj: THREE.Object3D;
  kind: 'swing' | 'slide';
  /** At full open: radians turned (swing) or distance moved along the wall (slide), signed. */
  reach: number;
  /** Rest position along the wall (slide). */
  base: number;
}

export interface DoorRig {
  /** The middle of the sill, local to the building's group (tiles). */
  at: THREE.Vector3;
  /** Out of the wall, local to the building's group. */
  out: THREE.Vector3;
  leaves: Leaf[];
  /** 0 shut … 1 open (a little below 0 as it knocks against the frame). */
  open: number;
  vel: number;
}

export interface DoorMats {
  leaf: THREE.Material;
  /** Straps, a ring, a frame round the pane, a handle. */
  trim: THREE.Material;
  glass?: THREE.Material;
  /** The glowing seam where sliding panels meet. */
  glow?: THREE.Material;
}

export interface DoorOpts {
  /** The leaf's inner face, out from the wall's face (the leaf sits from z0 to z0 + thick). */
  z0: number;
  thick: number;
  /** One metre in the door's units (1 for metres, 1/1.8 for tiles). */
  u: number;
  hingeRight?: boolean;
  /** Two leaves meeting in the middle (wide doors). */
  double?: boolean;
}

/** The room behind every doorway (shared, so the renderer can light it at night). */
export const doorwayMaterial = new THREE.MeshStandardMaterial({ color: '#1e150e', emissive: new THREE.Color('#ffa24a'), emissiveIntensity: 0, roughness: 1 });

/** How far a swinging leaf opens (a little past square). */
const SWING = 1.7;

/**
 * A door in its own frame: origin at the middle of the sill on the wall's
 * face, +z out of the wall, +x along it. The group holds the dark doorway
 * (static, fine to merge) and the leaves' pivots (marked `animated`).
 */
export function makeDoor(style: DoorStyle, w: number, h: number, mats: DoorMats, o: DoorOpts): { group: THREE.Group; leaves: Leaf[] } {
  const group = new THREE.Group();
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(w, h), doorwayMaterial);
  backing.position.set(0, h / 2, Math.max(0.002 * o.u, o.z0 - 0.008 * o.u));
  backing.receiveShadow = true;
  group.add(backing);
  const leaves: Leaf[] = [];
  if (style === 'slide') {
    for (const side of [-1, 1]) {
      const panel = leafMesh(style, w / 2, h, mats, o, side > 0);
      const slider = new THREE.Group();
      slider.add(panel);
      slider.position.set((side * w) / 4, 0, o.z0 + o.thick / 2);
      slider.userData.animated = true;
      group.add(slider);
      leaves.push({ obj: slider, kind: 'slide', reach: side * (w / 2) * 0.92, base: slider.position.x });
    }
    return { group, leaves };
  }
  const hinges = o.double ? [-1, 1] : [o.hingeRight ? 1 : -1];
  const lw = o.double ? w / 2 : w;
  for (const hinge of hinges) {
    const pivot = new THREE.Group();
    pivot.position.set((hinge * w) / 2, 0, o.z0 + o.thick);
    const leaf = leafMesh(style, lw, h, mats, o, hinge > 0);
    leaf.position.set((-hinge * lw) / 2, 0, -o.thick / 2);
    pivot.add(leaf);
    pivot.userData.animated = true;
    group.add(pivot);
    // outward: a leaf hinged on the left turns clockwise seen from above
    leaves.push({ obj: pivot, kind: 'swing', reach: hinge * SWING, base: 0 });
  }
  return { group, leaves };
}

/** One leaf, its sill-middle at the origin, its faces at ±thick/2; `right`: hinged on the right (the handle goes left). */
function leafMesh(style: DoorStyle, w: number, h: number, mats: DoorMats, o: DoorOpts, right: boolean): THREE.Group {
  const g = new THREE.Group();
  const t = o.thick;
  const u = o.u;
  const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const handle = (right ? -1 : 1) * w * 0.36;
  switch (style) {
    case 'plank':
      box(w, h, t, mats.leaf, 0, h / 2, 0);
      // iron straps from the hinge side, and a ring to pull
      for (const k of [0.22, 0.78]) box(w * 0.82, 0.05 * u, 0.012 * u, mats.trim, (right ? 1 : -1) * w * 0.08, h * k, t / 2 + 0.006 * u);
      box(0.08 * u, 0.08 * u, 0.03 * u, mats.trim, handle, h * 0.5, t / 2 + 0.015 * u);
      break;
    case 'glass': {
      const s = Math.min(0.09 * u, w * 0.12);
      box(w, s, t, mats.trim, 0, s / 2, 0);
      box(w, s, t, mats.trim, 0, h - s / 2, 0);
      box(s, h, t, mats.trim, -w / 2 + s / 2, h / 2, 0);
      box(s, h, t, mats.trim, w / 2 - s / 2, h / 2, 0);
      box(w - 2 * s, h - 2 * s, t * 0.3, mats.glass ?? mats.leaf, 0, h / 2, 0);
      // a push bar across the middle
      box(w * 0.6, 0.04 * u, 0.04 * u, mats.trim, 0, h * 0.48, t / 2 + 0.03 * u);
      break;
    }
    case 'slide':
      box(w, h, t, mats.leaf, 0, h / 2, 0);
      // the seam where the two panels meet glows
      box(0.04 * u, h * 0.86, t * 1.1, mats.glow ?? mats.trim, (right ? -1 : 1) * (w / 2 - 0.03 * u), h / 2, 0);
      break;
    case 'plain':
      box(w, h, t, mats.leaf, 0, h / 2, 0);
      box(0.07 * u, 0.07 * u, t * 0.8, mats.trim, handle, h * 0.5, t * 0.6);
      break;
  }
  return g;
}

/**
 * Ease a door towards open or shut. Opening is a quick push; a swinging door
 * falls shut on a spring, knocks against the frame once and settles (and
 * locks at rest, so a shut door costs nothing). Sliding panels glide both ways.
 */
export function moveDoor(rig: DoorRig, wantOpen: boolean, dt: number): void {
  const sliding = rig.leaves[0]?.kind === 'slide';
  if (wantOpen || sliding) {
    const target = wantOpen ? 1 : 0;
    rig.open += (target - rig.open) * (1 - Math.exp(-dt * (wantOpen ? 9 : 6)));
    rig.vel = 0;
    if (!wantOpen && rig.open < 0.002) rig.open = 0;
  } else if (rig.open !== 0 || rig.vel !== 0) {
    rig.vel += (-30 * rig.open - 3 * rig.vel) * dt;
    rig.open += rig.vel * dt;
    if (rig.open < 0) {
      // the knock: back off the frame a little, losing most of the swing
      rig.open = -rig.open * 0.3;
      rig.vel = -rig.vel * 0.3;
      if (Math.abs(rig.vel) < 0.25) rig.open = rig.vel = 0;
    }
  }
  for (const l of rig.leaves) {
    if (l.kind === 'swing') l.obj.rotation.y = l.reach * rig.open;
    else l.obj.position.x = l.base + l.reach * rig.open;
  }
}
