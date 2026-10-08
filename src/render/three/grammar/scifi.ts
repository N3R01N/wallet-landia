/**
 * Sci-fi buildings (Phase 6): a colony of panelled modules, round habs under
 * domes, connecting tubes, masts and solar arrays, with glowing seams. Same
 * Mason and roles as the other styles:
 *   stone = hull panels · plaster = white composite · stoneDark = dark plating ·
 *   timber = metal frames · planks = deck plate · roofTiles/roofSlate = roof
 *   panels · fire = glowing strips (the theme tints it) · glass, iron, gold.
 */

import * as THREE from 'three';
import { FACES, type Ctx, type FaceId, type Made, type Rect, type RecipeSet } from './medieval.js';
import type { Mat } from './meshWriter.js';

const R = (w: number, d: number, cx = 0, cz = 0): Rect => ({ cx, cz, w, d });

/** A panelled module: hull walls, corner frames, portholes, glowing seams, a roof. Returns its top. */
function module(c: Ctx, r: Rect, y0: number, h: number, o: { wall?: Mat; door?: boolean; ports?: FaceId[]; roof?: Mat } = {}): number {
  const { m } = c;
  m.walls(r, y0, h, o.wall ?? 'stone');
  m.band(r, y0 + 0.2, 0.4, 'stoneDark', 0.05);
  m.band(r, y0 + 0.45, 0.05, 'fire', 0.06);
  m.band(r, y0 + h - 0.12, 0.08, 'fire', 0.06);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.box([r.cx + (sx * r.w) / 2, y0 + h / 2, r.cz + (sz * r.d) / 2], [0.3, h, 0.3], 'timber', Math.PI / 4);
  for (const f of o.ports ?? FACES) {
    const L = f === 'front' || f === 'back' ? r.w : r.d;
    const n = Math.max(1, Math.floor(L / 1.6));
    for (let i = 0; i < n; i++) {
      const s = -L / 2 + (L / n) * (i + 0.5);
      if (o.door && f === 'front' && i === Math.floor(n / 2)) continue;
      for (let y = y0 + 1.3; y < y0 + h - 0.8; y += 2.4) {
        m.onFace(r, f, s, y + 0.3, [0.8, 0.8], 0.06, 'timber');
        m.panel(r, f, s - 0.3, s + 0.3, y, y + 0.6, 0.08, 'glass');
      }
    }
  }
  if (o.door) {
    m.onFace(r, 'front', 0, y0 + 1.2, [1.5, 2.4], 0.1, 'stoneDark');
    m.onFace(r, 'front', 0, y0 + 1.1, [1.1, 2.1], 0.04, 'plaster', 0.1);
    m.onFace(r, 'front', 0, y0 + 2.25, [1.1, 0.06], 0.03, 'fire', 0.12);
  }
  m.w.box([r.cx, y0 + h + 0.12, r.cz], [r.w + 0.2, 0.24, r.d + 0.2], o.roof ?? 'roofTiles', { skip: ['bottom'] });
  return y0 + h + 0.24;
}

/** A round hab with a dome. Returns the dome's top. */
function hab(c: Ctx, cx: number, cz: number, rad: number, h: number, dome: Mat = 'plaster'): number {
  const { m } = c;
  m.w.cylinder(cx, cz, 0, rad, h, 16, 'stone');
  m.w.cylinder(cx, cz, 0, rad + 0.08, 0.5, 16, 'stoneDark');
  m.w.cylinder(cx, cz, h * 0.55, rad + 0.04, 0.08, 16, 'fire');
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    m.box([cx + Math.cos(a) * (rad + 0.02), h * 0.55 + 0.6, cz + Math.sin(a) * (rad + 0.02)], [0.5, 0.45, 0.06], 'glass', -a + Math.PI / 2);
  }
  m.w.dome(cx, cz, h, rad, rad * 0.75, 16, 5, dome);
  return h + rad * 0.75;
}

/** A tube between two points at height y. */
function tube(c: Ctx, a: [number, number], b: [number, number], y: number): void {
  c.m.w.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.9, 0.9, 'stoneDark');
  c.m.w.beam([a[0], y + 0.46, a[1]], [b[0], y + 0.46, b[1]], 0.3, 0.05, 'fire');
}

