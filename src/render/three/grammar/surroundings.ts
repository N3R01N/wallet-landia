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
import type { SurroundingsStyle } from '../../../assets/theme.js';
import { buildGrassWhere, buildLamps, type Lamp, type LampSet } from '../scenery.js';
import type { MaterialLibrary } from './materials.js';
import { buildBeacons, buildLanterns, buildRocks, PropWriter } from './props.js';
import { waterMaterial } from '../water.js';
import { makeNoise, outside, Terrain, type Box2 } from './terrain.js';
import type { PlantSpot, Vegetation } from './vegetation.js';

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
  /** No pond in the meadow (default: one). */
  pond?: false;
  /** Spots the town already chose for scenery (its 2D trees and rocks); planted as they are. */
  plants?: SitePlant[];
  seed: number;
}

export interface SitePlant {
  x: number;
  z: number;
  kind: 'oak' | 'birch' | 'fir' | 'bush' | 'rock';
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

export function medievalSurroundings(site: Site, lib: MaterialLibrary, veg: Vegetation, style: SurroundingsStyle = { style: 'medieval' }): Surroundings {
  const relief = style.relief ?? 1;
  const wooded = style.woods ?? 1;
  const mix = { oak: style.trees?.oak ?? 0.57, birch: style.trees?.birch ?? 0.18, fir: style.trees?.fir ?? 0.25 };
  const mixTotal = Math.max(1e-6, mix.oak + mix.birch + mix.fir);
  const { flat } = site;
  const n = makeNoise(site.seed + 7);
  const rng = makeRng(site.seed);
  const centre = { x: (flat.x0 + flat.x1) / 2, z: (flat.z0 + flat.z1) / 2 };

  /** How wooded a place is: woods close in around the town, an open meadow to the south. */
  const woods = (x: number, z: number): number => {
    const edge = smooth(3, 10, outside(flat, x, z));
    const south = z > flat.z1 ? 0.12 + 0.88 * smooth(flat.z1 + 26, flat.z1 + 42, z) : 1;
    return Math.min(1, edge * south * smooth(0.36, 0.56, n.fbm(x * 0.05, z * 0.05, 3)) * wooded);
  };
  const bounds: Box2 = { x0: centre.x - 130, x1: centre.x + 130, z0: centre.z - 120, z1: centre.z + 120 };

  // trails wandering from the town's edges up into the woods
  const trails: [number, number][][] = [
    [centre.x - 8, flat.z0, 0, -1],
    [flat.x0, centre.z + 4, -1, 0.2],
    [flat.x1, centre.z - 6, 1, -0.3],
  ].map(([x0, z0, dx, dz]) => {
    const pts: [number, number][] = [[x0!, z0!]];
    let ang = Math.atan2(dz!, dx!);
    for (let i = 0; i < 9; i++) {
      ang += (n.noise(i * 0.7 + x0!, z0! * 0.1) - 0.5) * 0.9;
      const [px, pz] = pts[pts.length - 1]!;
      pts.push([px + Math.cos(ang) * 4.5, pz + Math.sin(ang) * 4.5]);
    }
    return pts;
  });
  const segDist = (x: number, z: number, a: [number, number], b: [number, number]): number => {
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const t = THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
  };
  const trailDist = (x: number, z: number): number => {
    let d = Infinity;
    for (const t of trails) for (let i = 0; i < t.length - 1; i++) d = Math.min(d, segDist(x, z, t[i]!, t[i + 1]!));
    return d;
  };
  // a pond in the meadow, if the site has one
  const pond = site.pond === false ? null : { x: centre.x + 8, z: flat.z1 + 15, r: 4.5, depth: 1.1 };
  const pondDist = (x: number, z: number): number => (pond ? Math.hypot(x - pond.x, z - pond.z) - pond.r : Infinity);
  const wear = (x: number, z: number): number => Math.max(site.wear(x, z), 1 - smooth(0.3, 1.1, trailDist(x, z)), 0.8 * (1 - smooth(-0.6, 0.9, Math.abs(pondDist(x, z) + 0.4))));
  const terrain = new Terrain({ flat, bounds, wear, ...(pond ? { dips: [pond] } : {}), woods: (x, z) => smooth(0.15, 0.6, woods(x, z)), relief: (_x, z) => relief * (0.3 + 0.7 * smooth(flat.z1 + 22, flat.z1 + 45, z)), seed: site.seed }, lib);
  const h = (x: number, z: number): number => terrain.heightAt(x, z);
  const group = new THREE.Group();
  group.name = 'surroundings';
  group.add(terrain.mesh);

  /** Free ground around a point (nothing taken within r). */
  const free = (x: number, z: number, r: number): boolean => {
    if (site.taken(x, z) || trailDist(x, z) < r + 0.6 || pondDist(x, z) < r + 0.3) return false;
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
        // firs take over higher up
        const fir = mix.fir / mixTotal;
        const firShare = fir + (1 - fir) * high * (fir > 0 ? 0.6 : 0);
        const oakShare = (1 - firShare) * (mix.oak / Math.max(1e-6, mix.oak + mix.birch));
        const kind = pick < firShare ? 'fir' : pick < firShare + oakShare ? 'oak' : 'birch';
        trees[kind].push({ x, y: y - 0.05, z, s: kind === 'fir' ? s * 1.15 : s });
      } else if (r < d * 1.6 + 0.02 && far < 60 && free(x, z, 0.6)) {
        bushes.push({ x, y, z, s: 0.7 + rng() * 0.7 });
      }
      if (far < 70 && outside(flat, x, z) > 3 && rng() < 0.03 + smooth(0.4, 0.9, terrain.slopeAt(x, z)) * 0.5 && free(x, z, 0.8)) rocks.push({ x, y, z, s: 0.4 + rng() * 1.1 });
    }
  }
  // the site's own scenery spots, else a few shade trees where there is room
  for (const p of site.plants ?? []) {
    // garden and street trees: smaller than the forest's
    const spot = { x: p.x, y: h(p.x, p.z), z: p.z, s: 0.7 + rng() * 0.35 };
    if (p.kind === 'rock') rocks.push({ ...spot, s: 0.35 + rng() * 0.4 });
    else if (p.kind === 'bush') bushes.push({ ...spot, s: 0.8 + rng() * 0.5 });
    else trees[p.kind].push(spot);
  }
  for (let k = 0, placed = site.plants ? 6 : 0; k < 300 && placed < 6; k++) {
    const x = flat.x0 + rng() * (flat.x1 - flat.x0);
    const z = flat.z0 + rng() * (flat.z1 - flat.z0);
    if (free(x, z, 2.2)) {
      trees.oak.push({ x, y: 0, z, s: 1.1 + rng() * 0.3 });
      placed++;
    }
  }
  // the woods beyond the town are seen from afar: low detail, no shadows (the
  // sun's shadow map covers the town anyway)
  const isFar = (p: PlantSpot): boolean => outside(flat, p.x, p.z) > 10;
  for (const kind of ['oak', 'birch', 'fir'] as const) {
    for (const o of veg.plant(kind, trees[kind].filter((p) => !isFar(p)), site.seed + kind.length)) group.add(o);
    for (const o of veg.plant(kind, trees[kind].filter(isFar), site.seed + kind.length + 50, true)) group.add(o);
  }
  for (const o of veg.plant('bush', bushes.filter((p) => !isFar(p)), site.seed + 3)) group.add(o);
  for (const o of veg.plant('bush', bushes.filter(isFar), site.seed + 4, true)) group.add(o);
  const rockMesh = buildRocks(rocks, lib, site.seed);
  rockMesh.castShadow = false; // mostly out on the hills
  group.add(rockMesh);

  // --- meadow: grass, flowers --------------------------------------------------------
  const grassArea = { x: flat.x0 - 14, y: flat.z0 - 10, w: flat.x1 - flat.x0 + 28, h: flat.z1 - flat.z0 + 32 };
  group.add(
    buildGrassWhere(grassArea, (x, z) => !site.taken(x, z) && wear(x, z) < 0.4 && pondDist(x, z) > 0 && woods(x, z) < 0.5, 5000, (x, z) => woods(x, z) > 0.2, h, style.grass ?? { hue: 0.24, sat: 0.45, light: 0.17 }),
  );
  const flowers: PlantSpot[] = [];
  for (let k = 0; k < 6000 && flowers.length < (style.flowers ?? 700); k++) {
    const x = grassArea.x + rng() * grassArea.w;
    const z = grassArea.y + rng() * grassArea.h;
    if (n.fbm(x * 0.15 + 30, z * 0.15, 2) < 0.55 || site.taken(x, z) || wear(x, z) > 0.3 || pondDist(x, z) < 0.5 || woods(x, z) > 0.3) continue;
    flowers.push({ x, y: h(x, z), z, s: 0.8 + rng() * 0.6 });
  }
  group.add(veg.flowers(flowers, site.seed + 5));

  // the pond: water a little below its rim, bushes round the shore
  if (pond) {
    let rim = Infinity;
    for (let k = 0; k < 16; k++) rim = Math.min(rim, h(pond.x + Math.cos((k / 16) * Math.PI * 2) * pond.r, pond.z + Math.sin((k / 16) * Math.PI * 2) * pond.r));
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r * 0.97, 40).rotateX(-Math.PI / 2), waterMaterial());
    water.position.set(pond.x, rim - 0.15, pond.z);
    water.receiveShadow = true;
    water.name = 'pond';
    group.add(water);
    const shore: PlantSpot[] = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + n.noise(k, 3) * 0.6;
      const r = pond.r + 0.6 + n.noise(k, 7) * 0.8;
      shore.push({ x: pond.x + Math.cos(a) * r, y: h(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r), z: pond.z + Math.sin(a) * r, s: 0.8 + n.noise(k, 9) * 0.6 });
    }
    for (const o of veg.plant('bush', shore, site.seed + 9)) group.add(o);
  }

  // --- props: rustic (medieval), urban (modern) or colony (sci-fi) ----------------------
  const kit = style.style;
  const props = new PropWriter(h, site.seed);
  for (const b of site.buildings) {
    if (b.kind === 'gate' || b.kind === 'herald' || b.kind === 'tent') continue;
    const side = rng() < 0.5 ? -1 : 1;
    const x = b.x + side * (b.w / 2 + 0.3);
    const z = b.z + b.d / 2 - 0.45;
    const r = rng();
    if (!free(x, z, 0.3) || !free(x, b.z - 0.2, 0.3)) continue; // a road or a neighbour there
    if (kit === 'modern') {
      if (r < 0.45) props.bin(x, z);
      else if (r < 0.75) props.bench(x, b.z, Math.PI / 2);
      else {
        props.bollard(x, z);
        props.bollard(x, z - 0.6);
      }
    } else if (kit === 'scifi') {
      if (r < 0.5) {
        props.canister(x, z);
        if (rng() < 0.6) props.canister(x, z - 0.6);
      } else props.crate(x, z, 0.7, rng());
    } else if (b.kind === 'home' || r < 0.25) props.woodpile(x, b.z - 0.2, Math.PI / 2);
    else if (r < 0.6) {
      props.barrel(x, z);
      if (rng() < 0.7) props.barrel(x + side * 0.05, z - 0.4);
    } else {
      props.crate(x, z, 0.6, rng());
      if (rng() < 0.6) props.crate(x, z, 0.45, rng(), 1.35);
    }
  }
  // the town's water: a well, a fountain or a water tank, where there is room near the middle
  for (let k = 0; k < 200; k++) {
    const x = centre.x + (rng() - 0.5) * (flat.x1 - flat.x0) * 0.8;
    const z = centre.z + (rng() - 0.5) * (flat.z1 - flat.z0) * 0.8;
    const shaded = (site.plants ?? []).some((p) => Math.hypot(p.x - x, p.z - z) < 2.2);
    if (free(x, z, 1.4) && site.wear(x, z) < 0.2 && !shaded) {
      if (kit === 'modern') props.fountain(x, z);
      else if (kit === 'scifi') props.tank(x, z);
      else {
        props.well(x, z);
        props.barrel(x + 0.9, z + 0.4);
      }
      break;
    }
  }
  // outside town: a paddock (rustic), a fenced park (urban) or a solar farm (colony), and field walls
  const mz = flat.z1 + 3;
  const px0 = centre.x - 24;
  if (kit === 'scifi') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) props.solarPanel(px0 + 1.5 + i * 3, mz + 1.5 + j * 2.4);
    props.pipeline([[centre.x + 8, mz + 1], [centre.x + 18, mz + 3], [centre.x + 30, mz + 2.2], [centre.x + 40, mz + 5]]);
  } else {
    props.fence([[px0 + 6, mz], [px0, mz], [px0, mz + 8], [px0 + 13, mz + 8], [px0 + 13, mz], [px0 + 9, mz]]);
    if (kit === 'modern') {
      for (let k = 0; k < 4; k++) props.bench(px0 + 2 + k * 3, mz + 4, 0);
      props.fountain(px0 + 6.5, mz + 6.5);
    } else {
      for (let k = 0; k < 5; k++) props.hay(px0 + 2 + rng() * 9, mz + 1.5 + rng() * 5, rng() * 3);
      props.woodpile(px0 + 11.5, mz + 6.5, 0.3);
    }
    props.stoneWall([[centre.x + 8, mz + 1], [centre.x + 18, mz + 3], [centre.x + 30, mz + 2.2], [centre.x + 40, mz + 5]]);
    props.stoneWall([[centre.x + 18, mz + 3], [centre.x + 20, mz + 14]]);
  }
  for (let k = 0; k < 100; k++) {
    const x = flat.x1 - 2 - rng() * 6;
    const z = flat.z1 - rng() * 4;
    if (free(x, z, 0.6) && site.wear(x, z) > 0.1) {
      props.signpost(x, z, rng() * 3);
      break;
    }
  }
  group.add(props.build(lib));

  const lampStyle = style.lamps ?? (kit === 'modern' ? 'post' : kit === 'scifi' ? 'beacon' : 'lantern');
  const lamps = lampStyle === 'post' ? buildLamps(site.lamps) : lampStyle === 'beacon' ? buildBeacons(site.lamps, lib, h) : buildLanterns(site.lamps, lib, h);
  group.add(lamps.group);
  return { group, lamps, heightAt: h };
}
