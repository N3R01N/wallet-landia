/**
 * Medieval buildings from a small grammar (docs/RESEARCH_REALISM.md, Phase 4):
 * a stone plinth, storeys of plaster, stone or planks, half-timbering, framed
 * windows with sills and shutters, plank doors, roofs with thickness and
 * overhang, chimneys. Each kind is a short recipe over those parts.
 *
 * Everything is built in metres around the origin (+z faces the street) and
 * written by one MeshWriter, so a building is one mesh per material. The
 * Mason (the parts) is shared by the other styles (modern.ts, scifi.ts);
 * builder.ts turns a recipe's result into a placed building.
 */

import * as THREE from 'three';
import { makeRng } from '../../../util/rng.js';
import { MeshWriter, type Mat, type V3 } from './meshWriter.js';

export const METRES_PER_TILE = 1.8;

export type FaceId = 'front' | 'right' | 'back' | 'left';
export const FACES: FaceId[] = ['front', 'right', 'back', 'left'];
export const FACE_ROT: Record<FaceId, number> = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };

/** A rectangle on the ground, centred at (cx, cz). */
export interface Rect {
  cx: number;
  cz: number;
  w: number;
  d: number;
}

/** A point on a face of a rectangle: s along the wall (from its centre), y up, o out of the wall. */
export function facePoint(r: Rect, f: FaceId, s: number, y: number, o: number): V3 {
  switch (f) {
    case 'front':
      return [r.cx + s, y, r.cz + r.d / 2 + o];
    case 'right':
      return [r.cx + r.w / 2 + o, y, r.cz - s];
    case 'back':
      return [r.cx - s, y, r.cz - r.d / 2 - o];
    case 'left':
      return [r.cx - r.w / 2 - o, y, r.cz + s];
  }
}
export const faceLen = (r: Rect, f: FaceId): number => (f === 'front' || f === 'back' ? r.w : r.d);

export interface StoreyOpts {
  h: number;
  wall: Mat;
  /** Exposed timber frame over the wall. */
  timber?: boolean;
  /** Faces that get windows (default all). */
  windows?: FaceId[];
  shutters?: boolean;
  /** Window size (default 0.7 × 0.9 m). */
  win?: [number, number];
  /** A door in the middle of the front, on this storey. */
  door?: { w: number; h: number };
  /** Stone quoins at the corners. */
  quoins?: boolean;
}

/** The grammar's parts, writing into one MeshWriter. */
export class Mason {
  readonly w = new MeshWriter();
  readonly rng: () => number;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  box(c: V3, size: V3, mat: Mat, rotY = 0, rotZ = 0): void {
    this.w.box(c, size, mat, { rotY, rotZ });
  }

  /** A box set onto a face: centred at (s, y) on the wall, `depth` out of it. */
  onFace(r: Rect, f: FaceId, s: number, y: number, size: [number, number], depth: number, mat: Mat, out = 0, tilt = 0): void {
    this.w.box(facePoint(r, f, s, y, out + depth / 2), [size[0], size[1], depth], mat, { rotY: FACE_ROT[f], rotZ: tilt });
  }

  /** A flat panel on a face (glass, a door leaf), facing out. */
  panel(r: Rect, f: FaceId, s0: number, s1: number, y0: number, y1: number, o: number, mat: Mat): void {
    this.w.quad(facePoint(r, f, s0, y0, o), facePoint(r, f, s1, y0, o), facePoint(r, f, s1, y1, o), facePoint(r, f, s0, y1, o), mat);
  }

  /** Four walls (no top or bottom). */
  walls(r: Rect, y0: number, h: number, mat: Mat): void {
    this.w.box([r.cx, y0 + h / 2, r.cz], [r.w, h, r.d], mat, { skip: ['top', 'bottom'] });
  }

  plinth(r: Rect, h: number, mat: Mat = 'stone'): void {
    this.w.box([r.cx, h / 2, r.cz], [r.w + 0.16, h, r.d + 0.16], mat, { skip: ['bottom'] });
  }

  window(r: Rect, f: FaceId, s: number, y: number, ww: number, wh: number, frame: Mat, shutters: boolean): void {
    const t = 0.09;
    this.panel(r, f, s - ww / 2, s + ww / 2, y, y + wh, 0.02, 'glass');
    // frame, a mullion and a transom
    this.onFace(r, f, s, y + wh + t / 2, [ww + 2 * t, t], 0.08, frame);
    this.onFace(r, f, s - ww / 2 - t / 2, y + wh / 2, [t, wh], 0.08, frame);
    this.onFace(r, f, s + ww / 2 + t / 2, y + wh / 2, [t, wh], 0.08, frame);
    this.onFace(r, f, s, y + wh / 2, [0.04, wh], 0.05, frame);
    this.onFace(r, f, s, y + wh * 0.6, [ww, 0.04], 0.05, frame);
    // sill
    this.onFace(r, f, s, y - 0.05, [ww + 0.3, 0.1], 0.16, 'stone');
    if (shutters) {
      const open = this.rng() < 0.75;
      for (const side of [-1, 1]) {
        if (open) this.onFace(r, f, s + side * (ww / 2 + t + ww * 0.27), y + wh / 2, [ww * 0.5, wh + 0.05], 0.04, 'planks', 0.01);
      }
      if (!open) this.panel(r, f, s - ww / 2, s + ww / 2, y, y + wh, 0.05, 'planks');
    }
  }

  door(r: Rect, f: FaceId, s: number, y: number, dw: number, dh: number, frame: Mat): void {
    this.onFace(r, f, s, y + dh / 2, [dw, dh], 0.05, 'planks');
    this.onFace(r, f, s, y + dh + 0.08, [dw + 0.36, 0.16], 0.12, frame);
    for (const side of [-1, 1]) this.onFace(r, f, s + side * (dw / 2 + 0.09), y + dh / 2, [0.18, dh], 0.1, frame);
    // iron straps and a ring
    for (const k of [0.25, 0.75]) this.onFace(r, f, s - dw * 0.1, y + dh * k, [dw * 0.7, 0.05], 0.06, 'iron');
    this.onFace(r, f, s + dw * 0.3, y + dh * 0.5, [0.08, 0.08], 0.08, 'iron');
    // a step
    this.box(facePoint(r, f, s, 0.06, 0.25), [dw + 0.5, 0.12, 0.5], 'stone', FACE_ROT[f]);
  }