function solar(c: Ctx, x: number, z: number, y: number, w = 1.6): void {
  c.m.box([x, y + 0.3, z], [0.08, 0.6, 0.08], 'iron');
  c.m.box([x, y + 0.65, z], [w, 0.05, w * 0.6], 'glass', 0, 0);
  c.m.box([x, y + 0.62, z], [w + 0.08, 0.04, w * 0.6 + 0.08], 'timber');
}

const RECIPES: Record<string, (c: Ctx) => Made> = {
  /** A trading post: a module with stalls under a canopy and a holo sign. */
  bazaar(c) {
    const { m, W, D } = c;
    const r = R(W * 0.9, D * 0.55, 0, -D * 0.2);
    const top = module(c, r, 0, 3.2, { door: true, ports: ['left', 'right'] });
    m.w.slab([[-W / 2, 3.0, D / 2], [W / 2, 3.0, D / 2], [W / 2, 3.4, r.cz + r.d / 2], [-W / 2, 3.4, r.cz + r.d / 2]], 0.06, { key: 'roofTiles', tint: c.roof }, 'timber');
    for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) m.box([x, 1.5, D / 2 - 0.1], [0.12, 3.0, 0.12], 'timber');
    for (const x of [-W * 0.25, W * 0.25]) {
      m.box([x, 0.5, D * 0.25], [1.1, 1.0, 0.6], 'stoneDark');
      m.box([x, 1.02, D * 0.25], [1.0, 0.04, 0.5], 'fire');
    }
    m.box([0, top + 0.7, r.cz], [W * 0.7, 0.9, 0.05], { key: 'roofTiles', tint: c.roof });
    m.band(R(W * 0.7, 0.05, 0, r.cz), top + 0.25, 0.05, 'fire', 0.02);
    return { top: top + 1.2, sign: [W / 2 - 0.2, 3.6, D / 2 + 0.2] };
  },
  /** A slim stacked tower of shrinking rings. */
  broker(c) {
    const { m, W } = c;
    let y = 0;
    for (const [rad, h] of [[W * 0.36, 3.4], [W * 0.3, 3.0], [W * 0.24, 2.6]] as const) {
      m.w.cylinder(0, 0, y, rad, h, 16, 'stone');
      m.w.cylinder(0, 0, y + h - 0.1, rad + 0.12, 0.2, 16, 'fire', { top: { key: 'roofTiles', tint: c.roof } });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        m.box([Math.cos(a) * (rad + 0.02), y + h * 0.55, Math.sin(a) * (rad + 0.02)], [0.6, h * 0.45, 0.05], 'glass', -a + Math.PI / 2);
      }
      y += h;
    }
    const tip = m.mast(0, 0, y, 2.5);
    m.onFace(R(W * 0.72, W * 0.72), 'front', 0, 1.1, [1.0, 2.2], 0.25, 'stoneDark');
    return { top: tip, sign: [W * 0.4, 2.6, W * 0.4] };
  },
  /** The vault: an armoured cube with a round door and glowing seams. */
  bank(c) {
    const { m, W, D } = c;
    const r = R(W * 0.9, D * 0.75, 0, -0.2);
    const top = module(c, r, 0, 4.4, { wall: 'stoneDark', ports: [], roof: { key: 'roofSlate', tint: c.roof } });
    const fz = r.cz + r.d / 2;
    m.w.beam([0, 2.0, fz], [0, 2.0, fz + 0.35], 2.4, 2.4, 'timber');
    m.w.beam([0, 2.0, fz + 0.36], [0, 2.0, fz + 0.42], 1.8, 1.8, 'gold');
    for (let k = 0; k < 4; k++) m.box([0, 2.0, fz + 0.46], [1.6, 0.08, 0.04], 'fire', 0, (k * Math.PI) / 4);
    for (const x of [-r.w / 2 + 0.6, r.w / 2 - 0.6]) m.box([x, 2.2, fz + 0.05], [0.14, 3.4, 0.08], 'fire');
    solar(c, 0, r.cz, top);
    return { top: top + 1, sign: [r.w / 2, 3.2, fz + 0.4] };
  },
  /** A spire: a tall faceted obelisk with glowing rings. */
  temple(c) {
    const { m, W } = c;
    const base = R(W * 0.8, W * 0.8);
    module(c, base, 0, 2.6, { door: true, ports: ['left', 'right', 'back'] });
    m.w.cone(0, 0, 2.84, W * 0.32, 11, 6, { key: 'roofSlate', tint: c.roof });
    for (const [y, rr] of [[5, 0.85], [8, 0.55], [11, 0.3]] as const) m.w.cylinder(0, 0, y, W * 0.32 * rr + 0.12, 0.12, 12, 'fire');
    m.box([0, 14.3, 0], [0.25, 0.25, 0.25], 'gold');
    return { top: 14.5, sign: [base.w / 2, 2.2, base.d / 2 + 0.3] };
  },
  /** A bunker with two turrets. */
  barracks(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.7, 0, -0.2);
    const top = module(c, r, 0, 3.0, { wall: 'stoneDark', door: true, ports: ['front'] });
    for (const x of [-r.w / 2 + 0.7, r.w / 2 - 0.7]) {
      m.w.cylinder(x, r.cz, top, 0.55, 0.7, 12, 'stone', { top: 'stoneDark' });
      m.w.beam([x, top + 0.45, r.cz], [x, top + 0.5, r.cz + 1.3], 0.14, 0.14, 'iron');
    }
    m.pole(0, r.cz - r.d / 2 + 0.3, top + 3, c.banner);
    return { top: top + 3, sign: [r.w / 2, 2.2, r.cz + r.d / 2 + 0.3] };
  },
  /** A lab: a dome with tanks and antennas. */
  alchemist(c) {
    const { m, W } = c;
    const top = hab(c, 0, -0.3, W * 0.4, 3.2, 'glass');
    for (const [x, z] of [[W * 0.42, W * 0.25], [-W * 0.42, W * 0.25]] as const) {
      m.w.cylinder(x, z, 0, 0.45, 2.4, 12, 'plaster');
      m.w.dome(x, z, 2.4, 0.45, 0.35, 12, 3, 'plaster');
      m.w.cylinder(x, z, 1.2, 0.47, 0.08, 12, 'fire');
    }
    const tip = m.mast(W * 0.2, -0.6, top - 1, 3.5);
    return { top: Math.max(top, tip), sign: [W * 0.4, 2.4, W * 0.45] };
  },
  /** A hexagonal hall. */
  auction(c) {
    const { m, W } = c;
    const rad = W * 0.5;
    m.w.cylinder(0, 0, 0, rad, 4.6, 6, 'stone');
    m.w.cylinder(0, 0, 0, rad + 0.1, 0.4, 6, 'stoneDark');
    m.w.cylinder(0, 0, 3.0, rad + 0.04, 0.08, 6, 'fire');
    m.w.cone(0, 0, 4.6, rad + 0.25, 2.2, 6, { key: 'roofTiles', tint: c.roof });
    m.onFace(R(rad * 1.7, rad * 1.7), 'front', 0, 1.3, [1.6, 2.6], 0.2, 'glass');
    return { top: 6.8, sign: [rad * 0.8, 2.8, rad * 0.9] };
  },
  /** A spaceport: a landing pad with lights and a control tower. */
  harbour(c) {
    const { m, W, D } = c;
    m.w.cylinder(W * 0.1, 0.2, 0, Math.min(W, D) * 0.48, 0.35, 16, 'stoneDark', { top: 'planks' });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      m.box([W * 0.1 + Math.cos(a) * Math.min(W, D) * 0.44, 0.4, 0.2 + Math.sin(a) * Math.min(W, D) * 0.44], [0.15, 0.08, 0.15], 'fire');
    }
    m.box([W * 0.1, 0.37, 0.2], [2.4, 0.02, 0.2], 'gold');
    m.box([W * 0.1, 0.37, 0.2], [0.2, 0.02, 2.4], 'gold');
    const t = R(1.3, 1.3, -W / 2 + 0.6, -D / 2 + 0.6);
    m.walls(t, 0, 4.5, 'stone');
    const cab = R(1.9, 1.9, t.cx, t.cz);
    m.walls(cab, 4.5, 1.2, 'glass');
    m.w.box([cab.cx, 5.8, cab.cz], [2.1, 0.2, 2.1], { key: 'roofTiles', tint: c.roof }, { skip: ['bottom'] });
    const tip = m.mast(cab.cx, cab.cz, 5.9, 2);
    return { top: tip, sign: [t.cx + 0.9, 2.4, t.cz + 0.9] };
  },
  /** Command centre: stacked modules and a dish. */
  council(c) {
    const { m, W, D } = c;
    const a = R(W, D * 0.65, 0, -0.3);
    const y1 = module(c, a, 0, 3.2, { door: true });
    const b = R(W * 0.6, D * 0.45, 0, -0.5);
    const y2 = module(c, b, y1, 2.8, { roof: { key: 'roofTiles', tint: c.roof } });
    m.w.cylinder(W * 0.25, -0.6, y2, 0.12, 1.0, 8, 'timber');
    m.w.cone(W * 0.25, -0.6, y2 + 2.0, 1.0, -0.6, 14, 'plaster');
    m.w.cone(W * 0.25, -0.6, y2 + 1.4, 1.0, 0.6, 14, 'plaster');
    m.pole(-W * 0.3, -0.6, y2 + 2.6, c.banner);
    return { top: y2 + 2.6, sign: [a.w / 2, 2.4, a.cz + a.d / 2 + 0.3] };
  },
  /** A registry kiosk with a holo panel. */
  names(c) {
    const { m, W, D } = c;
    const r = R(W * 0.7, D * 0.55);
    const top = module(c, r, 0, 3.0, { door: true, ports: ['left', 'right'] });
    m.box([0, top + 0.9, 0], [r.w * 0.8, 1.1, 0.04], 'glass');
    m.band(R(r.w * 0.8, 0.04), top + 0.35, 0.05, 'fire', 0.02);
    return { top: top + 1.5, sign: [r.w / 2, 2.4, r.d / 2 + 0.3] };
  },
  /** A cargo depot: stacked crates and a loader arm. */
  packing(c) {
    const { m, W, D } = c;
    const r = R(W * 0.55, D * 0.65, -W * 0.2, -0.3);
    const top = module(c, r, 0, 3.4, { door: true, ports: ['left'] });
    const colours = ['#d0d4dc', c.banner, '#e0a020', '#d0d4dc'];
    for (let i = 0; i < 4; i++) m.box([W / 2 - 0.7, 0.55 + Math.floor(i / 2) * 1.1, -0.9 + (i % 2) * 1.8], [1.1, 1.05, 1.6], { key: 'stone', tint: colours[i]! });
    m.w.beam([W / 2 - 1.5, 0, D / 2 - 0.4], [W / 2 - 1.5, 4.2, D / 2 - 0.4], 0.25, 0.25, 'timber');
    m.w.beam([W / 2 - 1.5, 4.1, D / 2 - 0.4], [W / 2 - 0.4, 3.6, 0], 0.2, 0.2, 'timber');
    return { top: Math.max(top, 4.3), sign: [r.cx + r.w / 2, 2.4, r.cz + r.d / 2 + 0.3] };
  },
  /** A fabricator with glowing exhaust stacks. */
  forge(c) {
    const { m, W, D } = c;
    const r = R(W * 0.85, D * 0.6, 0, -0.4);
    const top = module(c, r, 0, 3.4, { door: true, wall: 'stoneDark', roof: { key: 'roofSlate', tint: c.roof } });
    for (const x of [-r.w * 0.25, r.w * 0.25]) {
      m.w.cylinder(x, r.cz - 0.4, top, 0.3, 3.2, 10, 'stone');
      m.w.cylinder(x, r.cz - 0.4, top + 3.2, 0.36, 0.25, 10, 'fire', { top: 'fire' });
      m.smoke.push({ at: [x, top + 3.6, r.cz - 0.4], color: '#e8f4f8' });
    }
    m.box([0, 0.5, r.cz + r.d / 2 + 0.7], [1.2, 1.0, 0.9], 'stoneDark');
    m.box([0, 1.02, r.cz + r.d / 2 + 0.7], [0.9, 0.04, 0.6], 'fire');
    return { top: top + 3.5, sign: [r.w / 2, 2.4, r.cz + r.d / 2 + 0.3] };
  },
  /** A hover cart under a canopy. */
  herald(c) {
    const { m } = c;
    m.box([0, 0.9, 0], [2.2, 0.25, 1.4], 'plaster');
    m.box([0, 0.72, 0], [2.0, 0.08, 1.2], 'fire');
    m.box([-0.4, 1.3, 0], [0.6, 0.55, 0.6], 'stoneDark');
    for (const [x, z] of [[-1.0, -0.6], [1.0, -0.6], [-1.0, 0.6], [1.0, 0.6]] as const) m.box([x, 1.8, z], [0.06, 1.8, 0.06], 'timber');
    m.w.box([0, 2.75, 0], [2.4, 0.08, 1.6], { key: 'roofTiles', tint: c.banner }, {});
    return { top: 2.8, sign: [0.6, 1.7, 0.75] };
  },
  /** A pop-up dome shelter. */
  tent(c) {
    const { m, W } = c;
    m.w.dome(0, 0, 0, W * 0.4, 2.6, 14, 5, { key: 'cloth', tint: '#5a3a7a' });
    m.w.cylinder(0, 0, 0.02, W * 0.41, 0.12, 14, 'fire');
    m.panel(R(1, W * 0.8 + 0.05), 'front', -0.4, 0.4, 0, 1.6, 0, 'stoneDark');
    return { top: 2.6, sign: [0.9, 1.4, W * 0.42] };
  },
  /** The Chronicle Tower: a comms mast on a hab, the signal bell in a cage. */
  tower(c) {
    const { m } = c;
    const base = R(2.6, 2.6);
    const y = module(c, base, 0, 3.4, { door: true });
    // a lattice mast
    const h = 10;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.w.beam([sx * 0.9, y, sz * 0.9], [sx * 0.35, y + h, sz * 0.35], 0.12, 0.12, 'timber');
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const s = 0.9 - 0.55 * t;
      m.band(R(s * 2, s * 2), y + h * t, 0.08, 'timber', 0.02);
    }
    m.band(R(0.9, 0.9), y + h - 0.2, 0.1, 'fire', 0.03);
    m.box([0, y + h + 0.1, 0], [1.0, 0.2, 1.0], 'stoneDark');
    const tip = m.mast(0, 0, y + h + 0.2, 2.2);
    // the bell: a signal beacon swinging in the cage at the mast's foot
    const pivot = new THREE.Group();
    pivot.position.set(0, y + 2.6, 0);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.8, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#c89a38', metalness: 0.85, roughness: 0.35, emissive: new THREE.Color('#40e0ff'), emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    cup.position.y = -0.42;
    cup.castShadow = true;
    pivot.add(cup);
    return { top: tip, bell: pivot };
  },
  /** The guild hab: a big dome flanked by modules, banners. */
  guildhall(c) {
    const { m, W, D } = c;
    const top = hab(c, 0, -0.4, W * 0.36, 3.6, { key: 'roofTiles', tint: c.bannerRoof });
    for (const x of [-W / 2 + 0.6, W / 2 - 0.6]) {
      module(c, R(1.1, 1.6, x, D * 0.22), 0, 2.6, { ports: ['front'] });
      m.box([x, 3.5, D * 0.22 + 0.82], [0.6, 1.4, 0.03], { key: 'cloth', tint: c.banner });
    }
    tube(c, [-W / 2 + 0.6, D * 0.22], [-W * 0.2, -0.2], 1.0);
    tube(c, [W / 2 - 0.6, D * 0.22], [W * 0.2, -0.2], 1.0);
    m.onFace(R(W * 0.72, W * 0.72, 0, -0.4), 'front', 0, 1.2, [1.4, 2.4], 0.3, 'stoneDark');
    return { top, sign: [0, 3.2, D * 0.45] };
  },
  /** The airlock gate: a ring arch and two pylons. */
  gate(c) {
    const { m } = c;
    const segs = 14;
    for (let k = 0; k <= segs; k++) {
      const a0 = (k / segs) * Math.PI;
      const a1 = ((k + 1) / segs) * Math.PI;
      if (k === segs) break;
      m.w.beam([Math.cos(a0) * 2.4, 0.2 + Math.sin(a0) * 4.2, 0], [Math.cos(a1) * 2.4, 0.2 + Math.sin(a1) * 4.2, 0], 0.9, 0.5, 'stone');
      m.w.beam([Math.cos(a0) * 2.15, 0.2 + Math.sin(a0) * 3.95, 0.47], [Math.cos(a1) * 2.15, 0.2 + Math.sin(a1) * 3.95, 0.47], 0.08, 0.1, 'fire');
    }
    for (const x of [-2.6, 2.6]) module(c, R(0.9, 1.2, x, 0), 0, 2.2, { ports: [] });
    m.box([0, 0.02, 0], [3.6, 0.04, 2.0], 'planks');
    m.pole(-2.6, 0, 5.4, c.banner);
    m.pole(2.6, 0, 5.4, c.banner);
    return { top: 5.4 };
  },
};

