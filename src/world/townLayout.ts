/**
 * A town the player builds: which of their buildings stand where, and which
 * way each faces. Only that is kept (`TownLayout`); everything else is
 * worked out from it the same way every time:
 * - the ground, with what never moves: the Chronicle Tower and its plaza,
 *   the guildhall beside it, the gate and its road up to the square, the
 *   harbour's water;
 * - roads, from each door to the streets, in the order the buildings were
 *   placed (so the same layout always has the same roads, and moving one
 *   building lets the others' roads settle again);
 * - what the Sim needs: where people may walk, each hero's home and each
 *   protocol's building.
 *
 * What may be built comes from the history: one home per wallet, one
 * building per protocol its heroes have dealt with. Anything not placed (yet)
 * still works: its heroes come and go through the gate.
 *
 * `planTown` (layout.ts) stays as the suggested town: a visited town, which
 * has no layout of its own, and the tests' starting point.
 */

import type { BuildingKind } from '../domain/catalog.js';
import type { Guild, Protocol } from '../domain/model.js';
import type { ProtocolCategory } from '../domain/catalog.js';
import { DISTRICT_OF, makePlaced, MAP_H, MAP_W, planTown, type District, type Placed, type PlacedKind, type TileKind, type TownPlan } from './layout.js';

export type Rot = 0 | 1 | 2 | 3;

/** One building in town: its id (`home:<address>`, `b:<protocol id>`), top-left tile and quarter turns. */
export interface LayoutEntry {
  id: string;
  x: number;
  y: number;
  rot: Rot;
}

export interface TownLayout {
  v: 1;
  /** In the order they were placed (roads are laid in this order). */
  placed: LayoutEntry[];
}

export const emptyLayout = (): TownLayout => ({ v: 1, placed: [] });

/** Something the player may build. */
export interface Buildable {
  id: string;
  kind: PlacedKind;
  w: number;
  h: number;
  protocolId?: string;
  heroAddress?: string;
}

/** Every building this guild's history unlocks: a home per hero, then each protocol's building (sorted by id). */
export function buildables(guild: Guild): Buildable[] {
  const homes = [...guild.heroes].sort((a, b) => a.address.localeCompare(b.address)).map((h): Buildable => ({ id: `home:${h.address}`, kind: 'home', w: 3, h: 3, heroAddress: h.address }));
  const protocols = [...guild.protocols.values()].sort((a, b) => a.id.localeCompare(b.id)).map((p): Buildable => ({ id: `b:${p.id}`, kind: p.building, w: 3, h: 3, protocolId: p.id }));
  return [...homes, ...protocols];
}

// --- what never moves --------------------------------------------------------

const PLAZA = { x0: 13, x1: 30, y0: 13, y1: 19 };
/** The road from the gate up to the square. */
const GATE_ROAD = { x: 24, y0: 19, y1: 33 };

function fixedGround(): TileKind[] {
  const t: TileKind[] = new Array<TileKind>(MAP_W * MAP_H).fill('grass');
  const set = (x: number, y: number, k: TileKind): void => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) t[y * MAP_W + x] = k;
  };
  for (let y = 0; y < 3; y++) for (let x = 36; x < MAP_W; x++) set(x, y, 'wilds');
  for (let y = 3; y < 12; y++) for (let x = 37; x < MAP_W; x++) set(x, y, 'wilds');
  for (let y = PLAZA.y0; y < PLAZA.y1; y++) for (let x = PLAZA.x0; x < PLAZA.x1; x++) set(x, y, 'plaza');
  for (let y = 28; y < MAP_H; y++) for (let x = 36; x < MAP_W; x++) set(x, y, x === 36 || y === 28 ? 'sand' : 'water');
  for (let y = GATE_ROAD.y0; y < GATE_ROAD.y1; y++) set(GATE_ROAD.x, y, 'road');
  return t;
}

