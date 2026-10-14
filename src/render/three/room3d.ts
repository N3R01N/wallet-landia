/**
 * A house's inside in 3D, built in code the way the town's props are: timber,
 * planks, plaster and iron from the theme's own materials (MaterialLibrary),
 * so a medieval house looks like the medieval town. Metres, y up; the room is
 * 6 m wide, 5 m deep, 3.2 m high, with the camera inside it, looking in.
 *
 * Holdings sit where the room layout put them: coins and sacks on the table,
 * chests on the floor, the Banker's Scale on the counter, pictures on the walls,
 * rewards by the door. The things that move (the scale, the reward mound, the
 * dust in the light) are their own groups, so `animate` can move them.
 */

import * as THREE from 'three';
import { MaterialLibrary } from './grammar/materials.js';
import { MeshWriter } from './grammar/meshWriter.js';
import type { Room, RoomObject } from '../../world/roomLayout.js';
import type { Footprint } from './roomPath.js';
import { approxUsd } from '../../domain/tiers.js';

export const ROOM3D = { w: 6, d: 5, h: 3.2 } as const;

/** Frame colours for pictures: the NFT images cannot be textures in 3D (their hosts send no CORS headers), so each takes a colour from its name. */
const PICTURE_TINTS = ['#c0392b', '#4a8fe0', '#5fbf4a', '#8e5bd0', '#f5c518', '#8fc6e8'];

function tintFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PICTURE_TINTS[h % PICTURE_TINTS.length]!;
}

/** The medieval loot props (GLBs, loaded by the view): the sack and the pouch on the table. */
export const LOOT = {
  sack: '/themes/medieval/props/CoinSack.glb',
  pouch: '/themes/medieval/props/LeatherPouch.glb',
  coinPile: '/themes/medieval/props/CoinPile.glb',
  chest: '/themes/medieval/props/TreasureChest.glb',
} as const;

export interface Room3D {
  /** The whole room, in metres. */
  group: THREE.Group;
  /** Props to load and stand on the table: their file and where their base goes. */
  props: { url: string; at: THREE.Vector3; scale?: number; turn?: number }[];
  /** Hover text for each thing in the room, pinned where it stands. */
  labels: { at: THREE.Vector3; text: string; stand: THREE.Vector3; image?: string }[];
  /** The furniture's footprints on the floor, for walking round them. */
  solids: Footprint[];
  /** The room's floor, as a footprint. */
  floor: Footprint;
  /** The pictures' frames: where each sits, which way it faces, its size, and its NFT's image (https) if any. */
  frames: { center: THREE.Vector3; across: 'x' | 'z'; w: number; h: number; image?: string }[];
  /** Above the villager's head, where what they say is pinned. */
  talker: THREE.Vector3;
  /** Move the things that move, `t` seconds on the view's clock. */
  animate(t: number): void;
}

