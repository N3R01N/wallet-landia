/**
 * Modern buildings (Phase 6): brick and render facades over concrete, steel
 * frames, big glazing, flat roofs with parapets, shopfronts with awnings in
 * the protocol's colour. Same Mason, same roles as the medieval grammar, so
 * a theme's materials restyle these too:
 *   stone = facing brick · plaster = render · stoneDark = concrete ·
 *   timber = steel frames · planks = timber cladding · roofSlate = flat roofs
 *   and metal sheds · roofTiles = pitched roofs · glass, iron, gold, fire.
 */

import * as THREE from 'three';
import { type Ctx, type FaceId, type Made, type Rect, type RecipeSet, type StoreyOpts } from './medieval.js';
import type { Mat } from './meshWriter.js';

const FLOOR = 3.1;

/** Storeys of a block. Returns the height reached. */
function floors(c: Ctx, r: Rect, y0: number, n: number, o: { wall: Mat; win?: [number, number]; door?: boolean; windows?: FaceId[] }): number {
  let y = y0;
  for (let i = 0; i < n; i++) {
    const s: StoreyOpts = { h: FLOOR, wall: o.wall, win: o.win ?? [0.95, 1.5] };
    if (o.windows) s.windows = o.windows;
    if (i === 0 && o.door) s.door = { w: 1.1, h: 2.3 };
    c.m.storey(r, y, s);
    y += FLOOR;
    c.m.band(r, y - 0.07, 0.14, 'stoneDark', 0.03); // the floor slab's edge
  }
  return y;
}

/** A glazed ground floor with a fascia and an awning in the brand's colour. */
function shopfront(c: Ctx, r: Rect, wall: Mat): number {
  const { m } = c;
  m.walls(r, 0, FLOOR, wall);
  m.glassWall(r, 'front', 0.2, 2.35, 4, 1, 'timber', -r.w / 2 + 0.3, r.w / 2 - 0.3);
  m.onFace(r, 'front', 0, 2.85, [r.w, 0.5], 0.14, 'stoneDark');
  m.awning(r, 'front', 0, 2.5, r.w - 0.5, 1.1, c.roof);
  m.band(r, FLOOR - 0.07, 0.14, 'stoneDark', 0.03);
  return FLOOR;
}

/** Air-conditioning boxes and a vent on a flat roof. */
function rooftop(c: Ctx, r: Rect, y: number): void {
  const { m } = c;
  m.box([r.cx - r.w * 0.2, y + 0.35, r.cz - r.d * 0.15], [0.9, 0.7, 0.6], 'timber');
  m.box([r.cx + r.w * 0.22, y + 0.25, r.cz + r.d * 0.1], [0.6, 0.5, 0.6], 'iron');
  m.w.cylinder(r.cx + r.w * 0.25, r.cz - r.d * 0.25, y, 0.15, 0.9, 8, 'iron', { top: 'iron' });
}

const R = (w: number, d: number, cx = 0, cz = 0): Rect => ({ cx, cz, w, d });

