/**
 * A small mesh writer for the building grammar. Everything is emitted as
 * quads and triangles (counter-clockwise seen from outside) into one buffer
 * per material, so a whole building is a handful of draw calls.
 *
 * UVs are world-aligned in metres: walls map u horizontally and v up, roofs
 * u along the eave and v up the slope, flat faces map x/z. Coplanar faces
 * therefore continue the same texture without seams.
 */

import * as THREE from 'three';
import { TEX_SIZE, type MatKey, type MaterialLibrary } from './materials.js';

export type V3 = [number, number, number];
export type Mat = MatKey | { key: MatKey; tint?: string };

interface Part {
  key: MatKey;
  tint: string | undefined;
  pos: number[];
  nor: number[];
  uv: number[];
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export class MeshWriter {
  readonly #parts = new Map<string, Part>();
  triangles = 0;

  #part(mat: Mat): Part {
    const key = typeof mat === 'string' ? mat : mat.key;
    const tint = typeof mat === 'string' ? undefined : mat.tint;
    const id = `${key}|${tint ?? ''}`;
    let p = this.#parts.get(id);
    if (!p) {
      p = { key, tint, pos: [], nor: [], uv: [] };
      this.#parts.set(id, p);
    }
    return p;
  }

  /** A polygon (3 or 4 points, CCW from outside), fanned into triangles. */
  poly(pts: V3[], mat: Mat): void {
    if (pts.length < 3) return;
    _a.fromArray(pts[0]!);
    _b.fromArray(pts[1]!);
    _c.fromArray(pts[2]!);
    _n.subVectors(_b, _a).cross(_c.sub(_a));
    if (_n.lengthSq() < 1e-12) return;
    _n.normalize();
    // world-aligned UV axes
    if (Math.abs(_n.y) > 0.92) {
      _u.set(1, 0, 0);
      _v.set(0, 0, 1);
    } else {
      _u.crossVectors(UP, _n).normalize();
      _v.crossVectors(_n, _u).normalize();
    }
    const part = this.#part(mat);
    const size = TEX_SIZE[part.key];
    const emit = (q: V3): void => {
      _p.fromArray(q);
      part.pos.push(q[0], q[1], q[2]);
      part.nor.push(_n.x, _n.y, _n.z);
      part.uv.push(_p.dot(_u) / size, _p.dot(_v) / size);
    };
    for (let i = 1; i < pts.length - 1; i++) {
      emit(pts[0]!);
      emit(pts[i]!);
      emit(pts[i + 1]!);
      this.triangles++;
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, mat: Mat): void {
    this.poly([a, b, c, d], mat);
  }

  /** An axis-aligned (optionally rotated) box. `skip` drops faces nobody sees. */
  box(center: V3, size: V3, mat: Mat, opts: { rotX?: number; rotY?: number; rotZ?: number; skip?: ('top' | 'bottom' | 'front' | 'back' | 'left' | 'right')[] } = {}): void {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0)).setPosition(center[0], center[1], center[2]);
    const t = (x: number, y: number, z: number): V3 => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      return [v.x, v.y, v.z];
    };
    const skip = new Set(opts.skip ?? []);
    if (!skip.has('front')) this.quad(t(-hx, -hy, hz), t(hx, -hy, hz), t(hx, hy, hz), t(-hx, hy, hz), mat);
    if (!skip.has('back')) this.quad(t(hx, -hy, -hz), t(-hx, -hy, -hz), t(-hx, hy, -hz), t(hx, hy, -hz), mat);
    if (!skip.has('right')) this.quad(t(hx, -hy, hz), t(hx, -hy, -hz), t(hx, hy, -hz), t(hx, hy, hz), mat);
    if (!skip.has('left')) this.quad(t(-hx, -hy, -hz), t(-hx, -hy, hz), t(-hx, hy, hz), t(-hx, hy, -hz), mat);
    if (!skip.has('top')) this.quad(t(-hx, hy, hz), t(hx, hy, hz), t(hx, hy, -hz), t(-hx, hy, -hz), mat);
    if (!skip.has('bottom')) this.quad(t(-hx, -hy, -hz), t(hx, -hy, -hz), t(hx, -hy, hz), t(-hx, -hy, hz), mat);
  }

  /** A square-section beam from a to b (rails, logs, braces), its top kept up. */
  beam(a: V3, b: V3, width: number, height: number, mat: Mat): void {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const x = new THREE.Vector3().subVectors(B, A);
    const len = x.length();
    if (len < 1e-6) return;
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, UP);
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
    z.normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const c = A.add(B).multiplyScalar(0.5);
    const [hx, hy, hz] = [len / 2, height / 2, width / 2];
    const t = (i: number, j: number, k: number): V3 => {
      const v = c.clone().addScaledVector(x, i * hx).addScaledVector(y, j * hy).addScaledVector(z, k * hz);
      return [v.x, v.y, v.z];
    };
    this.quad(t(-1, -1, 1), t(1, -1, 1), t(1, 1, 1), t(-1, 1, 1), mat);
    this.quad(t(1, -1, -1), t(-1, -1, -1), t(-1, 1, -1), t(1, 1, -1), mat);
    this.quad(t(-1, 1, 1), t(1, 1, 1), t(1, 1, -1), t(-1, 1, -1), mat);
    this.quad(t(-1, -1, -1), t(1, -1, -1), t(1, -1, 1), t(-1, -1, 1), mat);
    this.quad(t(1, -1, 1), t(1, -1, -1), t(1, 1, -1), t(1, 1, 1), mat);
    this.quad(t(-1, -1, -1), t(-1, -1, 1), t(-1, 1, 1), t(-1, 1, -1), mat);
  }

  /**
   * A planar polygon given thickness: top face (offset outward), the
   * underside (the soffit you see under the eaves), and the edges (fascia).
   */
  slab(pts: V3[], thickness: number, mat: Mat, under: Mat = mat): void {
    _a.fromArray(pts[0]!);
    _b.fromArray(pts[1]!);
    _c.fromArray(pts[2]!);
    const n = new THREE.Vector3().subVectors(_b, _a).cross(_c.sub(_a)).normalize().multiplyScalar(thickness);
    const top = pts.map((p) => [p[0] + n.x, p[1] + n.y, p[2] + n.z] as V3);
    this.poly(top, mat);
    this.poly([...pts].reverse(), under);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this.quad(pts[j]!, pts[i]!, top[i]!, top[j]!, under);
    }
  }

  /** A cylinder's side (and optionally top) around (cx, cz). */
  cylinder(cx: number, cz: number, y0: number, r: number, h: number, segs: number, mat: Mat, opts: { top?: Mat } = {}): void {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p1: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      this.quad(p1, p0, [p0[0], y0 + h, p0[2]], [p1[0], y0 + h, p1[2]], mat);
      if (opts.top) this.poly([[cx, y0 + h, cz], [p1[0], y0 + h, p1[2]], [p0[0], y0 + h, p0[2]]], opts.top);
    }
  }

  /** A cone (round roof, spire), open at the base. */
  cone(cx: number, cz: number, y0: number, r: number, h: number, segs: number, mat: Mat): void {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      this.poly([[cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx, y0 + h, cz]], mat);
    }
  }

  /** One mesh per material. */
  build(lib: MaterialLibrary): THREE.Group {
    const g = new THREE.Group();
    for (const part of this.#parts.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(part.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, lib.get(part.key, part.tint));
      mesh.castShadow = part.key !== 'glass' && part.key !== 'fire';
      mesh.receiveShadow = true;
      mesh.name = part.key;
      g.add(mesh);
    }
    return g;
  }
}
