/**
 * The town: a tile grid with districts, roads and building slots.
 *
 * Coordinates are tile units, renderer-agnostic: the top-down and isometric
 * renderers both project the same (x, y). A building's slot comes from hashing
 * its protocol id into its district's slot list with linear probing (v3's rule):
 * value or rank never decide placement, so refreshing data cannot move one.
 */

import type { BuildingKind } from '../domain/catalog.js';
import type { Guild } from '../domain/model.js';
import { hashString } from '../util/rng.js';

export const MAP_W = 48;
export const MAP_H = 36;

/** `path`: a footpath carved from a door to the nearest road. */
export type TileKind = 'grass' | 'road' | 'plaza' | 'water' | 'wilds' | 'sand' | 'path';

export type District = 'temple' | 'alchemy' | 'civic' | 'wilds' | 'counting' | 'square' | 'market' | 'guild' | 'harbour';

export const DISTRICT_NAMES: Record<District, string> = {
  temple: 'Temple Hill',
  alchemy: "Alchemist's Lane",
  civic: 'Civic Quarter',
  wilds: 'The Wilds',
  counting: 'Counting Row',
  square: 'Town Square',
  market: 'Market District',
  guild: 'Guild Quarter',
  harbour: 'Harbour',
};

const DISTRICT_OF: Record<BuildingKind, District> = {
  temple: 'temple',
  barracks: 'temple',
  alchemist: 'alchemy',
  council: 'civic',
  names: 'civic',
  forge: 'civic',
  herald: 'civic',
  packing: 'civic',
  tent: 'wilds',
  bank: 'counting',
  bazaar: 'market',
  broker: 'market',
  auction: 'market',
  harbour: 'harbour',
};

/** Top-left tile of a 3×3 footprint; the door is the tile below its middle. */
export const SLOTS: Record<District, [number, number][]> = {
  temple: [[2, 8], [7, 8], [2, 4], [7, 4]],
  alchemy: [[14, 8], [19, 8], [14, 4], [19, 4]],
  civic: [[26, 8], [31, 8], [26, 4], [31, 4]],
  wilds: [[38, 8], [43, 8], [38, 4], [43, 4], [40, 1], [45, 1]],
  counting: [[2, 15], [7, 15]],
  square: [[30, 15], [19, 15], [26, 15], [33, 15]],
  market: [[38, 15], [43, 15], [38, 22], [43, 22], [30, 22], [33, 22]],
  guild: [[2, 22], [7, 22], [14, 22], [19, 22], [2, 29], [7, 29], [14, 29], [19, 29]],
  harbour: [[32, 29], [27, 29]],
};

/** Overflow goes to the Wilds, then anywhere free. Never dropped. */
const OVERFLOW: District[] = ['wilds', 'civic', 'alchemy', 'temple', 'market', 'square'];

export type PlacedKind = BuildingKind | 'tower' | 'guildhall' | 'home' | 'gate';

export interface Placed {
  id: string;
  kind: PlacedKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The door's tile (integer tile coordinates, just below the footprint). */
  door: { x: number; y: number };
  /** The world point at the door: the centre of the door tile. People stand here. */
  doorAt: Pt;
  protocolId?: string;
  heroAddress?: string;
  district: District | 'gate';
}

export interface TownPlan {
  tiles: TileKind[];
  buildings: Placed[];
  byProtocol: Map<string, Placed>;
  homes: Map<string, Placed>;
  tower: Placed;
  guildhall: Placed;
  gate: Placed;
  walkable: Uint8Array;
}

export function tileAt(plan: TownPlan, x: number, y: number): TileKind {
  return plan.tiles[y * MAP_W + x] ?? 'grass';
}

function baseTiles(): TileKind[] {
  const t: TileKind[] = new Array<TileKind>(MAP_W * MAP_H).fill('grass');
  const set = (x: number, y: number, k: TileKind): void => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) t[y * MAP_W + x] = k;
  };
  for (let y = 0; y < 3; y++) for (let x = 36; x < MAP_W; x++) set(x, y, 'wilds');
  for (let y = 3; y < 12; y++) for (let x = 37; x < MAP_W; x++) set(x, y, 'wilds');
  // Town square plaza around the Chronicle Tower.
  for (let y = 13; y < 19; y++) for (let x = 13; x < 30; x++) set(x, y, 'plaza');
  // Harbour water, with a beach.
  for (let y = 28; y < MAP_H; y++) for (let x = 36; x < MAP_W; x++) set(x, y, x === 36 || y === 28 ? 'sand' : 'water');
  // Roads: three horizontals, three verticals, and the gate road.
  for (let x = 2; x < 47; x++) {
    set(x, 12, 'road');
    set(x, 19, 'road');
    if (x < 36) set(x, 27, 'road');
  }
  for (let y = 3; y < 34; y++) {
    set(12, y, 'road');
    if (y < 28) set(36, y, 'road');
  }
  for (let y = 3; y < MAP_H; y++) set(24, y, 'road');
  return t;
}

