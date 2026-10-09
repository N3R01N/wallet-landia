/**
 * What the town shows at a glance about a guild's money:
 * - how safe each loan is (an estimated health factor per lending building),
 * - how much is waiting to be harvested (rewards ready to claim),
 * - how ETH moved since the player last looked.
 *
 * Zerion gives each protocol's collateral and debt in dollars but not the
 * protocol's own liquidation threshold, so health is an estimate with a
 * typical threshold (most blue-chip collateral sits around 80%); the sheet
 * says so and points to the protocol for the exact figure.
 */

import type { Stash } from './model.js';
import { tierOf, type Tier } from './tiers.js';

/** A typical liquidation threshold: the share of collateral value a loan may reach. */
export const TYPICAL_THRESHOLD = 0.8;

export type LoanLevel = 'safe' | 'watch' | 'danger' | 'critical';

export interface LoanHealth {
  collateralUsd: number;
  debtUsd: number;
  /** Debt over collateral. */
  ltv: number;
  /** Estimated health factor: threshold × collateral / debt (below 1 = liquidatable). */
  health: number;
  level: LoanLevel;
}

export function loanHealth(stash: Stash): LoanHealth | null {
  const debtUsd = stash.entries.filter((e) => e.kind === 'loan').reduce((s, e) => s + Math.abs(e.usd), 0);
  if (debtUsd <= 0) return null;
  const collateralUsd = stash.entries.filter((e) => e.kind === 'deposit' || e.kind === 'locked' || e.kind === 'staked').reduce((s, e) => s + Math.max(0, e.usd), 0);
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : Infinity;
  const health = collateralUsd > 0 ? (TYPICAL_THRESHOLD * collateralUsd) / debtUsd : 0;
  const level: LoanLevel = health >= 2 ? 'safe' : health >= 1.4 ? 'watch' : health >= 1.15 ? 'danger' : 'critical';
  return { collateralUsd, debtUsd, ltv, health, level };
}

export const LOAN_COLORS: Record<LoanLevel, string> = { safe: '#7fd36a', watch: '#f0c040', danger: '#ff8a3c', critical: '#ff4040' };

export const LOAN_WORDS: Record<LoanLevel, string> = {
  safe: 'safe: plenty of collateral',
  watch: 'worth watching',
  danger: 'in danger: add collateral or repay some',
  critical: 'near liquidation',
};

export type HarvestSize = 'little' | 'some' | 'lot';

export interface Harvest {
  usd: number;
  tier: Tier;
  size: HarvestSize;
}

/** Rewards waiting to be claimed in a building. */
export function harvestOf(stash: Stash): Harvest | null {
  return harvestOfUsd(stash.entries.filter((e) => e.kind === 'reward').reduce((s, e) => s + Math.max(0, e.usd), 0));
}

/** A harvest worth `usd` (null below a dollar). */
export function harvestOfUsd(usd: number): Harvest | null {
  if (usd < 1) return null;
  return { usd, tier: tierOf(usd), size: usd < 50 ? 'little' : usd < 1_000 ? 'some' : 'lot' };
}

export type PriceMood = 'boom' | 'up' | 'flat' | 'down' | 'crash';

export interface PriceMove {
  nowUsd: number;
  thenUsd: number;
  /** Change in percent since then. */
  pct: number;
  /** When the earlier price was seen (ms epoch). */
  since: number;
  mood: PriceMood;
}

export function priceMove(nowUsd: number, then: { usd: number; at: number }): PriceMove {
  const pct = ((nowUsd - then.usd) / then.usd) * 100;
  const mood: PriceMood = pct >= 8 ? 'boom' : pct >= 1.5 ? 'up' : pct > -1.5 ? 'flat' : pct > -8 ? 'down' : 'crash';
  return { nowUsd, thenUsd: then.usd, pct, since: then.at, mood };
}

export const MOOD_COLORS: Record<PriceMood, string> = { boom: '#5fe07a', up: '#9fdc6a', flat: '#e8dcc0', down: '#ff9a6a', crash: '#ff4a4a' };
