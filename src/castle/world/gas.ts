/**
 * The toll by the bell's block (docs/ENGAGEMENT.md B1): the base fee read as
 * the road's mood at the barrier. A low fee waves couriers through; a high one
 * jams them: they queue at the barrier and wait longer, and the toll keeper
 * grumbles. Pure numbers; the view applies them.
 */

import type { Timing } from '../scene/courier.js';

export type GasLevel = 'quiet' | 'busy' | 'jammed';

/**
 * The thresholds, in one place: a base fee (gwei) below `below` is that level.
 * Mainnet's fee mostly sits well under a gwei since the gas limit rose; a few
 * gwei is a busy day, ten and more a rush (a big mint, a crash).
 */
export const GAS_LEVELS: readonly { level: GasLevel; below: number }[] = [
  { level: 'quiet', below: 1 },
  { level: 'busy', below: 10 },
  { level: 'jammed', below: Infinity },
];

/** The level for a block's base fee (null: no fee known, no block yet). */
export function gasLevel(baseFeeGwei: number | null | undefined): GasLevel | null {
  if (baseFeeGwei === null || baseFeeGwei === undefined || !Number.isFinite(baseFeeGwei) || baseFeeGwei < 0) return null;
  return GAS_LEVELS.find((g) => baseFeeGwei < g.below)!.level;
}

/** Seconds a courier waits at the barrier to pay, by level (busy is the usual toll). */
export const TOLL_WAIT: Record<GasLevel, number> = { quiet: 0.7, busy: 1.25, jammed: 4.5 };

/** A courier's timing with the toll's wait for the level (unknown: as it was). */
export function tollTiming(base: Timing, level: GasLevel | null): Timing {
  return level === null ? base : { ...base, toll: TOLL_WAIT[level] };
}

/** How far apart couriers queueing at the barrier stand (m), back towards the castle. */
export const QUEUE_GAP = 0.9;

/** Where each courier waiting at the barrier stands: the first at the stop, the rest one gap further back each. */
export function queueOffsets(waiting: number): number[] {
  return Array.from({ length: waiting }, (_, i) => -i * QUEUE_GAP);
}

/** What the toll keeper mutters on a jammed road. Short, so a bubble holds it. */
export const GRUMBLES: readonly string[] = ['one at a time!', 'the queue goes back to the bridge', 'gas is through the roof', 'pay up or wait, ser', 'who is minting now?', 'no tips, no hurry', 'busiest block all week'];

/** The toll keeper's grumble on a jammed road, by a 0…1 roll (null on any other road: he just takes the toll). */
export function grumble(level: GasLevel | null, roll: number): string | null {
  if (level !== 'jammed') return null;
  return GRUMBLES[Math.min(GRUMBLES.length - 1, Math.floor(roll * GRUMBLES.length))]!;
}
