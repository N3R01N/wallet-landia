/** Where the player's land is staked out (both views draw the stakes). */

import { MAP_H, MAP_W, tileAt, type TownPlan } from '../world/layout.js';
import type { LandRect } from './view.js';

const STEP = 2;

/** Corners along the land's edge, every two tiles, where all four tiles round them are open ground. */
export function stakePoints(land: LandRect, plan: TownPlan): [number, number][] {
  const taken = new Uint8Array(MAP_W * MAP_H);
  for (const b of plan.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) taken[y * MAP_W + x] = 1;
  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
    const k = tileAt(plan, x, y);
    return taken[y * MAP_W + x] === 0 && (k === 'grass' || k === 'wilds' || k === 'sand');
  };
  const out: [number, number][] = [];
  const add = (x: number, y: number): void => {
    if (x <= 0 || y <= 0 || x >= MAP_W || y >= MAP_H) return; // the map's own edge needs no stakes
    if (open(x - 1, y - 1) && open(x, y - 1) && open(x - 1, y) && open(x, y)) out.push([x, y]);
  };
  for (let x = land.x0; x <= land.x1; x += STEP) {
    add(x, land.y0);
    add(x, land.y1);
  }
  for (let y = land.y0 + STEP; y < land.y1; y += STEP) {
    add(land.x0, y);
    add(land.x1, y);
  }
  return out;
}
