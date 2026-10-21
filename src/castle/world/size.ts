/**
 * How big things stand in the town, from how much value they hold: a
 * protocol's buildings by its value locked on Ethereum (a DefiLlama snapshot,
 * tvl.json), on one scale with the guild's castle. Real values span a million
 * to tens of billions, so size grows with the fifth root: ten times the value
 * is about 1.6 times the size, a thousand times about 4. Aave's billions dwarf a
 * castle of a million, and a small protocol is still a house, not a speck.
 */

import snapshot from './tvl.json';
import { protocolFamily } from '../assets/manifest.js';

/** The value a size-1 building (a 2 × 2 m plot) stands for. */
export const SIZE_REFERENCE_USD = 1_000_000;
export const SIZE_MIN = 0.6;
export const SIZE_MAX = 8;

/** A building's size factor for the value it stands for (1 = a 2 × 2 m house). */
export function sizeFor(usd: number): number {
  const v = Number.isFinite(usd) && usd > 0 ? usd : SIZE_REFERENCE_USD;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, (v / SIZE_REFERENCE_USD) ** (1 / 5)));
}

const TVL: Readonly<Record<string, number>> = (snapshot as { tvl: Record<string, number> }).tvl;
const STANDING: Readonly<Record<string, number>> = (snapshot as { standing?: Record<string, number> }).standing ?? {};

/** A protocol's value locked on Ethereum (by its Zerion id), or null when the snapshot does not know it. */
export function tvlOf(protocolId: string): number | null {
  return TVL[protocolFamily(protocolId)] ?? null;
}

/**
 * What a protocol's building is sized by: its value locked, or for the few
 * that value locked cannot measure (a marketplace, a name registry) its
 * standing from a year's fees (scripts/fetch-tvl.ts), whichever is larger;
 * null when the snapshot knows neither.
 */
export function standingOf(protocolId: string): number | null {
  const family = protocolFamily(protocolId);
  const tvl = TVL[family];
  const standing = STANDING[family];
  if (tvl === undefined && standing === undefined) return null;
  return Math.max(tvl ?? 0, standing ?? 0);
}

/** When the snapshot was taken (YYYY-MM-DD). */
export const TVL_UPDATED: string = (snapshot as { updated: string }).updated;