function makePlaced(id: string, kind: PlacedKind, x: number, y: number, w: number, h: number, district: Placed['district']): Placed {
  const door = { x: x + Math.floor(w / 2), y: y + h };
  return { id, kind, x, y, w, h, door, doorAt: { x: door.x + 0.5, y: door.y + 0.5 }, district };
}

export function planTown(guild: Guild): TownPlan {
  const tiles = baseTiles();
  const buildings: Placed[] = [];
  const used = new Set<string>();

  const tower = makePlaced('tower', 'tower', 22, 14, 4, 4, 'square');
  const guildhall = makePlaced('guildhall', 'guildhall', 15, 14, 4, 4, 'square');
  const gate = makePlaced('gate', 'gate', 23, 33, 3, 2, 'gate');
  gate.door = { x: 24, y: 32 };
  gate.doorAt = { x: 24.5, y: 32.5 };
  buildings.push(tower, guildhall, gate);

  const homes = new Map<string, Placed>();
  const guildSlots = SLOTS.guild;
  // Homes: hashed into the Guild Quarter, like everything else.
  const sortedHeroes = [...guild.heroes].sort((a, b) => a.address.localeCompare(b.address));
  for (const hero of sortedHeroes) {
    const slot = claim(guildSlots, `home:${hero.address}`, used) ?? claimAny(used);
    if (slot === null) continue;
    const p = makePlaced(`home:${hero.address}`, 'home', slot[0], slot[1], 3, 3, 'guild');
    p.heroAddress = hero.address;
    homes.set(hero.address, p);
    buildings.push(p);
  }

  const byProtocol = new Map<string, Placed>();
  // Placement is by id, never by value — except that when the town is full,
  // the places that matter (holdings, repeat visits) are seated first.
  const holds = new Set(guild.heroes.flatMap((h) => h.stashes.map((s) => s.protocolId)));
  const weight = (id: string, visits: number): number => (holds.has(id) || visits >= 3 ? 0 : 1);
  const protocols = [...guild.protocols.values()].sort((a, b) => weight(a.id, a.visits) - weight(b.id, b.visits) || a.id.localeCompare(b.id));
  const unplaced: string[] = [];
  for (const protocol of protocols) {
    const district = DISTRICT_OF[protocol.building];
    let slot = claim(SLOTS[district], protocol.id, used);
    let placedIn: District = district;
    for (const d of OVERFLOW) {
      if (slot !== null) break;
      slot = claim(SLOTS[d], protocol.id, used);
      placedIn = d;
    }
    slot ??= claimAny(used);
    if (slot === null) {
      unplaced.push(protocol.id);
      continue;
    }
    const p = makePlaced(`b:${protocol.id}`, protocol.building, slot[0], slot[1], 3, 3, placedIn);
    p.protocolId = protocol.id;
    byProtocol.set(protocol.id, p);
    buildings.push(p);
  }

  // A full town never drops a place: it shares the camp's tent, or the gate.
  const fallback = byProtocol.get('mystery:camp') ?? gate;
  for (const id of unplaced) byProtocol.set(id, fallback);

  const walkable = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < walkable.length; i++) walkable[i] = tiles[i] === 'water' ? 0 : 1;
  for (const b of buildings) {
    if (b.kind === 'gate') continue;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) walkable[y * MAP_W + x] = 0;
  }
  carveFootpaths(tiles, walkable, buildings);
  return { tiles, buildings, byProtocol, homes, tower, guildhall, gate, walkable };
}

const isStreet = (k: TileKind | undefined): boolean => k === 'road' || k === 'plaza' || k === 'path';

/**
 * Every door gets a footpath to the street network: a breadth-first search
 * from the door tile over walkable ground to the nearest road or plaza, and
 * the grass on the way becomes path. People then never need to cross lawns.
 */
