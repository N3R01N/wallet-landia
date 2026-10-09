/**
 * The town plan as a site for a theme's surroundings (Phase 7): the map is
 * the flat town, roads, paths, the plaza, water and buildings are taken,
 * verges next to roads and paths are worn, and the plan's own scenery spots
 * (the trees and rocks the 2D views draw) become real plants.
 *
 * Also the tile surfaces themselves: roads and plaza paved, paths and sand
 * trodden, the harbour water — textured by the theme's ground materials.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W, tileAt, type TileKind, type TownPlan } from '../../world/layout.js';
import { scatterProps } from '../ground.js';
import type { Lamp } from './scenery.js';
import { METRES_PER_TILE } from './grammar/medieval.js';
import type { Site, SitePlant } from './grammar/surroundings.js';

const kindAt = (plan: TownPlan, x: number, y: number): TileKind | null => {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? null : tileAt(plan, tx, ty);
};

const PAVED = new Set<TileKind>(['road', 'plaza']);

/**
 * The river: down from the hills to the north-east, into the harbour from
 * the east, and out of it to the south through the meadow.
 */
const RIVER: [number, number][] = [
  [104, -62], [90, -34], [72, -10], [61, 8], [57, 22], [53, 30.5], [47.5, 31.5], [42.5, 32.5],
  [43, 37.5], [46, 43.5], [52, 52], [51, 66], [58, 86], [66, 110], [72, 150],
];
const TRODDEN = new Set<TileKind>(['path', 'sand']);

export function townSite(plan: TownPlan, lamps: Lamp[]): Site {
  /** Distance from a point to the nearest road/path tile (0 on one), searched in a small window. */
  const toWay = (x: number, z: number): number => {
    let best = 9;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const k = kindAt(plan, tx + dx, tz + dz);
        if (k === null || (!PAVED.has(k) && !TRODDEN.has(k))) continue;
        const ex = Math.max(tx + dx - x, 0, x - (tx + dx + 1));
        const ez = Math.max(tz + dz - z, 0, z - (tz + dz + 1));
        best = Math.min(best, Math.hypot(ex, ez));
      }
    }
    return best;
  };
  const buildings = plan.buildings.map((b) => ({ x: b.x + b.w / 2, z: b.y + b.h / 2, w: b.w, d: b.h, kind: b.kind }));
  const inBuilding = (x: number, z: number, margin: number): boolean => plan.buildings.some((b) => x > b.x - margin && x < b.x + b.w + margin && z > b.y - margin && z < b.y + b.h + margin);
  const plants: SitePlant[] = scatterProps(plan).map((p) => ({
    x: p.x,
    z: p.y,
    kind: p.kind === 'pine' ? 'fir' : p.kind === 'tree' ? (Math.floor(p.x * 7 + p.y * 13) % 4 === 0 ? 'birch' : 'oak') : p.kind,
  }));
  return {
    flat: { x0: 0, x1: MAP_W, z0: 0, z1: MAP_H },
    taken: (x, z) => {
      const k = kindAt(plan, x, z);
      return k === 'road' || k === 'plaza' || k === 'path' || k === 'water' || k === 'sand' || inBuilding(x, z, 0.1);
    },
    wear: (x, z) => {
      const k = kindAt(plan, x, z);
      if (k === 'water') return 0;
      return Math.max(1 - Math.min(1, toWay(x, z) / 0.8), inBuilding(x, z, 0.5) ? 0.45 : 0);
    },
    lamps,
    buildings,
    plants,
    // the harbour's water is the river's, at the town's water level
    river: { points: RIVER, pin: { x: 42.5, z: 32.5, level: 0.03 }, under: { x0: 37, x1: MAP_W, z0: 29, z1: MAP_H } },
    seed: 11,
  };
}

/** One mesh per surface: road, plaza, trodden (path, sand) and water. UVs in metres. */
export function tileSurfaces(plan: TownPlan, materials: { paved: THREE.Material; plaza: THREE.Material; trodden: THREE.Material; water: THREE.Material }): THREE.Mesh[] {
  const parts = { paved: [] as number[], plaza: [] as number[], trodden: [] as number[], water: [] as number[] };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = tileAt(plan, x, y);
      const list = k === 'plaza' ? parts.plaza : PAVED.has(k) ? parts.paved : TRODDEN.has(k) ? parts.trodden : k === 'water' ? parts.water : null;
      if (list) list.push(x, y);
    }
  }
  const out: THREE.Mesh[] = [];
  for (const [name, cells] of Object.entries(parts) as [keyof typeof parts, number[]][]) {
    if (cells.length === 0) continue;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const lift = name === 'water' ? 0.03 : name === 'paved' || name === 'plaza' ? 0.012 : 0.008;
    for (let i = 0; i < cells.length; i += 2) {
      const x = cells[i]!;
      const z = cells[i + 1]!;
      const base = pos.length / 3;
      for (const [cx, cz] of [[x, z + 1], [x + 1, z + 1], [x + 1, z], [x, z]] as const) {
        pos.push(cx, lift, cz);
        uv.push(cx * METRES_PER_TILE, -cz * METRES_PER_TILE);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials[name]);
    mesh.receiveShadow = true;
    mesh.name = `ground-${name}`;
    out.push(mesh);
  }
  return out;
}
