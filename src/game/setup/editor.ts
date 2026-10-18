/**
 * The Portfolio Editor's rules (spec: "Portfolio Editor rules"): the match
 * cap, the blank build's budget, dust, and a preview of what the portfolio
 * fields against the chosen opponent. Pure: the setup panel calls these.
 */

import { BALANCE } from '../config/balance.js';
import { armyValue, buildArmy, unitValueFor } from '../core/army.js';
import { Catalog, STAKES_INTO } from '../core/catalog.js';
import { DEFAULT_VENUE } from '../core/depth.js';
import { qmul, qtyFor, value } from '../core/fixed.js';
import { holdingsOf, keepMaxFor, positionValue } from '../core/ledger.js';
import type { Archetype, Asset, AssetId, Difficulty, NftHolding, Portfolio, PositionKind, ProtocolFn, SideState, Squad } from '../core/types.js';
import { templatePortfolio } from '../data/templates.js';

export interface Draft {
  portfolio: Portfolio;
  customAssets: Asset[];
  /** A blank build's budget: what may be spent in all (null: no budget, only the cap). */
  budget: number | null;
  /** Shown once: why the editor changed something (a scaled-down import). */
  notice: string | null;
}

export type EditResult = { ok: true } | { ok: false; reason: string };

export function catalogOf(draft: Draft): Catalog {
  return new Catalog(draft.customAssets);
}

const emptyPortfolio = (): Portfolio => ({ positions: [], nfts: [], relics: [null, null, null] });

export function blankDraft(budget: number = BALANCE.match.startingBudget): Draft {
  return { portfolio: emptyPortfolio(), customAssets: [], budget, notice: null };
}

export function templateDraft(archetype: Archetype, budget: number = BALANCE.match.startingBudget): Draft {
  return { portfolio: templatePortfolio(archetype, budget, new Catalog()), customAssets: [], budget: null, notice: null };
}

/** An imported wallet, scaled down to the cap if it is above it. */
export function importDraft(portfolio: Portfolio, customAssets: Asset[], cap: number = BALANCE.match.matchCap): Draft {
  const draft: Draft = { portfolio: structuredClone(portfolio), customAssets: [...customAssets], budget: null, notice: null };
  const total = draftValue(draft);
  if (total > cap) {
    scale(draft.portfolio, cap / total);
    draft.notice = `This wallet holds $${Math.round(total).toLocaleString('en-US')}: scaled down to the $${cap.toLocaleString('en-US')} match cap.`;
  }
  return draft;
}

function scale(p: Portfolio, f: number): void {
  for (const pos of p.positions) {
    pos.qty = qmul(pos.qty, f);
    if (pos.pairQty !== undefined) pos.pairQty = qmul(pos.pairQty, f);
  }
  p.positions = p.positions.filter((x) => x.qty > 0n);
}

const prices = (draft: Draft): Record<AssetId, number> => Object.fromEntries(catalogOf(draft).assets.map((a) => [a.id, a.price]));

/** Everything held, debt not taken off, at the opening prices: what the cap and the budget count. NFTs are relics, not counted. */
export function draftValue(draft: Draft): number {
  const p = prices(draft);
  return draft.portfolio.positions.filter((x) => x.kind !== 'borrowed').reduce((s, x) => s + positionValue(x, p), 0);
}

/** The most that can still be added (the budget's or the cap's room). */
export function room(draft: Draft, cap: number = BALANCE.match.matchCap): number {
  const used = draftValue(draft);
  return Math.max(0, Math.min(cap, draft.budget ?? Infinity) - used);
}

/** The kinds a new position of this asset may take in the editor. */
export function kindsFor(asset: Asset): { kind: PositionKind; protocol?: ProtocolFn; label: string }[] {
  const out: { kind: PositionKind; protocol?: ProtocolFn; label: string }[] = [{ kind: 'spot', label: 'Held' }];
  if (asset.category === 'lst' || STAKES_INTO[asset.id]) {
    out.push({ kind: 'staked', protocol: 'staking', label: 'Staked' });
    out.push({ kind: 'restaked', protocol: 'restaking', label: 'Restaked' });
  }
  if (asset.collateral) out.push({ kind: 'supplied', protocol: 'lending', label: 'Supplied (lending)' });
  return out;
}

/** Adds `dollars` of an asset; within the budget and the cap. */
export function addDollars(draft: Draft, assetId: AssetId, dollars: number, kind: PositionKind = 'spot', protocol?: ProtocolFn, cap?: number): EditResult {
  const cat = catalogOf(draft);
  if (!cat.has(assetId)) return { ok: false, reason: 'unknown asset' };
  if (!(dollars > 0)) return { ok: false, reason: 'enter an amount' };
  if (dollars > room(draft, cap) + 1e-6) return { ok: false, reason: draft.budget !== null ? 'over the budget' : 'over the match cap' };
  // ETH staked in the editor is held as stETH, as the Trade phase would make it
  const id = kind === 'staked' || kind === 'restaked' ? (STAKES_INTO[assetId] ?? assetId) : assetId;
  const qty = qtyFor(dollars, cat.asset(id).price);
  const pos = draft.portfolio.positions.find((p) => p.asset === id && p.kind === kind && p.protocol === protocol && p.pairWith === undefined);
  if (pos) pos.qty += qty;
  else {
    const venue = kind === 'spot' ? undefined : DEFAULT_VENUE[kind === 'supplied' ? (protocol ?? 'lending') : kind];
    draft.portfolio.positions.push({ asset: id, qty, kind, ...(protocol ? { protocol } : {}), ...(venue ? { venue } : {}) });
  }
  return { ok: true };
}

