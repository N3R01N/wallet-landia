/**
 * A wallet's hall (docs/batches/17-wallet-halls.md): its tier picks the
 * building (lean-to … palace spire), and what the wallet mostly holds picks
 * its dressing: a counting house for tokens, a working guild for DeFi
 * positions, a gallery for NFTs.
 */

import type { Hero } from '../../domain/model.js';
import { TIER_FLOORS, TIER_NAMES, type Tier } from '../../domain/tiers.js';
import { HALL_KIND } from '../assets/manifest.js';

export type WalletFocus = 'tokens' | 'defi' | 'nft';

export const FOCUS_WORD: Record<WalletFocus, string> = { tokens: 'tokens', defi: 'DeFi positions', nft: 'NFTs' };

/** What the wallet mostly holds, by value: tokens in the wallet, positions in protocols (gross, debt counts toward the size), or NFTs at floor. Ties and an empty wallet: tokens. */
export function walletFocus(h: Pick<Hero, 'items' | 'stashes' | 'nftWorth'>): WalletFocus {
  const tokens = h.items.reduce((t, i) => t + Math.max(0, i.usd ?? 0), 0);
  const defi = h.stashes.reduce((t, s) => t + Math.abs(s.grossUsd), 0);
  const nft = Math.max(0, h.nftWorth);
  if (nft > tokens && nft > defi) return 'nft';
  if (defi > tokens) return 'defi';
  return 'tokens';
}

/** "Rare stone hall" for a tier. */
export function hallName(tier: number): string {
  const t = Math.max(0, Math.min(6, Math.round(tier)));
  return `${TIER_NAMES[t]} ${HALL_KIND[t]}`;
}

/** The next tier up and how much more it takes (null: at the top). */
export function nextHall(netWorth: number, tier: Tier): { name: string; needUsd: number } | null {
  if (tier >= 6) return null;
  const floor = TIER_FLOORS[tier + 1]!;
  return { name: hallName(tier + 1), needUsd: Math.max(0, floor - netWorth) };
}
