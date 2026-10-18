/**
 * The match's prices, moving all the time: every `priceStep` seconds each
 * token takes a step of the Siege market's model (a shared move by the
 * regime, the token's beta to it, its own noise; memecoins' jumps), scaled
 * from a game day (`daySeconds`) down to the step. Followers (stETH) track
 * their base. Seeded: the same seed, the same prices.
 */

import { BALANCE } from '../../game/config/balance.js';
import { dexp, normal, type Rng } from '../../game/core/detmath.js';
import type { Regime } from '../../game/core/types.js';
import { RULES, TOKEN_IDS, TOKENS, type TokenId } from '../data/rules.js';

const M = BALANCE.market;

export interface Market {
  prices: Record<TokenId, number>;
  regime: Regime;
  /** Seconds into the current day. */
  dayClock: number;
  day: number;
}

export function openingMarket(): Market {
  const prices = Object.fromEntries(TOKEN_IDS.map((t) => [t, TOKENS[t].price])) as Record<TokenId, number>;
  return { prices, regime: M.startRegime, dayClock: 0, day: 0 };
}

/** One price step (`RULES.priceStep` seconds). */
export function stepMarket(m: Market, rng: Rng): void {
  const share = RULES.priceStep / RULES.daySeconds;
  const regime = M.regimes[m.regime];
  const shared = regime.mu * share + regime.sigma * Math.sqrt(share) * normal(rng);
  for (const t of TOKEN_IDS) {
    const tok = TOKENS[t] as { cls: keyof typeof M.classes; follows?: TokenId };
    if (tok.follows) continue;
    const c = M.classes[tok.cls];
    if (c.sigma === 0 && c.beta === 0) continue;
    let r = c.beta * shared + c.sigma * Math.sqrt(share) * normal(rng);
    if (tok.cls === 'meme' && rng() < M.memeJumpChance * share) r += (rng() < 0.5 ? -1 : 1) * M.memeJump;
    m.prices[t] *= dexp(r);
  }
  for (const t of TOKEN_IDS) {
    const f = (TOKENS[t] as { follows?: TokenId }).follows;
    if (f) m.prices[t] = m.prices[f] * dexp(M.lstNoise * Math.sqrt(share) * normal(rng));
  }
  m.dayClock += RULES.priceStep;
  if (m.dayClock >= RULES.daySeconds) {
    m.dayClock = 0;
    m.day++;
    // the regime may change once a week
    if (m.day % 7 === 0 && rng() > M.regimeStay) {
      const others = (['bull', 'crab', 'bear'] as const).filter((r) => r !== m.regime);
      m.regime = others[Math.floor(rng() * others.length)]!;
    }
  }
}
