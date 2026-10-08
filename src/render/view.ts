/**
 * What the app needs from any way of drawing the town. The 2D renderer (top-down
 * and isometric) and the 3D renderer both implement it over the same Sim.
 */

import type { HeroClass } from '../domain/model.js';
import type { Placed } from '../world/layout.js';
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
  /** Orbit the camera; a no-op where the projection is fixed. */
  rotate(dx: number, dy: number): void;
}