  /**
   * One storey: walls, bays of windows, and (optionally) a timber frame laid
   * out on the same bays so posts never cross a window.
   */
  storey(r: Rect, y0: number, o: StoreyOpts): void {
    const { h } = o;
    this.walls(r, y0, h, o.wall);
    const [ww, wh] = o.win ?? [0.7, 0.9];
    const sill = y0 + Math.min(0.95, h - wh - 0.35);
    const beam = 0.14;
    for (const f of FACES) {
      const L = faceLen(r, f);
      const bays = Math.max(1, Math.round(L / 1.7));
      const bw = L / bays;
      const withWindows = (o.windows ?? FACES).includes(f);
      for (let i = 0; i < bays; i++) {
        const s = -L / 2 + bw * (i + 0.5);
        const isDoor = o.door !== undefined && f === 'front' && i === Math.floor(bays / 2);
        if (isDoor) this.door(r, f, s, y0, o.door!.w, o.door!.h, o.timber ? 'timber' : 'stone');
        else if (withWindows && bw > ww + 0.4) this.window(r, f, s, sill, ww, wh, 'timber', o.shutters ?? false);
        if (o.timber) {
          // a brace in the panel under the sill
          if (!isDoor && sill - y0 > 0.5) {
            const run = bw / 2 - 0.1;
            const rise = sill - y0 - 0.2;
            const len = Math.hypot(run, rise);
            const ang = Math.atan2(rise, run) * (i % 2 === 0 ? 1 : -1);
            this.onFace(r, f, s, y0 + 0.1 + rise / 2, [len, beam * 0.8], 0.05, 'timber', 0, ang);
          }
          if (i > 0) this.onFace(r, f, -L / 2 + bw * i, y0 + h / 2, [beam, h], 0.05, 'timber');
        }
      }
      if (o.timber) {
        this.onFace(r, f, 0, y0 + beam / 2, [L, beam], 0.06, 'timber');
        this.onFace(r, f, 0, y0 + h - beam / 2, [L, beam], 0.06, 'timber');
        this.onFace(r, f, 0, sill - 0.12, [L, beam * 0.7], 0.05, 'timber');
      }
    }
    if (o.timber) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) this.box([r.cx + (sx * r.w) / 2, y0 + h / 2, r.cz + (sz * r.d) / 2], [0.2, h, 0.2], 'timber');
    if (o.quoins) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        for (let y = y0; y < y0 + h - 0.2; y += 0.5) {
          const long = Math.round((y - y0) / 0.5) % 2 === 0;
          this.box([r.cx + (sx * r.w) / 2, y + 0.22, r.cz + (sz * r.d) / 2], [long ? 0.5 : 0.3, 0.42, long ? 0.3 : 0.5], 'stoneDark');
        }
      }
    }
  }

  /** A gable roof over `r`, ridge along x (rot 0) or z (rot π/2). Gable ends in `gableMat`. */
  gable(r: Rect, y: number, rise: number, over: number, mat: Mat, gableMat: Mat, alongZ = false): number {
    const L = alongZ ? r.d : r.w;
    const D = alongZ ? r.w : r.d;
    const T = (lx: number, ly: number, lz: number): V3 => (alongZ ? [r.cx + lz, ly, r.cz - lx] : [r.cx + lx, ly, r.cz + lz]);
    const drop = (rise * over) / (D / 2);
    const ye = y - drop;
    const yr = y + rise;
    const hl = L / 2 + over;
    const hd = D / 2 + over;
    this.w.slab([T(-hl, ye, hd), T(hl, ye, hd), T(hl, yr, 0), T(-hl, yr, 0)], 0.14, mat, 'timber');
    this.w.slab([T(hl, ye, -hd), T(-hl, ye, -hd), T(-hl, yr, 0), T(hl, yr, 0)], 0.14, mat, 'timber');
    // ridge cap
    this.w.box(T(0, yr + 0.12, 0), alongZ ? [0.22, 0.12, 2 * hl] : [2 * hl, 0.12, 0.22], mat);
    // gable ends
    this.w.poly([T(-L / 2, y, -D / 2), T(-L / 2, y, D / 2), T(-L / 2, yr, 0)], gableMat);
    this.w.poly([T(L / 2, y, D / 2), T(L / 2, y, -D / 2), T(L / 2, yr, 0)], gableMat);
    return yr + 0.2;
  }

  /** A hipped roof (a pyramid when square). */
  hip(r: Rect, y: number, rise: number, over: number, mat: Mat): number {
    const alongX = r.w >= r.d;
    const L = alongX ? r.w : r.d;
    const D = alongX ? r.d : r.w;
    const T = (lx: number, ly: number, lz: number): V3 => (alongX ? [r.cx + lx, ly, r.cz + lz] : [r.cx + lz, ly, r.cz - lx]);
    const drop = (rise * over) / (D / 2);
    const ye = y - drop;
    const yr = y + rise;
    const hl = L / 2 + over;
    const hd = D / 2 + over;
    const rl = Math.max(0, L / 2 - D / 2);
    const A = T(-hl, ye, hd);
    const B = T(hl, ye, hd);
    const C = T(hl, ye, -hd);
    const Dd = T(-hl, ye, -hd);
    const R1 = T(-rl, yr, 0);
    const R2 = T(rl, yr, 0);
    if (rl > 0.01) {
      this.w.slab([A, B, R2, R1], 0.12, mat, 'timber');
      this.w.slab([C, Dd, R1, R2], 0.12, mat, 'timber');
    } else {
      this.w.slab([A, B, R2], 0.12, mat, 'timber');
      this.w.slab([C, Dd, R1], 0.12, mat, 'timber');
    }
    this.w.slab([B, C, R2], 0.12, mat, 'timber');
    this.w.slab([Dd, A, R1], 0.12, mat, 'timber');
    return yr + 0.12;
  }

  /** A flat roof with a parapet of merlons. */
  crenels(r: Rect, y: number, mat: Mat = 'stone'): number {
    this.w.box([r.cx, y + 0.06, r.cz], [r.w + 0.3, 0.12, r.d + 0.3], 'stoneDark');
    for (const f of FACES) {
      const L = faceLen(r, f) + 0.3;
      const n = Math.max(2, Math.round(L / 0.8));
      for (let i = 0; i < n; i++) {
        const s = -L / 2 + (L / n) * (i + 0.5);
        this.onFace({ ...r, w: r.w + 0.3, d: r.d + 0.3 }, f, s, y + 0.12 + 0.35, [(L / n) * 0.55, 0.7], 0.3, mat, -0.3);
      }
    }
    return y + 0.82;
  }

  chimney(x: number, z: number, y0: number, h: number, fire = false): void {
    this.box([x, y0 + h / 2, z], [0.55, h, 0.55], 'stone');
    this.box([x, y0 + h + 0.06, z], [0.7, 0.12, 0.7], 'stoneDark');
    // the flue: soot by day, a glow at night when the forge burns
    this.box([x, y0 + h + 0.125, z], [0.34, 0.02, 0.34], fire ? 'fire' : 'iron');
  }

  /** A round tower: walls, slit windows, a cone roof. Returns the roof top. */
  roundTower(cx: number, cz: number, rad: number, h: number, roofMat: Mat, wall: Mat = 'stone', roofRise = rad * 2.2): number {
    const segs = 14;
    this.w.cylinder(cx, cz, 0, rad, h, segs, wall);
    this.w.cylinder(cx, cz, 0, rad + 0.12, 0.6, segs, 'stoneDark');
    this.w.cylinder(cx, cz, h - 0.25, rad + 0.1, 0.25, segs, 'stoneDark', { top: 'timber' });
    for (let y = 1.4; y < h - 1; y += 2.2) {
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + ((k - 1) * Math.PI) / 3 + (y % 2) * 0.4;
        const px = cx + Math.cos(a) * (rad + 0.02);
        const pz = cz - Math.sin(a) * (rad + 0.02);
        this.box([px, y, pz], [0.28, 0.75, 0.06], 'glass', a - Math.PI / 2 + Math.PI);
        this.box([px, y + 0.45, pz], [0.4, 0.12, 0.1], 'stoneDark', a - Math.PI / 2 + Math.PI);
      }
    }
    this.w.cone(cx, cz, h - 0.05, rad + 0.4, roofRise, segs, roofMat);
    this.w.cylinder(cx, cz, h - 0.05 + roofRise, 0.03, 0.6, 4, 'iron');
    return h + roofRise + 0.6;
  }

  // --- parts for the modern and sci-fi styles ---------------------------------------

  /** A flat roof slab with a parapet around it. Returns the parapet's top. */
  flatRoof(r: Rect, y: number, mat: Mat = 'roofSlate', edge: Mat = 'stoneDark', parapet = 0.55): number {
    this.w.box([r.cx, y + 0.1, r.cz], [r.w, 0.2, r.d], mat, { skip: ['bottom'] });
    if (parapet > 0) {
      const t = 0.18;
      for (const f of FACES) {
        const L = faceLen(r, f);
        this.onFace(r, f, 0, y + parapet / 2, [L + t * 2, parapet], t, edge, -t);
      }
    }
    return y + parapet;
  }

  /** A glass curtain wall on a face: one glazed panel and a grid of mullions. */
  glassWall(r: Rect, f: FaceId, y0: number, h: number, cols: number, rows: number, frame: Mat = 'timber', s0?: number, s1?: number): void {
    const L = faceLen(r, f);
    const a = s0 ?? -L / 2;
    const b = s1 ?? L / 2;
    this.panel(r, f, a, b, y0, y0 + h, 0.03, 'glass');
    for (let i = 0; i <= cols; i++) this.onFace(r, f, a + ((b - a) * i) / cols, y0 + h / 2, [0.07, h], 0.08, frame);
    for (let j = 0; j <= rows; j++) this.onFace(r, f, (a + b) / 2, y0 + (h * j) / rows, [b - a + 0.07, 0.07], 0.09, frame);
  }

  /** A sloping canvas awning over a shopfront. */
  awning(r: Rect, f: FaceId, s: number, y: number, w: number, depth: number, tint: string): void {
    const a = facePoint(r, f, s - w / 2, y, 0.02);
    const b = facePoint(r, f, s + w / 2, y, 0.02);
    const c = facePoint(r, f, s + w / 2, y - 0.45, depth);
    const d = facePoint(r, f, s - w / 2, y - 0.45, depth);
    this.w.slab([d, c, b, a], 0.03, { key: 'cloth', tint }, { key: 'cloth', tint });
  }

  /** A thin band round a rectangle at height y (glowing strips use the 'fire' role). */
  band(r: Rect, y: number, h: number, mat: Mat, out = 0.04): void {
    for (const f of FACES) this.onFace(r, f, 0, y, [faceLen(r, f) + out * 2, h], out, mat);
  }

  /** A mast with a light on top. */
  mast(x: number, z: number, y0: number, h: number, light: Mat = 'fire'): number {
    this.box([x, y0 + h / 2, z], [0.08, h, 0.08], 'iron');
    this.box([x, y0 + h + 0.08, z], [0.16, 0.16, 0.16], light);
    return y0 + h + 0.16;
  }

  pole(x: number, z: number, h: number, flag?: string): void {
    this.box([x, h / 2, z], [0.08, h, 0.08], 'timber');
    if (flag) this.box([x + 0.35, h - 0.35, z], [0.6, 0.45, 0.03], { key: 'cloth', tint: flag });
  }
}

