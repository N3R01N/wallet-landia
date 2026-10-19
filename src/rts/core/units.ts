/**
 * Ledger Wars' units on the move: what one is (Siege's unit types, from
 * units.json), how a group order spreads into a formation round the goal,
 * and each tick's walking: the shared flow field far off, straight at its
 * own slot once in clear sight of it, pushed apart from its neighbours, and
 * out of anything solid. Fighting is in combat.ts.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { Role, UnitTypeId } from '../../game/core/types.js';
import type { PlayerId } from '../data/rules.js';
import { cellCentre, cellOf, DECK_HALF, type GameMap } from './map.js';
import type { Paths } from './path.js';

export type Order =
  | { t: 'idle' }
  | { t: 'hold' }
  /** Walk to the slot (x, z), by the field to `cell` (the group's goal). */
  | { t: 'move'; x: number; z: number; cell: number; attack: boolean }
  | { t: 'attack'; target: number };

/** What a player can order (the world spreads moves into formation). */
export type OrderKind = 'move' | 'attackMove' | 'attack' | 'stop' | 'hold';

export interface Unit {
  id: number;
  type: UnitTypeId;
  owner: PlayerId;
  x: number;
  z: number;
  /** Where it stood at the start of this tick (the view draws in between). */
  px: number;
  pz: number;
  /** Facing (radians, 0 = towards +z). */
  face: number;
  hp: number;
  maxHp: number;
  order: Order;
  /** What it is fighting now (a unit or building id), whatever its order. */
  target: number | null;
  /** Seconds until it may strike again. */
  cooldown: number;
  /** Seconds since its last strike began (for the view's attack clip), and since it died (−1: alive). */
  struck: number;
  died: number;
  /** Walking this tick (for the view). */
  moving: boolean;
  /** Progress made towards the slot: the best distance so far and seconds without bettering it. */
  best: number;
  stall: number;
  /** Where an idle unit stands guard (it goes back there after a chase). */
  guard: { x: number; z: number } | null;
  /** Ability state: the Lancer's charge spent, the Swap Mage's timer, the drain on its attack. */
  charged: boolean;
  timer: number;
  drained: number;
  shield: number;
}

/** A unit's HP is its type's × this (combat.ts COMBAT.hpScale: fights last a few blows). */
const HP_SCALE = 2;

/** Metres a second per point of a unit type's speed. */
export const METRES_PER_SPEED = 3.6;
const RADIUS: Record<Role, number> = { swarm: 0.32, ranged: 0.4, support: 0.42, melee: 0.45, cavalry: 0.6, siege: 0.9 };

export function radiusOf(type: UnitTypeId): number {
  return RADIUS[UNIT_TYPES[type]!.role];
}

export function speedOf(type: UnitTypeId): number {
  return UNIT_TYPES[type]!.speed * METRES_PER_SPEED;
}

export function newUnit(id: number, type: UnitTypeId, owner: PlayerId, x: number, z: number): Unit {
  const t = UNIT_TYPES[type]!;
  const hp = t.hp * HP_SCALE;
  return { id, type, owner, x, z, px: x, pz: z, face: owner === 'A' ? Math.PI : 0, hp, maxHp: hp, order: { t: 'idle' }, target: null, cooldown: 0, struck: 99, died: -1, moving: false, best: Infinity, stall: 0, guard: { x, z }, charged: false, timer: 0, drained: 0, shield: t.ability === 'start-shield' ? 10 : 0 };
}

/**
 * Slots for a group round a goal: rows across the way the group travels,
 * the group's centre on the goal, each slot moved to the nearest open cell.
 * Returns one slot per unit, in the units' order (the nearest units take the
 * front row).
 */
export function formation(units: readonly Unit[], gx: number, gz: number, paths: Paths, map: GameMap): { x: number; z: number }[] {
  const n = units.length;
  if (n === 0) return [];
  const cx = units.reduce((s, u) => s + u.x, 0) / n;
  const cz = units.reduce((s, u) => s + u.z, 0) / n;
  let fx = gx - cx;
  let fz = gz - cz;
  const len = Math.hypot(fx, fz);
  if (len < 0.01) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  // across (right) and along (forward)
  const rx = -fz;
  const rz = fx;
  const spacing = Math.max(...units.map((u) => radiusOf(u.type))) * 2 + 0.5;
  const cols = Math.ceil(Math.sqrt(n * 2));
  const rows = Math.ceil(n / cols);
  const raw: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = (i % cols) - (inRow - 1) / 2;
    const back = row - (rows - 1) / 2;
    raw.push({ x: gx + rx * col * spacing - fx * back * spacing, z: gz + rz * col * spacing - fz * back * spacing });
  }
  // the units furthest forward take the front row
  const order = units.map((u, i) => ({ i, ahead: u.x * fx + u.z * fz })).sort((a, b) => b.ahead - a.ahead || a.i - b.i);
  const taken = new Set<number>();
  const slots: { x: number; z: number }[] = new Array(n);
  order.forEach(({ i }, k) => {
    const s = raw[k]!;
    let c = paths.nearestOpen(s.x, s.z, 8);
    // two slots in one cell: the next free one round it
    for (let r = 0; c >= 0 && taken.has(c) && r < 4; r++) c = paths.nearestOpen(s.x + (r + 1) * 0.9 * rx, s.z + (r + 1) * 0.9 * rz, 8);
    if (c >= 0) taken.add(c);
    const p = c >= 0 ? cellCentre(map, c) : s;
    // keep the slot's own spot when its cell is open (finer than the grid)
    slots[i] = c >= 0 && c === cellOf(map, s.x, s.z) ? s : p;
  });
  return slots;
}

