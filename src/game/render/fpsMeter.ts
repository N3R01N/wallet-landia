/**
 * A small frames-per-second meter (spec, M3: "600 entities at 60 fps on a
 * mid-range laptop": the headless tests can't measure it; this lets a player
 * check on their own machine). Counts frames over each half second.
 */

import { el } from '../../util/dom.js';

export class FpsMeter {
  readonly element = el('div', { class: 'siege-fps', 'aria-live': 'off' }, '– fps');
  #frames = 0;
  #time = 0;
  /** The last reading. */
  fps = 0;

  /** Call once a frame with the frame's seconds. */
  tick(dt: number, extra = ''): void {
    this.#frames++;
    this.#time += dt;
    if (this.#time < 0.5) return;
    this.fps = this.#frames / this.#time;
    this.#frames = 0;
    this.#time = 0;
    this.element.textContent = `${Math.round(this.fps)} fps${extra ? ` · ${extra}` : ''}`;
    this.element.dataset.level = this.fps >= 55 ? 'good' : this.fps >= 30 ? 'ok' : 'low';
  }
}
