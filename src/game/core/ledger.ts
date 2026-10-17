/**
 * The Ledger: applies a side's commands to its portfolio, with gas, fees,
 * slippage and the LTV limit, and runs what the market does to positions:
 * yields, impermanent loss, debt growth and liquidations (spec: "Protocols",
 * "Leverage, liquidations and market events").
 *
 * Commands are all or nothing: a refused one leaves the side as it was.
 */

import { BALANCE } from '../config/balance.js';
import { STAKES_INTO, UNSTAKES_INTO, type Catalog } from './catalog.js';
import { qmin, qmul, qn, qtyFor, value } from './fixed.js';
import type { AssetId, Command, Liquidation, Position, PositionKind, ProtocolFn, SideState } from './types.js';

const L = BALANCE.ledger;

/** What a command needs from the match around it. */
export interface LedgerCtx {
  catalog: Catalog;
  prices: Readonly<Record<AssetId, number>>;
  unitValue: number;
  round: number;
  gasMult: number;
}

export type CommandResult = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string): CommandResult => ({ ok: false, reason });

// ---------- positions ----------

function same(p: Position, asset: AssetId, kind: PositionKind, protocol?: ProtocolFn, pairWith?: AssetId): boolean {
  return p.asset === asset && p.kind === kind && p.protocol === protocol && p.pairWith === pairWith && p.unlocksAtRound === undefined;
}

export function holding(side: SideState, asset: AssetId, kind: PositionKind = 'spot', protocol?: ProtocolFn): bigint {
  return side.portfolio.positions.filter((p) => same(p, asset, kind, protocol)).reduce((s, p) => s + p.qty, 0n);
}

export function addPosition(side: SideState, asset: AssetId, kind: PositionKind, qty: bigint, protocol?: ProtocolFn): void {
  if (qty <= 0n) return;
  const p = side.portfolio.positions.find((x) => same(x, asset, kind, protocol));
  if (p) p.qty += qty;
  else side.portfolio.positions.push({ asset, qty, kind, ...(protocol ? { protocol } : {}) });
}

/** Takes qty from a position; false if there isn't that much. */
function take(side: SideState, asset: AssetId, kind: PositionKind, qty: bigint, protocol?: ProtocolFn): boolean {
  if (qty <= 0n) return false;
  const p = side.portfolio.positions.find((x) => same(x, asset, kind, protocol));
  if (!p || p.qty < qty) return false;
  p.qty -= qty;
  prune(side);
  return true;
}

function prune(side: SideState): void {
  side.portfolio.positions = side.portfolio.positions.filter((p) => p.qty > 0n);
}

export function positionValue(p: Position, prices: Readonly<Record<AssetId, number>>): number {
  const v = value(p.qty, prices[p.asset] ?? 0);
  if (p.kind === 'borrowed') return -v;
  if (p.kind === 'lp' && p.pairWith && p.pairQty) return v + value(p.pairQty, prices[p.pairWith] ?? 0);
  return v;
}

/** Net worth: everything held minus debt (NFTs excluded). */
export function netValue(side: SideState, prices: Readonly<Record<AssetId, number>>): number {
  return side.portfolio.positions.reduce((s, p) => s + positionValue(p, prices), 0);
}

/** Every token amount a side holds as (asset, qty), LP pairs split, debt left out: what armies and walls are made of. */
export function holdingsOf(side: SideState): { asset: AssetId; qty: bigint; kind: PositionKind }[] {
  const out: { asset: AssetId; qty: bigint; kind: PositionKind }[] = [];
  for (const p of side.portfolio.positions) {
    if (p.kind === 'borrowed') continue;
    out.push({ asset: p.asset, qty: p.qty, kind: p.kind });
    if (p.kind === 'lp' && p.pairWith && p.pairQty) out.push({ asset: p.pairWith, qty: p.pairQty, kind: 'lp' });
  }
  return out;
}