function fixedPieces(): { tower: Placed; guildhall: Placed; gate: Placed } {
  const tower = makePlaced('tower', 'tower', 22, 14, 4, 4, 'square');
  const guildhall = makePlaced('guildhall', 'guildhall', 15, 14, 4, 4, 'square');
  const gate = makePlaced('gate', 'gate', 23, 33, 3, 2, 'gate');
  gate.door = { x: 24, y: 32 };
  gate.doorAt = { x: 24.5, y: 32.5 };
  return { tower, guildhall, gate };
}

// --- doors and footprints ------------------------------------------------------

/** The door's tile for a footprint turned `rot` quarter turns (0: below the middle, 1: left, 2: above, 3: right). */
export function doorTile(x: number, y: number, w: number, h: number, rot: Rot): { x: number; y: number } {
  switch (rot) {
    case 0:
      return { x: x + Math.floor(w / 2), y: y + h };
    case 1:
      return { x: x - 1, y: y + Math.floor(h / 2) };
    case 2:
      return { x: x + Math.floor(w / 2), y: y - 1 };
    case 3:
      return { x: x + w, y: y + Math.floor(h / 2) };
  }
}

const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** Why a building cannot stand here (null: it can). `taken`: tiles already built on. */
export function blockedReason(tiles: readonly TileKind[], taken: Uint8Array, b: { x: number; y: number; w: number; h: number; rot: Rot }): string | null {
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!inMap(x, y)) return 'Off the edge of the map';
      if (taken[y * MAP_W + x] === 1) return 'Something is already built there';
      const k = tiles[y * MAP_W + x];
      if (k === 'water') return 'On the water';
      if (k === 'plaza' || k === 'road') return 'On the square or the gate road';
    }
  const d = doorTile(b.x, b.y, b.w, b.h, b.rot);
  if (!inMap(d.x, d.y) || taken[d.y * MAP_W + d.x] === 1 || tiles[d.y * MAP_W + d.x] === 'water') return 'The door opens onto nothing';
  return null;
}

// --- roads -----------------------------------------------------------------------

/** Costs for laying a road: along one already there is nearly free, across open ground dearer, and a turn costs a little, so roads share and run straight. */
const ROAD_COST: Record<TileKind, number> = { road: 1, plaza: 1, path: 1, grass: 6, wilds: 8, sand: 7, water: Infinity };
const TURN = 3;
const DX = [0, 1, 0, -1] as const;
const DY = [1, 0, -1, 0] as const;

/**
 * The cheapest road from a door to the streets (any road or plaza tile), over
 * tiles not built on; null if there is none. Dijkstra over (tile, heading),
 * ties broken by push order, so it is the same every time.
 */
