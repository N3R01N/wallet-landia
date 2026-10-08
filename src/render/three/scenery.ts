/**
 * Living scenery for the 3D town: grass tufts that sway in the wind, and street
 * lamps that light little pools on the ground at night. Placement is seeded and
 * derived from the town plan, so the same town always gets the same lamps.
 */

import * as THREE from 'three';
import { makeRng } from '../../util/rng.js';
import { MAP_H, MAP_W, tileAt, type TownPlan } from '../../world/layout.js';
import { applyWind } from './wind.js';
import { makeRng as makePropRng } from '../../util/rng.js';
import { P } from '../pixel.js';
import type { Prop } from '../ground.js';
import { packModel } from './models.js';

export interface Lamp {
  x: number;
  y: number;
}

/** Lamps along the streets, beside (not on) the road, away from doors. */
export function placeLamps(plan: TownPlan): Lamp[] {
  const lamps: Lamp[] = [];
  const doors = plan.buildings.map((b) => b.doorAt);
  const free = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && plan.walkable[y * MAP_W + x] === 1 && !['road', 'path', 'plaza', 'water'].includes(tileAt(plan, x, y));
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tileAt(plan, x, y) !== 'road' || (x * 3 + y * 5) % 7 !== 0) continue;
      const side = ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const).find(([dx, dy]) => free(x + dx, y + dy));
      if (side === undefined) continue;
      const lamp = { x: x + 0.5 + side[0] * 0.62, y: y + 0.5 + side[1] * 0.62 };
      if (doors.some((d) => Math.hypot(d.x - lamp.x, d.y - lamp.y) < 1.6)) continue;
      if (lamps.some((l) => Math.hypot(l.x - lamp.x, l.y - lamp.y) < 4.2)) continue;
      lamps.push(lamp);
    }
  }
  return lamps;
}

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,214,140,1)');
    grad.addColorStop(0.45, 'rgba(255,190,110,0.45)');
    grad.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface LampSet {
  group: THREE.Group;
  /** The light pools on the ground (kept out of the AO pass). */
  pools: THREE.Object3D;
  /** 0 by day, 1 at night: bulbs glow (and bloom), pools light the ground. */
  setNight(night: number): void;
}

export function buildLamps(lamps: Lamp[]): LampSet {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.06, 1.5, 6), new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.7, flatShading: true }), lamps.length);
  const cap = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.16, 4), new THREE.MeshStandardMaterial({ color: '#2a2420', flatShading: true }), lamps.length);
  // The bulb's emissive is in HDR: above the bloom threshold only at night.
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffe6b0', emissive: new THREE.Color('#ffc870'), emissiveIntensity: 0 });
  const bulb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 0.2, 0.17), bulbMat, lamps.length);
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), poolMat, lamps.length);
  lamps.forEach((l, i) => {
    post.setMatrixAt(i, m4.makeTranslation(l.x, 0.75, l.y));
    cap.setMatrixAt(i, m4.makeTranslation(l.x, 1.62, l.y));
    bulb.setMatrixAt(i, m4.makeTranslation(l.x, 1.45, l.y));
    pool.setMatrixAt(i, m4.makeTranslation(l.x, 0.025, l.y));
  });
  post.castShadow = true;
  cap.castShadow = true;
  pool.renderOrder = 1;
  group.add(post, cap, bulb, pool);
  return {
    group,
    pools: pool,
    setNight(night: number): void {
      bulbMat.emissiveIntensity = 0.15 + night * 3.2;
      poolMat.opacity = night * 0.55;
      pool.visible = night > 0.02;
    },
  };
}

/** Grass tufts on the town's open lawn. */
export function buildGrass(plan: TownPlan, count = 1800): THREE.InstancedMesh {
  return buildGrassWhere(
    { x: 0, y: 0, w: MAP_W, h: MAP_H },
    (x, y) => {
      const kind = tileAt(plan, Math.floor(x), Math.floor(y));
      return (kind === 'grass' || kind === 'wilds') && plan.walkable[Math.floor(y) * MAP_W + Math.floor(x)] === 1;
    },
    count,
    (x, y) => tileAt(plan, Math.floor(x), Math.floor(y)) === 'wilds',
  );
}

