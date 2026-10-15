/**
 * The replay, as the old town had it: pick what to replay (the last 25 or 100
 * transactions, the last 7 or 30 days, everything loaded), then the couriers
 * set out one after another, a beat apart, at 0.5× to 4×. Paced by
 * transaction, not by the clock, so a quiet month doesn't mean waiting. Pure:
 * the page drives it with real seconds.
 */

export type ReplayRange = { kind: 'count'; count: number } | { kind: 'days'; days: number } | { kind: 'all' };

/** The choices, by id (kept in the player's preferences). */
export const REPLAY_RANGES: readonly { id: string; label: string; range: ReplayRange }[] = [
  { id: 'count:25', label: 'Last 25 transactions', range: { kind: 'count', count: 25 } },
  { id: 'count:100', label: 'Last 100 transactions', range: { kind: 'count', count: 100 } },
  { id: 'days:7', label: 'Last 7 days', range: { kind: 'days', days: 7 } },
  { id: 'days:30', label: 'Last 30 days', range: { kind: 'days', days: 30 } },
  { id: 'all', label: 'Everything loaded', range: { kind: 'all' } },
];
export const DEFAULT_REPLAY_RANGE = 'count:100';

/** How fast: couriers a beat apart at 1×. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
/** Seconds between two couriers at 1×. */
export const REPLAY_GAP = 1.5;

const DAY_MS = 86_400_000;

/** The range for an id (the default for an unknown one). */
export function replayRange(id: string | null | undefined): { id: string; label: string; range: ReplayRange } {
  return REPLAY_RANGES.find((r) => r.id === id) ?? REPLAY_RANGES.find((r) => r.id === DEFAULT_REPLAY_RANGE)!;
}

/** The items a range takes, oldest first. Pure. */
export function inRange<T extends { time: number }>(items: readonly T[], range: ReplayRange, now = Date.now()): T[] {
  const sorted = [...items].sort((a, b) => a.time - b.time);
  if (range.kind === 'count') return sorted.slice(-range.count);
  if (range.kind === 'days') return sorted.filter((i) => i.time >= now - range.days * DAY_MS);
  return sorted;
}

/** Plays a list of items one after another: each `advance` hands out those it reached. */
export class ReplaySequence<T> {
  readonly items: readonly T[];
  /** How far along (in items; the next one to set out is the first at or after this). */
  position = 0;
  playing = false;
  /** 0.5 … 4 (REPLAY_SPEEDS). */
  speed = 1;

  constructor(items: readonly T[]) {
    this.items = items;
  }

  /**
   * Moves on by `seconds` of real time while playing; returns what it reached,
   * in order (the first item sets out as soon as it plays). At the end it stops.
   */
  advance(seconds: number): T[] {
    if (!this.playing || seconds <= 0) return [];
    const before = this.position;
    let after = Math.min(this.items.length, before + (seconds * this.speed) / REPLAY_GAP);
    const out: T[] = [];
    for (let i = Math.ceil(before); i < after; i++) out.push(this.items[i]!);
    // the last one has set out: the end
    if (Math.ceil(after) >= this.items.length) {
      after = this.items.length;
      this.playing = false;
    }
    this.position = after;
    return out;
  }

  /** Jump to an item (it sets out next); nothing is handed out for those skipped. */
  seek(index: number): void {
    this.position = Math.max(0, Math.min(this.items.length, index));
  }

  /** The item last handed out, or about to be (0-based), for "12 of 100". */
  get current(): number {
    return Math.max(0, Math.min(this.items.length - 1, Math.ceil(this.position) - 1));
  }

  /** At the end: everything handed out. */
  get done(): boolean {
    return this.position >= this.items.length;
  }
}