function roadFrom(tiles: readonly TileKind[], taken: Uint8Array, door: { x: number; y: number }): number[] | null {
  const start = door.y * MAP_W + door.x;
  if (tiles[start] === 'road' || tiles[start] === 'plaza') return [start];
  const N = MAP_W * MAP_H * 4;
  const cost = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  for (let d = 0; d < 4; d++) {
    cost[start * 4 + d] = 0;
    heap.push(start * 4 + d, 0);
  }
  while (heap.size > 0) {
    const s = heap.pop();
    const i = s >> 2;
    const dir = s & 3;
    const c = cost[s]!;
    if (heap.lastKey > c) continue; // a stale entry
    if (i !== start && (tiles[i] === 'road' || tiles[i] === 'plaza')) {
      const out: number[] = [];
      for (let k = s; k !== -1; k = came[k]!) out.push(k >> 2);
      return out.reverse();
    }
    const x = i % MAP_W;
    const y = Math.floor(i / MAP_W);
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DX[nd]!;
      const ny = y + DY[nd]!;
      if (!inMap(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (taken[ni] === 1) continue;
      const step = ROAD_COST[tiles[ni] ?? 'grass'];
      if (!Number.isFinite(step)) continue;
      const nc = c + step + (i !== start && nd !== dir ? TURN : 0);
      const ns = ni * 4 + nd;
      if (nc < cost[ns]!) {
        cost[ns] = nc;
        came[ns] = s;
        heap.push(ns, nc);
      }
    }
  }
  return null;
}

/** A small binary heap of (state, cost); equal costs come out in push order. */
class MinHeap {
  #keys: number[] = [];
  #items: number[] = [];
  #order: number[] = [];
  #n = 0;
  /** The cost of the last item popped. */
  lastKey = 0;
  get size(): number {
    return this.#keys.length;
  }
  #less(a: number, b: number): boolean {
    return this.#keys[a]! < this.#keys[b]! || (this.#keys[a] === this.#keys[b] && this.#order[a]! < this.#order[b]!);
  }
  #swap(a: number, b: number): void {
    for (const arr of [this.#keys, this.#items, this.#order]) [arr[a], arr[b]] = [arr[b]!, arr[a]!];
  }
  push(item: number, key: number): void {
    this.#keys.push(key);
    this.#items.push(item);
    this.#order.push(this.#n++);
    for (let i = this.#keys.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) break;
      this.#swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.#items[0]!;
    this.lastKey = this.#keys[0]!;
    const last = this.#keys.length - 1;
    this.#swap(0, last);
    this.#keys.pop();
    this.#items.pop();
    this.#order.pop();
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.#keys.length && this.#less(l, m)) m = l;
      if (r < this.#keys.length && this.#less(r, m)) m = r;
      if (m === i) break;
      this.#swap(i, m);
      i = m;
    }
    return top;
  }
}

// --- the plan ----------------------------------------------------------------------

/**
 * Builds a town one building at a time on the fixed ground: each placed with
 * its road, or refused (nothing changes). Shared by `planFromLayout` and
 * `arrange`, so both build exactly the same way.
 */
class TownBuilder {
  readonly tiles = fixedGround();
  readonly taken = new Uint8Array(MAP_W * MAP_H);
  readonly fixed = fixedPieces();
  readonly buildings: Placed[];
  readonly homes = new Map<string, Placed>();
  readonly byProtocol = new Map<string, Placed>();
  readonly placed = new Set<string>();

  constructor() {
    const { tower, guildhall, gate } = this.fixed;
    this.buildings = [tower, guildhall, gate];
    for (const b of this.buildings) this.#occupy(b, 1);
  }

  #occupy(b: { x: number; y: number; w: number; h: number }, v: 0 | 1): void {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (inMap(x, y)) this.taken[y * MAP_W + x] = v;
  }

  /** Can `what` stand here? (A cheap look: footprint and door, not yet the road.) */
  fits(what: Buildable, x: number, y: number, rot: Rot, land?: Land): boolean {
    if (land !== undefined && !onLand(land, { x, y, w: what.w, h: what.h })) return false;
    return blockedReason(this.tiles, this.taken, { x, y, w: what.w, h: what.h, rot }) === null;
  }

  /** Put it up with its road; false (and nothing changed) if it cannot stand or no road reaches its door. */
  place(what: Buildable, x: number, y: number, rot: Rot, land?: Land): boolean {
    if (this.placed.has(what.id) || !this.fits(what, x, y, rot, land)) return false;
    // its footprint first, so its own road goes round it; then the road (or not at all)
    const p = makePlaced(what.id, what.kind, x, y, what.w, what.h, what.kind === 'home' ? 'guild' : DISTRICT_OF[what.kind as BuildingKind]);
    p.rot = rot;
    p.door = doorTile(x, y, what.w, what.h, rot);
    p.doorAt = { x: p.door.x + 0.5, y: p.door.y + 0.5 };
    this.#occupy(p, 1);
    const road = roadFrom(this.tiles, this.taken, p.door);
    if (road === null) {
      this.#occupy(p, 0);
      return false;
    }
    for (const i of road) if (this.tiles[i] !== 'plaza') this.tiles[i] = 'road';
    this.placed.add(what.id);
    if (what.protocolId !== undefined) {
      p.protocolId = what.protocolId;
      this.byProtocol.set(what.protocolId, p);
    }
    if (what.heroAddress !== undefined) {
      p.heroAddress = what.heroAddress;
      this.homes.set(what.heroAddress, p);
    }
    this.buildings.push(p);
    return true;
  }

  /**
   * Could `what` stand here, and with what road? Changes nothing: the town
   * as built is tried with this one more building on a copy.
   */
  preview(what: Buildable, x: number, y: number, rot: Rot, land?: Land): Preview {
    const door = doorTile(x, y, what.w, what.h, rot);
    const no = (reason: string): Preview => ({ ok: false, reason, door, road: [] });
    if (this.placed.has(what.id)) return no('Already built');
    if (land !== undefined && !onLand(land, { x, y, w: what.w, h: what.h })) return no(land.nextAt === null ? 'Outside your land' : `Outside your land: more land at level ${land.nextAt}`);
    const why = blockedReason(this.tiles, this.taken, { x, y, w: what.w, h: what.h, rot });
    if (why !== null) return no(why);
    const taken = this.taken.slice();
    for (let yy = y; yy < y + what.h; yy++) for (let xx = x; xx < x + what.w; xx++) taken[yy * MAP_W + xx] = 1;
    const road = roadFrom(this.tiles, taken, door);
    if (road === null) return no("The door can't reach a street");
    return { ok: true, reason: null, door, road: road.filter((i) => this.tiles[i] !== 'road' && this.tiles[i] !== 'plaza') };
  }

  plan(guild: Guild): TownPlan {
    const { tower, guildhall, gate } = this.fixed;
    const homes = new Map(this.homes);
    const byProtocol = new Map(this.byProtocol);
    // not built (yet): its heroes live outside the gate, and its quests go out through it
    for (const h of guild.heroes) if (!homes.has(h.address)) homes.set(h.address, gate);
    for (const id of guild.protocols.keys()) if (!byProtocol.has(id)) byProtocol.set(id, gate);
    const walkable = new Uint8Array(MAP_W * MAP_H);
    for (let i = 0; i < walkable.length; i++) walkable[i] = this.tiles[i] === 'water' || this.taken[i] === 1 ? 0 : 1;
    // the gate is walked through
    for (let y = gate.y; y < gate.y + gate.h; y++) for (let x = gate.x; x < gate.x + gate.w; x++) if (inMap(x, y)) walkable[y * MAP_W + x] = this.tiles[y * MAP_W + x] === 'water' ? 0 : 1;
    return { tiles: [...this.tiles], buildings: [...this.buildings], byProtocol, homes, tower, guildhall, gate, walkable, labels: districtLabelsFor(this.buildings, tower) };
  }
}

/** Where a building in hand would stand: may it, why not, and the new road it would get (tile indices). */
export interface Preview {
  ok: boolean;
  reason: string | null;
  door: { x: number; y: number };
  road: number[];
}

/**
 * The town as built, ready to try one more building on every pointer move
 * (the layout is built once; each try is one road search).
 */
export class BuildPlanner {
  readonly #t = new TownBuilder();
  readonly buildables: Map<string, Buildable>;

  constructor(guild: Guild, layout: TownLayout) {
    this.buildables = new Map(buildables(guild).map((b) => [b.id, b]));
    for (const e of layout.placed) {
      const what = this.buildables.get(e.id);
      if (what !== undefined) this.#t.place(what, e.x, e.y, e.rot);
    }
  }

  /** What stands in town now (ids). */
  get placed(): ReadonlySet<string> {
    return this.#t.placed;
  }

  preview(id: string, x: number, y: number, rot: Rot, land?: Land): Preview {
    const what = this.buildables.get(id);
    if (what === undefined) return { ok: false, reason: 'Not yours to build', door: doorTile(x, y, 3, 3, rot), road: [] };
    return this.#t.preview(what, x, y, rot, land);
  }
}

/**
 * The town as built: what stands where, roads laid, everyone's way about.
 * Entries that cannot stand (an id this history does not unlock, off the
 * map, overlapping, a door no road can reach) are left out, not refused: the
 * same layout serves several history windows and realms, and a building
 * comes back when it may.
 */
export function planFromLayout(guild: Guild, layout: TownLayout): TownPlan {
  const t = new TownBuilder();
  const can = new Map(buildables(guild).map((b) => [b.id, b]));
  for (const e of layout.placed) {
    const what = can.get(e.id);
    if (what !== undefined) t.place(what, e.x, e.y, e.rot);
  }
  return t.plan(guild);
}

/**
 * Name a district where its buildings stand together: the tightest group of
 * two or more within a few tiles of each other, labelled over the middle of
 * it (biggest groups first, none written over another); the square always.
 */
function districtLabelsFor(buildings: readonly Placed[], tower: Placed): [District, number, number][] {
  const NEAR = 7;
  const centre = (b: Placed): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
  const groups: { d: District; list: Placed[] }[] = [];
  const by = new Map<District, Placed[]>();
  for (const b of buildings) {
    if (b.district === 'gate' || b.district === 'square') continue;
    by.set(b.district, [...(by.get(b.district) ?? []), b]);
  }
  for (const [d, list] of by) {
    // the building with the most of its kind near it, and those near it
    let best: Placed[] = [];
    for (const b of list) {
      const [bx, by2] = centre(b);
      const near = list.filter((o) => {
        const [ox, oy] = centre(o);
        return Math.hypot(ox - bx, oy - by2) <= NEAR;
      });
      if (near.length > best.length) best = near;
    }
    if (best.length >= 2) groups.push({ d, list: best });
  }
  groups.sort((a, b) => b.list.length - a.list.length || a.d.localeCompare(b.d));
  const out: [District, number, number][] = [['square', tower.x + tower.w / 2 - 2, tower.y - 0.8]];
  for (const { d, list } of groups) {
    const cx = list.reduce((s, b) => s + b.x + b.w / 2, 0) / list.length;
    const y = Math.min(...list.map((b) => b.y)) - 0.8;
    // a label is ~10 tiles wide at the usual zoom: keep clear of those already written
    if (out.some(([, x2, y2]) => Math.abs(x2 - cx) < 10 && Math.abs(y2 - y) < 2)) continue;
    out.push([d, cx, y]);
  }
  return out;
}

/**
 * Arrange for the player: everything this history unlocks that `layout`
 * does not place yet is added, each where the classic town would have it
 * (its district's slot) if that is free, else at the nearest free spot a
 * road can reach (on `land`, if given). What is already placed stays.
 */
export function arrange(guild: Guild, layout: TownLayout, land?: Land): TownLayout {
  const t = new TownBuilder();
  const can = new Map(buildables(guild).map((b) => [b.id, b]));
  const placed: LayoutEntry[] = [];
  for (const e of layout.placed) {
    const what = can.get(e.id);
    if (what !== undefined && t.place(what, e.x, e.y, e.rot)) placed.push(e);
  }
  // in the classic town's order (homes, then the places that matter most), from its slots
  for (const b of planTown(guild).buildings) {
    const what = can.get(b.id);
    if (what === undefined || t.placed.has(what.id)) continue;
    const spot = nearestSpot(t, what, b.x, b.y, land);
    if (spot !== null) placed.push({ id: what.id, x: spot.x, y: spot.y, rot: 0 });
  }
  return { v: 1, placed };
}

/** The suggested town from nothing: `arrange` on an empty layout (a visited town's shape, and the tests'). */
export const suggestedLayout = (guild: Guild, land?: Land): TownLayout => arrange(guild, emptyLayout(), land);

/** Put `what` up at (x, y) or the nearest spot round it that takes it (rings outward), facing south; where, or null. */
function nearestSpot(t: TownBuilder, what: Buildable, x: number, y: number, land?: Land): { x: number; y: number } | null {
  for (let r = 0; r < Math.max(MAP_W, MAP_H); r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // the ring only
        const nx = x + dx;
        const ny = y + dy;
        if (t.fits(what, nx, ny, 0, land) && t.place(what, nx, ny, 0, land)) return { x: nx, y: ny };
      }
  }
  return null;
}

