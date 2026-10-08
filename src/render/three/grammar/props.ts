/**
 * Medieval props (Phase 5), built with the same mesh writer and PBR materials
 * as the buildings: a well, barrels, crates, hay bales, woodpiles, fences,
 * dry-stone walls, signposts. All static props of a scene go into one
 * MeshWriter, so they cost one draw call per material. Rocks are instanced;
 * lantern posts light pools on the ground at night like the town's lamps.
 *
 * Callers pass tile coordinates and ground heights in tiles; props are built
 * in metres inside a group scaled back to tiles.
 */

import * as THREE from 'three';
import { makeRng } from '../../../util/rng.js';
import { radialTexture, type Lamp, type LampSet } from '../scenery.js';
import type { MaterialLibrary } from './materials.js';
import { METRES_PER_TILE } from './medieval.js';
import { MeshWriter, type V3 } from './meshWriter.js';

const M = METRES_PER_TILE;

export class PropWriter {
  readonly w = new MeshWriter();
  readonly rng: () => number;
  readonly #ground: (x: number, z: number) => number;

  /** `ground` gives the height in tiles at a tile position. */
  constructor(ground: (x: number, z: number) => number, seed = 1) {
    this.#ground = ground;
    this.rng = makeRng(seed);
  }

  /** Metres at a tile position, standing on the ground. */
  #at(x: number, z: number, lift = 0): V3 {
    return [x * M, this.#ground(x, z) * M + lift, z * M];
  }

  barrel(x: number, z: number): void {
    const [px, py, pz] = this.#at(x, z);
    this.w.cylinder(px, pz, py, 0.3, 0.85, 10, 'planks', { top: 'planks' });
    for (const y of [0.12, 0.7]) this.w.cylinder(px, pz, py + y, 0.315, 0.05, 10, 'iron');
  }

  crate(x: number, z: number, size = 0.6, rot = 0, stack = 0): void {
    const [px, py, pz] = this.#at(x, z, stack * size);
    this.w.box([px, py + size / 2, pz], [size, size, size], 'planks', { rotY: rot });
    this.w.box([px, py + size / 2, pz], [size + 0.04, size * 0.16, size + 0.04], 'timber', { rotY: rot });
  }

  hay(x: number, z: number, rot = 0): void {
    const [px, py, pz] = this.#at(x, z);
    this.w.box([px, py + 0.28, pz], [1.0, 0.56, 0.62], { key: 'thatch', tint: '#f0d890' }, { rotY: rot });
  }

  woodpile(x: number, z: number, rot = 0): void {
    const [px, py, pz] = this.#at(x, z);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        const off = (i - (4 - row) / 2) * 0.24;
        const y = py + 0.12 + row * 0.21;
        const a: V3 = [px + c * off - s * 0.45, y, pz - s * off - c * 0.45];
        const b: V3 = [px + c * off + s * 0.45, y, pz - s * off + c * 0.45];
        this.w.beam(a, b, 0.2, 0.2, 'bark');
      }
    }
    for (const side of [-1, 1]) this.w.box([px + c * side * 0.75, py + 0.45, pz - s * side * 0.75], [0.1, 0.9, 0.1], 'timber', { rotY: rot });
  }

  well(x: number, z: number): void {
    const [px, py, pz] = this.#at(x, z);
    this.w.cylinder(px, pz, py, 0.85, 0.85, 14, 'stone');
    this.w.cylinder(px, pz, py + 0.85, 0.92, 0.1, 14, 'stoneDark', { top: 'stoneDark' });
    this.w.cylinder(px, pz, py + 0.8, 0.7, 0.08, 14, 'iron', { top: 'iron' }); // dark water
    for (const sx of [-1, 1]) this.w.box([px + sx * 0.8, py + 1.3, pz], [0.14, 1.8, 0.14], 'timber');
    this.w.beam([px - 0.9, py + 1.75, pz], [px + 0.9, py + 1.75, pz], 0.1, 0.1, 'timber');
    this.w.beam([px + 0.05, py + 1.75, pz], [px + 0.05, py + 1.2, pz], 0.02, 0.02, 'iron');
    this.w.cylinder(px + 0.05, pz, py + 0.95, 0.16, 0.25, 8, 'planks');
    const y = py + 2.2;
    this.w.slab([[px - 1.0, y - 0.5, pz + 0.75], [px + 1.0, y - 0.5, pz + 0.75], [px + 1.0, y, pz], [px - 1.0, y, pz]], 0.06, 'roofTiles', 'timber');
    this.w.slab([[px + 1.0, y - 0.5, pz - 0.75], [px - 1.0, y - 0.5, pz - 0.75], [px - 1.0, y, pz], [px + 1.0, y, pz]], 0.06, 'roofTiles', 'timber');
  }

  signpost(x: number, z: number, rot = 0): void {
    const [px, py, pz] = this.#at(x, z);
    this.w.box([px, py + 1.1, pz], [0.12, 2.2, 0.12], 'timber');
    for (const [y, a] of [[1.85, rot], [1.5, rot + 2.1]] as const) {
      const dx = Math.cos(a) * 0.45;
      const dz = -Math.sin(a) * 0.45;
      this.w.beam([px, py + y, pz], [px + dx * 1.6, py + y, pz + dz * 1.6], 0.04, 0.2, 'planks');
    }
  }

  /** A post-and-rail fence along tile points, following the ground. */
  fence(points: [number, number][]): void {
    let prev: V3 | null = null;
    for (let k = 0; k < points.length - 1; k++) {
      const [x0, z0] = points[k]!;
      const [x1, z1] = points[k + 1]!;
      const len = Math.hypot(x1 - x0, z1 - z0) * M;
      const n = Math.max(1, Math.round(len / 2.2));
      for (let i = k === 0 ? 0 : 1; i <= n; i++) {
        const t = i / n;
        const p = this.#at(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        const lean = (this.rng() - 0.5) * 0.08;
        this.w.box([p[0], p[1] + 0.55, p[2]], [0.13, 1.2, 0.13], 'timber', { rotZ: lean });
        if (prev) for (const h of [0.45, 0.95]) this.w.beam([prev[0], prev[1] + h, prev[2]], [p[0], p[1] + h, p[2]], 0.07, 0.11, 'timber');
        prev = p;
      }
    }
  }

  /** A dry-stone wall along tile points, following the ground. */
  stoneWall(points: [number, number][]): void {
    for (let k = 0; k < points.length - 1; k++) {
      const [x0, z0] = points[k]!;
      const [x1, z1] = points[k + 1]!;
      const n = Math.max(1, Math.round((Math.hypot(x1 - x0, z1 - z0) * M) / 1.6));
      for (let i = 0; i < n; i++) {
        const a = this.#at(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
        const b = this.#at(x0 + ((x1 - x0) * (i + 1)) / n, z0 + ((z1 - z0) * (i + 1)) / n);
        const h = 0.75 + this.rng() * 0.15;
        this.w.beam([a[0], a[1] + h / 2 - 0.1, a[2]], [b[0], b[1] + h / 2 - 0.1, b[2]], 0.55, h, 'stone');
        this.w.beam([a[0], a[1] + h - 0.05, a[2]], [b[0], b[1] + h - 0.05, b[2]], 0.6, 0.14, 'stoneDark');
      }
    }
  }

  build(lib: MaterialLibrary): THREE.Group {
    const g = this.w.build(lib);
    g.scale.setScalar(1 / M);
    g.name = 'props';
    return g;
  }
}

