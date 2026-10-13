/**
 * The farm: how many animals the guild's wealth keeps, and where their paddock
 * stands (open meadow, away from the buildings). Pure: the 3D farm draws it.
 */

import { MAP_H, MAP_W } from './layout.js';

export const HERD = { max: 8, perDecade: 2 } as const;

/** Animals kept for a net worth: none for a bedroll's worth, more on a log scale, capped. */
export function herdFor(netWorthUsd: number): number {
  const nw = Math.max(0, Number.isFinite(netWorthUsd) ? netWorthUsd : 0);
  return Math.min(HERD.max, Math.round(HERD.perDecade * Math.log10(1 + nw / 1000)));
}

/**
 * A paddock on the meadow near the middle of the town: the open tile nearest the town's middle that has
 * at least PADDOCK.clear tiles of ground clear of every building (the furthest-out tiles, by water or
 * the map's edge, are not where anyone looks). Null when there is no such meadow.
 */
export const PADDOCK = { clear: 4 } as const;

export function paddockSpot(walkable: Uint8Array, buildings: readonly { x: number; y: number; w: number; h: number }[]): { x: number; y: number } | null {
  const mx = MAP_W / 2;
  const my = MAP_H / 2;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (walkable[y * MAP_W + x] !== 1) continue;
      const d = Math.hypot(x - mx, y - my);
      if (d >= bestD) continue;
      let clear = Infinity;
      for (const b of buildings) {
        const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
        const dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
        clear = Math.min(clear, Math.max(dx, dy));
        if (clear < PADDOCK.clear) break;
      }
      if (clear >= PADDOCK.clear) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}