/** Build the room and its holdings. `lib`: the theme's materials (a fresh, plain library when the theme has none). */
export function buildRoom3d(room: Room, lib: MaterialLibrary = new MaterialLibrary({})): Room3D {
  const w = new MeshWriter();
  const { w: W, d: D, h: H } = ROOM3D;
  const solids: Footprint[] = [
    { x0: -1.6, x1: 0.2, z0: -0.15, z1: 0.65 }, // the table
    { x0: 0.5, x1: 1.9, z0: -1.775, z1: -1.225 }, // the counter
    { x0: -2.8, x1: -1.4, z0: -2.15, z1: -1.75 }, // the bench
  ];
  // where each thing's hover text is pinned, and what it says
  const labels: Room3D['labels'] = [];
  const props: Room3D['props'] = [];
  // where the hero stops to look at a thing: on the floor just in front of it, inside the room
  const tag = (o: RoomObject, x: number, y: number, z: number): void => {
    const stand = new THREE.Vector3(Math.min(2.4, Math.max(-2.4, x)), 0, Math.min(2, Math.max(-2, z + 0.7)));
    labels.push({ at: new THREE.Vector3(x, y, z), text: `${o.label}${o.usd === null ? '' : ` · ${approxUsd(o.usd)}`}`, stand, ...(o.image && (o.kind === 'coins' || o.kind === 'sack' || o.kind === 'pouch') ? { image: o.image } : {}) });
  };
  const hw = W / 2;
  const hd = D / 2;

  // the shell: floor, ceiling and four walls, with timber beams across the ceiling
  w.box([0, -0.05, 0], [W, 0.1, D], 'planks');
  w.box([0, H + 0.05, 0], [W, 0.1, D], 'timber');
  w.box([0, H / 2, -hd - 0.05], [W, H, 0.1], 'plaster');
  w.box([-hw - 0.05, H / 2, 0], [0.1, H, D], 'plaster');
  w.box([hw + 0.05, H / 2, 0], [0.1, H, D], 'plaster');
  w.box([0, H / 2, hd + 0.05], [W, H, 0.1], 'plaster');
  for (const x of [-2, 0, 2]) w.box([x, H - 0.1, 0], [0.2, 0.2, D], 'timber');
  w.box([0, 0.4, -hd + 0.06], [W, 0.8, 0.1], 'timber'); // wainscot

  // a window on the left wall and a door on the front wall
  w.box([-hw + 0.06, 1.8, 1.7], [0.12, 1.3, 1.3], 'timber');
  w.box([-hw + 0.03, 1.8, 1.7], [0.1, 1.05, 1.05], 'glass');
  w.box([2.1, 1.1, hd - 0.02], [0.95, 2.2, 0.12], 'timber');
  w.box([2.4, 1.1, hd - 0.1], [0.07, 0.07, 0.07], 'gold');

  // the table in the middle, and the counter for the scale by the back wall
  w.box([-0.7, 0.8, 0.2], [1.8, 0.08, 0.9], 'planks');
  for (const [x, z] of [
    [-1.5, -0.15],
    [0.1, -0.15],
    [-1.5, 0.55],
    [0.1, 0.55],
  ] as const) {
    w.box([x, 0.38, z], [0.08, 0.76, 0.08], 'timber');
  }
  w.box([1.2, 0.45, -1.5], [1.4, 0.9, 0.55], 'planks');
  w.box([1.2, 0.93, -1.5], [1.46, 0.05, 0.6], 'timber');

  // the pictures: along the back wall, then the left wall
  const pictures = room.objects.filter((o) => o.kind === 'picture');
  const frames: Room3D['frames'] = [];
  pictures.forEach((o, k) => {
    const tint = tintFor(o.label);
    if (k < 6) {
      const x = -2.4 + k * 0.95;
      w.box([x, 1.9, -hd + 0.04], [0.8, 1.0, 0.06], 'timber');
      w.box([x, 1.9, -hd + 0.08], [0.66, 0.86, 0.04], { key: 'plaster', tint });
      tag(o, x, 2.2, -hd + 0.1);
      frames.push({ center: new THREE.Vector3(x, 1.9, -hd + 0.08), across: 'x', w: 0.66, h: 0.86, ...(o.image ? { image: o.image } : {}) });
    } else {
      const z = -1.6 + (k - 6) * 0.95;
      w.box([-hw + 0.04, 1.9, z], [0.06, 1.0, 0.8], 'timber');
      w.box([-hw + 0.08, 1.9, z], [0.04, 0.86, 0.66], { key: 'plaster', tint });
      tag(o, -hw + 0.1, 2.2, z);
      frames.push({ center: new THREE.Vector3(-hw + 0.08, 1.9, z), across: 'z', w: 0.66, h: 0.86, ...(o.image ? { image: o.image } : {}) });
    }
  });

  // the table's holdings: coin piles, sacks and pouches (four places across the top, which runs from x −1.6 to 0.2)
  room.objects
    .filter((o) => o.zone === 'table')
    .forEach((o, i) => {
      const x = -1.35 + i * 0.4;
      tag(o, x, 1.05, 0.2);
      if (o.kind === 'coins') {
        // a loose heap of gold coins: the coin-pile prop, turned a little for each place
        props.push({ url: LOOT.coinPile, at: new THREE.Vector3(x, 0.84, 0.2), turn: i * 0.9 });
      } else {
        // a pouch for a small holding, a sack for a larger one: the prop is loaded by the view
        props.push({ url: o.kind === 'pouch' ? LOOT.pouch : LOOT.sack, at: new THREE.Vector3(x, 0.84, 0.2) });
      }
    });

  // the chests on the floor, in front of the table: a body with iron straps and corner bands, a stepped arched lid, a gold lock, coins spilling out
  // (on the floor beside the table, where the camera sees them whole)
  room.objects.filter((o) => o.kind === 'chest').forEach((o, i) => {
    const x = 0.55 + i * 0.7;
    props.push({ url: LOOT.chest, at: new THREE.Vector3(x, 0, 0.5) });
    solids.push({ x0: x - 0.4, x1: x + 0.4, z0: 0.26, z1: 0.74 });
    tag(o, x, 0.6, 0.5);
  });

  // the post of the Banker's Scale stays on the counter; the beam and pans are their own group (below)
  const scales = room.objects.filter((o) => o.kind === 'scale');
  if (scales.length > 0) w.box([1.2, 1.28, -1.5], [0.05, 0.64, 0.05], 'timber');

  // rewards to claim: gold mounds (on the counter by the scale), as their own group so they can bob
  // (on the counter, beside the scale: a coin pile, scaled by the reward's size)
  room.objects
    .filter((o) => o.kind === 'harvest')
    .forEach((o, i) => {
      const at = new THREE.Vector3(1.45 + i * 0.1, 0.95, -1.6);
      props.push({ url: LOOT.coinPile, at, scale: 0.5 + 0.7 * o.size, turn: i * 1.3 });
      tag(o, at.x, 1.2, at.z);
    });

  // the hero whose house it is stands here (the view places their own figure), and talks about the house
  const talker = new THREE.Vector3(-2.5, 1.9, -1.2);

  // a merchant's ledger on the counter, a bard's lute on the right wall, a sleeper's bench by the back wall
  for (const o of room.objects.filter((o) => o.kind === 'ledger' || o.kind === 'lute' || o.kind === 'bench')) {
    if (o.kind === 'ledger') {
      w.box([0.7, 1.0, -1.6], [0.36, 0.04, 0.26], 'plaster');
      w.box([0.7, 1.03, -1.6], [0.34, 0.02, 0.24], 'timber');
      tag(o, 0.7, 1.2, -1.6);
    } else if (o.kind === 'lute') {
      w.box([hw - 0.06, 1.8, -0.6], [0.06, 0.4, 0.3], 'timber');
      w.box([hw - 0.06, 2.2, -0.6], [0.05, 0.42, 0.05], 'timber');
      tag(o, hw - 0.1, 2.2, -0.6);
    } else {
      w.box([-2.1, 0.45, -1.95], [1.4, 0.08, 0.4], 'timber');
      for (const x of [-2.7, -1.5]) w.box([x, 0.2, -1.95], [0.08, 0.4, 0.3], 'timber');
      tag(o, -2.1, 0.7, -1.95);
    }
  }

  const group = new THREE.Group();
  group.name = 'room';
  group.add(w.build(lib));

  // the Banker's Scale: its beam pivots at the middle; a tipped beam sits lower on the debt side (its left)
  const beams: { pivot: THREE.Group; tilt: number }[] = [];
  for (const o of scales) {
    const tilt = o.tone === undefined ? 0 : { safe: 0, watch: 1, danger: 2, critical: 3 }[o.tone];
    const hot = o.tone === 'danger' || o.tone === 'critical';
    const b = new MeshWriter();
    b.beam([-0.7, 0, 0], [0.7, 0, 0], 0.05, 0.05, 'iron');
    for (const x of [-0.7, 0.7]) {
      // two chains from the beam's end down to a pan
      for (const dz of [-0.07, 0.07]) b.beam([x, -0.02, dz], [x, -0.4, dz], 0.012, 0.012, 'iron');
      b.cylinder(x, 0, -0.44, 0.13, 0.04, 12, x < 0 && hot ? { key: 'iron', tint: '#e0503c' } : 'iron');
    }
    const pivot = new THREE.Group();
    pivot.add(b.build(lib));
    pivot.position.set(1.2, 1.62, -1.5);
    tag(o, 1.2, 1.95, -1.5);
    pivot.rotation.z = 0.08 * tilt;
    group.add(pivot);
    beams.push({ pivot, tilt });
  }

  // the dust in the light: little motes drifting upward
  const motes = 40;
  const base = new Float32Array(motes * 3);
  for (let i = 0; i < motes; i++) {
    base[i * 3] = (Math.sin(i * 12.9) * 0.5 + 0.5) * (W - 0.4) - W / 2 + 0.2;
    base[i * 3 + 1] = 0.3 + (Math.sin(i * 7.7) * 0.5 + 0.5) * 2.4;
    base[i * 3 + 2] = (Math.sin(i * 3.1) * 0.5 + 0.5) * (D - 0.4) - D / 2 + 0.2;
  }
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new THREE.BufferAttribute(new Float32Array(base.length), 3);
  dustGeo.setAttribute('position', dustPos);
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#fff3d0', size: 0.03, transparent: true, opacity: room.empty ? 0.5 : 0.35, depthWrite: false }));
  group.add(dust);

  const animate = (t: number): void => {
    for (const { pivot, tilt } of beams) {
      // a level scale hangs still; a tipped one sways a little either way
      pivot.rotation.z = 0.08 * tilt + (tilt === 0 ? 0 : Math.sin(t * 1.4) * 0.015);
    }
    for (let i = 0; i < motes; i++) {
      const rise = (t * 0.04 + i * 0.07) % 1;
      dustPos.setXYZ(i, base[i * 3]! + Math.sin(t * 0.3 + i) * 0.08, base[i * 3 + 1]! + rise * 0.6, base[i * 3 + 2]!);
    }
    dustPos.needsUpdate = true;
  };
  animate(0);
  return { group, talker, labels, props, solids, floor: { x0: -hw + 0.1, x1: hw - 0.1, z0: -hd + 0.1, z1: hd - 0.1 }, frames, animate };
}
