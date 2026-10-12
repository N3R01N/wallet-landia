/**
 * What the townsfolk say about the ETH price move shown on the board: crypto
 * talk for a drop, for a flat day, and for a rise. Short, so they fit a bubble.
 */

import type { PriceMood } from '../domain/risk.js';

export type ChatterMood = 'dropped' | 'flat' | 'rose';

const PHRASES: Record<ChatterMood, readonly string[]> = {
  dropped: ["it's so over", 'what is wrong with ETH', 'NGMI', 'rekt', 'bags are heavy', 'ser, bear market', 'down bad', 'ETH is bleeding', 'wen bottom'],
  flat: ['slow day', 'nothing happening with ETH', 'wen moon', 'crab market', 'ETH is sleeping', 'touch grass, check chart', 'ngl, boring', 'ser, the chart is flat'],
  rose: ['to the moon', 'we are so back', 'WAGMI', 'LFG', 'send it', 'green candles', 'ETH is pumping', 'bullish af'],
};

/** The group a price move falls in: a drop (down or crash), no real move (flat), or a rise (up or boom). */
export function chatterFor(mood: PriceMood): ChatterMood {
  if (mood === 'down' || mood === 'crash') return 'dropped';
  if (mood === 'flat') return 'flat';
  return 'rose';
}

/** The phrases the townsfolk may say for this price move. */
export function phrasesFor(mood: PriceMood): readonly string[] {
  return PHRASES[chatterFor(mood)];
}
