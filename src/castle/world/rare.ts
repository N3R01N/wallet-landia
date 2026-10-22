/**
 * Rare moments for couriers: the guild's biggest transaction in the loaded
 * history walks in gold; a failed one at night walks as a pale ghost. Pure:
 * the scene dresses them (scene/wonders.ts).
 */

import type { Errand } from './world.js';

export type CourierLook = 'gold' | 'ghost';

/** The errand that moved the most (failed ones moved nothing); the latest on a tie, null when none moved any value. */
export function biggestErrand(errands: readonly Errand[]): Errand | null {
  let best: Errand | null = null;
  for (const e of errands) if (!e.failed && e.valueUsd > 0 && (!best || e.valueUsd >= best.valueUsd)) best = e;
  return best;
}

/** How a courier looks: gold for the biggest, a ghost for a failed one at night, else as usual. */
export function courierLook(errand: Errand, o: { biggest: string | null; night: boolean }): CourierLook | null {
  if (errand.key === o.biggest) return 'gold';
  if (errand.failed && o.night) return 'ghost';
  return null;
}