const RECIPES: Record<string, (c: Ctx) => Made> = {
  /** A shopping arcade: shopfront below, rendered offices above, a sign on the roof. */
  bazaar(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.8);
    shopfront(c, r, 'plaster');
    const y = floors(c, r, FLOOR, 1, { wall: { key: 'plaster', tint: c.wash } });
    const top = m.flatRoof(r, y);
    m.box([0, top + 0.6, -r.d / 4], [r.w * 0.8, 1.0, 0.12], { key: 'cloth', tint: c.roof });
    for (const x of [-r.w * 0.3, r.w * 0.3]) m.box([x, top + 0.1, -r.d / 4], [0.08, 0.4, 0.08], 'iron');
    return { top: top + 1.1, sign: [r.w / 2 - 0.2, 3.6, r.d / 2 + 0.4] };
  },
  /** A slim office building with a glazed lobby. */
  broker(c) {
    const { m, W, D } = c;
    const r = R(W * 0.75, D * 0.8);
    m.walls(r, 0, FLOOR, 'stoneDark');
    m.glassWall(r, 'front', 0, FLOOR - 0.2, 3, 1);
    const y = floors(c, r, FLOOR, 3, { wall: { key: 'plaster', tint: c.wash } });
    const top = m.flatRoof(r, y);
    rooftop(c, r, y);
    return { top, sign: [r.w / 2 - 0.1, 3.4, r.d / 2 + 0.4] };
  },
  /** A brick banking hall with a glass tower above. */
  bank(c) {
    const { m, W, D } = c;
    const base = R(W, D * 0.85);
    floors(c, base, 0, 1, { wall: 'stone', door: true, win: [0.9, 1.9] });
    m.flatRoof(base, FLOOR, 'roofSlate', 'stoneDark', 0.4);
    const t = R(W * 0.62, D * 0.55, 0, -D * 0.1);
    for (const f of ['front', 'right', 'back', 'left'] as FaceId[]) m.glassWall(t, f, FLOOR + 0.2, FLOOR * 5, 4, 5);
    m.walls(t, FLOOR + 0.2, FLOOR * 5, 'stoneDark');
    const crown = m.flatRoof(t, FLOOR * 6 + 0.2, 'roofSlate', 'timber', 0.9);
    m.band(t, crown - 0.3, 0.18, { key: 'cloth', tint: c.roof }, 0.06);
    m.box([0, FLOOR + 0.35, base.d / 2 + 0.25], [W * 0.5, 0.3, 0.12], 'gold');
    return { top: crown, sign: [base.w / 2 - 0.3, 2.6, base.d / 2 + 0.4] };
  },
  /** A concrete church with a steep roof and a thin bell tower. */
  temple(c) {
    const { m, W, D } = c;
    const nave = R(W * 0.68, D * 0.75, 0, -0.4);
    m.storey(nave, 0, { h: 4.8, wall: 'stoneDark', win: [0.35, 3.0], windows: ['left', 'right'] });
    m.gable(nave, 4.8, 4.2, 0.3, { key: 'roofSlate', tint: c.roof }, 'stoneDark', true);
    m.glassWall(nave, 'front', 2.2, 2.4, 1, 3, 'timber', -0.6, 0.6);
    m.door(nave, 'front', 0, 0, 1.2, 2.0, 'timber');
    const tw = R(1.0, 1.0, nave.w / 2 + 0.6, nave.cz + nave.d / 2 - 0.5);
    m.walls(tw, 0, 11, 'stoneDark');
    for (const f of ['front', 'right', 'back', 'left'] as FaceId[]) m.panel(tw, f, -0.25, 0.25, 9.2, 10.4, 0.02, 'glass');
    m.box([tw.cx, 11.1, tw.cz], [1.1, 0.2, 1.1], 'stoneDark');
    m.box([tw.cx, 12.3, tw.cz], [0.08, 2.2, 0.08], 'gold');
    m.box([tw.cx, 12.8, tw.cz], [0.8, 0.08, 0.08], 'gold');
    return { top: 13.4, sign: [-nave.w / 2 - 0.1, 2.4, nave.cz + nave.d / 2 + 0.3] };
  },
  /** A security headquarters: concrete, small windows, a fence and a flag. */
  barracks(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.75, 0, -0.3);
    const y = floors(c, r, 0, 2, { wall: 'stoneDark', door: true, win: [0.55, 0.7] });
    const top = m.flatRoof(r, y, 'roofSlate', 'stoneDark', 0.8);
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.3) m.box([x, 0.7, D / 2 - 0.1], [0.04, 1.4, 0.04], 'iron');
    m.box([0, 1.35, D / 2 - 0.1], [W, 0.05, 0.05], 'iron');
    m.pole(W / 2 - 0.4, -D / 2 + 0.6, top + 3, c.banner);
    return { top: top + 3, sign: [r.w / 2 - 0.2, 2.4, r.cz + r.d / 2 + 0.3] };
  },
  /** A round laboratory tower with glazed bands and a dome. */
  alchemist(c) {
    const { m, W } = c;
    const rad = W * 0.36;
    m.w.cylinder(0, -0.3, 0, rad, 11, 18, 'stoneDark');
    for (let y = 1.5; y < 10.5; y += 3) m.w.cylinder(0, -0.3, y, rad + 0.03, 1.3, 18, 'glass');
    m.w.cylinder(0, -0.3, 11, rad + 0.15, 0.3, 18, 'timber', { top: 'roofSlate' });
    m.w.dome(0, -0.3, 11.3, rad * 0.6, rad * 0.55, 14, 4, 'glass');
    const a = R(2.2, 1.6, 0, 1.4);
    m.walls(a, 0, FLOOR, 'plaster');
    m.glassWall(a, 'front', 0.2, 2.4, 2, 1);
    m.flatRoof(a, FLOOR, 'roofSlate', 'stoneDark', 0.3);
    return { top: 11.3 + rad * 0.55, sign: [1.3, 2.6, 2.4] };
  },
  /** A gallery: a concrete box with one huge window and a cantilever. */
  auction(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.7, 0, -0.3);
    m.walls(r, 0, 6.4, 'stoneDark');
    m.glassWall(r, 'front', 0.1, 4.2, 3, 2);
    const top = m.flatRoof(r, 6.4, 'roofSlate', 'stoneDark', 0.4);
    const cant = R(W * 0.6, D * 0.5, -W * 0.2, -0.2);
    m.walls({ ...cant, cz: cant.cz + 0.6 }, 6.8, 2.6, { key: 'plaster', tint: c.wash });
    m.glassWall({ ...cant, cz: cant.cz + 0.6 }, 'front', 7.2, 1.6, 4, 1);
    m.flatRoof({ ...cant, cz: cant.cz + 0.6 }, 9.4, 'roofSlate', 'stoneDark', 0.3);
    m.box([0, 4.6, r.cz + r.d / 2 + 0.1], [r.w, 0.6, 0.15], { key: 'cloth', tint: c.roof });
    return { top: Math.max(top, 9.7), sign: [r.w / 2 - 0.2, 2.6, r.cz + r.d / 2 + 0.4] };
  },
  /** A container terminal: a metal shed, stacked containers and a gantry crane. */
  harbour(c) {
    const { m, W, D } = c;
    const r = R(W * 0.6, D * 0.7, -W * 0.2, -0.3);
    m.storey(r, 0, { h: 4, wall: 'roofSlate', door: { w: 2.0, h: 3.2 }, windows: [] });
    const top = m.gable(r, 4, 1.0, 0.25, { key: 'roofSlate', tint: c.roof }, 'roofSlate');
    const colours = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', c.banner];
    for (let i = 0; i < 5; i++) m.box([W / 2 - 0.7, 0.65 + Math.floor(i / 2) * 1.3, -1.3 + (i % 2) * 2.6], [1.25, 1.25, 2.5], { key: 'roofSlate', tint: colours[i]! });
    for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) for (const x of [W / 2 - 1.6, W / 2 + 0.2]) m.box([x, 3.6, z], [0.18, 7.2, 0.18], { key: 'timber', tint: '#e0a020' });
    m.box([W / 2 - 0.7, 7.2, 0], [2.2, 0.35, D], { key: 'timber', tint: '#e0a020' });
    m.box([W / 2 - 0.7, 6.6, 0.4], [0.8, 0.6, 0.8], 'timber');
    return { top: Math.max(top, 7.4), sign: [r.cx + r.w / 2 - 0.2, 3.0, r.cz + r.d / 2 + 0.4] };
  },
  /** The town hall: three brick floors behind a columned portico, a clock and a flag. */
  council(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.7, 0, -0.4);
    const y = floors(c, r, 0, 3, { wall: 'stone', door: true });
    const top = m.flatRoof(r, y, 'roofSlate', 'stoneDark', 0.6);
    const fz = r.cz + r.d / 2;
    for (let i = 0; i < 4; i++) m.w.cylinder(-W / 2 + 0.5 + (i * (W - 1)) / 3, fz + 0.8, 0, 0.2, FLOOR * 2, 12, 'stoneDark');
    m.box([0, FLOOR * 2 + 0.2, fz + 0.5], [W + 0.2, 0.4, 1.2], 'stoneDark');
    m.box([0, 0.1, fz + 0.6], [W + 0.4, 0.2, 1.4], 'stoneDark');
    m.w.cylinder(0, fz + 0.04, top - 1.6, 0.55, 0.06, 18, 'gold', { top: 'gold' });
    m.pole(0, r.cz - 0.5, top + 3.2, c.banner);
    return { top: top + 3.2, sign: [r.w / 2 - 0.3, 2.4, fz + 1.4] };
  },
  /** A small brick office with a shopfront. */
  names(c) {
    const { m, W, D } = c;
    const r = R(W * 0.8, D * 0.7);
    shopfront(c, r, 'stone');
    const y = floors(c, r, FLOOR, 1, { wall: 'stone' });
    const top = m.flatRoof(r, y, 'roofSlate', 'stoneDark', 0.4);
    return { top, sign: [r.w / 2 - 0.1, 3.4, r.d / 2 + 0.4] };
  },
  /** A metal warehouse with roller doors and pallets. */
  packing(c) {
    const { m, W, D } = c;
    const r = R(W * 0.95, D * 0.7, 0, -0.3);
    m.walls(r, 0, 4.5, 'roofSlate');
    for (const s of [-r.w * 0.25, r.w * 0.25]) m.onFace(r, 'front', s, 1.6, [1.6, 3.2], 0.06, { key: 'planks', tint: '#9aa0a8' });
    const top = m.gable(r, 4.5, 0.9, 0.3, { key: 'roofSlate', tint: c.roof }, 'roofSlate');
    for (const [x, z] of [[-W / 2 + 0.6, D / 2 - 0.3], [W / 2 - 0.6, D / 2 - 0.4]] as const) {
      m.box([x, 0.08, z], [1.0, 0.16, 0.9], 'planks');
      m.box([x, 0.5, z], [0.9, 0.7, 0.8], { key: 'cloth', tint: '#c8b890' });
    }
    return { top, sign: [r.w / 2 - 0.2, 3.2, r.cz + r.d / 2 + 0.4] };
  },
  /** A brick works with a sawtooth roof and a tall stack. */
  forge(c) {
    const { m, W, D } = c;
    const r = R(W * 0.9, D * 0.65, 0, -0.4);
    m.storey(r, 0, { h: 4, wall: 'stone', door: { w: 1.8, h: 3 }, win: [0.9, 1.6] });
    m.flatRoof(r, 4, 'roofSlate', 'stone', 0);
    for (let i = 0; i < 3; i++) {
      const z0 = r.cz - r.d / 2 + (i * r.d) / 3;
      const z1 = z0 + r.d / 3;
      m.w.slab([[-r.w / 2, 4.2, z1], [r.w / 2, 4.2, z1], [r.w / 2, 5.4, z0], [-r.w / 2, 5.4, z0]], 0.08, { key: 'roofSlate', tint: c.roof }, 'timber');
      m.w.quad([r.w / 2, 4.2, z0], [-r.w / 2, 4.2, z0], [-r.w / 2, 5.4, z0], [r.w / 2, 5.4, z0], 'glass');
    }
    m.w.cylinder(r.w / 2 - 0.5, r.cz + 0.6, 0, 0.42, 12, 14, 'stone');
    m.w.cylinder(r.w / 2 - 0.5, r.cz + 0.6, 11.6, 0.5, 0.4, 14, 'stoneDark', { top: 'fire' });
    return { top: 12, sign: [r.w / 2 + 0.1, 3.0, r.cz + r.d / 2 + 0.4] };
  },
  /** A food truck with its hatch open. */
  herald(c) {
    const { m } = c;
    m.box([0, 1.45, -0.2], [1.9, 2.0, 3.0], { key: 'plaster', tint: c.banner });
    m.box([0, 1.05, 1.75], [1.9, 1.3, 0.9], { key: 'plaster', tint: c.banner });
    m.box([0, 1.4, 2.2], [1.6, 0.6, 0.05], 'glass');
    for (const sx of [-0.85, 0.85]) for (const z of [-1.1, 1.6]) m.box([sx, 0.36, z], [0.25, 0.72, 0.72], 'iron');
    m.panel({ cx: 0, cz: -0.2, w: 1.9, d: 3.0 }, 'right', -1.1, 0.9, 1.3, 2.1, 0.02, 'glass');
    m.w.slab([[0.95, 2.4, 1.0], [0.95, 2.4, -1.4], [1.9, 2.1, -1.4], [1.9, 2.1, 1.0]], 0.04, { key: 'cloth', tint: c.roof });
    m.box([1.25, 1.2, -0.2], [0.5, 0.06, 2.2], 'timber');
    return { top: 2.6, sign: [1.0, 2.6, 1.4] };
  },
  /** A pop-up gazebo. */
  tent(c) {
    const { m, W } = c;
    const r = R(W * 0.75, W * 0.75);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.box([(sx * r.w) / 2, 1.2, (sz * r.d) / 2], [0.06, 2.4, 0.06], 'timber');
    m.hip(r, 2.4, 1.3, 0.1, { key: 'cloth', tint: '#5a3a7a' });
    m.box([0, 0.45, 0], [1.2, 0.06, 0.7], 'timber');
    m.w.cylinder(0, 0, 0.5, 0.18, 0.36, 12, 'glass', { top: 'glass' });
    return { top: 3.7, sign: [r.w / 2 + 0.1, 1.6, r.d / 2] };
  },
  /** The Chronicle Tower: a concrete clock tower with an open top and a mast. */
  tower(c) {
    const { m } = c;
    const r = R(2.4, 2.4);
    m.storey(r, 0, { h: 3.2, wall: 'stoneDark', door: { w: 1.2, h: 2.4 }, windows: [] });
    m.walls(r, 3.2, 7.4, 'stone');
    for (const f of ['front', 'right', 'back', 'left'] as FaceId[]) {
      m.onFace(r, f, 0, 8.6, [1.3, 1.3], 0.06, 'stoneDark');
      m.panel(r, f, -0.55, 0.55, 8.05, 9.15, 0.08, { key: 'plaster', tint: '#f4f0e6' });
      m.onFace(r, f, 0, 8.75, [0.05, 0.4], 0.03, 'iron', 0.08);
      m.onFace(r, f, 0.1, 8.6, [0.3, 0.05], 0.03, 'iron', 0.08, 0.5);
      for (let y = 4.2; y < 7.5; y += 1.4) m.panel(r, f, -0.12, 0.12, y, y + 0.9, 0.02, 'glass');
    }
    m.box([0, 10.7, 0], [r.w + 0.3, 0.2, r.d + 0.3], 'stoneDark');
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.box([sx * 1.0, 11.8, sz * 1.0], [0.4, 2.0, 0.4], 'stoneDark');
    const top = m.flatRoof(r, 12.8, 'roofSlate', 'stoneDark', 0.2);
    const tip = m.mast(0, 0, top, 4.5);
    const pivot = new THREE.Group();
    pivot.position.set(0, 12.4, 0);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 0.85, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#c89a38', metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }));
    cup.position.y = -0.45;
    cup.castShadow = true;
    pivot.add(cup);
    return { top: tip, bell: pivot };
  },
  /** The guild's headquarters: brick and glass, banners, a roof garden. */
  guildhall(c) {
    const { m, W, D } = c;
    const r = R(W, D * 0.75, 0, -0.3);
    m.walls(r, 0, FLOOR, 'stoneDark');
    m.glassWall(r, 'front', 0, FLOOR - 0.1, 5, 1);
    const y = floors(c, r, FLOOR, 2, { wall: 'stone' });
    const top = m.flatRoof(r, y, 'grass', 'stoneDark', 0.7);
    for (const [x, z] of [[-1, -0.5], [0.8, 0.3], [-0.2, 0.8]] as const) m.box([x, y + 0.5, z], [0.7, 0.6, 0.7], 'forestFloor');
    for (const x of [-W / 2 + 0.5, W / 2 - 0.5]) m.box([x, FLOOR + 1.6, r.cz + r.d / 2 + 0.06], [0.7, 2.6, 0.03], { key: 'cloth', tint: c.banner });
    return { top, sign: [0, 3.3, r.cz + r.d / 2 + 0.4] };
  },
  /** The town gate: two pylons, a sign gantry and a barrier. */
  gate(c) {
    const { m } = c;
    for (const x of [-2.2, 2.2]) {
      const r = R(1.0, 1.4, x, 0);
      m.walls(r, 0, 6, 'stoneDark');
      m.flatRoof(r, 6, 'roofSlate', 'stoneDark', 0.2);
      m.band(r, 5.2, 0.12, 'fire', 0.03);
    }
    m.box([0, 5.4, 0], [3.4, 0.8, 0.3], { key: 'cloth', tint: c.banner });
    m.box([0, 5.85, 0], [3.4, 0.1, 0.4], 'timber');
    m.box([-0.3, 1.0, 0.9], [3.0, 0.12, 0.12], { key: 'cloth', tint: '#e8e0d0' });
    m.box([-1.7, 0.6, 0.9], [0.3, 1.2, 0.3], 'timber');
    m.box([0, 0.02, 0], [3.4, 0.04, 2.4], 'asphalt');
    return { top: 6.4 };
  },
};

