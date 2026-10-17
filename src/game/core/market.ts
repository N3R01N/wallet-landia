/**
 * The Market: regimes, a week of daily candles per round, events and their
 * rumors (spec: "Price simulation", "Market events"). Seeded: the same seed
 * gives the same prices.
 *
 * Each daily log return is r = β·m + σ·ε + shock, with m ~ N(μ_regime, σ_market).
 */

import { BALANCE, type Regime } from '../config/balance.js';
import eventsJson from '../data/events.json';
import type { Catalog } from './catalog.js';
import { clamp, dexp, dlog, normal, streamOf, weighted, type Rng } from './detmath.js';
import type { AssetId, Candle, EventId, MarketEvent, MarketState, NftHolding } from './types.js';

const M = BALANCE.market;

export interface EventDef {
  name: string;
  weight: number;
  rumor: string;
  [k: string]: number | string;
}

export const EVENTS = eventsJson.events as unknown as Record<EventId, EventDef>;
export const EVENT_IDS = Object.keys(EVENTS) as EventId[];
export const CALM_RUMOR = eventsJson.calmRumor;

/** An event's number (events.json). */
export function eventNum(id: EventId, key: string): number {
  const v = EVENTS[id][key];
  if (typeof v !== 'number') throw new Error(`events.json: ${id}.${key} is not a number`);
  return v;
}

export function initialMarket(catalog: Catalog, nfts: readonly NftHolding[]): MarketState {
  const prices: Record<AssetId, number> = {};
  for (const a of catalog.assets) prices[a.id] = a.price;
  const nftFloors: Record<string, number> = {};
  for (const n of nfts) nftFloors[n.collection] = n.floor;
  return { regime: M.startRegime, prices, nftFloors, next: null, rumor: null, current: null, aftermath: [], candles: [], gasMult: 1 };
}

/** What the assets either side holds: Depeg and Rug Pull pick among them first. */
export interface Holdings {
  held: ReadonlySet<AssetId>;
}

/**
 * Draws the event of the next Market phase (round + 1) and the rumor shown in
 * this round's Trade phase. The rumor tells the truth with rumorAccuracy;
 * otherwise it names another outcome ("calm" counts as one).
 */
export function drawNext(seed: string, round: number, catalog: Catalog, holdings: Holdings): { next: MarketEvent | null; rumor: EventId | null } {
  const rng = streamOf(seed, 'events', round);
  let next: MarketEvent | null = null;
  if (rng() < BALANCE.events.chance) {
    const id = weighted(rng, EVENT_IDS.map((e) => [e, EVENTS[e].weight] as const));
    next = { id };
    if (id === 'depeg') next.target = pickTarget(rng, catalog.stables(), holdings);
    if (id === 'rug-pull') next.target = pickTarget(rng, catalog.assets.filter((a) => catalog.isFallback(a.id) && a.id !== 'drop').map((a) => a.id), holdings);
    if (id === 'black-swan') next.size = eventNum(id, 'dropMin') + rng() * (eventNum(id, 'dropMax') - eventNum(id, 'dropMin'));
  }
  return { next, rumor: rumorFor(rng, next?.id ?? null) };
}

export function rumorFor(rng: Rng, truth: EventId | null): EventId | null {
  if (rng() < BALANCE.events.rumorAccuracy) return truth;
  const others: (EventId | null)[] = [null, ...EVENT_IDS].filter((e) => e !== truth);
  return others[Math.floor(rng() * others.length)] ?? null;
}

function pickTarget(rng: Rng, ids: readonly AssetId[], holdings: Holdings): AssetId {
  const held = ids.filter((id) => holdings.held.has(id));
  const from = held.length > 0 ? held : ids;
  const id = from[Math.floor(rng() * from.length)];
  if (id === undefined) throw new Error('no target for the event');
  return id;
}

export function nextRegime(rng: Rng, regime: Regime): Regime {
  if (rng() < M.regimeStay) return regime;
  const others = (['bull', 'crab', 'bear'] as const).filter((r) => r !== regime);
  return others[rng() < 0.5 ? 0 : 1] ?? regime;
}