/** A layout read back from storage or a file: only well-formed entries, each id once. */
export function sanitizeLayout(raw: unknown): TownLayout {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { placed?: unknown }).placed)) return emptyLayout();
  const seen = new Set<string>();
  const placed: LayoutEntry[] = [];
  for (const e of (raw as { placed: unknown[] }).placed) {
    if (typeof e !== 'object' || e === null) continue;
    const { id, x, y, rot } = e as Record<string, unknown>;
    if (typeof id !== 'string' || id.length > 200 || seen.has(id) || !/^(home:0x[0-9a-f]{40}|b:.+)$/.test(id)) continue;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inMap(x as number, y as number)) continue;
    const r = rot === 1 || rot === 2 || rot === 3 ? rot : 0;
    seen.add(id);
    placed.push({ id, x: x as number, y: y as number, rot: r });
  }
  return { v: 1, placed };
}

// --- land --------------------------------------------------------------------------

/** How much land the player has, by level: a rectangle centred on the tower, growing to the whole map. */
const LAND: [level: number, w: number, h: number][] = [
  [1, 16, 12],
  [5, 24, 18],
  [10, 32, 24],
  [15, 40, 30],
  [20, MAP_W, MAP_H],
];

export interface Land {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The level that brings the next widening (null: the whole map is yours). */
  nextAt: number | null;
}

