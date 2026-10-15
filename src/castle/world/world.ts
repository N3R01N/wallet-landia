/**
 * The castle's world from the guild the domain layer builds (src/domain): how
 * many wallets (towers), how much the guild is worth (the keep's tier), which
 * protocols get a building in town (and how much is kept in each), and the
 * transactions as errands for couriers. Pure: no DOM, no WebGL.
 */

import type { ProtocolCategory } from '../../domain/catalog.js';
import type { Goods, Guild, Journey, PositionKind, Verb } from '../../domain/model.js';
import { tierOf } from '../../domain/tiers.js';
import { walletFocus, type WalletFocus } from './halls.js';
import { ethPriceFrom } from '../../domain/risk.js';
import { SIZE_REFERENCE_USD, sizeFor, tvlOf } from './size.js';
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
  /** Its value locked on Ethereum (the snapshot in tvl.json), or null when unknown. */
  tvlUsd: number | null;
  /** How big its building stands (size.ts: 1 = a 2 × 2 m house). */
  size: number;
  /** The protocol's icon as Zerion gives it (for a logo when the bundled snapshot has none). */
  iconUrl: string | null;
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
  /** Each stop, for the Quest Replay: what was done where, goods given and received. */
  steps: ErrandStep[];
  /** The contract method, when known ("Multicall"). */
  method: string | null;
  block: number | null;
  /** The value tier of what it carries. */
  tier: number;
  time: number;
  label: string;
}

export interface ErrandStep {
  verb: Verb;
  /** Where: a protocol's name, one of the guild's wallets, or someone outside. */
  where: string;
  give: Goods[];
  get: Goods[];
}