/** Walks a unit one tick towards its move slot. Returns true when it has arrived (or given up). */
export function walk(u: Unit, dt: number, paths: Paths): boolean {
  if (u.order.t !== 'move') return true;
  const o = u.order;
  const dx = o.x - u.x;
  const dz = o.z - u.z;
  const d = Math.hypot(dx, dz);
  const stepLen = speedOf(u.type) * dt;
  if (d <= Math.max(0.15, stepLen)) {
    u.x = o.x;
    u.z = o.z;
    return true;
  }
  // stuck short of the slot (others stand there): near enough is there
  if (d < u.best - 0.05) {
    u.best = d;
    u.stall = 0;
  } else u.stall += dt;
  if ((u.stall > 1.5 && d < 3.5) || u.stall > 6) return true;
  let vx = dx / d;
  let vz = dz / d;
  if (d > 14 || !paths.clear(u.x, u.z, o.x, o.z)) {
    const s = paths.step(paths.field(o.cell), u.x, u.z);
    if (s) {
      vx = s.dx;
      vz = s.dz;
    }
  }
  u.x += vx * stepLen;
  u.z += vz * stepLen;
  u.face = Math.atan2(vx, vz);
  u.moving = true;
  return false;
}

/**
 * Steps a unit towards a point (a target), by a flow field when the way isn't
 * clear: the field to `goal` (default the point), snapped to a 3 m grid so
 * that chasers of nearby targets share fields.
 */
export function approach(u: Unit, x: number, z: number, dt: number, paths: Paths, goal: { x: number; z: number } = { x, z }): void {
  const dx = x - u.x;
  const dz = z - u.z;
  const d = Math.hypot(dx, dz) || 1;
  let vx = dx / d;
  let vz = dz / d;
  if (!paths.clear(u.x, u.z, x, z)) {
    const s = paths.step(paths.field(paths.nearestOpen(Math.round(goal.x / 3) * 3, Math.round(goal.z / 3) * 3, 8)), u.x, u.z);
    if (s) {
      vx = s.dx;
      vz = s.dz;
    }
  }
  const len = Math.min(d, speedOf(u.type) * dt);
  u.x += vx * len;
  u.z += vz * len;
  u.face = Math.atan2(vx, vz);
  u.moving = true;
}

/** Pushes overlapping units apart (the walkers more than those standing), and everyone out of solid ground. */
export function separate(units: readonly Unit[], map: GameMap): void {
  const cell = 2;
  const grid = new Map<number, Unit[]>();
  const key = (x: number, z: number) => (Math.floor(z / cell) + 500) * 1000 + Math.floor(x / cell) + 500;
  for (const u of units) {
    if (u.died >= 0) continue;
    const k = key(u.x, u.z);
    const list = grid.get(k);
    if (list) list.push(u);
    else grid.set(k, [u]);
  }
  for (const u of units) {
    if (u.died >= 0) continue;
    const ra = radiusOf(u.type);
    const gx = Math.floor(u.x / cell);
    const gz = Math.floor(u.z / cell);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = grid.get((gz + oz + 500) * 1000 + gx + ox + 500);
        if (!list) continue;
        for (const v of list) {
          if (v.id <= u.id) continue;
          const min = ra + radiusOf(v.type);
          let dx = v.x - u.x;
          let dz = v.z - u.z;
          let d = Math.hypot(dx, dz);
          if (d >= min) continue;
          if (d < 1e-6) {
            // exactly on top: apart along a fixed direction, by id
            dx = Math.cos(u.id * 2.39996);
            dz = Math.sin(u.id * 2.39996);
            d = 1;
          }
          const push = (min - Math.min(d, min)) / 2;
          const nx = dx / d;
          const nz = dz / d;
          // whoever stands still gives way less
          const wu = u.moving || !v.moving ? 1 : 0.4;
          const wv = v.moving || !u.moving ? 1 : 0.4;
          u.x -= nx * push * wu;
          u.z -= nz * push * wu;
          v.x += nx * push * wv;
          v.z += nz * push * wv;
        }
      }
    }
  }
  // on a bridge: between its parapets
  for (const u of units) {
    if (Math.abs(u.z) >= DECK_HALF.length) continue;
    const bx = map.river.bridges.find((b) => Math.abs(u.x - b) < map.river.bridgeHalf + 0.5);
    if (bx === undefined) continue;
    const room = Math.max(0.2, DECK_HALF.width - radiusOf(u.type) * 0.7);
    // walkers drift to the middle (the paths run along cell centres, half a metre off it)
    if (u.moving) u.x += (bx - u.x) * 0.08;
    u.x = Math.max(bx - room, Math.min(bx + room, u.x));
  }
  // out of buildings, water and rocks: back to the nearest open cell's edge
  for (const u of units) {
    const c = cellOf(map, u.x, u.z);
    if (c >= 0 && map.blocked[c] === 0) continue;
    const h = map.size / 2;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= 6 && !best; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const n = cellOf(map, u.x + dx, u.z + dz);
          if (n < 0 || map.blocked[n] !== 0) continue;
          const p = cellCentre(map, n);
          const d = Math.hypot(p.x - u.x, p.z - u.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    if (best) {
      u.x = best.x;
      u.z = best.z;
    } else {
      u.x = Math.max(-h + 1, Math.min(h - 1, u.x));
      u.z = Math.max(-h + 1, Math.min(h - 1, u.z));
    }
  }
}