export function landFor(level: number): Land {
  let w = LAND[0]![1];
  let h = LAND[0]![2];
  let nextAt: number | null = null;
  for (const [from, lw, lh] of LAND) {
    if (level >= from) {
      w = lw;
      h = lh;
    } else {
      nextAt = from;
      break;
    }
  }
  // centred on the tower, kept inside the map
  const cx = 24;
  const cy = 16;
  const x0 = Math.max(0, Math.min(MAP_W - w, cx - Math.floor(w / 2)));
  const y0 = Math.max(0, Math.min(MAP_H - h, cy - Math.floor(h / 2)));
  return { x0, y0, x1: x0 + w, y1: y0 + h, nextAt };
}

/** Is this footprint (and its door) on the player's land? */
export function onLand(land: Land, b: { x: number; y: number; w: number; h: number }): boolean {
  return b.x >= land.x0 && b.y >= land.y0 && b.x + b.w <= land.x1 && b.y + b.h <= land.y1;
}

// --- what may be built, remembered -----------------------------------------------

/** What a protocol's building needs, kept once its history has shown it. */
export type Known = Record<string, { name: string; iconUrl: string | null; url: string | null; category: string; building: string }>;

const BUILDINGS = new Set<string>(Object.keys(DISTRICT_OF));

/**
 * Remember every protocol this guild shows, and give the guild back those it
 * no longer shows (an older history window) as protocols with no visits: what
 * may be built never shrinks. `known` is updated in place; `fresh` lists the
 * ids seen for the first time.
 */
export function rememberProtocols(guild: Guild, known: Known): { guild: Guild; fresh: string[] } {
  const fresh: string[] = [];
  for (const p of guild.protocols.values()) {
    if (known[p.id] === undefined) fresh.push(p.id);
    known[p.id] = { name: p.name, iconUrl: p.iconUrl, url: p.url, category: p.category, building: p.building };
  }
  const protocols = new Map(guild.protocols);
  for (const [id, k] of Object.entries(known)) {
    if (protocols.has(id) || !BUILDINGS.has(k.building)) continue;
    const p: Protocol = { id, name: k.name, iconUrl: k.iconUrl, url: k.url, category: k.category as ProtocolCategory, building: k.building as BuildingKind, visits: 0 };
    protocols.set(id, p);
  }
  return { guild: { ...guild, protocols }, fresh };
}