function carveFootpaths(tiles: TileKind[], walkable: Uint8Array, buildings: Placed[]): void {
  for (const b of buildings) {
    const start = b.door.y * MAP_W + b.door.x;
    if (walkable[start] !== 1) continue; // reported by the layout tests
    const came = new Int32Array(MAP_W * MAP_H).fill(-2);
    came[start] = -1;
    const queue = [start];
    let found = -1;
    while (queue.length > 0) {
      const i = queue.shift()!;
      const k = tiles[i];
      if ((k === 'road' || k === 'plaza') && i !== start) {
        found = i;
        break;
      }
      const x = i % MAP_W;
      const y = Math.floor(i / MAP_W);
      // Prefer heading away from the building first, then sideways.
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const n = ny * MAP_W + nx;
        if (came[n] !== -2 || walkable[n] !== 1 || tiles[n] === 'water') continue;
        came[n] = i;
        queue.push(n);
      }
    }
    if (tiles[start] === 'road' || tiles[start] === 'plaza') continue;
    for (let i = found === -1 ? -1 : (came[found] ?? -1); i >= 0; i = came[i] ?? -1) {
      if (!isStreet(tiles[i])) tiles[i] = 'path';
    }
    if (!isStreet(tiles[start])) tiles[start] = 'path';
  }
}

function claim(slots: readonly [number, number][], id: string, used: Set<string>): [number, number] | null {
  if (slots.length === 0) return null;
  const start = hashString(id) % slots.length;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[(start + i) % slots.length];
    if (s === undefined) continue;
    const key = `${s[0]},${s[1]}`;
    if (!used.has(key)) {
      used.add(key);
      return s;
    }
  }
  return null;
}

/** Last resort for a very busy town: spare plots along the edges. */
export const SPARE: [number, number][] = [
  [8, 0], [14, 0], [19, 0], [26, 0], [31, 0], [2, 0], [9, 32], [16, 32], [27, 22],
];
function claimAny(used: Set<string>): [number, number] | null {
  return claim(SPARE, 'spare', used);
}

// --- pathfinding -------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
  /** Height above the ground in tiles (flyers only). */
  z?: number;
}

/** What a step onto each kind of tile costs. Streets are the way; lawns are a last resort. */
const STEP_COST: Record<TileKind, number> = { road: 1, plaza: 1, path: 1, sand: 4, grass: 40, wilds: 40, water: Infinity };

/**
 * A* on the tile grid, returning tile *centres* (a tile spans [x, x+1]).
 * Positions are world points; the tile under a point is its floor.
 */
export function findPath(plan: TownPlan, from: Pt, to: Pt): Pt[] {
  const idx = (x: number, y: number): number => y * MAP_W + x;
  const sx = clampX(Math.floor(from.x));
  const sy = clampY(Math.floor(from.y));
  const tx = clampX(Math.floor(to.x));
  const ty = clampY(Math.floor(to.y));
  const start = idx(sx, sy);
  const goal = idx(tx, ty);
  const g = new Float32Array(MAP_W * MAP_H).fill(Infinity);
  const came = new Int32Array(MAP_W * MAP_H).fill(-1);
  const open: { i: number; f: number }[] = [{ i: start, f: 0 }];
  g[start] = 0;
  const h = (i: number): number => Math.abs((i % MAP_W) - tx) + Math.abs(Math.floor(i / MAP_W) - ty);

  while (open.length > 0) {
    let best = 0;
    for (let k = 1; k < open.length; k++) if ((open[k]?.f ?? Infinity) < (open[best]?.f ?? Infinity)) best = k;
    const cur = open.splice(best, 1)[0];
    if (cur === undefined) break;
    if (cur.i === goal) break;
    const cx = cur.i % MAP_W;
    const cy = Math.floor(cur.i / MAP_W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = idx(nx, ny);
      if (plan.walkable[ni] === 0 && ni !== goal) continue;
      const cost = STEP_COST[plan.tiles[ni] ?? 'grass'];
      const ng = (g[cur.i] ?? Infinity) + cost;
      if (ng < (g[ni] ?? Infinity)) {
        g[ni] = ng;
        came[ni] = cur.i;
        open.push({ i: ni, f: ng + h(ni) });
      }
    }
  }

  if (came[goal] === -1 && goal !== start) return [from, to];
  const path: Pt[] = [];
  for (let i = goal; i !== -1; i = came[i] ?? -1) {
    path.push({ x: (i % MAP_W) + 0.5, y: Math.floor(i / MAP_W) + 0.5 });
    if (i === start) break;
  }
  return path.reverse();
}

const clampX = (x: number): number => Math.max(0, Math.min(MAP_W - 1, x));
const clampY = (y: number): number => Math.max(0, Math.min(MAP_H - 1, y));