export interface CastleWorld {
  /** Wallets in the guild: a tower each. */
  wallets: number;
  /** The wallets' addresses, in their towers' order. */
  walletIds: string[];
  /** Each wallet's own value tier (its tower), in the same order. */
  walletTiers: number[];
  /** What each wallet mostly holds (its hall's dressing), in the same order. */
  walletFocus?: WalletFocus[];
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
export const MAX_BUILDINGS = 16;
/** How many of the latest journeys count as recent (the castle replays about this many). */
const RECENT_JOURNEYS = 24;

export function worldFromGuild(guild: Guild): CastleWorld {
  const held = new Map<string, number>();
  for (const hero of guild.heroes) for (const s of hero.stashes) held.set(s.protocolId, (held.get(s.protocolId) ?? 0) + s.grossUsd);

  // the protocols the recent couriers go to come first after what the guild holds (every one a courier
  // visits should have its building: an approval for OpenSea, a one-off swap)
  const recent = new Set<string>();
  for (const j of guild.journeys.slice(-RECENT_JOURNEYS)) for (const st of j.steps ?? []) if (st.target.kind === 'building') recent.add(st.target.protocolId);
  const rank = (id: string) => ((held.get(id) ?? 0) > 0 ? 0 : recent.has(id) ? 1 : 2);
  // one building per protocol family: OpenSea's Seaport and SeaDrop, Aave's v2 and v3 share one (the first
  // in the order stands for the family; what the guild holds in the others counts there too)
  const members = new Map<string, string[]>();
  const familyOf = new Map<string, string>();
  const candidates = [...guild.protocols.values()]
    .filter((p) => (held.get(p.id) ?? 0) > 0 || p.visits > 0)
    .sort((a, b) => rank(a.id) - rank(b.id) || (held.get(b.id) ?? 0) - (held.get(a.id) ?? 0) || b.visits - a.visits || a.name.localeCompare(b.name))
    .filter((p) => {
      const fam = protocolFamily(p.id);
      const first = familyOf.get(fam);
      if (first !== undefined) {
        members.get(first)!.push(p.id);
        return false;
      }
      familyOf.set(fam, p.id);
      members.set(p.id, [p.id]);
      return true;
    });
  const sumHeld = (id: string) => (members.get(id) ?? [id]).reduce((t, m) => t + (held.get(m) ?? 0), 0);
  const protocols = candidates
    .slice(0, MAX_BUILDINGS)
    .map((p): WorldProtocol => {
      const family = protocolFamily(p.id);
      const group = new Set(members.get(p.id) ?? [p.id]);
      const holdings: Holding[] = guild.heroes
        .flatMap((h) => h.stashes.filter((st) => group.has(st.protocolId)).flatMap((st) => st.entries.map((e) => ({ label: e.name || e.symbol, kind: e.kind, usd: e.usd, wallet: h.address }))))
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
        .slice(0, MAX_HOLDINGS);
      const tvlUsd = tvlOf(p.id);
      return {
        id: p.id,
        name: p.name,
        category: CATEGORY_FOR[p.category] ?? 'other',
        tier: tierOf(sumHeld(p.id)),
        signature: family in SIGNATURE_PROTOCOLS ? family : null,
        holdings,
        visits: [...group].reduce((t, m) => t + (guild.protocols.get(m)?.visits ?? 0), 0),
        tvlUsd,
        // unknown to the snapshot: as big as what the guild keeps there, at least a house
        size: sizeFor(tvlUsd ?? Math.max(sumHeld(p.id), SIZE_REFERENCE_USD)),
        iconUrl: [...group].map((m) => guild.protocols.get(m)?.iconUrl ?? null).find((u) => u) ?? null,
      };
    });

  // each protocol with a building, and every member of its family, to the building's own id
  const buildingOf = new Map<string, string>();
  for (const p of protocols) for (const m of members.get(p.id) ?? [p.id]) buildingOf.set(m, p.id);
  const shown = new Set(buildingOf.keys());
  const walletIds = guild.heroes.map((h) => h.address);
  const towerOf = new Map(walletIds.map((a, i) => [a, i]));
  // a send between two of the guild's wallets is one journey key on both sides: one errand
  const seen = new Set<string>();
  const errands: Errand[] = [];
  for (const j of guild.journeys) {
    if (seen.has(j.key)) continue;
    const found = errandOf(j, shown, towerOf, (id) => guild.protocols.get(id)?.name ?? id);
    const e = found && found.protocolId ? { ...found, protocolId: buildingOf.get(found.protocolId) ?? found.protocolId } : found;
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
    walletFocus: guild.heroes.map(walletFocus),
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
export function errandOf(
  j: Journey,
  shownProtocols: ReadonlySet<string>,
  towerOf: ReadonlyMap<string, number> = new Map(),
  protocolName: (id: string) => string = (id) => id,
): Errand | null {
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
    method: j.method,
    block: j.block,
    steps: j.steps.map(
      (st): ErrandStep => ({
        verb: st.verb,
        where: st.target.kind === 'building' ? protocolName(st.target.protocolId) : st.target.kind === 'home' ? `wallet ${st.target.address.slice(0, 6)}…${st.target.address.slice(-4)}` : 'someone outside the town',
        give: st.give,
        get: st.get,
      }),
    ),
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

/**
 * A preview town (`?preview=` in the page URL, for looking at models): the
 * guild's castle with these buildings in town instead of its own. An entry is
 * a protocol with a landmark (`lido`: at its real value), or a category at a
 * value (`lending:5e6`: a $5M lending protocol, its category building, with a
 * real protocol's logo and colour: `lending:5e6:morpho` names which one).
 */
/** A protocol of each category whose logo a preview's category building shows (each has a logo in logos.json). */
const PREVIEW_LOGOS: Record<string, string> = {
  lending: 'morpho',
  dex: 'uniswap',
  staking: 'lido',
  nft: 'sudoswap',
  governance: 'compound',
  bridge: 'across',
  other: 'defi-saver',
};

export function previewWorld(world: CastleWorld, spec: string): CastleWorld {
  const categories = new Set<string>(Object.keys(PREVIEW_LOGOS));
  const protocolsSeen = new Set<string>();
  const protocols = spec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_BUILDINGS)
    .map((entry, i): WorldProtocol | null => {
      const [head, value, borrow] = entry.split(':');
      if (!head) return null;
      const usd = Number(value);
      if (categories.has(head)) {
        const at = Number.isFinite(usd) && usd > 0 ? usd : SIZE_REFERENCE_USD;
        // a real protocol's id, for its logo and colour on the category building (no landmark: signature null)
        const id = borrow || PREVIEW_LOGOS[head]!;
        return { id: i === 0 || !protocolsSeen.has(id) ? (protocolsSeen.add(id), id) : `${id}-${i}`, name: `${head} ($${Math.round(at).toLocaleString('en-US')})`, category: head as BuildingCategory, tier: 0, signature: null, holdings: [], visits: 0, tvlUsd: at, size: sizeFor(at), iconUrl: null };
      }
      const family = protocolFamily(head);
      const category = SIGNATURE_PROTOCOLS[family];
      if (!category) return null;
      const tvlUsd = Number.isFinite(usd) && usd > 0 ? usd : tvlOf(head);
      return { id: head, name: head, category: category as BuildingCategory, tier: 0, signature: family, holdings: [], visits: 0, tvlUsd, size: sizeFor(tvlUsd ?? SIZE_REFERENCE_USD), iconUrl: null };
    })
    .filter((p): p is WorldProtocol => p !== null);
  return protocols.length ? { ...world, protocols, errands: [] } : world;
}