/** Homes by value tier: cardboard shelter, camper van, bungalow, terrace, villa, apartments, skyscraper. */
function home(c: Ctx): Made {
  const { m, W, D } = c;
  switch (c.tier) {
    case 0: {
      m.box([-0.4, 0.45, 0], [1.6, 0.9, 1.0], { key: 'planks', tint: '#b89870' });
      m.box([0.9, 0.08, 0.3], [1.8, 0.14, 0.7], { key: 'cloth', tint: '#3a5a8a' });
      m.box([1.6, 0.4, -0.5], [0.5, 0.5, 0.7], 'iron');
      return { top: 0.9 };
    }
    case 1: {
      m.box([0, 1.25, 0], [2.0, 1.9, 4.2], { key: 'plaster', tint: '#f2efe8' });
      m.box([0, 1.0, 0], [2.02, 0.2, 4.22], { key: 'cloth', tint: c.banner });
      m.box([0, 1.6, 2.11], [1.7, 0.7, 0.04], 'glass');
      for (const sx of [-1.01, 1.01]) m.box([sx, 1.65, -0.5], [0.04, 0.6, 1.6], 'glass');
      for (const sx of [-0.9, 0.9]) for (const z of [-1.4, 1.4]) m.box([sx, 0.35, z], [0.28, 0.7, 0.7], 'iron');
      m.w.slab([[1.0, 2.0, 1.0], [1.0, 2.0, -1.2], [2.6, 1.7, -1.2], [2.6, 1.7, 1.0]], 0.03, { key: 'cloth', tint: '#d4a020' });
      return { top: 2.3 };
    }
    case 2: {
      const r = R(W * 0.8, D * 0.62);
      m.plinth(r, 0.25, 'stoneDark');
      m.storey(r, 0.25, { h: 2.7, wall: { key: 'plaster', tint: c.wash }, door: { w: 1.0, h: 2.1 } });
      const top = m.gable(r, 2.95, 1.5, 0.45, 'roofTiles', { key: 'plaster', tint: c.wash });
      return { top };
    }
    case 3: {
      const r = R(W * 0.85, D * 0.62);
      m.plinth(r, 0.25, 'stoneDark');
      const y = floors(c, { ...r }, 0.25, 2, { wall: 'stone', door: true });
      const top = m.gable(r, y, 2.0, 0.4, 'roofTiles', 'stone');
      m.box([r.w / 2 - 0.6, top - 0.6, 0], [0.5, 1.6, 0.5], 'stone');
      return { top };
    }
    case 4: {
      // a white villa: two offset boxes, glass walls, a pool
      const a = R(W * 0.75, D * 0.45, -W * 0.1, -D * 0.2);
      m.walls(a, 0, FLOOR, { key: 'plaster', tint: '#f6f4ef' });
      m.glassWall(a, 'front', 0.1, 2.7, 4, 1);
      m.flatRoof(a, FLOOR, 'roofSlate', { key: 'plaster', tint: '#f6f4ef' }, 0.25);
      const b = R(W * 0.6, D * 0.42, W * 0.12, -D * 0.05);
      m.walls(b, FLOOR + 0.25, FLOOR, 'planks');
      m.glassWall(b, 'front', FLOOR + 0.4, 2.6, 3, 1);
      const top = m.flatRoof(b, FLOOR * 2 + 0.25, 'roofSlate', 'planks', 0.25);
      m.box([-W * 0.15, 0.05, D * 0.3], [W * 0.55, 0.1, D * 0.28], 'cobbles');
      m.box([-W * 0.15, 0.08, D * 0.3], [W * 0.45, 0.06, D * 0.2], { key: 'plaster', tint: '#4aa8d8' });
      return { top };
    }
    case 5: {
      const r = R(W * 0.8, D * 0.7);
      const y = floors(c, r, 0, 7, { wall: 'stone', door: true });
      for (let i = 1; i < 7; i++) for (const s of [-r.w * 0.25, r.w * 0.25]) {
        m.box([s, i * FLOOR + 0.05, r.d / 2 + 0.45], [1.2, 0.12, 0.9], 'stoneDark');
        m.box([s, i * FLOOR + 0.55, r.d / 2 + 0.88], [1.2, 0.9, 0.04], 'glass');
      }
      const top = m.flatRoof(r, y, 'roofSlate', 'stoneDark', 0.8);
      rooftop(c, r, y);
      return { top };
    }
    default: {
      // a glass skyscraper with a setback crown, a helipad and a spire
      const r = R(W * 0.85, D * 0.85);
      const h = FLOOR * 14;
      m.walls(r, 0, h, 'stoneDark');
      for (const f of ['front', 'right', 'back', 'left'] as FaceId[]) m.glassWall(r, f, 0.3, h - 0.6, 5, 14);
      m.flatRoof(r, h, 'roofSlate', 'timber', 0.3);
      const crown = R(r.w * 0.6, r.d * 0.6);
      m.walls(crown, h + 0.3, 3, 'stoneDark');
      for (const f of ['front', 'right', 'back', 'left'] as FaceId[]) m.glassWall(crown, f, h + 0.4, 2.7, 3, 1);
      m.w.cylinder(0, 0, h + 3.3, crown.w * 0.48, 0.2, 18, 'stoneDark', { top: 'asphalt' });
      m.box([0, h + 3.55, 0], [0.9, 0.04, 0.15], { key: 'plaster', tint: '#ffffff' });
      const tip = m.mast(crown.w / 2 - 0.1, crown.d / 2 - 0.1, h + 3.3, 3.5);
      return { top: tip };
    }
  }
}

export const MODERN: RecipeSet = { recipes: RECIPES, home };