/** Dollars in stablecoins (any position but debt): the walls. */
export function stableValue(side: SideState, ctx: Pick<LedgerCtx, 'catalog' | 'prices'>): number {
  return holdingsOf(side)
    .filter((h) => ctx.catalog.asset(h.asset).isStable)
    .reduce((s, h) => s + value(h.qty, ctx.prices[h.asset] ?? 0), 0);
}

// ---------- the keep ----------

export function keepMaxFor(side: SideState, ctx: Pick<LedgerCtx, 'catalog' | 'prices' | 'unitValue'>): number {
  return (BALANCE.keep.baseHp + (BALANCE.keep.hpPerStableUnit * stableValue(side, ctx)) / ctx.unitValue) * (1 + (side.keepBonus ?? 0));
}

/**
 * New walls raise max HP and current HP by the same amount; walls taken down
 * lower the max and clamp the current HP to it (spec: "Castle and keep").
 */
export function refreshKeep(side: SideState, ctx: Pick<LedgerCtx, 'catalog' | 'prices' | 'unitValue'>): void {
  const max = keepMaxFor(side, ctx);
  if (max > side.keepHpMax) side.keepHp += max - side.keepHpMax;
  side.keepHpMax = max;
  side.keepHp = Math.min(side.keepHp, max);
}

// ---------- lending accounts ----------

export interface Account {
  protocol: 'lending' | 'vault';
  collateral: number;
  debt: number;
  /** Health factor (Infinity with no debt). */
  hf: number;
}

export function account(side: SideState, protocol: 'lending' | 'vault', ctx: Pick<LedgerCtx, 'catalog' | 'prices'>): Account {
  let collateral = 0;
  let debt = 0;
  for (const p of side.portfolio.positions) {
    if (p.protocol !== protocol) continue;
    const v = value(p.qty, ctx.prices[p.asset] ?? 0);
    if (p.kind === 'supplied' && ctx.catalog.asset(p.asset).collateral) collateral += v;
    if (p.kind === 'borrowed') debt += v;
  }
  return { protocol, collateral, debt, hf: debt > 0 ? (collateral * L.liquidationThreshold) / debt : Infinity };
}

export function accounts(side: SideState, ctx: Pick<LedgerCtx, 'catalog' | 'prices'>): Account[] {
  return (['lending', 'vault'] as const).map((p) => account(side, p, ctx)).filter((a) => a.debt > 0 || a.collateral > 0);
}

// ---------- gas ----------

/** Pays one action's gas: in ETH, else in stables (the largest first). */
function payGas(side: SideState, ctx: LedgerCtx): boolean {
  let due = L.gasUnits * ctx.unitValue * ctx.gasMult;
  const eth = holding(side, 'eth');
  const ethPrice = ctx.prices.eth ?? 0;
  if (eth > 0n && ethPrice > 0) {
    const need = qtyFor(due, ethPrice);
    if (eth >= need) return need === 0n || take(side, 'eth', 'spot', need);
    take(side, 'eth', 'spot', eth);
    due -= value(eth, ethPrice);
  }
  const stables = ctx.catalog
    .stables()
    .map((id) => ({ id, v: value(holding(side, id), ctx.prices[id] ?? 0) }))
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  for (const s of stables) {
    const price = ctx.prices[s.id] ?? 1;
    const have = holding(side, s.id);
    const need = qtyFor(due, price);
    if (have >= need) return need === 0n || take(side, s.id, 'spot', need);
    if (have > 0n) {
      take(side, s.id, 'spot', have);
      due -= value(have, price);
    }
  }
  return due <= 1e-9;
}

/** One action's gas in dollars (for the UI and the NPCs). */
export function gasCost(ctx: Pick<LedgerCtx, 'unitValue' | 'gasMult'>): number {
  return L.gasUnits * ctx.unitValue * ctx.gasMult;
}

/** Fee plus slippage for a trade of this many dollars. */
export function swapCostRate(dollars: number, unitValue: number): number {
  return L.swapFee + Math.min(L.maxSlippage, (L.slippagePer10Units * dollars) / (10 * unitValue));
}

// ---------- commands ----------