/** Sets a position's value in dollars (its pair, for a pool, keeps its share). 0 removes it. */
export function setDollars(draft: Draft, index: number, dollars: number, cap?: number): EditResult {
  const pos = draft.portfolio.positions[index];
  if (!pos) return { ok: false, reason: 'no such position' };
  const p = prices(draft);
  const now = Math.abs(positionValue(pos, p));
  if (dollars <= 0) {
    draft.portfolio.positions.splice(index, 1);
    return { ok: true };
  }
  if (pos.kind !== 'borrowed' && dollars - now > room(draft, cap) + 1e-6) return { ok: false, reason: draft.budget !== null ? 'over the budget' : 'over the match cap' };
  const f = dollars / now;
  pos.qty = qmul(pos.qty, f);
  if (pos.pairQty !== undefined) pos.pairQty = qmul(pos.pairQty, f);
  return { ok: true };
}

export function removePosition(draft: Draft, index: number): void {
  draft.portfolio.positions.splice(index, 1);
}

export function addNft(draft: Draft, nft: NftHolding): void {
  const prev = draft.portfolio.nfts.find((n) => n.collection === nft.collection);
  if (prev) prev.floor = nft.floor;
  else draft.portfolio.nfts.push({ ...nft });
}

export function removeNft(draft: Draft, collection: string): void {
  draft.portfolio.nfts = draft.portfolio.nfts.filter((n) => n.collection !== collection);
  draft.portfolio.relics = draft.portfolio.relics.map((r) => (r?.nft === collection ? null : r));
}

/** The opponent an NPC choice makes: its template, at the player's value × the difficulty's. */
export function opponentPortfolio(draft: Draft, archetype: Archetype, difficulty: Difficulty): Portfolio {
  const budget = Math.max(100, draftValue(draft) * BALANCE.npc.valueMult[difficulty]);
  return templatePortfolio(archetype, budget, new Catalog());
}

export interface Preview {
  unitValue: number;
  squads: Squad[];
  /** Per position (same order): units it adds, or 'dust' / 'walls' / 'debt'. */
  rows: (number | 'dust' | 'walls' | 'debt')[];
  keepHp: number;
  armyValue: number;
  opponent: { squads: Squad[]; keepHp: number };
}

function previewSide(portfolio: Portfolio): SideState {
  return { id: 'A', portfolio, keepHp: 0, keepHpMax: 0, buildingsOwned: [], isNpc: false, tradeDone: false, valueBeforeMarket: 0, liquidations: [], shutdownUsed: false, keepBonus: 0 };
}

/** What the draft fields at the opening prices against that opponent (the same numbers the match will start with). */
export function preview(draft: Draft, archetype: Archetype, difficulty: Difficulty): Preview {
  const catalog = catalogOf(draft);
  const p = prices(draft);
  const me = previewSide(draft.portfolio);
  const them = { ...previewSide(opponentPortfolio(draft, archetype, difficulty)), id: 'B' as const };
  const unitValue = unitValueFor([me, them], catalog, p);
  const ctx = { catalog, prices: p, unitValue };
  const rows = draft.portfolio.positions.map((pos): number | 'dust' | 'walls' | 'debt' => {
    if (pos.kind === 'borrowed') return 'debt';
    if (catalog.asset(pos.asset).isStable && !(pos.pairWith && !catalog.asset(pos.pairWith).isStable)) return 'walls';
    const one = previewSide({ positions: [pos], nfts: [], relics: [] });
    const n = buildArmy(one, ctx).squads.reduce((s, q) => s + q.count, 0);
    return n > 0 ? n : 'dust';
  });
  return {
    unitValue,
    squads: buildArmy(me, ctx).squads,
    rows,
    keepHp: keepMaxFor(me, ctx),
    armyValue: armyValue(me, catalog, p),
    opponent: { squads: buildArmy(them, ctx).squads, keepHp: keepMaxFor(them, ctx) },
  };
}

/** Dollars of a holding at the opening prices (for the editor's rows). */
export function rowValue(draft: Draft, index: number): number {
  const pos = draft.portfolio.positions[index];
  return pos ? positionValue(pos, prices(draft)) : 0;
}

/** The token amounts of the draft (debt left out), for display. */
export function holdingsValue(draft: Draft): { asset: AssetId; dollars: number }[] {
  const p = prices(draft);
  return holdingsOf(previewSide(draft.portfolio)).map((h) => ({ asset: h.asset, dollars: value(h.qty, p[h.asset] ?? 0) }));
}
