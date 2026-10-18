/**
 * Where prices come from (spec: "Interface: PriceProvider with snapshot() and
 * step(round): Candle[]"). The match only talks to this interface:
 *
 * - SimPriceProvider: the seeded random walk with regimes and events (v1);
 * - HistoricalReplayProvider: real daily closes from a past range, a week a
 *   round (the events still happen; their price shocks don't, the history is
 *   what it was);
 * - a live feed plugs in the same way later.
 *
 * A provider is described by plain data (`PriceSource`) so a match setup, and
 * with it a replay, stays serialisable.
 */

import { BALANCE } from '../config/balance.js';
import type { Catalog } from './catalog.js';
import { streamOf } from './detmath.js';
import { initialMarket, nextRegime, runMarket } from './market.js';
import type { AssetId, Candle, MarketState, NftHolding } from './types.js';

export interface PriceProvider {
  /** The opening prices and NFT floors (setup values everything at these). */
  snapshot(): MarketState;
  /** Moves the market one round (a week of daily candles) and returns the candles. */
  step(market: MarketState, round: number): Candle[];
}

export type PriceSource =
  | { kind: 'sim' }
  /** Daily closes per asset, index 0 the opening; assets missing from it hold their opening price. */
  | { kind: 'historical'; closes: Record<AssetId, number[]>; label?: string };

export function providerFor(source: PriceSource | undefined, seed: string, catalog: Catalog, nfts: readonly NftHolding[]): PriceProvider {
  if (source?.kind === 'historical') return new HistoricalReplayProvider(source.closes, seed, catalog, nfts);
  return new SimPriceProvider(seed, catalog, nfts);
}

export class SimPriceProvider implements PriceProvider {
  constructor(
    readonly seed: string,
    readonly catalog: Catalog,
    readonly nfts: readonly NftHolding[],
  ) {}

  snapshot(): MarketState {
    return initialMarket(this.catalog, this.nfts);
  }

  step(market: MarketState, round: number): Candle[] {
    runMarket(market, this.seed, round, this.catalog, () => {});
    return market.candles;
  }
}

export class HistoricalReplayProvider implements PriceProvider {
  readonly #closes: Record<AssetId, number[]>;

  constructor(
    closes: Record<AssetId, number[]>,
    readonly seed: string,
    readonly catalog: Catalog,
    readonly nfts: readonly NftHolding[],
  ) {
    this.#closes = closes;
  }

  snapshot(): MarketState {
    const m = initialMarket(this.catalog, this.nfts);
    for (const [id, series] of Object.entries(this.#closes)) if (series[0] !== undefined) m.prices[id] = series[0];
    return m;
  }

  step(market: MarketState, round: number): Candle[] {
    // the regime and the event still turn (the HUD and the event rules use them); the prices are history's
    market.regime = nextRegime(streamOf(this.seed, 'market', round), market.regime);
    market.current = market.next;
    market.next = null;
    market.rumor = null;
    market.gasMult = market.current?.id === 'gas-spike' ? 5 : 1;
    const days = BALANCE.market.daysPerRound;
    const first = (round - 2) * days;
    const candles: Candle[] = [];
    for (let d = 0; d < days; d++) {
      const open = { ...market.prices };
      for (const [id, series] of Object.entries(this.#closes)) {
        // past the end of the series, the last close holds
        const v = series[Math.min(series.length - 1, first + d + 1)];
        if (v !== undefined) market.prices[id] = v;
      }
      candles.push({ day: d, open, close: { ...market.prices } });
    }
    market.candles = candles;
    return candles;
  }
}
