/**
 * The battlefield: a square of open ground, a river across the middle with
 * three stone bridges (the chokepoints), forests, rocks, lakes and a few
 * landmarks from the town's scenery models. Point-symmetric (what is at
 * (x, z) is also at (−x, −z)), so neither side has the better ground; the
 * start spots are kept clear. Seeded.
 *
 * The ground is a grid of 1 m cells: `blocked` marks where nothing walks or
 * is built (water, trunks, rocks); buildings are added to it in play.
 */

import { streamOf } from '../../game/core/detmath.js';
import { RULES } from '../data/rules.js';

export interface Scenery {
  name: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export interface GameMap {
  size: number;
  /** One byte per cell, row by row from (−size/2, −size/2): 0 open, 1 blocked by the land, 2 by a building. */
  blocked: Uint8Array;
  scenery: Scenery[];
  /** Where the river runs (|z| under this) and where its bridges cross (x centres, half-width). */
  river: { half: number; bridges: number[]; bridgeHalf: number };
}

const BRIDGES = [-48, 0, 48];

export function cellOf(map: GameMap, x: number, z: number): number {
  const h = map.size / 2;
  const cx = Math.floor(x + h);
  const cz = Math.floor(z + h);
  if (cx < 0 || cz < 0 || cx >= map.size || cz >= map.size) return -1;
  return cz * map.size + cx;
}

/** The centre of a cell. */
export function cellCentre(map: GameMap, cell: number): { x: number; z: number } {
  const h = map.size / 2;
  return { x: (cell % map.size) - h + 0.5, z: Math.floor(cell / map.size) - h + 0.5 };
}

export function isOpen(map: GameMap, x: number, z: number): boolean {
  const c = cellOf(map, x, z);
  return c >= 0 && map.blocked[c] === 0;
}

/** Marks a disc (or with `value` 0, clears it). */
function mark(map: GameMap, x: number, z: number, r: number, value: number): void {
  for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const c = cellOf(map, x + dx, z + dz);
      if (c >= 0) map.blocked[c] = value;
    }
  }
}

/** Marks a rectangle (x0..x1, z0..z1). */
export function markRect(map: GameMap, x0: number, z0: number, x1: number, z1: number, value: number): void {
  for (let z = Math.floor(z0); z < Math.ceil(z1); z++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const c = cellOf(map, x + 0.5, z + 0.5);
      if (c >= 0) map.blocked[c] = value;
    }
  }
}

export function generateMap(seed: string): GameMap {
  const size = RULES.mapSize;
  const map: GameMap = { size, blocked: new Uint8Array(size * size), scenery: [], river: { half: 3, bridges: BRIDGES, bridgeHalf: 2.5 } };
  const rng = streamOf(seed, 'rts-map');
  const h = size / 2;

  // the river, east to west, and its bridges
  markRect(map, -h, -map.river.half, h, map.river.half, 1);
  for (let x = -h + 3; x < h; x += 6) map.scenery.push({ name: 'scenery.river.straight', x, z: 0, rot: Math.PI / 2, scale: 1 });
  for (const bx of BRIDGES) {
    markRect(map, bx - map.river.bridgeHalf, -map.river.half - 1, bx + map.river.bridgeHalf, map.river.half + 1, 0);
    map.scenery.push({ name: 'scenery.bridge.stone', x: bx, z: 0, rot: 0, scale: 1 });
  }

  // one half of the land, then the other half mirrored through the centre
  const placed: Scenery[] = [];
  const clearOf = (x: number, z: number, r: number) =>
    Math.abs(z) > map.river.half + r + 2 &&
    Math.abs(x) < h - r - 1 &&
    Math.abs(z) < h - r - 1 &&
    // the start spots and the way out of them
    Math.hypot(x - RULES.start.A.x, z - RULES.start.A.z) > 26 + r &&
    Math.hypot(x - RULES.start.B.x, z - RULES.start.B.z) > 26 + r &&
    // the bridges' approaches
    BRIDGES.every((bx) => Math.hypot(x - bx, Math.abs(z) - map.river.half) > 8 + r);
  const put = (name: string, r: number, scale = 1) => {
    for (let tries = 0; tries < 30; tries++) {
      const x = (rng() * 2 - 1) * (h - 4);
      const z = map.river.half + 4 + rng() * (h - map.river.half - 8);
      if (!clearOf(x, z, r) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < r + 2)) continue;
      const s: Scenery = { name, x, z, rot: rng() * Math.PI * 2, scale };
      placed.push(s);
      return s;
    }
    return null;
  };
  const block: [Scenery, number][] = [];
  // forests: clumps of trees
  for (let f = 0; f < 7; f++) {
    const centre = put('scenery.forest.patch', 6, 0.8);
    if (!centre) continue;
    block.push([centre, 4.5]);
    for (let t = 0; t < 6; t++) {
      const a = rng() * Math.PI * 2;
      const d = 5 + rng() * 4;
      const x = centre.x + Math.cos(a) * d;
      const z = centre.z + Math.sin(a) * d;
      if (!clearOf(x, z, 1)) continue;
      const tree: Scenery = { name: rng() < 0.5 ? 'scenery.tree.oak' : 'scenery.tree.pine', x, z, rot: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.3 };
      placed.push(tree);
      block.push([tree, 0.8]);
    }
  }
  for (let i = 0; i < 10; i++) {
    const s = put(`scenery.rock.${1 + Math.floor(rng() * 3)}`, 1.5, 1 + rng() * 0.6);
    if (s) block.push([s, 1.3 * s.scale]);
  }
  const lake = put('scenery.lake', 8, 0.8);
  if (lake) block.push([lake, 5.5]);
  for (const name of ['scenery.ruin', 'scenery.windmill', 'scenery.camp']) {
    const s = put(name, 3);
    if (s) block.push([s, 2.5]);
  }
  for (let i = 0; i < 6; i++) put('scenery.meadow', 4); // flowers: walkable
  for (const [s, r] of block) mark(map, s.x, s.z, r, 1);
  for (const [s, r] of block) mark(map, -s.x, -s.z, r, 1);
  for (const s of placed) map.scenery.push(s, { ...s, x: -s.x, z: -s.z, rot: s.rot + Math.PI });

  // hills beyond the edge, for a horizon
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng() * 0.3;
    const d = h + 45 + rng() * 25;
    map.scenery.push({ name: rng() < 0.6 ? 'scenery.hill' : `scenery.mountain.${1 + Math.floor(rng() * 3)}`, x: Math.cos(a) * d, z: Math.sin(a) * d, rot: rng() * Math.PI * 2, scale: 1 + rng() * 0.5 });
  }
  return map;
}

/** Whether the two points are joined by open ground (4-way steps). */
export function connected(map: GameMap, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const start = cellOf(map, a.x, a.z);
  const goal = cellOf(map, b.x, b.z);
  if (start < 0 || goal < 0) return false;
  const seen = new Uint8Array(map.blocked.length);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    if (c === goal) return true;
    const x = c % map.size;
    for (const n of [c - map.size, c + map.size, x > 0 ? c - 1 : -1, x < map.size - 1 ? c + 1 : -1]) {
      if (n < 0 || n >= map.blocked.length || seen[n] || map.blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return false;
}

