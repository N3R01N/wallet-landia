/**
 * The ArmyBuilder: a portfolio at the day's prices becomes squads (spec:
 * "Units"). Unit stats are fixed; a position's value only sets how many.
 *
 *   count = floor(qty × price / (UNIT_VALUE × costMult))
 */

import { BALANCE } from '../config/balance.js';
import type { Catalog } from './catalog.js';
import { value } from './fixed.js';
import { holdingsOf } from './ledger.js';
import type { Army, AssetId, Role, SideState, Squad } from './types.js';

const B = BALANCE.match;

/** Spawn order front to back: Melee, then Ranged and Support, then Siege (cavalry and swarms with the line). */
export const ROLE_ORDER: readonly Role[] = ['melee', 'cavalry', 'swarm', 'ranged', 'support', 'siege'];

/** A side's army value: every non-stable holding (debt not taken off: borrowed tokens fight too). NFTs are not in it. */
export function armyValue(side: SideState, catalog: Catalog, prices: Readonly<Record<AssetId, number>>): number {
  return holdingsOf(side)
    .filter((h) => !catalog.asset(h.asset).isStable)
    .reduce((s, h) => s + value(h.qty, prices[h.asset] ?? 0), 0);
}

/**
 * UNIT_VALUE, fixed at setup: the larger starting army ÷ 120, so the bigger
 * side fields about 120 units. With no army on either side (all stables) the
 * larger total value stands in.
 */
export function unitValueFor(sides: readonly SideState[], catalog: Catalog, prices: Readonly<Record<AssetId, number>>): number {
  const army = Math.max(...sides.map((s) => armyValue(s, catalog, prices)));
  if (army > 0) return army / B.unitsAtStart;
  const total = Math.max(...sides.map((s) => holdingsOf(s).reduce((t, h) => t + value(h.qty, prices[h.asset] ?? 0), 0)));
  return Math.max(1, total / B.unitsAtStart);
}

export interface ArmyCtx {
  catalog: Catalog;
  prices: Readonly<Record<AssetId, number>>;
  unitValue: number;
}

export function buildArmy(side: SideState, ctx: ArmyCtx, atkMult = 1): Army {
  const groups = new Map<string, { asset: AssetId; unit: string; dollars: number; detonates: boolean }>();
  const add = (asset: AssetId, dollars: number, detonates: boolean) => {
    const unit = ctx.catalog.unitOf(asset);
    if (!unit) return;
    const key = `${asset}|${unit.id}|${detonates ? 1 : 0}`;
    const g = groups.get(key);
    if (g) g.dollars += dollars;
    else groups.set(key, { asset, unit: unit.id, dollars, detonates });
  };
  for (const h of holdingsOf(side)) add(h.asset, value(h.qty, ctx.prices[h.asset] ?? 0), false);
  // collateral seized in a liquidation comes back once, to blow up among its own side
  for (const l of side.liquidations) for (const s of l.seized) add(s.asset, s.value, true);

  const squads: Squad[] = [];
  for (const g of groups.values()) {
    if (g.dollars < B.dustUnits * ctx.unitValue) continue;
    const unit = ctx.catalog.unitOf(g.asset);
    if (!unit) continue;
    // (a hair of slack: $1,000 at $200 a unit is 5 units, not 4.999…)
    const count = Math.floor((g.dollars / (ctx.unitValue * unit.costMult)) * (1 + 1e-6));
    if (count <= 0) continue;
    squads.push({ asset: g.asset, unit: g.unit, count, stacks: [], ...(g.detonates ? { detonates: true } : {}) });
  }
  const role = (s: Squad) => ROLE_ORDER.indexOf(ctx.catalog.unitOf(s.asset)?.role ?? 'melee');
  squads.sort((a, b) => role(a) - role(b) || (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0) || Number(a.detonates ?? false) - Number(b.detonates ?? false));
  stackSquads(squads);
  return { side: side.id, squads, atkMult };
}

/**
 * Above the render cap a side's units merge into stacks of ×k (one entity, k
 * units), with k the same for the whole side: entities stay under the cap.
 */
export function stackSquads(squads: Squad[]): void {
  const total = squads.reduce((s, q) => s + q.count, 0);
  const entities = (k: number) => squads.reduce((n, q) => n + Math.ceil(q.count / k), 0);
  let k = Math.max(1, Math.ceil(total / B.renderCap));
  // every squad is at least one entity, so with more squads than the cap no k fits: stop at one stack per squad
  while (k < total && entities(k) > B.renderCap) k++;
  for (const s of squads) {
    const full = Math.floor(s.count / k);
    const rest = s.count - full * k;
    s.stacks = [...Array<number>(full).fill(k), ...(rest > 0 ? [rest] : [])];
  }
}

export function unitCount(army: Army): number {
  return army.squads.reduce((s, q) => s + q.count, 0);
}
