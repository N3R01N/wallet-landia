/**
 * Portfolio templates (spec: "Fully simulated"): the same five the NPC
 * archetypes start from. Shares of a budget, at the opening prices.
 */

import type { Catalog } from '../core/catalog.js';
import { qtyFor } from '../core/fixed.js';
import { DEFAULT_VENUE } from '../core/depth.js';
import type { Archetype, AssetId, Portfolio, Position, PositionKind, ProtocolFn } from '../core/types.js';

interface Slice {
  asset: AssetId;
  share: number;
  kind?: PositionKind;
  protocol?: ProtocolFn;
  /** LP: half the share goes to each token. */
  pairWith?: AssetId;
}

export const TEMPLATES: Readonly<Record<Archetype, { name: string; slices: Slice[] }>> = {
  degen: {
    name: 'Degen',
    slices: [
      { asset: 'pepe', share: 0.4 },
      { asset: 'shib', share: 0.4 },
      { asset: 'ldo', share: 0.1 },
      { asset: 'usdc', share: 0.1 },
    ],
  },
  whale: {
    name: 'Whale',
    slices: [
      { asset: 'wbtc', share: 0.45 },
      { asset: 'eth', share: 0.35 },
      { asset: 'usdc', share: 0.2 },
    ],
  },
  'stable-maxi': {
    name: 'Stable Maxi',
    slices: [
      { asset: 'usdc', share: 0.35 },
      { asset: 'dai', share: 0.25 },
      { asset: 'steth', share: 0.25, kind: 'staked', protocol: 'staking' },
      { asset: 'wbtc', share: 0.15 },
    ],
  },
  'yield-farmer': {
    name: 'Yield Farmer',
    slices: [
      { asset: 'eth', share: 0.3, kind: 'lp', protocol: 'dex', pairWith: 'usdc' },
      { asset: 'link', share: 0.25, kind: 'supplied', protocol: 'lending' },
      { asset: 'steth', share: 0.2, kind: 'staked', protocol: 'staking' },
      { asset: 'steth', share: 0.15, kind: 'restaked', protocol: 'restaking' },
      { asset: 'eth', share: 0.1 },
    ],
  },
  balanced: {
    name: 'Balanced',
    slices: [
      { asset: 'eth', share: 0.3 },
      { asset: 'wbtc', share: 0.2 },
      { asset: 'usdc', share: 0.2 },
      { asset: 'link', share: 0.07 },
      { asset: 'uni', share: 0.05 },
      { asset: 'aave', share: 0.05 },
      { asset: 'ldo', share: 0.05 },
      { asset: 'ens', share: 0.03 },
      { asset: 'pepe', share: 0.05 },
    ],
  },
};

/** A template's portfolio worth `budget` dollars at the catalog's opening prices. */
export function templatePortfolio(archetype: Archetype, budget: number, catalog: Catalog): Portfolio {
  const positions: Position[] = [];
  for (const s of TEMPLATES[archetype].slices) {
    const price = catalog.asset(s.asset).price;
    const dollars = budget * s.share;
    if (s.kind === 'lp' && s.pairWith) {
      positions.push({
        asset: s.asset,
        qty: qtyFor(dollars / 2, price),
        kind: 'lp',
        protocol: 'dex',
        pairWith: s.pairWith,
        pairQty: qtyFor(dollars / 2, catalog.asset(s.pairWith).price),
        venue: DEFAULT_VENUE.lp!,
      });
      continue;
    }
    const venue = s.kind ? DEFAULT_VENUE[s.kind === 'supplied' ? (s.protocol ?? 'lending') : s.kind] : undefined;
    positions.push({ asset: s.asset, qty: qtyFor(dollars, price), kind: s.kind ?? 'spot', ...(s.protocol ? { protocol: s.protocol } : {}), ...(venue ? { venue } : {}) });
  }
  return { positions, nfts: [], relics: [null, null, null] };
}