/** Applies one command to a side. A refused command changes nothing. */
export function applyCommand(side: SideState, cmd: Command, ctx: LedgerCtx): CommandResult {
  if (cmd.t === 'endTrade') {
    side.tradeDone = true;
    return { ok: true };
  }
  if (side.tradeDone) return refuse('this side has ended its trade phase');
  const draft = structuredClone(side);
  if (!payGas(draft, ctx)) return refuse('not enough ETH or stables for gas');
  const r = run(draft, cmd, ctx);
  if (!r.ok) return r;
  prune(draft);
  refreshKeep(draft, ctx);
  Object.assign(side, draft);
  return r;
}

function known(ctx: LedgerCtx, ...ids: AssetId[]): CommandResult | null {
  for (const id of ids) if (!ctx.catalog.has(id)) return refuse(`unknown asset ${id}`);
  return null;
}

function run(side: SideState, cmd: Exclude<Command, { t: 'endTrade' }>, ctx: LedgerCtx): CommandResult {
  const price = (id: AssetId) => ctx.prices[id] ?? 0;
  switch (cmd.t) {
    case 'swap': {
      const bad = known(ctx, cmd.from, cmd.to);
      if (bad) return bad;
      if (cmd.from === cmd.to) return refuse('swap to the same asset');
      if (!take(side, cmd.from, 'spot', cmd.qty)) return refuse(`not enough ${cmd.from}`);
      const dollars = value(cmd.qty, price(cmd.from));
      addPosition(side, cmd.to, 'spot', qtyFor(dollars * (1 - swapCostRate(dollars, ctx.unitValue)), price(cmd.to)));
      return { ok: true };
    }
    case 'stake': {
      const into = STAKES_INTO[cmd.asset];
      if (!into) return refuse(`${cmd.asset} can't be staked`);
      if (!take(side, cmd.asset, 'spot', cmd.qty)) return refuse(`not enough ${cmd.asset}`);
      addPosition(side, into, 'staked', qtyFor(value(cmd.qty, price(cmd.asset)), price(into)), 'staking');
      return { ok: true };
    }
    case 'unstake': {
      if (!UNSTAKES_INTO[cmd.asset]) return refuse(`${cmd.asset} isn't a staking token`);
      const fromStaked = take(side, cmd.asset, 'staked', cmd.qty, 'staking');
      if (!fromStaked && !take(side, cmd.asset, 'spot', cmd.qty)) return refuse(`not enough staked ${cmd.asset}`);
      // it stays staked (and fights as such) until the round it unlocks
      side.portfolio.positions.push({ asset: cmd.asset, qty: cmd.qty, kind: 'staked', protocol: 'staking', unlocksAtRound: ctx.round + L.unstakeRounds });
      return { ok: true };
    }
    case 'restake': {
      if (!UNSTAKES_INTO[cmd.asset]) return refuse(`only staking tokens can be restaked`);
      const ok = take(side, cmd.asset, 'staked', cmd.qty, 'staking') || take(side, cmd.asset, 'spot', cmd.qty);
      if (!ok) return refuse(`not enough ${cmd.asset}`);
      addPosition(side, cmd.asset, 'restaked', cmd.qty, 'restaking');
      return { ok: true };
    }
    case 'lpAdd': {
      const bad = known(ctx, cmd.a, cmd.b);
      if (bad) return bad;
      if (cmd.a === cmd.b) return refuse('a pool needs two different tokens');
      const qb = qtyFor(value(cmd.qty, price(cmd.a)), price(cmd.b));
      if (!take(side, cmd.a, 'spot', cmd.qty)) return refuse(`not enough ${cmd.a}`);
      if (!take(side, cmd.b, 'spot', qb)) return refuse(`not enough ${cmd.b} to pair`);
      const lp = side.portfolio.positions.find((p) => p.kind === 'lp' && p.asset === cmd.a && p.pairWith === cmd.b);
      if (lp) {
        lp.qty += cmd.qty;
        lp.pairQty = (lp.pairQty ?? 0n) + qb;
      } else side.portfolio.positions.push({ asset: cmd.a, qty: cmd.qty, kind: 'lp', protocol: 'dex', pairWith: cmd.b, pairQty: qb });
      return { ok: true };
    }
    case 'lpRemove': {
      const lp = side.portfolio.positions.find((p) => p.kind === 'lp' && p.asset === cmd.a && p.pairWith === cmd.b);
      if (!lp || lp.qty < cmd.qty || cmd.qty <= 0n) return refuse('not that much in the pool');
      const share = qn(cmd.qty) / qn(lp.qty);
      const qb = cmd.qty === lp.qty ? (lp.pairQty ?? 0n) : qmul(lp.pairQty ?? 0n, share);
      lp.qty -= cmd.qty;
      lp.pairQty = (lp.pairQty ?? 0n) - qb;
      addPosition(side, cmd.a, 'spot', cmd.qty);
      addPosition(side, cmd.b, 'spot', qb);
      return { ok: true };
    }
    case 'supply': {
      const bad = known(ctx, cmd.asset);
      if (bad) return bad;
      const via = cmd.via ?? 'lending';
      if (via === 'vault' && !ctx.catalog.asset(cmd.asset).collateral) return refuse(`${cmd.asset} can't back a vault`);
      if (!take(side, cmd.asset, 'spot', cmd.qty)) return refuse(`not enough ${cmd.asset}`);
      addPosition(side, cmd.asset, 'supplied', cmd.qty, via);
      return { ok: true };
    }
    case 'withdraw': {
      const via = cmd.via ?? 'lending';
      if (!take(side, cmd.asset, 'supplied', cmd.qty, via)) return refuse(`not that much ${cmd.asset} supplied`);
      const acc = account(side, via, ctx);
      if (acc.debt > acc.collateral * L.ltv) return refuse('that would leave the loan above its limit');
      addPosition(side, cmd.asset, 'spot', cmd.qty);
      return { ok: true };
    }
    case 'borrow': {
      const bad = known(ctx, cmd.asset);
      if (bad) return bad;
      const via = cmd.via ?? 'lending';
      // a vault mints stablecoins against its collateral (Maker/Sky)
      if (via === 'vault' && !ctx.catalog.asset(cmd.asset).isStable) return refuse('a vault mints stablecoins only');
      if (cmd.qty <= 0n) return refuse('nothing to borrow');
      const acc = account(side, via, ctx);
      if (acc.collateral <= 0) return refuse('supply collateral first');
      if (acc.debt + value(cmd.qty, price(cmd.asset)) > acc.collateral * L.ltv) return refuse('above the borrowing limit');
      addPosition(side, cmd.asset, 'borrowed', cmd.qty, via);
      addPosition(side, cmd.asset, 'spot', cmd.qty);
      return { ok: true };
    }
    case 'repay': {
      const via = cmd.via ?? 'lending';
      const debt = holding(side, cmd.asset, 'borrowed', via);
      if (debt <= 0n) return refuse(`no ${cmd.asset} debt`);
      const pay = qmin(cmd.qty, debt);
      if (!take(side, cmd.asset, 'spot', pay)) return refuse(`not enough ${cmd.asset} to repay`);
      take(side, cmd.asset, 'borrowed', pay, via);
      return { ok: true };
    }
    case 'slotRelic': {
      if (!side.portfolio.nfts.some((n) => n.collection === cmd.nft)) return refuse('that NFT is not held');
      if (cmd.slot < 0 || cmd.slot > 2) return refuse('no such slot');
      const relics = side.portfolio.relics;
      while (relics.length < 3) relics.push(null);
      for (let i = 0; i < relics.length; i++) if (relics[i]?.nft === cmd.nft) relics[i] = null;
      relics[cmd.slot] = { nft: cmd.nft };
      return { ok: true };
    }
  }
}