// --- recipes -------------------------------------------------------------------

export interface Ctx {
  m: Mason;
  /** Roof tint from the protocol's brand colour (softened, scaled by the theme). */
  roof: string;
  /** Roof tint from the guild's banner colour. */
  bannerRoof: string;
  banner: string;
  tier: number;
  /** The plaster wash for this building. */
  wash: string;
  /** Usable footprint in metres. */
  W: number;
  D: number;
}

export interface Made {
  top: number;
  /** Where the sign hangs, in metres. */
  sign?: V3;
  bell?: THREE.Object3D;
}

/**
 * A soft version of a brand colour, so tinted roof tiles still read as tiles;
 * `strength` (the theme's brandRoofs) fades it towards no tint at all.
 */
export function roofTint(hex: string, strength: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const soft = new THREE.Color().setHSL(hsl.h, Math.min(0.32, hsl.s * 0.6), THREE.MathUtils.clamp(hsl.l, 0.5, 0.72));
  return `#${new THREE.Color('#ffffff').lerp(soft, strength).getHexString()}`;
}

export const WASHES = ['#f4ead6', '#efe2c4', '#e9dccb', '#f2e6d0', '#e6d6b8'];

/** A half-timbered house of `n` storeys: the common townhouse/hall body. */
function timberHouse(c: Ctx, o: { w: number; d: number; storeys: number; jetty?: number; roof: Mat; rise?: number; alongZ?: boolean; door?: boolean; stoneGround?: boolean }): Made {
  const { m } = c;
  let r: Rect = { cx: 0, cz: 0, w: o.w, d: o.d };
  m.plinth(r, 0.35);
  let y = 0.35;
  const sh = 2.6;
  for (let i = 0; i < o.storeys; i++) {
    const stone = i === 0 && o.stoneGround;
    const opts: StoreyOpts = { h: sh, wall: stone ? 'stone' : { key: 'plaster', tint: c.wash }, timber: !stone, shutters: i === 0 };
    if (i === 0 && o.door !== false) opts.door = { w: 1.05, h: 2.0 };
    m.storey(r, y, opts);
    y += sh;
    if (o.jetty && i < o.storeys - 1) {
      // the upper floor oversails the street on joists
      const jr: Rect = { ...r, d: r.d + o.jetty * 2 };
      for (let k = -r.w / 2 + 0.2; k <= r.w / 2 - 0.1; k += 0.45) m.box([k, y - 0.08, 0], [0.12, 0.16, jr.d], 'timber');
      m.box([0, y + 0.03, 0], [jr.w + 0.05, 0.08, jr.d], 'timber');
      r = jr;
      y += 0.08;
    }
  }
  const top = m.gable(r, y, o.rise ?? r.d * 0.55, 0.45, o.roof, { key: 'plaster', tint: c.wash }, o.alongZ ?? false);
  return { top, sign: [o.w / 2 - 0.2, 2.9, o.d / 2 + 0.8] };
}

