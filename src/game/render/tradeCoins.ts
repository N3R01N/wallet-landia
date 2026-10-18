/**
 * A trade's coins (replacing the couriers: a trade is instant, and shows as
 * coins flying): what a command gives flies from the side's gate to the
 * building of its kind (swaps to the exchange, loans to the bank, staking to
 * the staking house), and what it gets flies back. The castle view's Exchange
 * does the flying.
 */

import type { BuildingPlacement } from '../../castle/scene/plan.js';
import type { Goods } from '../../domain/model.js';
import { qn } from '../core/fixed.js';
import { holdingsOf } from '../core/ledger.js';
import type { Match } from '../core/match.js';
import type { AssetId, Command, SideId } from '../core/types.js';

/** The building category each command goes to (CastleWorld's categories). */
const GOES_TO: Record<Command['t'], string> = {
  swap: 'dex',
  lpAdd: 'dex',
  lpRemove: 'dex',
  stake: 'staking',
  unstake: 'staking',
  restake: 'staking',
  supply: 'lending',
  withdraw: 'lending',
  borrow: 'lending',
  repay: 'lending',
  slotRelic: 'nft',
  endTrade: 'other',
};

/** The building a command's coins go to: a vault's own (Maker/Sky) when there is one, else the first of its kind; null: none in town. */
export function buildingFor(cmd: Command, buildings: readonly BuildingPlacement[]): BuildingPlacement | null {
  if ('via' in cmd && cmd.via === 'vault') {
    const vault = buildings.find((b) => /maker|sky/.test(b.protocol.id));
    if (vault) return vault;
  }
  return buildings.find((b) => b.protocol.category === GOES_TO[cmd.t]) ?? null;
}

/** A side's holdings before a command: per asset, all of it and the spot part. */
export interface Holdings {
  total: Map<AssetId, bigint>;
  spot: Map<AssetId, bigint>;
}

export function holdingsNow(m: Match, side: SideId): Holdings {
  const total = new Map<AssetId, bigint>();
  const spot = new Map<AssetId, bigint>();
  for (const h of holdingsOf(m.side(side))) {
    total.set(h.asset, (total.get(h.asset) ?? 0n) + h.qty);
    if (h.kind === 'spot') spot.set(h.asset, (spot.get(h.asset) ?? 0n) + h.qty);
  }
  return { total, spot };
}

export interface TradeFlight {
  /** Where the goods change hands (a building's person at its door); null: no building of its kind in town. */
  at: { x: number; z: number } | null;
  give: Goods[];
  get: Goods[];
}

/**
 * What an accepted command moved: what it gave (from the command) and what it
 * got (what the side holds now that it didn't before: a swap's tokens, a
 * borrow, stETH for staked ETH). Gas is not shown.
 */
export function tradeFlight(m: Match, side: SideId, cmd: Command, before: Holdings, buildings: readonly BuildingPlacement[]): TradeFlight {
  const b = buildingFor(cmd, buildings);
  const prices = m.state.market.prices;
  const goods = (asset: AssetId, qty: bigint): Goods => {
    const a = m.catalog.has(asset) ? m.catalog.asset(asset) : null;
    return { symbol: a?.symbol ?? asset, quantity: qn(qty), usd: qn(qty) * (prices[asset] ?? 0), isNft: false };
  };
  const now = holdingsNow(m, side);
  const give: Goods[] = [];
  const given = new Set<AssetId>();
  const out = (asset: AssetId, qty: bigint) => {
    if (qty <= 0n) return;
    give.push(goods(asset, qty));
    given.add(asset);
  };
  if (cmd.t === 'swap') out(cmd.from, cmd.qty);
  if (cmd.t === 'stake' || cmd.t === 'unstake' || cmd.t === 'restake' || cmd.t === 'supply' || cmd.t === 'repay') out(cmd.asset, cmd.qty);
  if (cmd.t === 'lpAdd') {
    out(cmd.a, cmd.qty);
    out(cmd.b, (before.spot.get(cmd.b) ?? 0n) - (now.spot.get(cmd.b) ?? 0n));
  }
  const get: Goods[] = [];
  const assets = new Set([...now.total.keys(), ...now.spot.keys()]);
  for (const asset of assets) {
    if (given.has(asset)) continue;
    const spotUp = (now.spot.get(asset) ?? 0n) - (before.spot.get(asset) ?? 0n);
    const totalUp = (now.total.get(asset) ?? 0n) - (before.total.get(asset) ?? 0n);
    const up = spotUp > totalUp ? spotUp : totalUp;
    if (up > 0n) get.push(goods(asset, up));
  }
  return { at: b ? { x: b.npc.x, z: b.npc.z } : null, give, get };
}
