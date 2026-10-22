/**
 * The castle grows with you (docs/ENGAGEMENT.md A5): the pieces that reached a
 * higher tier than at the last visit, the keep first, then each wallet's hall.
 * Pure: the scene plays the moment (scene/growth.ts).
 */

import { TIER_NAMES } from '../assets/manifest.js';

/** A piece that grew: the keep, or a wallet's hall (its index in the guild's wallets). */
export interface Growth {
  piece: 'keep' | number;
  from: number;
  to: number;
}

/** What grew since `before` (the highest tiers reached then); a wallet new since then has not grown, it has arrived. */
export function grownSince(
  now: { tier: number; walletIds: readonly string[]; walletTiers: readonly number[] },
  before: { keep: number; wallets: Readonly<Record<string, number>> },
): Growth[] {
  const out: Growth[] = [];
  if (now.tier > before.keep) out.push({ piece: 'keep', from: before.keep, to: now.tier });
  now.walletIds.forEach((a, i) => {
    const was = before.wallets[a.toLowerCase()];
    const is = now.walletTiers[i] ?? 0;
    if (was !== undefined && is > was) out.push({ piece: i, from: was, to: is });
  });
  return out;
}

/** "Your keep is now Rare", "Vault's hall is now Epic". */
export function growthLine(g: Growth, walletName: (i: number) => string): string {
  const tier = TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, g.to))];
  return g.piece === 'keep' ? `Your keep is now ${tier}` : `${walletName(g.piece)}’s hall is now ${tier}`;
}
