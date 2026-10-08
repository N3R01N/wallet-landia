/**
 * The ground and its scenery, baked once per projection into one big canvas.
 * Slots: env.ground.<kind>, env.tree.
 */

import { MAP_H, MAP_W, tileAt, type TileKind, type TownPlan } from '../world/layout.js';
import { hashString, makeRng } from '../util/rng.js';
import { P, poly, px, shade, sprite, type Sprite } from './pixel.js';
import { ISO_H, ISO_W } from './buildings.js';

const T = 16;

const BASE: Record<TileKind, string> = {
  grass: '#78b856',
  road: '#c9a878',
  plaza: '#cfc6b2',
  water: '#4a90c8',
  wilds: '#4f8a46',
  sand: '#e6d29a',
  path: '#d6bb8a',
};

/** Which sides of a tile border something that is not street (for footpath edges). */
type Edges = { n: boolean; s: boolean; e: boolean; w: boolean };
const NO_EDGES: Edges = { n: false, s: false, e: false, w: false };

function edgesOf(plan: TownPlan, x: number, y: number): Edges {
  const street = (k: TileKind): boolean => k === 'road' || k === 'plaza' || k === 'path';
  return {
    n: !street(tileAt(plan, x, y - 1)),
    s: !street(tileAt(plan, x, y + 1)),
    e: !street(tileAt(plan, x + 1, y)),
    w: !street(tileAt(plan, x - 1, y)),
  };
}

function tileTexture(c: CanvasRenderingContext2D, kind: TileKind, x: number, y: number, ox: number, oy: number, edges: Edges = NO_EDGES): void {
  const rng = makeRng(hashString(`${x},${y}`));
  const base = BASE[kind];
  px(c, ox, oy, T, T, (x + y) % 2 === 0 ? base : shade(base, -0.04));
  switch (kind) {
    case 'grass':
    case 'wilds':
      for (let i = 0; i < 5; i++) px(c, ox + rng() * 15, oy + rng() * 14, 1, 2, shade(base, rng() > 0.5 ? 0.18 : -0.15));
      if (rng() < 0.12) px(c, ox + rng() * 14, oy + rng() * 14, 2, 2, ['#f4e04a', '#f08ab0', '#ffffff'][Math.floor(rng() * 3)] ?? '#fff');
      break;
    case 'road':
      for (let i = 0; i < 4; i++) px(c, ox + rng() * 14, oy + rng() * 14, 2, 1, shade(base, -0.15));
      break;
    case 'path': {
      // a trodden footpath: grass creeps in only where it borders lawn
      const g = shade(BASE.grass, -0.05);
      if (edges.w) px(c, ox, oy, 2, T, g);
      if (edges.e) px(c, ox + T - 2, oy, 2, T, g);
      if (edges.n) px(c, ox, oy, T, 2, g);
      if (edges.s) px(c, ox, oy + T - 2, T, 2, g);
      for (let i = 0; i < 3; i++) px(c, ox + 4 + rng() * 7, oy + 3 + rng() * 9, 3, 2, shade(base, 0.15));
      break;
    }
    case 'plaza':
      px(c, ox, oy, T, 1, shade(base, -0.12));
      px(c, ox, oy, 1, T, shade(base, -0.12));
      px(c, ox + 8, oy + 8, 8, 1, shade(base, -0.08));
      break;
    case 'water':
      for (let i = 0; i < 2; i++) px(c, ox + rng() * 12, oy + rng() * 14, 4, 1, shade(base, 0.3));
      break;
    case 'sand':
      for (let i = 0; i < 3; i++) px(c, ox + rng() * 15, oy + rng() * 15, 1, 1, shade(base, -0.15));
      break;
  }
}

export interface Ground {
  canvas: HTMLCanvasElement;
  /** World-art-pixel position of the canvas' top-left. */
  x: number;
  y: number;
}