/**
 * Runs one Market phase in place: the regime switch, then the week of seven
 * daily candles with this round's event (market.next becomes market.current)
 * and the aftermath of earlier ones. `onDay` runs after each candle (the
 * liquidation checks).
 */
export function runMarket(market: MarketState, seed: string, round: number, catalog: Catalog, onDay: (candle: Candle) => void): void {
  const rng = streamOf(seed, 'market', round);
  market.regime = nextRegime(rng, market.regime);
  const event = market.next;
  market.current = event;
  market.next = null;
  market.rumor = null;
  market.gasMult = event?.id === 'gas-spike' ? eventNum('gas-spike', 'gasMult') : 1;

  const days = M.daysPerRound;
  const shock: Record<AssetId, number> = {};
  const addShock = (id: AssetId, totalMove: number) => {
    shock[id] = (shock[id] ?? 0) + dlog(1 + totalMove) / days;
  };
  const assets = catalog.assets;
  const memes = assets.filter((a) => a.priceClass === 'meme');
  for (const a of market.aftermath) {
    if (a.id === 'meme-fall') for (const m of memes) addShock(m.id, -eventNum('meme-mania', 'fallNext'));
  }
  if (event?.id === 'black-swan') for (const a of assets) if (!a.isStable && !a.follows) addShock(a.id, -(event.size ?? 0.25));
  if (event?.id === 'meme-mania') for (const m of memes) addShock(m.id, eventNum('meme-mania', 'rise'));
  if (event?.id === 'rug-pull' && event.target) addShock(event.target, -eventNum('rug-pull', 'drop'));
  const regime = M.regimes[market.regime];
  const drift = event?.id === 'bull-run' ? eventNum('bull-run', 'dailyDrift') : regime.mu;

  // stables: 1.00, except a depeg (and its recovery, a halving gap per round)
  const pegs: Record<AssetId, number> = {};
  for (const a of market.aftermath) {
    if (a.id === 'depeg-recover' && a.target) {
      a.value *= 1 - eventNum('depeg', 'recoverPerRound');
      pegs[a.target] = 1 - a.value;
    }
  }
  if (event?.id === 'depeg' && event.target) pegs[event.target] = eventNum('depeg', 'to');

  market.aftermath = market.aftermath.filter((a) => (a.id === 'depeg-recover' ? a.value > 0.005 : false));
  if (event?.id === 'meme-mania') market.aftermath.push({ id: 'meme-fall', value: 1 });
  if (event?.id === 'depeg' && event.target) market.aftermath.push({ id: 'depeg-recover', target: event.target, value: 1 - eventNum('depeg', 'to') });

  const candles: Candle[] = [];
  for (let day = 0; day < days; day++) {
    const open = { ...market.prices };
    const m = drift + regime.sigma * normal(rng);
    const ret: Record<AssetId, number> = {};
    // leaders first, then the assets that follow them
    for (const a of assets) {
      if (a.follows || a.isStable) continue;
      const c = M.classes[a.priceClass];
      let r = c.beta * m + c.sigma * normal(rng) + (shock[a.id] ?? 0);
      if (a.priceClass === 'meme' && rng() < M.memeJumpChance) r += dlog(1 + (rng() < 0.5 ? -M.memeJump : M.memeJump));
      ret[a.id] = r;
    }
    for (const a of assets) {
      if (a.isStable) {
        market.prices[a.id] = pegs[a.id] ?? 1;
        continue;
      }
      const r = a.follows ? (ret[a.follows] ?? 0) + M.lstNoise * normal(rng) + (shock[a.id] ?? 0) : (ret[a.id] ?? 0);
      // a token can lose nearly everything, never all of it
      market.prices[a.id] = Math.max(1e-12, (market.prices[a.id] ?? a.price) * dexp(clamp(r, -5, 5)));
    }
    const nft = M.classes.nft;
    for (const id of Object.keys(market.nftFloors).sort()) {
      const r = nft.beta * m + nft.sigma * normal(rng);
      market.nftFloors[id] = (market.nftFloors[id] ?? 0) * dexp(r);
    }
    const candle = { day, open, close: { ...market.prices } };
    candles.push(candle);
    onDay(candle);
  }
  market.candles = candles;
}
