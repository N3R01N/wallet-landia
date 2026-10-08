/**
 * Medieval surroundings (Phase 5): dress a site with terrain, woods, a
 * meadow, props and lanterns. The site says where the town stands and what
 * ground is taken (roads, buildings); everything else is decided here, seeded,
 * so the same site always looks the same.
 *
 * Units are tiles.
 */

import * as THREE from 'three';
import { makeRng } from '../../../util/rng.js';
import { buildGrassWhere, type Lamp, type LampSet } from '../scenery.js';
import type { MaterialLibrary } from './materials.js';
import { buildLanterns, buildRocks, PropWriter } from './props.js';
import { makeNoise, outside, Terrain, type Box2 } from './terrain.js';
import type { Vegetation} from './vegetation.js';
import { type PlantSpot } from './vegetation.js';

export interface Site {
  /** Where the town stands; kept flat. */
  flat: Box2;
  /** Ground nothing may stand on: roads, tracks, buildings. */
  taken(x: number, z: number): boolean;
  /** 0..1, how worn the ground is (road verges, trodden paths). */
  wear(x: number, z: number): number;
  lamps: Lamp[];
  /** Building footprints: centre and size in tiles; the front faces +z. */
  buildings: { x: number; z: number; w: number; d: number; kind: string }[];
  seed: number;
}

