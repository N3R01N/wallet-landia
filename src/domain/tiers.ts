/**
 * The one value scale. Mounts, homes, item frames, caravans and drama all read
 * from it, so a player learns the colours once (World Bible §0).
 */

export type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Lower bound of each tier, in USD. Config, not code: tune freely. */
export const TIER_FLOORS = [0, 10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;

export const TIER_NAMES = ['Dust', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;

export const TIER_COLORS = ['#9aa0a6', '#f4f1e8', '#5fbf4a', '#4a8fe0', '#a35fd6', '#ef8f2f', '#f5c518'] as const;

export function tierOf(usd: number | null | undefined): Tier {
  const v = Math.abs(usd ?? 0);
  let tier = 0;
  for (let i = TIER_FLOORS.length - 1; i >= 0; i--) {
    if (v >= (TIER_FLOORS[i] ?? Infinity)) {
      tier = i;
      break;
    }
  }
  return tier as Tier;
}

/** "~$12k" — the at-a-glance figure. Exact numbers live in the panels. */
export function approxUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '?';
  const v = Math.abs(usd);
  const sign = usd < 0 ? '-' : '';
  if (v < 1) return `${sign}<$1`;
  if (v < 1_000) return `${sign}~$${Math.round(v)}`;
  if (v < 1_000_000) return `${sign}~$${(v / 1_000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${sign}~$${(v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0)}M`;
}

export function exactUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return 'unpriced';
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function formatQty(q: number): string {
  if (q === 0) return '0';
  const a = Math.abs(q);
  if (a >= 1_000_000) return `${(q / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return q.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return q.toPrecision(3);
}
