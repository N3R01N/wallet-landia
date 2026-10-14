/**
 * The castle's world from the guild the domain layer builds (src/domain): how
 * many wallets (towers), how much the guild is worth (the keep's tier), which
 * protocols get a building in town (and how much is kept in each), and the
 * transactions as errands for couriers. Pure: no DOM, no WebGL.
 */

import type { ProtocolCategory } from '../../domain/catalog.js';
import type { Guild, Journey, PositionKind, Verb } from '../../domain/model.js';
import { tierOf } from '../../domain/tiers.js';
import { ethPriceFrom } from '../../world/chain.js';
import { SIGNATURE_PROTOCOLS, protocolFamily } from '../assets/manifest.js';

/** The castle's building categories (docs/ASSET_SPEC.md §3.5). */
export type BuildingCategory = 'lending' | 'dex' | 'staking' | 'nft' | 'governance' | 'bridge' | 'other';

/** Which castle building each of the domain's protocol categories gets. */
export const CATEGORY_FOR: Record<ProtocolCategory, BuildingCategory> = {
  dex: 'dex',
  aggregator: 'dex',
  lending: 'lending',
  staking: 'staking',
  restaking: 'staking',
  yield: 'staking',
  'nft-market': 'nft',
  mint: 'nft',
  bridge: 'bridge',
  governance: 'governance',
  names: 'governance',
  wrapper: 'other',
  airdrop: 'other',
  unknown: 'other',
};

export interface WorldProtocol {
  id: string;
  name: string;
  category: BuildingCategory;
  /** Value tier 0–6 of what the guild keeps there (gross: debt counts towards size). */
  tier: number;
  /** The signature building's protocol family (manifest SIGNATURE_PROTOCOLS), if it has one. */
  signature: string | null;
  /** What the guild keeps there, largest first: deposits, loans (negative), staked, rewards. */
  holdings: Holding[];
  /** Transactions of the guild's that went there, in the loaded window. */
  visits: number;
}

export interface Holding {
  /** Token name or symbol. */
  label: string;
  kind: PositionKind;
  /** Signed: a loan is negative. */
  usd: number;
  /** The wallet that keeps it. */
  wallet: string;
}

/** At most this many holdings per building's sheet. */
export const MAX_HOLDINGS = 12;

/** One transaction as a courier's errand. */
export interface Errand {
  key: string;
  /** The building it goes to or comes from; null: the town's far end (someone outside the town). */
  protocolId: string | null;
  /**
   * Out: a wallet sent it (the courier leaves the castle and pays the toll). In:
   * something arrived. Inside: goods passed between the guild's own wallets
   * (along the castle walls, from tower to tower).
   */
  direction: 'out' | 'in' | 'inside';
  /** It failed: the courier pays the toll, is turned back at the barrier, and goes home. */
  failed: boolean;
  /** For an errand inside the castle: the wallets' towers (their order in `wallets`). */
  fromTower?: number;
  toTower?: number;
  /** The transaction itself, for its sheet. */
  hash: string;
  chainId: string;
  verb: Verb;
  /** What it moved, in USD (approximate). */
  valueUsd: number;
  /** The toll: the fee paid, in USD (null: unknown, or not paid by the guild). */
  feeUsd: number | null;
  /** The wallet it belongs to. */
  wallet: string;
  /** The value tier of what it carries. */
  tier: number;
  time: number;
  label: string;
}

export interface CastleWorld {
  /** Wallets in the guild: a tower each. */
  wallets: number;
  /** The wallets' addresses, in their towers' order. */
  walletIds: string[];
  /** Each wallet's own value tier (its tower), in the same order. */
  walletTiers: number[];
  /** The guild's value tier: the keep. */
  tier: number;
  /** Buildings in town, most important first (nearest the gate). */
  protocols: WorldProtocol[];
  /** Errands, oldest first. */
  errands: Errand[];
  /** ETH's price as the wallets' holdings show it now (null: none held), for the weather. */
  ethUsd: number | null;
}

/** As many buildings as the town has slots for (plan.ts). */
export const MAX_BUILDINGS = 10;

