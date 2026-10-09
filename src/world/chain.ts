/**
 * How busy the real chain is, as the town shows it at the Chronicle Tower:
 * the queue at its door (how full blocks are), the toll board (the base fee,
 * what a simple transfer costs, and which way it is heading) and the beacon
 * on its top (how expensive, at a glance from anywhere in town).
 *
 * Ethereum aims for half-full blocks: fuller than that and the base fee rises
 * by up to 12.5% a block, emptier and it falls. So fullness is how busy the
 * chain is now, and the base fee is what that has made it cost.
 */

export interface ChainState {
  /** The latest block seen (null until the first bell). */
  block: number | null;
  /** That block's fullness, gas used / gas limit (0..1). */
  busy: number;
  /** Fullness smoothed over recent blocks (0..1): the queue's length. */
  congestion: number;
  baseFeeGwei: number | null;
  txCount: number;
}

export interface BlockInfo {
  number: number;
  busy: number;
  baseFeeGwei: number | null;
  txCount: number;
}

export function initialChain(): ChainState {
  // a calm default until the first block arrives (offline, or the RPC is down)
  return { block: null, busy: 0.5, congestion: 0.35, baseFeeGwei: null, txCount: 0 };
}

/** The state after a new block (a repeat of the same block changes nothing). */
export function nextChain(prev: ChainState, b: BlockInfo): ChainState {
  if (prev.block === b.number) return prev;
  const busy = Math.min(1, Math.max(0, b.busy));
  return {
    block: b.number,
    busy,
    congestion: prev.block === null ? busy : prev.congestion * 0.6 + busy * 0.4,
    baseFeeGwei: b.baseFeeGwei,
    txCount: b.txCount,
  };
}

/** Gas for a plain ETH transfer. */
const TRANSFER_GAS = 21_000;

export type TollLevel = 'low' | 'mid' | 'high';

export interface Toll {
  gwei: number | null;
  /** What a plain transfer costs at this base fee, in USD (null without an ETH price). */
  transferUsd: number | null;
  /** 0 (cheap) … 1 (very expensive), on a log scale. */
  heat: number;
  level: TollLevel;
  /** Where the base fee goes next: up (block over half full), down, or about level. */
  trend: -1 | 0 | 1;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function tollOf(chain: ChainState, ethUsd: number | null): Toll {
  const gwei = chain.baseFeeGwei;
  const transferUsd = gwei !== null && ethUsd !== null ? gwei * 1e-9 * TRANSFER_GAS * ethUsd : null;
  // $0.02 a transfer is cool, $5 is red hot; without a price, 0.5 gwei to 100 gwei
  const heat =
    transferUsd !== null ? clamp01(Math.log10(transferUsd / 0.02) / Math.log10(5 / 0.02)) : gwei !== null ? clamp01(Math.log10(gwei / 0.5) / Math.log10(100 / 0.5)) : 0.2;
  const level: TollLevel = heat < 0.34 ? 'low' : heat < 0.67 ? 'mid' : 'high';
  const trend = chain.block === null ? 0 : chain.busy > 0.55 ? 1 : chain.busy < 0.45 ? -1 : 0;
  return { gwei, transferUsd, heat, level, trend };
}

export const TOLL_COLORS: Record<TollLevel, string> = { low: '#5fcf6a', mid: '#f0b030', high: '#ff5a3c' };

/** The beacon's colour for a heat: green, through amber, to red. */
export function heatColor(heat: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0.37, 0.81, 0.42],
    [0.94, 0.69, 0.19],
    [1.0, 0.35, 0.24],
  ];
  const t = clamp01(heat) * 2;
  const i = Math.min(1, Math.floor(t));
  const f = t - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function formatGwei(gwei: number): string {
  return gwei >= 10 ? gwei.toFixed(0) : gwei >= 1 ? gwei.toFixed(1) : gwei.toFixed(2);
}

export function formatTransferUsd(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : usd >= 0.01 ? `${Math.round(usd * 100)}¢` : '<1¢';
}

/** An ETH price from what the guild holds (USD value per ETH), or null. */
export function ethPriceFrom(items: readonly { symbol: string; category: string; quantity: number; usd: number | null }[]): number | null {
  const prices = items.filter((i) => i.category === 'native' && i.symbol.toUpperCase() === 'ETH' && i.quantity > 0 && (i.usd ?? 0) > 0).map((i) => (i.usd ?? 0) / i.quantity);
  if (prices.length === 0) return null;
  prices.sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)]!;
}