// ---------- what the market does ----------

/** At the start of each Market phase: yields and fees into the positions, debt growth, unstakes that unlock. */
export function payYields(side: SideState, round: number, ctx: Pick<LedgerCtx, 'prices'>): void {
  const unlocked: Position[] = [];
  for (const p of side.portfolio.positions) {
    if (p.unlocksAtRound !== undefined) {
      if (p.unlocksAtRound <= round) unlocked.push(p);
      continue;
    }
    if (p.kind === 'supplied') p.qty += qmul(p.qty, L.supplyYield);
    else if (p.kind === 'restaked') p.qty += qmul(p.qty, L.restakeYield);
    else if (p.kind === 'borrowed') p.qty += qmul(p.qty, L.debtGrowth);
    else if (p.kind === 'lp') {
      p.qty += qmul(p.qty, L.lpFee);
      p.pairQty = (p.pairQty ?? 0n) + qmul(p.pairQty ?? 0n, L.lpFee);
    }
  }
  // an unlocked unstake is ETH again, at the day's rate
  for (const p of unlocked) {
    const into = UNSTAKES_INTO[p.asset] ?? p.asset;
    const qty = qtyFor(value(p.qty, ctx.prices[p.asset] ?? 0), ctx.prices[into] ?? 1);
    p.qty = 0n;
    addPosition(side, into, 'spot', qty);
  }
  prune(side);
}