export function bakeTopGround(plan: TownPlan): Ground {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * T;
  canvas.height = MAP_H * T;
  const c = canvas.getContext('2d');
  if (c === null) throw new Error('no 2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) tileTexture(c, tileAt(plan, x, y), x, y, x * T, y * T, edgesOf(plan, x, y));
  return { canvas, x: 0, y: 0 };
}

export function bakeIsoGround(plan: TownPlan): Ground {
  const W = (MAP_W + MAP_H) * ISO_W;
  const H = (MAP_W + MAP_H) * ISO_H + 40;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (c === null) throw new Error('no 2d');
  // Draw each tile's texture into a square, then shear it into the diamond.
  const tile = document.createElement('canvas');
  tile.width = T;
  tile.height = T;
  const tc = tile.getContext('2d');
  if (tc === null) throw new Error('no 2d');
  const ox = MAP_H * ISO_W;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      tileTexture(tc, tileAt(plan, x, y), x, y, 0, 0, edgesOf(plan, x, y));
      const sx = ox + (x - y) * ISO_W;
      const sy = (x + y) * ISO_H;
      c.setTransform(ISO_W / T, ISO_H / T, -ISO_W / T, ISO_H / T, sx, sy);
      c.drawImage(tile, 0, 0);
      // a hint of overlap hides hairline seams
      c.drawImage(tile, 0, 0, T, T, -0.05, -0.05, T + 0.1, T + 0.1);
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  // the map's edge, as a little earth cliff
  poly(c, [[ox - MAP_H * ISO_W, MAP_H * ISO_H], [ox + (MAP_W - MAP_H) * ISO_W, (MAP_W + MAP_H) * ISO_H], [ox + (MAP_W - MAP_H) * ISO_W, (MAP_W + MAP_H) * ISO_H + 10], [ox - MAP_H * ISO_W, MAP_H * ISO_H + 10]], '#8a6a4a');
  poly(c, [[ox + (MAP_W - MAP_H) * ISO_W, (MAP_W + MAP_H) * ISO_H], [ox + MAP_W * ISO_W, MAP_W * ISO_H], [ox + MAP_W * ISO_W, MAP_W * ISO_H + 10], [ox + (MAP_W - MAP_H) * ISO_W, (MAP_W + MAP_H) * ISO_H + 10]], '#6a4a2a');
  return { canvas, x: -ox, y: 0 };
}

export interface Prop {
  x: number;
  y: number;
  kind: 'tree' | 'pine' | 'bush' | 'rock';
}

/** Scenery on free grass, away from roads and doors. Deterministic. */
export function scatterProps(plan: TownPlan): Prop[] {
  const rng = makeRng(7);
  const props: Prop[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = tileAt(plan, x, y);
      if ((k !== 'grass' && k !== 'wilds') || plan.walkable[y * MAP_W + x] === 0) continue;
      let nearRoad = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = tileAt(plan, x + dx, y + dy);
          if (n === 'road' || n === 'plaza' || n === 'path' || plan.walkable[(y + dy) * MAP_W + x + dx] === 0) nearRoad = true;
        }
      if (nearRoad) continue;
      const r = rng();
      const edge = x < 2 || y < 3 || x > MAP_W - 3 || k === 'wilds';
      if (r < (edge ? 0.45 : 0.1)) props.push({ x: x + 0.5, y: y + 0.8, kind: k === 'wilds' || rng() < 0.3 ? 'pine' : rng() < 0.7 ? 'tree' : 'bush' });
      else if (r < (edge ? 0.5 : 0.12)) props.push({ x: x + 0.5, y: y + 0.8, kind: 'rock' });
    }
  }
  return props;
}

export function propSprite(kind: Prop['kind']): Sprite {
  return sprite(`prop:${kind}`, 24, 32, 12, 30, (c) => {
    c.fillStyle = P.shadow;
    c.beginPath();
    c.ellipse(12, 30, 7, 2, 0, 0, Math.PI * 2);
    c.fill();
    switch (kind) {
      case 'tree':
        px(c, 11, 20, 3, 10, P.woodDark);
        for (const [x, y, r, col] of [[12, 14, 8, '#3f8a3a'], [8, 16, 5, '#357a32'], [16, 15, 5, '#4a9a42'], [12, 9, 6, '#58aa4a']] as const) {
          c.fillStyle = col;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
        px(c, 10, 8, 2, 2, '#7ac860');
        break;
      case 'pine':
        px(c, 11, 24, 2, 6, P.woodDark);
        poly(c, [[3, 26], [21, 26], [12, 10]], '#2f6a3a');
        poly(c, [[5, 19], [19, 19], [12, 4]], '#3a7a44');
        poly(c, [[12, 26], [21, 26], [12, 10]], '#285a32');
        break;
      case 'bush':
        c.fillStyle = '#4a9a42';
        c.beginPath();
        c.arc(9, 26, 4, 0, Math.PI * 2);
        c.arc(15, 26, 4, 0, Math.PI * 2);
        c.arc(12, 23, 4, 0, Math.PI * 2);
        c.fill();
        px(c, 10, 22, 2, 2, '#e05060');
        break;
      case 'rock':
        poly(c, [[6, 30], [18, 30], [16, 24], [10, 23]], P.stoneDark);
        poly(c, [[10, 23], [16, 24], [14, 26], [9, 26]], P.stone);
        break;
    }
  });
}
