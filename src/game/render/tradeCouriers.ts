/**
 * A trade's courier (spec: "Couriers → Trade-phase animation only"): each
 * accepted command sends the town's courier from the castle to the building
 * of its kind (swaps to the exchange, loans to the bank, staking to the
 * staking house) with the tokens it gives, and back with what it gets. The
 * town's own courier timeline does the walking.
 */

import type { BuildingPlacement } from '../../castle/scene/plan.js';
import type { Errand } from '../../castle/world/world.js';
import type { Verb } from '../../domain/model.js';
import { qn } from '../core/fixed.js';
import type { Match } from '../core/match.js';
import type { Command } from '../core/types.js';

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

const VERB: Record<Command['t'], Verb> = {
  swap: 'swap',
  lpAdd: 'addLiquidity',
  lpRemove: 'removeLiquidity',
  stake: 'stake',
  unstake: 'unstake',
  restake: 'stake',
  supply: 'supply',
  withdraw: 'withdraw',
  borrow: 'borrow',
  repay: 'repay',
  slotRelic: 'buyNft',
  endTrade: 'unknown',
};

let serial = 0;

/** The building a command's courier goes to: a vault's own (Maker/Sky) when there is one, else the first of its kind; null: none in town. */
export function buildingFor(cmd: Command, buildings: readonly BuildingPlacement[]): BuildingPlacement | null {
  if ('via' in cmd && cmd.via === 'vault') {
    const vault = buildings.find((b) => /maker|sky/.test(b.protocol.id));
    if (vault) return vault;
  }
  return buildings.find((b) => b.protocol.category === GOES_TO[cmd.t]) ?? null;
}

export function tradeErrand(m: Match, cmd: Command, buildings: readonly BuildingPlacement[], gasUsd: number): Errand {
  const building = buildingFor(cmd, buildings);
  const prices = m.state.market.prices;
  const goods = (asset: string, qty: bigint) => {
    const a = m.catalog.has(asset) ? m.catalog.asset(asset) : null;
    return { symbol: a?.symbol ?? asset, quantity: qn(qty), usd: qn(qty) * (prices[asset] ?? 0), isNft: false };
  };
  const give = 'qty' in cmd ? [goods('from' in cmd ? cmd.from : 'a' in cmd ? cmd.a : cmd.asset, cmd.qty)] : [];
  const get = cmd.t === 'swap' ? [goods(cmd.to, 0n)] : [];
  const value = give.reduce((s, g) => s + g.usd, 0);
  return {
    key: `siege-${m.state.round}-${serial++}`,
    protocolId: building?.protocol.id ?? null,
    direction: 'out',
    failed: false,
    hash: '',
    chainId: 'ethereum',
    verb: VERB[cmd.t],
    valueUsd: value,
    feeUsd: gasUsd,
    wallet: '',
    steps: [{ verb: VERB[cmd.t], where: building?.protocol.name ?? 'the market', give, get }],
    method: null,
    block: null,
    tier: Math.max(0, Math.min(6, Math.floor(Math.log10(Math.max(1, value))) - 1)),
    time: 0,
    label: cmd.t,
    // a gas spike: the roads are full, the courier trudges
    ...(m.state.market.gasMult > 1 ? { pace: 0.45, lantern: true } : {}),
  };
}