/** Homes by value tier: sleeping capsule, pod, hab, twin hab, dome villa, hab tower, arcology spire. */
function home(c: Ctx): Made {
  const { m, W, D } = c;
  switch (c.tier) {
    case 0: {
      m.w.beam([-0.9, 0.45, 0], [0.9, 0.45, 0], 0.9, 0.9, 'plaster');
      m.box([0.92, 0.45, 0], [0.04, 0.6, 0.6], 'glass');
      m.box([0, 0.03, 0], [2.2, 0.06, 1.1], 'fire');
      return { top: 0.9 };
    }
    case 1:
      return { top: hab(c, 0, 0, 1.2, 1.6) };
    case 2: {
      const r = R(W * 0.75, D * 0.55);
      return { top: module(c, r, 0, 2.8, { door: true }) };
    }
    case 3: {
      const a = R(W * 0.5, D * 0.5, -W * 0.22, 0);
      const t1 = module(c, a, 0, 2.8, { door: true });
      const t2 = hab(c, W * 0.28, -0.3, 1.1, 2.6);
      tube(c, [a.cx + a.w / 2, 0], [W * 0.28 - 1.0, -0.3], 1.2);
      solar(c, a.cx, a.cz, t1);
      return { top: Math.max(t1 + 1, t2) };
    }
    case 4: {
      const top = hab(c, 0, -0.2, W * 0.42, 2.8, 'glass');
      m.w.cylinder(0, -0.2, 0, W * 0.48, 0.25, 18, 'planks', { top: 'planks' });
      m.box([W * 0.25, 0.3, D * 0.38], [1.6, 0.1, 1.0], { key: 'plaster', tint: '#4ad8e8' });
      return { top };
    }
    case 5: {
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const s = 1 - i * 0.12;
        y = module(c, R(W * 0.8 * s, D * 0.75 * s), y, 2.8, { door: i === 0, roof: i === 3 ? { key: 'roofTiles', tint: c.bannerRoof } : 'roofTiles' });
      }
      return { top: m.mast(0, 0, y, 2.5) };
    }
    default: {
      // an arcology spire: tiers of rings around a core, gardens, a beacon
      const core = W * 0.22;
      m.w.cylinder(0, 0, 0, core, 30, 12, 'stone');
      let y = 0;
      for (let i = 0; i < 6; i++) {
        const rad = W * (0.46 - i * 0.045);
        m.w.cylinder(0, 0, y, rad, 3.2, 16, i % 2 ? 'plaster' : 'stone', { top: i % 2 ? 'grass' : 'roofTiles' });
        m.w.cylinder(0, 0, y + 1.4, rad + 0.03, 1.2, 16, 'glass');
        m.w.cylinder(0, 0, y + 3.0, rad + 0.06, 0.08, 16, 'fire');
        y += 4.8;
      }
      m.w.cone(0, 0, 30, core + 0.1, 6, 12, { key: 'roofSlate', tint: c.bannerRoof });
      return { top: m.mast(0, 0, 36, 2) };
    }
  }
}

export const SCIFI: RecipeSet = { recipes: RECIPES, home };