/** Grass tufts anywhere `accept` allows: three crossed blades each, coloured by clump. */
export function buildGrassWhere(
  area: { x: number; y: number; w: number; h: number },
  accept: (x: number, y: number) => boolean,
  count = 1800,
  darker: (x: number, y: number) => boolean = () => false,
): THREE.InstancedMesh {
  const blade = (angle: number): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0, 0, 0.05, 0, 0, 0, 0.32, 0.03], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2], 3));
    g.rotateY(angle);
    return g;
  };
  const parts = [blade(0), blade(2.1), blade(4.2)];
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute('position').array as Float32Array));
    nor.push(...(p.getAttribute('normal').array as Float32Array));
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(merged, mat, count);
  const rng = makeRng(23);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 6; tries++) {
    const x = area.x + rng() * area.w;
    const y = area.y + rng() * area.h;
    if (!accept(x, y)) continue;
    const s = 0.7 + rng() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, 0, y), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.6), s));
    mesh.setMatrixAt(n, m4);
    // clumps: low-frequency colour variation across the lawn
    const clump = Math.sin(x * 0.35) * Math.cos(y * 0.41) * 0.5 + 0.5;
    color.setHSL(0.27 + clump * 0.05 - (darker(x, y) ? 0.02 : 0), 0.5, 0.36 + clump * 0.12 + rng() * 0.05);
    mesh.setColorAt(n, color);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  applyWind(mesh, 0.35);
  return mesh;
}

/**
 * Trees, pines, bushes and rocks as instanced meshes (foliage sways in the
 * wind), or a pack's models where the loadout picks them.
 */
export function buildPropMeshes(props: Prop[], mat: (color: string) => THREE.Material): THREE.Object3D[] {
const out: THREE.Object3D[] = [];
  const rng = makePropRng(11);
  const parts: Record<string, { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[] }> = {
    trunk: { geo: new THREE.CylinderGeometry(0.08, 0.11, 0.6, 5), mat: mat(P.woodDark), list: [] },
    crown: { geo: new THREE.IcosahedronGeometry(0.5, 0), mat: mat('#4a9a42'), list: [] },
    crown2: { geo: new THREE.IcosahedronGeometry(0.38, 0), mat: mat('#5aaa4a'), list: [] },
    pine: { geo: new THREE.ConeGeometry(0.5, 1.1, 6), mat: mat('#2f6a3a'), list: [] },
    pineTop: { geo: new THREE.ConeGeometry(0.36, 0.8, 6), mat: mat('#3a7a44'), list: [] },
    bush: { geo: new THREE.IcosahedronGeometry(0.28, 0), mat: mat('#4a9a42'), list: [] },
    rock: { geo: new THREE.DodecahedronGeometry(0.22, 0), mat: mat(P.stoneDark), list: [] },
  };
  const put = (key: string, x: number, y: number, z: number, s: number, ry = 0): void => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
    parts[key]?.list.push(m);
  };
  const models = new Map<Prop['kind'], ReturnType<typeof packModel>>();
  for (const k of ['tree', 'pine', 'bush', 'rock'] as const) models.set(k, packModel([`prop.${k}`]));
  for (const p of props) {
    const s = 0.8 + rng() * 0.5;
    const x = p.x + (rng() - 0.5) * 0.4;
    const z = p.y - 0.3 + (rng() - 0.5) * 0.4;
    const model = models.get(p.kind);
    if (model) {
      const m = model.scene.clone(true);
      m.scale.multiplyScalar(model.scale * s);
      m.position.set(x, 0, z);
      m.rotation.y = rng() * Math.PI * 2;
      out.push(m);
      continue;
    }
    switch (p.kind) {
      case 'tree':
        put('trunk', x, 0.3 * s, z, s);
        put('crown', x, 0.95 * s, z, s, rng() * 3);
        put('crown2', x + 0.15, 1.3 * s, z - 0.1, s, rng() * 3);
        break;
      case 'pine':
        put('trunk', x, 0.3 * s, z, s * 0.8);
        put('pine', x, 0.85 * s, z, s);
        put('pineTop', x, 1.35 * s, z, s);
        break;
      case 'bush':
        put('bush', x, 0.2, z, s);
        break;
      case 'rock':
        put('rock', x, 0.1, z, s, rng() * 3);
        break;
    }
  }
  // Foliage sways in the wind; trunks and rocks stay put.
  const sways: Record<string, number> = { crown: 1.6, crown2: 1.6, pine: 1.8, pineTop: 1.8, bush: 0.6 };
  for (const [key, part] of Object.entries(parts)) {
    if (part.list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(part.geo, part.mat, part.list.length);
    part.list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const ref = sways[key];
    if (ref !== undefined) applyWind(mesh, ref);
    out.push(mesh);
  }
  return out;
}