/**
 * Constant-product pools after a price move: the pool keeps qa·qb = k and
 * rebalances to the new price ratio (the impermanent loss).
 */
export function rebalancePools(side: SideState, prices: Readonly<Record<AssetId, number>>): void {
  for (const p of side.portfolio.positions) {
    if (p.kind !== 'lp' || !p.pairWith || !p.pairQty) continue;
    const pa = prices[p.asset] ?? 0;
    const pb = prices[p.pairWith] ?? 0;
    if (pa <= 0 || pb <= 0) continue;
    const k = qn(p.qty) * qn(p.pairQty);
    const qa = Math.sqrt((k * pb) / pa);
    const qb = Math.sqrt((k * pa) / pb);
    p.qty = qtyFor(qa, 1);
    p.pairQty = qtyFor(qb, 1);
  }
}

/**
 * The liquidation check, run on every daily candle. While an account's HF is
 * under 1, half its debt is repaid by seizing collateral worth that plus the
 * penalty.
 */
export function liquidate(side: SideState, round: number, day: number, ctx: Pick<LedgerCtx, 'catalog' | 'prices'>, penaltyCut = 0): Liquidation[] {
  const out: Liquidation[] = [];
  for (const protocol of ['lending', 'vault'] as const) {
    let acc = account(side, protocol, ctx);
    let guard = 0;
    let liq: Liquidation | null = null;
    while (acc.debt > 0 && acc.hf < 1 && acc.collateral > 0 && guard++ < 32) {
      liq ??= { round, day, protocol, repaid: 0, seized: [] };
      const repay = acc.debt * L.liquidationRepay;
      for (const p of side.portfolio.positions) if (p.protocol === protocol && p.kind === 'borrowed') p.qty -= qmul(p.qty, L.liquidationRepay);
      const seizeShare = Math.min(1, (repay * (1 + Math.max(0, L.liquidationPenalty - penaltyCut))) / acc.collateral);
      for (const p of side.portfolio.positions) {
        if (p.protocol !== protocol || p.kind !== 'supplied' || !ctx.catalog.asset(p.asset).collateral) continue;
        const qty = seizeShare >= 1 ? p.qty : qmul(p.qty, seizeShare);
        if (qty <= 0n) continue;
        p.qty -= qty;
        const v = value(qty, ctx.prices[p.asset] ?? 0);
        const prev = liq.seized.find((s) => s.asset === p.asset);
        if (prev) {
          prev.qty += qty;
          prev.value += v;
        } else liq.seized.push({ asset: p.asset, qty, value: v });
      }
      liq.repaid += repay;
      prune(side);
      acc = account(side, protocol, ctx);
    }
    if (liq) out.push(liq);
  }
  side.liquidations.push(...out);
  return out;
}

/** Slashing: restaked positions lose a share. */
export function slash(side: SideState, burn: number): void {
  for (const p of side.portfolio.positions) if (p.kind === 'restaked') p.qty -= qmul(p.qty, burn);
  prune(side);
}
