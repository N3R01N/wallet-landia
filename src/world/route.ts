/**
 * How people move through town.
 *
 * Walkers follow the street network (A* over roads, plaza and footpaths), keep
 * a little to the right of the way so two-way traffic does not overlap, and
 * round their corners. Flyers (griffins, dragons, ravens) take off steeply at
 * the door, cross town above every rooftop, and land steeply at the next door,
 * so they never pass through a building.
 */

import { findPath, MAP_W, type Placed, type Pt, type TownPlan } from './layout.js';

/** How far to the right of the way people walk (tiles). */
export const LANE = 0.2;
/** Cruising height for flyers, above the tallest roof (the Chronicle Tower, ~7.2 tiles). */
export const FLY_CRUISE = 8.5;
/** Horizontal distance over which a flyer climbs or descends at a door. */
export const FLY_CLIMB = 0.45;

const walkableAt = (plan: TownPlan, p: Pt): boolean => {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < MAP_W && plan.walkable[y * MAP_W + x] === 1;
};

/** Drop points that lie on a straight line between their neighbours. */
function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Shift interior points to the right of the direction of travel. */
function keepRight(pts: Pt[], lane: number): Pt[] {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = pts[i - 1]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // y grows downward on the map: the right of (dx, dy) is (-dy, dx).
    return { x: p.x + (-dy / len) * lane, y: p.y + (dx / len) * lane };
  });
}

/** How much of a corner is cut, at most (tiles). A fraction of a long street would cut across lawns. */
const CORNER = 0.35;

/** Round each corner by cutting it a fixed small distance either side. */
function roundCorners(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const lab = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const lbc = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    const ta = Math.min(CORNER, lab / 2) / lab;
    const tc = Math.min(CORNER, lbc / 2) / lbc;
    out.push({ x: b.x + (a.x - b.x) * ta, y: b.y + (a.y - b.y) * ta });
    out.push({ x: b.x + (c.x - b.x) * tc, y: b.y + (c.y - b.y) * tc });
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Does every part of the polyline stay on walkable ground? (sampled every 0.1 tile) */
function walkableAlong(plan: TownPlan, pts: Pt[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    for (let k = 0; k <= n; k++) {
      if (!walkableAt(plan, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    }
  }
  return true;
}

/**
 * A walk from `from` to `to` along the streets. The first point is dropped
 * (the walker is already there); the last is exactly `to`.
 */
export function walkRoute(plan: TownPlan, from: Pt, to: Pt): Pt[] {
  const grid = findPath(plan, from, to);
  if (grid.length <= 1) return [{ x: to.x, y: to.y }];
  const pts = [{ x: from.x, y: from.y }, ...grid.slice(1, -1), { x: to.x, y: to.y }];
  // Shape the walk, then prove it: every candidate is checked along its whole
  // length, and the first one that stays on walkable ground wins.
  const lane = keepRight(simplify(pts), LANE);
  for (const candidate of [roundCorners(lane), lane, pts]) {
    if (walkableAlong(plan, candidate.slice(1))) return candidate.slice(1);
  }
  return pts.slice(1);
}

/**
 * A flight from `from` to `to`: straight up at the door, across above the
 * rooftops, straight down at the destination. Points carry `z` (height in tiles).
 */
export function flightRoute(from: Pt, to: Pt, cruise = FLY_CRUISE): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.05) return [{ x: to.x, y: to.y, z: 0 }];
  const ux = dx / dist;
  const uy = dy / dist;
  const climb = Math.min(FLY_CLIMB, dist / 2);
  return [
    { x: from.x + ux * climb, y: from.y + uy * climb, z: cruise },
    { x: to.x - ux * climb, y: to.y - uy * climb, z: cruise },
    { x: to.x, y: to.y, z: 0 },
  ];
}

/**
 * Where the n-th person waiting at a door stands: on the door tile, fanned out
 * away from the building, so nobody stands inside anybody else.
 */
const SLOTS: [number, number][] = [[0, 0], [-0.32, 0.18], [0.32, 0.18], [0, 0.36], [-0.36, 0.42], [0.36, 0.42]];
export function doorSlot(b: Placed, n: number): Pt {
  const [ox, oy] = SLOTS[n % SLOTS.length]!;
  const ring = Math.floor(n / SLOTS.length) * 0.06;
  return { x: b.doorAt.x + ox * (1 + ring), y: b.doorAt.y - 0.1 + oy + ring };
}
