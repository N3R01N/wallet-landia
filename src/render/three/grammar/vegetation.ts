/**
 * Procedural vegetation (Phase 5): broadleaf trees grown as branching bark
 * tubes with leaf cards at the twigs, firs as tiers of drooping needle cards,
 * bushes and wildflowers. Leaf and needle textures are painted on a canvas at
 * start-up, so nothing is downloaded.
 *
 * Leaf cards get normals pointing away from the crown's centre: lit like a
 * soft volume instead of a pile of flat quads (the usual foliage trick).
 * Every species is two instanced meshes (wood and foliage); foliage sways.
 *
 * Units are tiles; one tile is 1.8 m.
 */

import * as THREE from 'three';
import { makeRng } from '../../../util/rng.js';
import { applyWind } from '../wind.js';
import type { MaterialLibrary } from './materials.js';
import { METRES_PER_TILE } from './medieval.js';

export interface PlantSpot {
  x: number;
  y: number;
  z: number;
  /** Size factor around 1. */
  s: number;
}

// --- canvas textures ------------------------------------------------------------

function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D, rng: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) paint(g, makeRng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A clump of broad leaves on twigs, transparent around it. */
function leafTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (g, rng) => {
      g.strokeStyle = '#4a3a28';
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(128, 250);
        g.quadraticCurveTo(128 + (rng() - 0.5) * 80, 160, 40 + rng() * 176, 30 + rng() * 120);
        g.stroke();
      }
      for (let i = 0; i < 230; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 105;
        const x = 128 + Math.cos(a) * r;
        const y = 118 + Math.sin(a) * r * 0.9;
        const l = 0.2 + rng() * 0.22 - (r / 105) * 0.04;
        g.save();
        g.translate(x, y);
        g.rotate(rng() * Math.PI * 2);
        g.fillStyle = `hsl(${88 + rng() * 30}, ${42 + rng() * 20}%, ${l * 100}%)`;
        g.beginPath();
        g.ellipse(0, 0, 11 + rng() * 6, 5 + rng() * 3, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(20,40,10,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-9, 0);
        g.lineTo(9, 0);
        g.stroke();
        g.restore();
      }
    },
    3,
  );
}

