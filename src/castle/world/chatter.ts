/**
 * What the townsfolk say (the old town's chatter, kept): about the ETH move
 * since the player's last visit, about the road (how busy the chain is and
 * what the toll costs), and about their own trade. Short, so a bubble holds it.
 */

import type { PriceMood } from '../../domain/risk.js';
import type { RoadLevel } from '../conditions.js';

const MARKET: Record<'dropped' | 'flat' | 'rose', readonly string[]> = {
  dropped: ["it's so over", 'what is wrong with ETH', 'NGMI', 'rekt', 'bags are heavy', 'ser, bear market', 'down bad', 'ETH is bleeding', 'wen bottom'],
  flat: ['slow day', 'nothing happening with ETH', 'wen moon', 'crab market', 'ETH is sleeping', 'touch grass, check chart', 'ngl, boring', 'ser, the chart is flat'],
  rose: ['to the moon', 'we are so back', 'WAGMI', 'LFG', 'send it', 'green candles', 'ETH is pumping', 'bullish af'],
};

const ROAD: Record<RoadLevel, readonly string[]> = {
  quiet: ['road is empty today', 'tolls are cheap, ser', 'quiet blocks', 'gas is low, ape now'],
  busy: ['busy road today', 'blocks are filling up', 'steady stream of couriers', 'the toll is creeping up'],
  crowded: ['the road is packed!', 'gas is through the roof', 'who is minting now?', 'tolls are brutal', 'wait for a quiet block'],
};

/** Each trade's own talk (by building category). */
const TRADE: Record<string, readonly string[]> = {
  lending: ['rates look tasty', 'mind your health factor', 'borrowing again, ser?', 'collateral is king'],
  dex: ['best price in town', 'swap you anything', 'watch the slippage', 'liquidity is deep today'],
  staking: ['yield is ripening', 'stake and relax', 'rewards come with patience', 'the granary is full'],
  nft: ['have you seen my JPEGs?', 'floor is floor', 'new art just dropped', 'this one is a grail'],
  governance: ['vote on the proposal!', 'quorum or bust', 'the council meets tonight', 'delegate to me, ser'],
  bridge: ['ships to the L2s at dawn', 'bridging is faster now', 'the harbour never sleeps', 'mind the fees across'],
  other: ['nice weather for a walk', 'gm', 'have you seen the courier?', 'lovely castle, ser'],
};

/** The market's mood in three: a drop, no real move, a rise. */
export function chatterFor(mood: PriceMood): 'dropped' | 'flat' | 'rose' {
  if (mood === 'down' || mood === 'crash') return 'dropped';
  if (mood === 'flat') return 'flat';
  return 'rose';
}

/** Everything a person of this trade may say now (the market's and the road's lines when known). */
export function linesFor(o: { mood: PriceMood | null; road: RoadLevel | null; trade: string }): string[] {
  return [...(o.mood ? MARKET[chatterFor(o.mood)] : []), ...(o.road ? ROAD[o.road] : []), ...(TRADE[o.trade] ?? TRADE.other!)];
}

/** One line (by a 0…1 roll, so tests can pick). */
export function pickLine(o: { mood: PriceMood | null; road: RoadLevel | null; trade: string }, roll: number): string {
  const lines = linesFor(o);
  return lines[Math.min(lines.length - 1, Math.floor(roll * lines.length))]!;
}