export interface Surroundings {
  group: THREE.Group;
  lamps: LampSet;
  heightAt(x: number, z: number): number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function medievalSurroundings(site: Site, lib: MaterialLibrary, veg: Vegetation): Surroundings {
  const { flat } = site;
  const n = makeNoise(site.seed + 7);
  const rng = makeRng(site.seed);
  const centre = { x: (flat.x0 + flat.x1) / 2, z: (flat.z0 + flat.z1) / 2 };

  /** How wooded a place is: woods close in around the town, an open meadow to the south. */
  const woods = (x: number, z: number): number => {
    const edge = smooth(3, 10, outside(flat, x, z));
    const south = z > flat.z1 ? 0.12 + 0.88 * smooth(flat.z1 + 26, flat.z1 + 42, z) : 1;
    return edge * south * smooth(0.36, 0.56, n.fbm(x * 0.05, z * 0.05, 3));
  };
  const bounds: Box2 = { x0: centre.x - 130, x1: centre.x + 130, z0: centre.z - 120, z1: centre.z + 120 };
  const terrain = new Terrain({ flat, bounds, wear: site.wear, woods: (x, z) => smooth(0.15, 0.6, woods(x, z)), relief: (_x, z) => 0.3 + 0.7 * smooth(flat.z1 + 22, flat.z1 + 45, z), seed: site.seed }, lib);
  const h = (x: number, z: number): number => terrain.heightAt(x, z);
  const group = new THREE.Group();
  group.name = 'surroundings';
  group.add(terrain.mesh);

  /** Free ground around a point (nothing taken within r). */
  const free = (x: number, z: number, r: number): boolean => {
    if (site.taken(x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (site.taken(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  };

  // --- trees, on a jittered grid, thinner far away -------------------------------
  const trees: Record<'oak' | 'birch' | 'fir', PlantSpot[]> = { oak: [], birch: [], fir: [] };
  const bushes: PlantSpot[] = [];
  const rocks: PlantSpot[] = [];
  const reach = 85;
  for (let gz = centre.z - reach; gz < centre.z + reach; gz += 2.4) {
    for (let gx = centre.x - reach; gx < centre.x + reach; gx += 2.4) {
      const x = gx + (rng() - 0.5) * 2;
      const z = gz + (rng() - 0.5) * 2;
      const far = Math.hypot(x - centre.x, z - centre.z);
      if (far > reach) continue;
      const d = woods(x, z);
      const r = rng();
      const y = h(x, z);
      if (r < d * (far > 50 ? 0.6 : 0.85) && free(x, z, 1.2)) {
        const s = 1.35 + rng() * 0.7;
        const pick = rng();
        const high = smooth(4, 12, y);
        const kind = pick < 0.25 + high * 0.55 ? 'fir' : pick < 0.82 ? 'oak' : 'birch';
        trees[kind].push({ x, y: y - 0.05, z, s: kind === 'fir' ? s * 1.15 : s });
      } else if (r < d * 1.6 + 0.02 && far < 60 && free(x, z, 0.6)) {
        bushes.push({ x, y, z, s: 0.7 + rng() * 0.7 });
      }
      if (far < 70 && outside(flat, x, z) > 3 && rng() < 0.03 + smooth(0.4, 0.9, terrain.slopeAt(x, z)) * 0.5 && free(x, z, 0.8)) rocks.push({ x, y, z, s: 0.4 + rng() * 1.1 });
    }
  }
  // a few shade trees inside the town, where there is room
  for (let k = 0, placed = 0; k < 300 && placed < 6; k++) {
    const x = flat.x0 + rng() * (flat.x1 - flat.x0);
    const z = flat.z0 + rng() * (flat.z1 - flat.z0);
    if (free(x, z, 2.2)) {
      trees.oak.push({ x, y: 0, z, s: 1.1 + rng() * 0.3 });
      placed++;
    }
  }
  for (const kind of ['oak', 'birch', 'fir'] as const) for (const o of veg.plant(kind, trees[kind], site.seed + kind.length)) group.add(o);
  for (const o of veg.plant('bush', bushes, site.seed + 3)) group.add(o);
  group.add(buildRocks(rocks, lib, site.seed));

  // --- meadow: grass, flowers --------------------------------------------------------
  const grassArea = { x: flat.x0 - 14, y: flat.z0 - 10, w: flat.x1 - flat.x0 + 28, h: flat.z1 - flat.z0 + 32 };
  group.add(
    buildGrassWhere(grassArea, (x, z) => !site.taken(x, z) && site.wear(x, z) < 0.4 && woods(x, z) < 0.5, 5000, (x, z) => woods(x, z) > 0.2, h, { hue: 0.24, sat: 0.45, light: 0.17 }),
  );
  const flowers: PlantSpot[] = [];
  for (let k = 0; k < 6000 && flowers.length < 700; k++) {
    const x = grassArea.x + rng() * grassArea.w;
    const z = grassArea.y + rng() * grassArea.h;
    if (n.fbm(x * 0.15 + 30, z * 0.15, 2) < 0.55 || site.taken(x, z) || site.wear(x, z) > 0.3 || woods(x, z) > 0.3) continue;
    flowers.push({ x, y: h(x, z), z, s: 0.8 + rng() * 0.6 });
  }
  group.add(veg.flowers(flowers, site.seed + 5));

  // --- props -----------------------------------------------------------------------
  const props = new PropWriter(h, site.seed);
  for (const b of site.buildings) {
    if (b.kind === 'gate' || b.kind === 'herald' || b.kind === 'tent') continue;
    const side = rng() < 0.5 ? -1 : 1;
    const x = b.x + side * (b.w / 2 + 0.3);
    const z = b.z + b.d / 2 - 0.45;
    const r = rng();
    if (b.kind === 'home' || r < 0.25) props.woodpile(x, b.z - 0.2, Math.PI / 2);
    else if (r < 0.6) {
      props.barrel(x, z);
      if (rng() < 0.7) props.barrel(x + side * 0.05, z - 0.4);
    } else {
      props.crate(x, z, 0.6, rng());
      if (rng() < 0.6) props.crate(x, z, 0.45, rng(), 1.35);
    }
  }
  // a well where the town has room, near the middle
  for (let k = 0; k < 200; k++) {
    const x = centre.x + (rng() - 0.5) * (flat.x1 - flat.x0) * 0.8;
    const z = centre.z + (rng() - 0.5) * (flat.z1 - flat.z0) * 0.8;
    if (free(x, z, 1.4) && site.wear(x, z) < 0.2) {
      props.well(x, z);
      props.barrel(x + 0.9, z + 0.4);
      break;
    }
  }
  // a paddock with hay in the meadow, a dry-stone wall along the fields, a signpost
  const mz = flat.z1 + 3;
  const px0 = centre.x - 24;
  props.fence([[px0 + 6, mz], [px0, mz], [px0, mz + 8], [px0 + 13, mz + 8], [px0 + 13, mz], [px0 + 9, mz]]);
  for (let k = 0; k < 5; k++) props.hay(px0 + 2 + rng() * 9, mz + 1.5 + rng() * 5, rng() * 3);
  props.woodpile(px0 + 11.5, mz + 6.5, 0.3);
  props.stoneWall([[centre.x + 8, mz + 1], [centre.x + 18, mz + 3], [centre.x + 30, mz + 2.2], [centre.x + 40, mz + 5]]);
  props.stoneWall([[centre.x + 18, mz + 3], [centre.x + 20, mz + 14]]);
  for (let k = 0; k < 100; k++) {
    const x = flat.x1 - 2 - rng() * 6;
    const z = flat.z1 - rng() * 4;
    if (free(x, z, 0.6) && site.wear(x, z) > 0.1) {
      props.signpost(x, z, rng() * 3);
      break;
    }
  }
  group.add(props.build(lib));

  const lamps = buildLanterns(site.lamps, lib, h);
  group.add(lamps.group);
  return { group, lamps, heightAt: h };
}