export function worldFromGuild(guild: Guild): CastleWorld {
  const held = new Map<string, number>();
  for (const hero of guild.heroes) for (const s of hero.stashes) held.set(s.protocolId, (held.get(s.protocolId) ?? 0) + s.grossUsd);

  const protocols = [...guild.protocols.values()]
    .filter((p) => (held.get(p.id) ?? 0) > 0 || p.visits > 0)
    .sort((a, b) => (held.get(b.id) ?? 0) - (held.get(a.id) ?? 0) || b.visits - a.visits || a.name.localeCompare(b.name))
    .slice(0, MAX_BUILDINGS)
    .map((p): WorldProtocol => {
      const family = protocolFamily(p.id);
      const holdings: Holding[] = guild.heroes
        .flatMap((h) => h.stashes.filter((st) => st.protocolId === p.id).flatMap((st) => st.entries.map((e) => ({ label: e.name || e.symbol, kind: e.kind, usd: e.usd, wallet: h.address }))))
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
        .slice(0, MAX_HOLDINGS);
      return {
        id: p.id,
        name: p.name,
        category: CATEGORY_FOR[p.category] ?? 'other',
        tier: tierOf(held.get(p.id) ?? 0),
        signature: family in SIGNATURE_PROTOCOLS ? family : null,
        holdings,
        visits: p.visits,
      };
    });

  const shown = new Set(protocols.map((p) => p.id));
  const walletIds = guild.heroes.map((h) => h.address);
  const towerOf = new Map(walletIds.map((a, i) => [a, i]));
  // a send between two of the guild's wallets is one journey key on both sides: one errand
  const seen = new Set<string>();
  const errands: Errand[] = [];
  for (const j of guild.journeys) {
    if (seen.has(j.key)) continue;
    const e = errandOf(j, shown, towerOf);
    if (e) {
      seen.add(j.key);
      errands.push(e);
    }
  }
  const worth = guild.heroes.reduce((t, h) => t + h.netWorth, 0);
  return {
    wallets: guild.heroes.length,
    walletIds,
    walletTiers: guild.heroes.map((h) => h.tier),
    tier: tierOf(worth),
    protocols,
    errands,
    ethUsd: ethPriceFrom(guild.heroes.flatMap((h) => h.items)),
  };
}

/**
 * A journey as an errand, or null when it has no courier: someone else's failed
 * transaction, or a send between the guild's own wallets whose towers are not
 * on the walls. `towerOf`: each guild wallet's tower.
 */
export function errandOf(j: Journey, shownProtocols: ReadonlySet<string>, towerOf: ReadonlyMap<string, number> = new Map()): Errand | null {
  const failed = j.status === 'failed';
  if (failed && !j.initiated) return null; // only a wallet's own failure is its errand
  const base = {
    key: j.key,
    tier: j.tier,
    time: j.time,
    label: j.label,
    failed,
    hash: j.hash,
    chainId: j.chainId,
    verb: j.verb,
    valueUsd: j.valueUsd,
    feeUsd: j.initiated ? j.feeUsd : null,
    wallet: j.hero,
  };
  if (j.counterpartyHero !== null) {
    if (failed) return null;
    const [from, to] = j.initiated ? [j.hero, j.counterpartyHero] : [j.counterpartyHero, j.hero];
    const fromTower = towerOf.get(from);
    const toTower = towerOf.get(to);
    if (fromTower === undefined || toTower === undefined || fromTower === toTower) return null;
    return { ...base, protocolId: null, direction: 'inside', fromTower, toTower };
  }
  const building = j.steps.map((s) => s.target).find((t) => t.kind === 'building');
  const protocolId = building?.kind === 'building' && shownProtocols.has(building.protocolId) ? building.protocolId : null;
  return { ...base, protocolId, direction: j.initiated ? 'out' : 'in' };
}

/** The errands in `next` that `prev` did not have (new transactions to play now). */
export function newErrands(prev: CastleWorld | null, next: CastleWorld): Errand[] {
  const seen = new Set(prev?.errands.map((e) => e.key) ?? []);
  return next.errands.filter((e) => !seen.has(e.key));
}