/** A fir branch seen from above: a stem with needles, tapering to a point. */
function needleTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (g, rng) => {
      // the branch runs from the left edge (trunk) to the right (tip)
      g.lineCap = 'round';
      for (let i = 0; i < 900; i++) {
        const t = rng();
        const x = 6 + t * 240;
        const spread = (1 - t) * 105 + 8;
        const y = 128 + (rng() - 0.5) * 2 * spread;
        const len = 10 + rng() * 12;
        const ang = (y < 128 ? -1 : 1) * (0.5 + rng() * 0.6);
        g.strokeStyle = `hsl(${105 + rng() * 30}, ${32 + rng() * 16}%, ${19 + rng() * 18}%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        g.stroke();
      }
      g.strokeStyle = '#3a2a1c';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 128);
      g.lineTo(240, 128);
      g.stroke();
    },
    5,
  );
}

/** A little clump of five-petal flowers on stems, white (tinted per instance). */
function flowerTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    (g, rng) => {
      for (let i = 0; i < 7; i++) {
        const x = 20 + rng() * 88;
        const y = 20 + rng() * 50;
        g.strokeStyle = '#3c6a2a';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(64 + (rng() - 0.5) * 20, 128);
        g.stroke();
        g.fillStyle = '#ffffff';
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          g.beginPath();
          g.ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5, 3.5, a, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#e8c040';
        g.beginPath();
        g.arc(x, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    },
    9,
  );
}

// --- geometry builders ------------------------------------------------------------

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  /** A tapered tube from a to b. Bark grain runs along u (the medieval bark texture's grain is horizontal). */
  tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides: number, v0: number): number {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const side = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3().crossVectors(dir, side).normalize();
    const q = new THREE.Vector3().crossVectors(dir, p).normalize();
    const bark = 1 / METRES_PER_TILE; // UVs in metres; the bark texture repeats per its size
    const base = this.pos.length / 3;
    for (let ring = 0; ring < 2; ring++) {
      const c = ring === 0 ? a : b;
      const r = ring === 0 ? r0 : r1;
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const n = p.clone().multiplyScalar(Math.cos(t)).addScaledVector(q, Math.sin(t));
        this.vert(c.clone().addScaledVector(n, r), n, (v0 + ring * len) / bark, ((i / sides) * Math.PI * 2 * Math.max(r0, 0.05)) / bark + 0.1);
      }
    }
    for (let i = 0; i < sides; i++) {
      const a0 = base + i;
      const b0 = base + sides + 1 + i;
      this.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
    return v0 + len;
  }

  /** A square card centred at c, facing a random way; normals point away from `centre`. */
  card(c: THREE.Vector3, size: number, rng: () => number, centre: THREE.Vector3, bend = 0.7): void {
    const right = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.6, rng() - 0.5).normalize();
    const up = new THREE.Vector3(rng() - 0.5, 1.2, rng() - 0.5).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    up.crossVectors(fwd, right).normalize();
    const h = size / 2;
    const out = new THREE.Vector3().subVectors(c, centre).normalize();
    const base = this.pos.length / 3;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [i, j] of corners) {
      const p = c.clone().addScaledVector(right, i * h).addScaledVector(up, j * h);
      const n = new THREE.Vector3().subVectors(p, centre).normalize().lerp(out, 0.3).lerp(new THREE.Vector3(0, 1, 0), 1 - bend).normalize();
      this.vert(p, n, (i + 1) / 2, (j + 1) / 2);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

interface Species {
  wood: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
  height: number;
}

/** A broadleaf tree: a leaning trunk, two orders of branches, leaf clumps at the twigs. */
function broadleaf(seed: number, shape: 'round' | 'tall'): Species {
  const rng = makeRng(seed);
  const wood = new GeoBuilder();
  const leaves = new GeoBuilder();
  const H = shape === 'tall' ? 3.6 : 2.9;
  const trunkR = shape === 'tall' ? 0.11 : 0.15;
  const crown = new THREE.Vector3(0, H * 0.72, 0);
  // trunk in three bending segments
  const pts = [new THREE.Vector3(0, -0.1, 0)];
  for (let i = 1; i <= 3; i++) pts.push(new THREE.Vector3((rng() - 0.5) * 0.18, (H * 0.62 * i) / 3, (rng() - 0.5) * 0.18));
  let v = 0;
  for (let i = 0; i < 3; i++) v = wood.tube(pts[i]!, pts[i + 1]!, trunkR * (1 - i * 0.22) * (i === 0 ? 1.25 : 1), trunkR * (1 - (i + 1) * 0.22), 7, v);
  const top = pts[3]!;
  const branches = shape === 'tall' ? 5 : 6;
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.6;
    const startY = H * (0.38 + rng() * 0.25);
    const start = new THREE.Vector3(top.x * (startY / top.y), startY, top.z * (startY / top.y));
    const out = shape === 'tall' ? 0.6 + rng() * 0.3 : 0.95 + rng() * 0.4;
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * out, 0.55 + rng() * 0.6, Math.sin(a) * out));
    wood.tube(start, end, trunkR * 0.45, trunkR * 0.18, 5, 0);
    for (let k = 0; k < 2; k++) {
      const t = 0.55 + k * 0.35;
      const s = start.clone().lerp(end, t);
      const tip = s.clone().add(new THREE.Vector3(Math.cos(a + (k ? 0.7 : -0.7)) * 0.45, 0.35 + rng() * 0.3, Math.sin(a + (k ? 0.7 : -0.7)) * 0.45));
      wood.tube(s, tip, trunkR * 0.16, trunkR * 0.06, 4, 0);
      for (let c = 0; c < 4; c++) leaves.card(tip.clone().add(new THREE.Vector3((rng() - 0.5) * 0.5, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.5)), 0.85 + rng() * 0.45, rng, crown);
    }
    for (let c = 0; c < 3; c++) leaves.card(end.clone().add(new THREE.Vector3((rng() - 0.5) * 0.5, rng() * 0.3, (rng() - 0.5) * 0.5)), 0.9 + rng() * 0.4, rng, crown);
  }
  // fill the crown's top and inside so it does not look hollow
  for (let c = 0; c < 14; c++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (shape === 'tall' ? 0.6 : 0.9);
    leaves.card(new THREE.Vector3(Math.cos(a) * r, crown.y + (rng() - 0.3) * (shape === 'tall' ? 1.4 : 0.9), Math.sin(a) * r), 0.9 + rng() * 0.5, rng, crown);
  }
  return { wood: wood.geometry(), foliage: leaves.geometry(), height: H + 0.6 };
}

/** A fir: a straight trunk and tiers of drooping needle cards, narrowing up. */
function fir(seed: number): Species {
  const rng = makeRng(seed);
  const wood = new GeoBuilder();
  const needles = new GeoBuilder();
  const H = 4.2;
  wood.tube(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, H, 0), 0.12, 0.02, 6, 0);
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const y = 0.7 + (t / tiers) * (H - 0.9);
    const len = (1 - t / tiers) * 1.35 + 0.25;
    const n = Math.max(4, Math.round(8 - t * 0.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.7 + rng() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const w = len * 0.55;
      const droop = -len * (0.32 + rng() * 0.12);
      const root = new THREE.Vector3(0, y, 0);
      const tip = dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, y + droop, 0));
      const mid = root.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.1, 0));
      // the card spans root → tip (u) and side to side (v); lit as if from the cone's surface
      const n0 = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.8, 0)).normalize();
      const base = needles.pos.length / 3;
      needles.vert(root.clone().addScaledVector(side, -w * 0.15), n0, 0, 0.35);
      needles.vert(tip, n0, 1, 0.5);
      needles.vert(root.clone().addScaledVector(side, w * 0.15), n0, 0, 0.65);
      needles.vert(mid.clone().addScaledVector(side, -w / 2), n0, 0.5, 0);
      needles.vert(mid.clone().addScaledVector(side, w / 2), n0, 0.5, 1);
      needles.idx.push(base, base + 3, base + 1, base + 2, base + 1, base + 4, base, base + 1, base + 2);
    }
  }
  return { wood: wood.geometry(), foliage: needles.geometry(), height: H };
}

function bush(seed: number): Species {
  const rng = makeRng(seed);
  const leaves = new GeoBuilder();
  const centre = new THREE.Vector3(0, 0.15, 0);
  for (let c = 0; c < 9; c++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.3;
    leaves.card(new THREE.Vector3(Math.cos(a) * r, 0.25 + rng() * 0.25, Math.sin(a) * r), 0.6 + rng() * 0.3, rng, centre, 0.8);
  }
  return { wood: new THREE.BufferGeometry(), foliage: leaves.geometry(), height: 0.7 };
}

// --- planting ---------------------------------------------------------------------

export class Vegetation {
  readonly #lib: MaterialLibrary;
  readonly #leafMat: THREE.MeshStandardMaterial;
  readonly #needleMat: THREE.MeshStandardMaterial;
  readonly #flowerMat: THREE.MeshStandardMaterial;
  readonly #species: Record<'oak' | 'birch' | 'fir' | 'bush', Species[]>;

  constructor(lib: MaterialLibrary) {
    this.#lib = lib;
    const foliage = (map: THREE.Texture): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    this.#leafMat = foliage(leafTexture());
    this.#needleMat = foliage(needleTexture());
    this.#flowerMat = foliage(flowerTexture());
    this.#species = {
      oak: [broadleaf(11, 'round'), broadleaf(12, 'round'), broadleaf(13, 'round')],
      birch: [broadleaf(21, 'tall'), broadleaf(22, 'tall')],
      fir: [fir(31), fir(32)],
      bush: [bush(41), bush(42)],
    };
  }

  /** Instanced meshes for one kind of plant at the given spots. */
  plant(kind: 'oak' | 'birch' | 'fir' | 'bush', spots: PlantSpot[], seed: number): THREE.Object3D[] {
    const variants = this.#species[kind];
    const rng = makeRng(seed);
    const groups = variants.map(() => [] as THREE.Matrix4[]);
    const colours = variants.map(() => [] as THREE.Color[]);
    for (const s of spots) {
      const v = Math.floor(rng() * variants.length);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08));
      groups[v]!.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + rng() * 0.2), s.s)));
      const c = new THREE.Color();
      if (kind === 'fir') c.setHSL(0.33, 0.25, 0.75 + rng() * 0.25);
      else if (kind === 'birch') c.setHSL(0.2 + rng() * 0.04, 0.5, 0.82 + rng() * 0.15);
      else c.setHSL(0.17 + rng() * 0.08, 0.4, 0.62 + rng() * 0.22);
      colours[v]!.push(c);
    }
    const out: THREE.Object3D[] = [];
    variants.forEach((sp, v) => {
      const list = groups[v]!;
      if (list.length === 0) return;
      if (sp.wood.getAttribute('position')) {
        const wood = new THREE.InstancedMesh(sp.wood, this.#lib.get('bark', kind === 'birch' ? '#e8e2d8' : undefined), list.length);
        list.forEach((m, i) => wood.setMatrixAt(i, m));
        wood.castShadow = true;
        wood.receiveShadow = true;
        wood.name = 'bark';
        out.push(wood);
      }
      const leaves = new THREE.InstancedMesh(sp.foliage, kind === 'fir' ? this.#needleMat : this.#leafMat, list.length);
      list.forEach((m, i) => {
        leaves.setMatrixAt(i, m);
        leaves.setColorAt(i, colours[v]![i]!);
      });
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      leaves.name = `foliage-${kind}`;
      applyWind(leaves, sp.height * (kind === 'bush' ? 1 : 1.4));
      out.push(leaves);
    });
    return out;
  }

  /** Wildflowers: small crossed cards, tinted per instance. */
  flowers(spots: PlantSpot[], seed: number): THREE.InstancedMesh {
    const rng = makeRng(seed);
    const g = new GeoBuilder();
    const n = new THREE.Vector3(0, 1, 0);
    for (const a of [0, Math.PI / 2]) {
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.14);
      const base = g.pos.length / 3;
      g.vert(new THREE.Vector3(-d.x, 0, -d.z), n, 0, 0);
      g.vert(new THREE.Vector3(d.x, 0, d.z), n, 1, 0);
      g.vert(new THREE.Vector3(d.x, 0.26, d.z), n, 1, 1);
      g.vert(new THREE.Vector3(-d.x, 0.26, -d.z), n, 0, 1);
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const mesh = new THREE.InstancedMesh(g.geometry(), this.#flowerMat, spots.length);
    const palette = ['#ffffff', '#ffe060', '#c890ff', '#ff7070', '#90b8ff'];
    spots.forEach((s, i) => {
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3), new THREE.Vector3(s.s, s.s, s.s)));
      mesh.setColorAt(i, new THREE.Color(palette[Math.floor(rng() * palette.length)]!));
    });
    mesh.receiveShadow = true;
    mesh.name = 'flowers';
    applyWind(mesh, 0.3);
    return mesh;
  }
}