function stoneHall(c: Ctx, o: { w: number; d: number; storeys: number; roof: 'hip' | 'gable' | 'crenel'; roofMat: Mat; wall?: Mat; door?: { w: number; h: number } }): { top: number; y: number; r: Rect } {
  const { m } = c;
  const r: Rect = { cx: 0, cz: 0, w: o.w, d: o.d };
  m.plinth(r, 0.45, 'stoneDark');
  let y = 0.45;
  for (let i = 0; i < o.storeys; i++) {
    const opts: StoreyOpts = { h: 3, wall: o.wall ?? 'stone', shutters: false, quoins: true, win: [0.6, 1.2] };
    if (i === 0) opts.door = o.door ?? { w: 1.3, h: 2.3 };
    m.storey(r, y, opts);
    y += 3;
    // a string course between floors
    m.box([0, y, 0], [r.w + 0.14, 0.14, r.d + 0.14], 'stoneDark');
  }
  const top = o.roof === 'hip' ? m.hip(r, y, Math.min(r.w, r.d) * 0.45, 0.4, o.roofMat) : o.roof === 'gable' ? m.gable(r, y, r.d * 0.5, 0.35, o.roofMat, o.wall ?? 'stone') : m.crenels(r, y);
  return { top, y, r };
}

const RECIPES: Record<string, (c: Ctx) => Made> = {
  /** A market hall: an open arcade on posts, a timbered room above. */
  bazaar(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: 0, cz: 0, w: W, d: D * 0.8 };
    m.box([0, 0.08, 0], [W + 0.4, 0.16, r.d + 0.4], 'cobbles');
    const posts = 4;
    for (let i = 0; i < posts; i++) {
      const x = -W / 2 + 0.15 + (i * (W - 0.3)) / (posts - 1);
      for (const z of [-r.d / 2 + 0.15, r.d / 2 - 0.15]) {
        m.box([x, 0.3, z], [0.45, 0.3, 0.45], 'stone');
        m.box([x, 1.55, z], [0.24, 2.6, 0.24], 'timber');
        m.box([x, 2.75, z + (z > 0 ? -0.25 : 0.25)], [0.14, 0.14, 0.7], 'timber', 0, 0);
      }
    }
    m.box([0, 2.95, 0], [W + 0.2, 0.2, r.d + 0.2], 'timber');
    m.storey(r, 3.05, { h: 2.4, wall: { key: 'plaster', tint: c.wash }, timber: true, shutters: true });
    const top = m.gable(r, 5.45, r.d * 0.6, 0.5, { key: 'roofTiles', tint: c.roof }, { key: 'plaster', tint: c.wash });
    // stalls under the arcade
    for (const [x, col] of [[-W * 0.25, '#b04040'], [W * 0.25, '#d8b040']] as const) {
      m.box([x, 0.55, 0.2], [1.1, 0.8, 0.6], 'planks');
      m.box([x, 0.98, 0.2], [1.0, 0.06, 0.55], { key: 'cloth', tint: col });
    }
    return { top, sign: [W / 2 - 0.3, 2.4, r.d / 2 + 0.5] };
  },
  /** A narrow merchant's townhouse with the gable to the street. */
  broker(c) {
    return timberHouse(c, { w: c.W * 0.72, d: c.D * 0.85, storeys: 3, jetty: 0.25, roof: { key: 'roofTiles', tint: c.roof }, alongZ: true, rise: 2.6 });
  },
  /** A stone counting house behind a columned portico. */
  bank(c) {
    const { m, W, D } = c;
    const body = stoneHall(c, { w: W, d: D * 0.72, storeys: 2, roof: 'hip', roofMat: { key: 'roofSlate', tint: c.roof } });
    const fz = body.r.d / 2;
    m.box([0, 0.12, fz + 0.65], [W + 0.2, 0.24, 1.3], 'stoneDark');
    for (let i = 0; i < 4; i++) {
      const x = -W / 2 + 0.4 + (i * (W - 0.8)) / 3;
      m.w.cylinder(x, fz + 1.0, 0.24, 0.2, 2.9, 10, 'stone');
      m.box([x, 3.2, fz + 1.0], [0.5, 0.16, 0.5], 'stoneDark');
    }
    m.box([0, 3.38, fz + 0.6], [W + 0.3, 0.2, 1.2], 'stone');
    // pediment
    const y = 3.48;
    const half = W / 2 + 0.15;
    m.w.slab([[-half, y, fz + 1.2], [half, y, fz + 1.2], [0, y + 1.1, fz + 1.2]], 0.15, 'stone', 'stone');
    m.w.slab([[half, y, fz + 1.2], [half, y, fz], [0, y + 1.1, fz], [0, y + 1.1, fz + 1.2]], 0.1, { key: 'roofSlate', tint: c.roof }, 'timber');
    m.w.slab([[-half, y, fz], [-half, y, fz + 1.2], [0, y + 1.1, fz + 1.2], [0, y + 1.1, fz]], 0.1, { key: 'roofSlate', tint: c.roof }, 'timber');
    m.box([0, y + 0.45, fz + 1.36], [0.5, 0.5, 0.05], 'gold');
    return { top: body.top, sign: [W / 2 - 0.4, 2.2, fz + 1.5] };
  },
  /** A chapel with a spire at the front. */
  temple(c) {
    const { m, W, D } = c;
    const nave: Rect = { cx: 0, cz: -0.5, w: W * 0.65, d: D * 0.75 };
    m.plinth(nave, 0.4);
    m.storey(nave, 0.4, { h: 3.6, wall: 'stone', quoins: true, win: [0.5, 1.6], windows: ['left', 'right', 'back'] });
    m.gable(nave, 4.0, 2.4, 0.3, { key: 'roofSlate', tint: c.roof }, 'stone', true);
    const tw: Rect = { cx: 0, cz: nave.cz + nave.d / 2 + 0.6, w: 1.7, d: 1.7 };
    m.plinth(tw, 0.4);
    m.storey(tw, 0.4, { h: 6.2, wall: 'stone', quoins: true, door: { w: 1.0, h: 2.2 }, win: [0.4, 1.0], windows: ['left', 'right'] });
    m.box([0, 6.65, tw.cz], [tw.w + 0.2, 0.2, tw.d + 0.2], 'stoneDark');
    // belfry openings
    for (const f of FACES) m.panel(tw, f, -0.35, 0.35, 5.2, 6.2, 0.02, 'glass');
    const spireH = 4.2;
    m.hip(tw, 6.75, spireH, 0.15, { key: 'roofSlate', tint: c.roof });
    m.box([0, 6.75 + spireH + 0.5, tw.cz], [0.06, 0.9, 0.06], 'gold');
    m.box([0, 6.75 + spireH + 0.65, tw.cz], [0.5, 0.06, 0.06], 'gold');
    return { top: 6.75 + spireH + 1, sign: [W / 2 - 0.3, 2.2, tw.cz + 1.4] };
  },
  /** A crenellated stone barracks with banners. */
  barracks(c) {
    const { m, W, D } = c;
    const body = stoneHall(c, { w: W, d: D * 0.8, storeys: 2, roof: 'crenel', roofMat: 'stone', wall: 'stoneDark' });
    for (const x of [-W / 2 + 0.6, W / 2 - 0.6]) m.box([x, 4.5, body.r.d / 2 + 0.03], [0.6, 1.6, 0.03], { key: 'cloth', tint: c.banner });
    m.pole(W / 2 - 0.4, -body.r.d / 2 + 0.4, body.top + 2.2, c.banner);
    return { top: body.top + 2, sign: [0, 2.9, body.r.d / 2 + 0.3] };
  },
  /** A round alchemist's tower with a green-glassed lantern. */
  alchemist(c) {
    const { m, W } = c;
    const top = m.roundTower(0, -0.3, W * 0.36, 8.5, { key: 'roofTiles', tint: c.roof });
    const r: Rect = { cx: 0, cz: 0.9, w: 1.6, d: 1.4 };
    m.storey(r, 0, { h: 2.6, wall: { key: 'plaster', tint: c.wash }, timber: true, door: { w: 0.9, h: 2.0 }, windows: [] });
    m.gable(r, 2.6, 0.9, 0.25, { key: 'roofTiles', tint: c.roof }, { key: 'plaster', tint: c.wash }, true);
    return { top, sign: [1.2, 2.4, 2.0] };
  },
  /** A big auction hall with a wide door. */
  auction(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: 0, cz: 0, w: W, d: D * 0.8 };
    m.plinth(r, 0.4);
    m.storey(r, 0.4, { h: 3.4, wall: 'stone', quoins: true, door: { w: 1.6, h: 2.6 }, win: [0.7, 1.4] });
    m.storey(r, 3.8, { h: 2.2, wall: { key: 'plaster', tint: c.wash }, timber: true, win: [0.6, 0.7] });
    const top = m.gable(r, 6.0, r.d * 0.5, 0.45, { key: 'roofTiles', tint: c.roof }, { key: 'plaster', tint: c.wash });
    // a dormer with a hoist beam
    m.box([0, 6.6, r.d / 2 + 0.3], [0.15, 0.15, 1.0], 'timber');
    return { top, sign: [W / 2 - 0.4, 3.0, r.d / 2 + 0.5] };
  },
  /** A timber warehouse at the water, with a pier. */
  harbour(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: -0.4, cz: -0.2, w: W * 0.75, d: D * 0.7 };
    m.plinth(r, 0.3);
    m.storey(r, 0.3, { h: 3.0, wall: 'planks', door: { w: 1.4, h: 2.4 }, win: [0.5, 0.6], shutters: true });
    const top = m.gable(r, 3.3, r.d * 0.55, 0.4, { key: 'roofTiles', tint: c.roof }, 'planks');
    // pier on posts
    const px = W / 2 - 0.3;
    m.box([px, 0.35, 0.4], [1.2, 0.1, D * 0.95], 'planks');
    for (const z of [-D / 2 + 0.3, 0, D / 2 - 0.2]) for (const sx of [-0.5, 0.5]) m.box([px + sx, 0.15, z], [0.14, 0.9, 0.14], 'timber');
    m.box([px, 0.8, D / 2 - 0.2], [0.3, 0.8, 0.3], 'planks');
    m.w.cylinder(px + 0.4, -0.4, 0.4, 0.22, 0.5, 8, 'planks');
    return { top, sign: [r.cx + r.w / 2 - 0.2, 2.6, r.d / 2 + 0.3] };
  },
  /** The town hall: stone below, timber above, a hipped roof and a little turret. */
  council(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: 0, cz: 0, w: W, d: D * 0.75 };
    m.plinth(r, 0.45);
    m.storey(r, 0.45, { h: 3.0, wall: 'stone', quoins: true, door: { w: 1.3, h: 2.4 }, win: [0.6, 1.2] });
    m.storey(r, 3.45, { h: 2.6, wall: { key: 'plaster', tint: c.wash }, timber: true, shutters: true });
    m.hip(r, 6.05, 2.0, 0.45, { key: 'roofSlate', tint: c.roof });
    const t: Rect = { cx: 0, cz: 0, w: 0.9, d: 0.9 };
    m.walls({ ...t }, 7.6, 1.2, 'timber');
    for (const f of FACES) m.panel(t, f, -0.25, 0.25, 7.9, 8.6, 0.02, 'glass');
    m.hip(t, 8.8, 1.4, 0.15, { key: 'roofSlate', tint: c.roof });
    m.pole(0, 0, 11.2, c.banner);
    return { top: 11.2, sign: [W / 2 - 0.4, 2.8, r.d / 2 + 0.3] };
  },
  /** A small half-timbered office. */
  names(c) {
    return timberHouse(c, { w: c.W * 0.8, d: c.D * 0.65, storeys: 2, roof: { key: 'roofTiles', tint: c.roof } });
  },
  /** A plank warehouse with crates. */
  packing(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: 0, cz: -0.3, w: W * 0.9, d: D * 0.65 };
    m.plinth(r, 0.3);
    m.storey(r, 0.3, { h: 3.2, wall: 'planks', door: { w: 1.6, h: 2.5 }, win: [0.5, 0.5], windows: ['left', 'right'] });
    const top = m.gable(r, 3.5, r.d * 0.45, 0.4, { key: 'roofTiles', tint: c.roof }, 'planks');
    for (const [x, z, s] of [[-W / 2 + 0.4, r.d / 2 + 0.2, 0.6], [-W / 2 + 0.6, r.d / 2 + 0.8, 0.5], [W / 2 - 0.5, r.d / 2 + 0.4, 0.55], [-W / 2 + 0.45, r.d / 2 + 0.25, 0.45]] as const) {
      const y = s === 0.45 ? 0.6 + s / 2 : s / 2;
      m.box([x, y, z], [s, s, s], 'planks', m.rng() * 0.4);
    }
    return { top, sign: [r.w / 2 - 0.3, 2.6, r.cz + r.d / 2 + 0.4] };
  },
  /** A stone smithy with an open front, a big chimney and the fire. */
  forge(c) {
    const { m, W, D } = c;
    const r: Rect = { cx: 0, cz: -0.6, w: W * 0.85, d: D * 0.55 };
    m.plinth(r, 0.3);
    m.storey(r, 0.3, { h: 2.8, wall: 'stone', quoins: true, door: { w: 1.0, h: 2.1 }, win: [0.6, 0.6] });
    const top = m.gable(r, 3.1, 1.6, 0.35, { key: 'roofSlate', tint: c.roof }, 'stone');
    m.chimney(r.w / 2 - 0.5, r.cz - 0.4, 3.0, 2.8, true);
    // the open lean-to over the anvil
    const lz = r.cz + r.d / 2;
    for (const x of [-r.w / 2 + 0.2, r.w / 2 - 0.2]) m.box([x, 1.25, lz + 1.4], [0.18, 2.5, 0.18], 'timber');
    m.w.slab([[-r.w / 2 - 0.2, 2.5, lz + 1.7], [r.w / 2 + 0.2, 2.5, lz + 1.7], [r.w / 2 + 0.2, 3.0, lz], [-r.w / 2 - 0.2, 3.0, lz]], 0.1, { key: 'roofSlate', tint: c.roof }, 'timber');
    m.box([-0.6, 0.45, lz + 0.8], [0.9, 0.9, 0.9], 'stone');
    m.box([-0.6, 0.91, lz + 0.8], [0.5, 0.04, 0.5], 'fire');
    m.box([0.7, 0.35, lz + 0.8], [0.25, 0.7, 0.25], 'timber');
    m.box([0.7, 0.75, lz + 0.8], [0.55, 0.12, 0.22], 'iron');
    return { top: top + 0.6, sign: [r.w / 2 + 0.1, 2.3, lz + 1.6] };
  },
  /** The herald's cart under a canopy. */
  herald(c) {
    const { m } = c;
    m.box([0, 0.85, 0], [2.4, 0.12, 1.3], 'planks');
    for (const sz of [-1, 1]) m.box([0, 1.1, sz * 0.62], [2.4, 0.4, 0.06], 'planks');
    // wheels: spokes as thin boxes rotated round the axle
    for (const sx of [-0.8, 0.8])
      for (const sz of [-0.72, 0.72]) for (let k = 0; k < 4; k++) m.box([sx, 0.45, sz], [0.9, 0.06, 0.05], 'timber', 0, (k * Math.PI) / 4);
    m.box([1.75, 0.6, 0], [1.2, 0.06, 0.06], 'timber');
    for (const [x, z] of [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]] as const) m.box([x, 1.8, z], [0.07, 1.9, 0.07], 'timber');
    m.w.slab([[-1.3, 2.6, 0.75], [1.3, 2.6, 0.75], [1.3, 3.0, 0], [-1.3, 3.0, 0]], 0.04, { key: 'cloth', tint: c.banner }, { key: 'cloth', tint: c.banner });
    m.w.slab([[1.3, 2.6, -0.75], [-1.3, 2.6, -0.75], [-1.3, 3.0, 0], [1.3, 3.0, 0]], 0.04, { key: 'cloth', tint: c.banner }, { key: 'cloth', tint: c.banner });
    m.box([-0.4, 1.3, 0], [0.5, 0.5, 0.5], 'planks');
    m.pole(-1.4, 1.2, 3.4, c.banner);
    return { top: 3.4, sign: [0.6, 1.6, 0.75] };
  },
  /** The mysterious tent. */
  tent(c) {
    const { m, W } = c;
    m.w.cone(0, 0, 0, W * 0.42, 3.4, 10, { key: 'cloth', tint: '#5a3a7a' });
    m.w.cone(0, 0, 2.6, W * 0.22, 1.4, 10, { key: 'cloth', tint: '#c8a040' });
    m.box([0, 4.1, 0], [0.06, 0.8, 0.06], 'gold');
    m.panel({ cx: 0, cz: 0, w: 1, d: W * 0.8 + 0.05 }, 'front', -0.35, 0.35, 0, 1.5, 0, { key: 'cloth', tint: '#20142a' });
    return { top: 4.5, sign: [0.9, 1.4, W * 0.45] };
  },
  /** The Chronicle Tower: a stone bell tower with an open belfry and spire. */
  tower(c) {
    const { m } = c;
    const r: Rect = { cx: 0, cz: 0, w: 2.6, d: 2.6 };
    m.plinth(r, 0.5, 'stoneDark');
    m.storey(r, 0.5, { h: 4, wall: 'stone', quoins: true, door: { w: 1.1, h: 2.4 }, win: [0.4, 1.2] });
    m.storey(r, 4.5, { h: 3.4, wall: 'stone', quoins: true, win: [0.4, 1.0] });
    m.box([0, 7.95, 0], [r.w + 0.3, 0.2, r.d + 0.3], 'stoneDark');
    // open belfry: corner piers and a roof
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.box([(sx * r.w) / 2 - sx * 0.25, 9.15, (sz * r.d) / 2 - sz * 0.25], [0.5, 2.2, 0.5], 'stone');
    m.box([0, 10.35, 0], [r.w + 0.3, 0.3, r.d + 0.3], 'stoneDark');
    m.hip({ ...r }, 10.5, 4.2, 0.25, { key: 'roofSlate', tint: c.roof });
    m.box([0, 15.2, 0], [0.06, 1.2, 0.06], 'gold');
    // a clock face
    m.onFace(r, 'front', 0, 6.2, [1.25, 1.25], 0.08, 'stoneDark');
    m.panel(r, 'front', -0.5, 0.5, 5.7, 6.7, 0.1, { key: 'plaster', tint: '#f0ead8' });
    m.onFace(r, 'front', 0, 6.35, [0.05, 0.32], 0.03, 'iron', 0.1);
    m.onFace(r, 'front', 0.1, 6.2, [0.24, 0.05], 0.03, 'iron', 0.1, 0.5);
    // the bell hangs in the belfry on its own pivot
    const pivot = new THREE.Group();
    pivot.position.set(0, 9.9, 0);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.65, 0.95, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#c89a38', metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }));
    cup.position.y = -0.5;
    cup.castShadow = true;
    pivot.add(cup);
    m.box([0, 10.05, 0], [r.w - 0.3, 0.16, 0.16], 'timber');
    return { top: 15.8, bell: pivot };
  },
  /** The guild hall: a big jettied half-timbered hall in the guild's colours. */
  guildhall(c) {
    const made = timberHouse(c, { w: c.W, d: c.D * 0.7, storeys: 2, jetty: 0.35, roof: { key: 'roofTiles', tint: c.bannerRoof }, stoneGround: true });
    for (const x of [-c.W / 2 + 0.5, c.W / 2 - 0.5]) {
      c.m.box([x, 4.4, c.D * 0.35 + 0.42], [0.7, 1.8, 0.03], { key: 'cloth', tint: c.banner });
      c.m.box([x, 5.35, c.D * 0.35 + 0.45], [0.85, 0.08, 0.08], 'timber');
    }
    c.m.chimney(c.W / 2 - 0.8, -0.6, 5.5, 3.2);
    return { ...made, sign: [0, 3.2, c.D * 0.35 + 0.8] };
  },
  /** The town gate: two towers and a crenellated arch. */
  gate(c) {
    const { m } = c;
    for (const x of [-2.1, 2.1]) {
      const r: Rect = { cx: x, cz: 0, w: 1.5, d: 1.8 };
      m.plinth(r, 0.4, 'stoneDark');
      m.storey(r, 0.4, { h: 4.6, wall: 'stone', quoins: true, win: [0.25, 0.8], windows: ['front', 'back'] });
      m.crenels(r, 5.0);
    }
    const arch: Rect = { cx: 0, cz: 0, w: 2.7, d: 1.6 };
    m.box([0, 4.2, 0], [arch.w, 1.6, arch.d], 'stone');
    m.crenels(arch, 5.0);
    // the portcullis, half raised
    for (let x = -1.1; x <= 1.1; x += 0.36) m.box([x, 3.0, 0.75], [0.06, 1.6, 0.06], 'iron');
    for (let y = 2.4; y < 3.8; y += 0.4) m.box([0, y, 0.75], [2.4, 0.06, 0.06], 'iron');
    m.box([0, 0.02, 0], [2.7, 0.04, 2.4], 'cobbles');
    m.pole(-2.1, 0, 7.2, c.banner);
    m.pole(2.1, 0, 7.2, c.banner);
    return { top: 7.2 };
  },
};

