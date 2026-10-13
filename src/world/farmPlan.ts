/**
 * The farm: how many animals the guild's wealth keeps, and the paddock they
 * live in (a fenced rectangle on open meadow, away from the buildings). The
 * paddock is solid for people on the plan, and the animals keep their own
 * distance from each other and from the fence. Pure: the 3D farm draws it.
 */

import { MAP_H, MAP_W } from './layout.js';

export const HERD = { max: 8, perDecade: 2 } as const;
/** The paddock, in tiles; how far from any building it must lie; and the animals' hitbox radius (tiles). */
export const PADDOCK = { w: 6, h: 5, clear: 4, radius: 0.3 } as const;

/** A rectangle in tile edges: x0..x1 and z0..z1, the far edges exclusive. */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Animals kept for a net worth: none for a bedroll's worth, more on a log scale, capped. */
export function herdFor(netWorthUsd: number): number {
  const nw = Math.max(0, Number.isFinite(netWorthUsd) ? netWorthUsd : 0);
  return Math.min(HERD.max, Math.round(HERD.perDecade * Math.log10(1 + nw / 1000)));
}

/** The paddock's tile rectangle, centred on a tile. */
export function paddockRect(c: { x: number; y: number }): Rect {
  const x0 = c.x - Math.floor(PADDOCK.w / 2);
  const z0 = c.y - Math.floor(PADDOCK.h / 2);
  return { x0, x1: x0 + PADDOCK.w, z0, z1: z0 + PADDOCK.h };
}

/** Empty ground between a rectangle and a building, in tiles (the larger of the two gaps). */
function gapTo(r: Rect, b: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(0, b.x - (r.x1 - 1), r.x0 - (b.x + b.w - 1));
  const dy = Math.max(0, b.y - (r.z1 - 1), r.z0 - (b.y + b.h - 1));
  return Math.max(dx, dy);
}

/**
 * A paddock on open meadow near the middle of the town: every tile of it walkable, and at least
 * PADDOCK.clear tiles of ground clear of every building. The nearest such spot to the map's middle,
 * or null when there is none.
 */
export function paddockSpot(walkable: Uint8Array, buildings: readonly { x: number; y: number; w: number; h: number }[]): { x: number; y: number } | null {
  const mx = MAP_W / 2;
  const my = MAP_H / 2;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d >= bestD) continue;
      const r = paddockRect({ x, y });
      if (r.x0 < 0 || r.z0 < 0 || r.x1 > MAP_W || r.z1 > MAP_H) continue;
      let open = true;
      for (let tz = r.z0; open && tz < r.z1; tz++) for (let tx = r.x0; tx < r.x1; tx++) if (walkable[tz * MAP_W + tx] !== 1) open = false;
      if (!open) continue;
      if (buildings.some((b) => gapTo(r, b) < PADDOCK.clear)) continue;
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** Make the paddock solid for people on the plan: they walk round it, not through the animals. */
export function blockPaddock(walkable: Uint8Array, r: Rect): void {
  for (let tz = Math.max(0, r.z0); tz < Math.min(MAP_H, r.z1); tz++) {
    for (let tx = Math.max(0, r.x0); tx < Math.min(MAP_W, r.x1); tx++) walkable[tz * MAP_W + tx] = 0;
  }
}

/**
 * Keep the animals apart and inside their paddock: any two closer than 2 × radius are pushed
 * apart, and every animal is held `radius` inside the fence. Moves the points in place.
 */
export function separateHerd(points: { x: number; z: number }[], radius: number, r: Rect, rounds = 3): void {
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = 2 * radius;
        if (d >= min) continue;
        // (two animals in the same place part along x)
        const ux = d > 1e-6 ? dx / d : 1;
        const uz = d > 1e-6 ? dz / d : 0;
        const push = (min - d) / 2;
        a.x -= ux * push;
        a.z -= uz * push;
        b.x += ux * push;
        b.z += uz * push;
      }
    }
  }
  for (const p of points) {
    p.x = Math.min(r.x1 - radius, Math.max(r.x0 + radius, p.x));
    p.z = Math.min(r.z1 - radius, Math.max(r.z0 + radius, p.z));
  }
}
