/**
 * The replay clock: plays the guild's history window as time passing, faster
 * than life. Each step it hands out the errands whose time it just passed, in
 * order, so couriers set out as their transactions happened. Pure: the page
 * drives it with real seconds.
 */

/** History per real second: an hour, a day, a week. */
export const REPLAY_SPEEDS = [
  { label: '1 hour / s', ms: 3_600_000 },
  { label: '1 day / s', ms: 86_400_000 },
  { label: '1 week / s', ms: 604_800_000 },
] as const;

export class ReplayClock<T extends { time: number }> {
  readonly from: number;
  readonly to: number;
  /** Where the clock stands (ms since the epoch). */
  position: number;
  playing = false;
  /** History (ms) per real second. */
  speed: number = REPLAY_SPEEDS[1].ms;
  readonly #items: readonly T[];

  /** `items` in any order; the window is from the first to the last (or `to`, if later). */
  constructor(items: readonly T[], to = Date.now()) {
    this.#items = [...items].sort((a, b) => a.time - b.time);
    this.from = this.#items[0]?.time ?? to;
    this.to = Math.max(to, this.#items[this.#items.length - 1]?.time ?? to);
    this.position = this.from;
  }

  /** Jump to a time (clamped to the window); nothing is handed out for the time skipped. */
  seek(t: number): void {
    this.position = Math.min(this.to, Math.max(this.from, t));
  }

  /**
   * Moves on by `seconds` of real time while playing; returns what it passed, in
   * order. At the window's end it stops. Starting exactly at an item's time
   * hands it out (the first errand plays when the replay starts).
   */
  advance(seconds: number): T[] {
    if (!this.playing || seconds <= 0) return [];
    const before = this.position;
    const after = Math.min(this.to, before + seconds * this.speed);
    const passed = this.#items.filter((i) => (i.time > before || (i.time === before && before === this.from)) && i.time <= after);
    this.position = after;
    if (after >= this.to) this.playing = false;
    return passed;
  }

  /** How far through the window, 0 … 1. */
  get progress(): number {
    return this.to === this.from ? 1 : (this.position - this.from) / (this.to - this.from);
  }
}