/** Boulders: a lumpy rock instanced at random sizes, half sunk into the ground. */
export function buildRocks(spots: { x: number; y: number; z: number; s: number }[], lib: MaterialLibrary, seed = 4): THREE.InstancedMesh {
  const rng = makeRng(seed);
  const geo = new THREE.IcosahedronGeometry(0.5, 2);
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.8 + Math.sin(v.x * 5.1 + 1) * Math.cos(v.z * 4.3) * 0.12 + Math.sin(v.y * 7.3) * 0.08;
    v.multiplyScalar(k);
    v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, lib.get('rock'), spots.length);
  spots.forEach((s, i) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.3, rng() * 0.4));
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y - 0.1 * s.s, s.z), q, new THREE.Vector3(s.s * (0.8 + rng() * 0.5), s.s, s.s * (0.8 + rng() * 0.5))));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'rocks';
  return mesh;
}

/** Timber lantern posts: an iron arm and a glazed lantern that glows at night. */
export function buildLanterns(lamps: Lamp[], lib: MaterialLibrary, ground: (x: number, z: number) => number = () => 0): LampSet {
  const group = new THREE.Group();
  const n = lamps.length;
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 1.6, 0.075), lib.get('timber'), n);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.34), lib.get('iron'), n);
  const cap = new THREE.InstancedMesh(new THREE.ConeGeometry(0.11, 0.1, 4).rotateY(Math.PI / 4), lib.get('iron'), n);
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffe6b0', emissive: new THREE.Color('#ffb860'), emissiveIntensity: 0 });
  const bulb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.17, 0.13), bulbMat, n);
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), poolMat, n);
  const m4 = new THREE.Matrix4();
  lamps.forEach((l, i) => {
    const y = ground(l.x, l.y);
    // the lantern hangs towards the street (north of the post in the sandbox; any side works)
    post.setMatrixAt(i, m4.makeTranslation(l.x, y + 0.8, l.y));
    arm.setMatrixAt(i, m4.makeTranslation(l.x, y + 1.5, l.y - 0.17));
    bulb.setMatrixAt(i, m4.makeTranslation(l.x, y + 1.36, l.y - 0.3));
    cap.setMatrixAt(i, m4.makeTranslation(l.x, y + 1.49, l.y - 0.3));
    pool.setMatrixAt(i, m4.makeTranslation(l.x, y + 0.025, l.y - 0.3));
  });
  for (const m of [post, arm, cap]) m.castShadow = true;
  pool.renderOrder = 1;
  group.add(post, arm, cap, bulb, pool);
  return {
    group,
    pools: pool,
    setNight(night: number): void {
      bulbMat.emissiveIntensity = 0.1 + night * 3.4;
      poolMat.opacity = night * 0.55;
      pool.visible = night > 0.02;
    },
  };
}
