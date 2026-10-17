/**
 * The assets and unit types a match knows: the data files, plus any asset an
 * imported wallet brought (its category picks a fallback unit).
 */

import assetsJson from '../data/assets.json';
import unitsJson from '../data/units.json';
import type { Asset, AssetId, Category, PriceClass, UnitType, UnitTypeId } from './types.js';

interface AssetRow {
  id: string;
  symbol: string;
  category: string;
  class: string;
  price: number;
  unit?: string;
  follows?: string;
  stable?: boolean;
  collateral?: boolean;
}

export const BASE_ASSETS: readonly Asset[] = (assetsJson.assets as AssetRow[]).map((r) => ({
  id: r.id,
  symbol: r.symbol,
  category: r.category as Category,
  priceClass: r.class as PriceClass,
  isStable: r.stable === true,
  collateral: r.collateral !== false,
  price: r.price,
  ...(r.unit ? { curatedUnit: r.unit } : {}),
  ...(r.follows ? { follows: r.follows } : {}),
}));

export const UNIT_TYPES: Readonly<Record<UnitTypeId, UnitType>> = Object.fromEntries(
  Object.entries(unitsJson.units).map(([id, u]) => [id, { id, ...u } as UnitType]),
);

const FALLBACK = unitsJson.fallback as Record<string, UnitTypeId>;

export class Catalog {
  readonly #assets = new Map<AssetId, Asset>();

  constructor(custom: readonly Asset[] = []) {
    for (const a of BASE_ASSETS) this.#assets.set(a.id, a);
    for (const a of custom) if (!this.#assets.has(a.id)) this.#assets.set(a.id, a);
  }

  get assets(): Asset[] {
    return [...this.#assets.values()];
  }

  has(id: AssetId): boolean {
    return this.#assets.has(id);
  }

  asset(id: AssetId): Asset {
    const a = this.#assets.get(id);
    if (!a) throw new Error(`unknown asset ${id}`);
    return a;
  }

  /** The unit an asset fields: its curated one, else its category's fallback, else Militia. */
  unitOf(id: AssetId): UnitType | null {
    const a = this.asset(id);
    if (a.isStable) return null;
    const unitId = a.curatedUnit ?? FALLBACK[a.category] ?? 'militia';
    const u = UNIT_TYPES[unitId];
    if (!u) throw new Error(`unknown unit ${unitId}`);
    return u;
  }

  /** Assets with no curated unit (the Rug Pull's targets). */
  isFallback(id: AssetId): boolean {
    const a = this.asset(id);
    return !a.isStable && a.curatedUnit === undefined;
  }

  stables(): AssetId[] {
    return this.assets.filter((a) => a.isStable).map((a) => a.id);
  }
}

/** The staking token an asset stakes into (ETH → stETH), if it can be staked. */
export const STAKES_INTO: Readonly<Record<AssetId, AssetId>> = { eth: 'steth', weth: 'steth' };
/** What an LST unstakes back into. */
export const UNSTAKES_INTO: Readonly<Record<AssetId, AssetId>> = { steth: 'eth', reth: 'eth', weeth: 'eth' };
