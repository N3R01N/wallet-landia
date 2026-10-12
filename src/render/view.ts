/**
 * What the app needs from any way of drawing the town. The 2D renderer (top-down
 * and isometric) and the 3D renderer both implement it over the same Sim.
 */

import type { HeroClass } from '../domain/model.js';
import type { Placed, PlacedKind } from '../world/layout.js';
import type { Sim } from '../world/sim.js';

export type ViewKind = 'top' | 'iso' | '3d';

export type HitTarget = { kind: 'building'; placed: Placed } | { kind: 'hero'; address: string };

export interface WorldView {
  /** What gets mounted in the page. */
  readonly element: HTMLElement;
  /** The surface pointer coordinates are measured against. */
  readonly canvas: HTMLCanvasElement;
  hover: HitTarget | null;
  selected: HitTarget | null;
  classOf: (address: string) => HeroClass;
  setSim(sim: Sim): void;
  fit(): void;
  draw(): void;
  hitTest(sx: number, sy: number): HitTarget | null;
  pan(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  /** Centre the camera on a tile position. */
  focus(x: number, y: number): void;
  /** Keep a hero in view (3D Quest Replay); optional. */
  /** Keep someone in view: a hero's address or any agent's id; `then` (an address) once they are gone. */
  follow?(key: string | null, then?: string | null): void;
  /** Who the camera keeps in view, if it follows anyone. */
  readonly following?: string | null;
  /** Orbit the camera; a no-op where the projection is fixed. */
  rotate(dx: number, dy: number): void;
  /** The ground point (tile units, fractional) under a screen point, or null off the ground. */
  groundAt(sx: number, sy: number): { x: number; y: number } | null;
  /** While the player builds: what to draw over the town (null: not building). */
  build: BuildOverlay | null;
  /** The player's land, staked out along its edge (null: none shown, e.g. a visited town). */
  land: LandRect | null;
}

/** A rectangle of tiles (x1/y1 exclusive). */
export interface LandRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What build mode draws: the tile grid, the player's land, and the building in hand (if any). */
export interface BuildOverlay {
  /** The land the player may build on (tiles, x1/y1 exclusive); outside it is drawn darker. */
  land: LandRect;
  ghost: BuildGhost | null;
}

/** A building held over the town, where it would stand. */
export interface BuildGhost {
  /** What it is (drawn as that building, see-through), and the protocol or hero it is for. */
  kind: PlacedKind;
  protocolId?: string;
  heroAddress?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Quarter turns from facing south. */
  rot: 0 | 1 | 2 | 3;
  /** The door tile, and the tiles its new road would take (tile indices y * MAP_W + x). */
  door: { x: number; y: number };
  road: number[];
  /** It may stand here (tinted green), or not (red). */
  ok: boolean;
}