/** Homes by value tier: bedroll, tent, cottage, house, manor, keep, castle. */
function home(c: Ctx): Made {
  const { m, W, D } = c;
  switch (c.tier) {
    case 0: {
      m.box([-0.5, 0.06, 0], [1.9, 0.12, 0.8], { key: 'cloth', tint: '#7a3a2a' });
      m.box([-1.3, 0.12, 0], [0.4, 0.2, 0.75], { key: 'cloth', tint: '#e0d0b0' });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        m.box([1.2 + Math.cos(a) * 0.4, 0.1, 0.5 + Math.sin(a) * 0.4], [0.22, 0.18, 0.18], 'stone', a);
      }
      m.box([1.2, 0.12, 0.5], [0.3, 0.12, 0.3], 'fire');
      for (let k = 0; k < 3; k++) m.box([1.2, 0.08, 0.5], [0.7, 0.09, 0.09], 'timber', (k * Math.PI) / 3);
      return { top: 0.6 };
    }
    case 1: {
      // a ridge tent
      m.w.slab([[-1.4, 0, 1.1], [1.4, 0, 1.1], [1.4, 1.7, 0], [-1.4, 1.7, 0]], 0.03, { key: 'cloth', tint: '#b8a078' });
      m.w.slab([[1.4, 0, -1.1], [-1.4, 0, -1.1], [-1.4, 1.7, 0], [1.4, 1.7, 0]], 0.03, { key: 'cloth', tint: '#b8a078' });
      m.w.poly([[1.4, 0, 1.1], [1.4, 0, -1.1], [1.4, 1.7, 0]], { key: 'cloth', tint: '#a08860' });
      m.w.poly([[-1.4, 0, -1.1], [-1.4, 0, 1.1], [-1.4, 1.7, 0]], { key: 'cloth', tint: '#a08860' });
      for (const x of [-1.45, 1.45]) m.box([x, 0.95, 0], [0.06, 1.9, 0.06], 'timber');
      m.box([0, 0.6, 1.6], [0.25, 0.25, 0.25], 'planks');
      return { top: 1.9 };
    }
    case 2: {
      // a thatched cottage, low walls, deep roof
      const r: Rect = { cx: 0, cz: 0, w: W * 0.8, d: D * 0.6 };
      m.plinth(r, 0.3);
      m.storey(r, 0.3, { h: 2.2, wall: { key: 'plaster', tint: c.wash }, timber: true, door: { w: 0.95, h: 1.85 }, shutters: true, win: [0.6, 0.7] });
      const top = m.gable(r, 2.5, 2.2, 0.55, 'thatch', { key: 'plaster', tint: c.wash });
      m.chimney(r.w / 2 - 0.6, -0.2, 2.6, 2.4, false);
      return { top };
    }
    case 3:
      return timberHouse(c, { w: W * 0.82, d: D * 0.62, storeys: 2, roof: 'roofTiles' });
    case 4: {
      const made = timberHouse(c, { w: W, d: D * 0.65, storeys: 3, jetty: 0.3, roof: 'roofTiles', stoneGround: true });
      c.m.chimney(W / 2 - 0.7, -0.3, 8.0, 2.2);
      return made;
    }
    case 5: {
      const body = stoneHall(c, { w: W * 0.8, d: D * 0.8, storeys: 3, roof: 'crenel', roofMat: 'stone' });
      m.pole(0, 0, body.top + 2.4, c.banner);
      return { top: body.top + 2.4 };
    }
    default: {
      // a castle: a keep, four round corner towers and curtain walls
      const keep = stoneHall(c, { w: W * 0.5, d: D * 0.5, storeys: 3, roof: 'crenel', roofMat: 'stone' });
      const k = W / 2 - 0.5;
      for (const [x, z] of [[-k, -k], [k, -k], [k, k], [-k, k]] as const) m.roundTower(x, z, 0.7, 6, { key: 'roofSlate', tint: c.bannerRoof });
      for (const f of FACES) {
        const r: Rect = { cx: 0, cz: 0, w: 2 * k, d: 2 * k };
        m.onFace(r, f, 0, 1.8, [2 * k - 1.2, 3.6], 0.5, 'stone', -0.5);
        const n = 6;
        for (let i = 0; i < n; i++) m.onFace(r, f, -k + 0.6 + ((2 * k - 1.2) / n) * (i + 0.5), 3.85, [0.3, 0.5], 0.5, 'stone', -0.5);
      }
      m.door({ cx: 0, cz: 0, w: 2 * k, d: 2 * k }, 'front', 0, 0, 1.3, 2.5, 'stoneDark');
      m.pole(0, 0, keep.top + 2.4, c.banner);
      return { top: keep.top + 2.4 };
    }
  }
}

/** The medieval recipes: every building kind, and homes by value tier. */
export const MEDIEVAL: RecipeSet = { recipes: RECIPES, home };

/** A building style: a recipe per kind (missing kinds use `names`), and homes by tier. */
export interface RecipeSet {
  recipes: Record<string, (c: Ctx) => Made>;
  home(c: Ctx): Made;
}
