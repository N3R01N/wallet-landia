/**
 * Ledger Wars' economy (docs/rts/PLAN.md): positions earn, spot tokens don't.
 * Swaps and pools at the Exchange, staking at the Staking House, restaking
 * at the Restaking Hall, supplying and borrowing at the Bank, DAI against
 * ETH at the Vault. Each position belongs to a kind of building: while the
 * player has none of that kind standing (it was destroyed), the position is
 * frozen: it earns nothing, owes nothing more, can't be touched, and is
 * never liquidated. Yields are per minute of play (game-fast), raised by the
 * building's level.
 */

import { BUILDINGS, aName, STABLES, TOKENS, type BuildingKind, type PlayerId, type TokenId } from '../data/rules.js';

export type PositionKind = 'staked' | 'restaked' | 'lp' | 'supplied' | 'borrowed' | 'vault';

export interface Position {
  id: number;
  kind: PositionKind;
  token: TokenId;
  qty: number;
  /** A pool's second token, and a vault's DAI debt. */
  pair?: TokenId;
  pairQty?: number;
  debt?: number;
}

/** Where each kind of position is held. */
export const HELD_AT: Record<PositionKind, BuildingKind> = { staked: 'staking', restaked: 'restaking', lp: 'exchange', supplied: 'bank', borrowed: 'bank', vault: 'vault' };

export const ECON = {
  /** Per minute, at level 1: what each position earns (or a debt grows). */
  perMinute: { staked: 0.12, restaked: 0.18, lp: 0.16, supplied: 0.05, borrowed: 0.06, vault: 0.03 } as Record<PositionKind, number>,
  /** Each level above 1 adds this share to a building's yield. */
  levelBonus: 0.5,
  swapFee: 0.003,
  /** Slippage per $10,000 traded. */
  slippagePer10k: 0.01,
  /** Borrow up to this share of the collateral's value; liquidation when debt passes the threshold's share. */
  ltv: 0.7,
  threshold: 0.8,
  /** A liquidation repays half the debt from collateral, plus this penalty. */
  penalty: 0.1,
  /** The vault: DAI up to this share of the ETH's value; liquidated past the threshold. */
  vaultLtv: 0.6,
  vaultThreshold: 0.75,
} as const;

/** Tokens that can back a loan at the Bank. */
export const COLLATERAL: readonly TokenId[] = ['eth', 'steth', 'wbtc', 'link', 'uni', 'aave', 'usdc', 'dai'];

export type EconCommand =
  | { t: 'swap'; from: TokenId; to: TokenId; qty: number }
  | { t: 'lpAdd'; a: TokenId; b: TokenId; qty: number }
  | { t: 'lpRemove'; id: number; share?: number }
  | { t: 'stake'; qty: number }
  | { t: 'unstake'; id: number; share?: number }
  | { t: 'restake'; qty: number }
  | { t: 'supply'; token: TokenId; qty: number }
  | { t: 'withdraw'; id: number; share?: number }
  | { t: 'borrow'; token: TokenId; qty: number }
  | { t: 'repay'; id: number; qty: number }
  | { t: 'vaultOpen'; eth: number; dai: number }
  | { t: 'vaultClose'; id: number };

export const ECON_COMMANDS = new Set<string>(['swap', 'lpAdd', 'lpRemove', 'stake', 'unstake', 'restake', 'supply', 'withdraw', 'borrow', 'repay', 'vaultOpen', 'vaultClose']);

/** What the economy needs of the world. */
export interface EconWorld {
  prices: Record<TokenId, number>;
  tokens(p: PlayerId): Record<TokenId, number>;
  positions(p: PlayerId): Position[];
  /** The highest level of this kind of building the player has standing (0: none). */
  level(p: PlayerId, kind: BuildingKind): number;
  nextId(): number;
}

export interface EconResult {
  ok: boolean;
  reason?: string;
}

const no = (reason: string): EconResult => ({ ok: false, reason });
/** A share of a position to take out: (0, 1], all when not given. */
const part = (share: number | undefined) => (share === undefined || !(share > 0) ? 1 : Math.min(1, share));
const EPS = 1e-12;

export function frozen(w: EconWorld, p: PlayerId, pos: Position): boolean {
  return w.level(p, HELD_AT[pos.kind]) === 0;
}

/** A position's worth (debts negative). */
export function positionValue(w: EconWorld, pos: Position): number {
  const v = pos.qty * w.prices[pos.token] + (pos.pair ? (pos.pairQty ?? 0) * w.prices[pos.pair] : 0);
  if (pos.kind === 'borrowed') return -v;
  if (pos.kind === 'vault') return v - (pos.debt ?? 0) * w.prices.dai;
  return v;
}

/** The Bank account: collateral (supplied), debt (borrowed), and the health factor. */
export function bankAccount(w: EconWorld, p: PlayerId): { collateral: number; debt: number; health: number; room: number } {
  let collateral = 0;
  let debt = 0;
  for (const pos of w.positions(p)) {
    if (pos.kind === 'supplied' && COLLATERAL.includes(pos.token)) collateral += pos.qty * w.prices[pos.token];
    if (pos.kind === 'borrowed') debt += pos.qty * w.prices[pos.token];
  }
  return { collateral, debt, health: debt > EPS ? (collateral * ECON.threshold) / debt : Infinity, room: Math.max(0, collateral * ECON.ltv - debt) };
}

export function vaultHealth(w: EconWorld, pos: Position): number {
  const debt = (pos.debt ?? 0) * w.prices.dai;
  return debt > EPS ? (pos.qty * w.prices[pos.token] * ECON.vaultThreshold) / debt : Infinity;
}

/** Dollars a minute the player's positions earn now (debts' growth taken off), frozen ones not counted. */
export function incomePerMinute(w: EconWorld, p: PlayerId): number {
  let s = 0;
  for (const pos of w.positions(p)) {
    if (frozen(w, p, pos)) continue;
    const rate = ECON.perMinute[pos.kind] * levelMult(w.level(p, HELD_AT[pos.kind]));
    if (pos.kind === 'borrowed') s -= rate * pos.qty * w.prices[pos.token];
    else if (pos.kind === 'vault') s -= rate * (pos.debt ?? 0) * w.prices.dai;
    else s += rate * (pos.qty * w.prices[pos.token] + (pos.pair ? (pos.pairQty ?? 0) * w.prices[pos.pair] : 0));
  }
  return s;
}

const levelMult = (level: number) => 1 + ECON.levelBonus * Math.max(0, level - 1);

/** What a swap of `qty` would give (fee and slippage taken). */
export function swapOut(w: EconWorld, from: TokenId, to: TokenId, qty: number): number {
  const usd = qty * w.prices[from];
  const cost = ECON.swapFee + Math.min(0.3, ECON.slippagePer10k * (usd / 10000));
  return (usd * (1 - cost)) / w.prices[to];
}

export function applyEcon(w: EconWorld, p: PlayerId, cmd: EconCommand): EconResult {
  const tokens = w.tokens(p);
  const positions = w.positions(p);
  const need = (kind: BuildingKind) => (w.level(p, kind) > 0 ? null : `needs ${aName(kind)}`);
  const enough = (t: TokenId, qty: number) => (qty > EPS && tokens[t] >= qty - EPS ? null : `not enough ${TOKENS[t].symbol}`);
  const find = (id: number, kind: PositionKind) => positions.find((x) => x.id === id && x.kind === kind) ?? null;
  const take = (t: TokenId, qty: number) => (tokens[t] = Math.max(0, tokens[t] - qty));
  const drop = (pos: Position) => positions.splice(positions.indexOf(pos), 1);
  switch (cmd.t) {
    case 'swap': {
      const why = need('exchange') ?? (cmd.from === cmd.to ? 'the same token' : enough(cmd.from, cmd.qty));
      if (why) return no(why);
      take(cmd.from, cmd.qty);
      tokens[cmd.to] += swapOut(w, cmd.from, cmd.to, cmd.qty);
      return { ok: true };
    }
    case 'lpAdd': {
      const bQty = (cmd.qty * w.prices[cmd.a]) / w.prices[cmd.b];
      const why = need('exchange') ?? (cmd.a === cmd.b ? 'a pool needs two tokens' : enough(cmd.a, cmd.qty) ?? enough(cmd.b, bQty));
      if (why) return no(why);
      take(cmd.a, cmd.qty);
      take(cmd.b, bQty);
      const same = positions.find((x) => x.kind === 'lp' && x.token === cmd.a && x.pair === cmd.b);
      if (same) {
        same.qty += cmd.qty;
        same.pairQty = (same.pairQty ?? 0) + bQty;
      } else positions.push({ id: w.nextId(), kind: 'lp', token: cmd.a, qty: cmd.qty, pair: cmd.b, pairQty: bQty });
      return { ok: true };
    }
    case 'lpRemove': {
      const pos = find(cmd.id, 'lp');
      if (!pos) return no('no such pool position');
      if (frozen(w, p, pos)) return no('frozen until the Exchange is rebuilt');
      const share = part(cmd.share);
      tokens[pos.token] += pos.qty * share;
      tokens[pos.pair!] += (pos.pairQty ?? 0) * share;
      if (share >= 1) drop(pos);
      else {
        pos.qty *= 1 - share;
        pos.pairQty = (pos.pairQty ?? 0) * (1 - share);
      }
      return { ok: true };
    }
    case 'stake': {
      const why = need('staking') ?? enough('eth', cmd.qty);
      if (why) return no(why);
      take('eth', cmd.qty);
      const qty = (cmd.qty * w.prices.eth) / w.prices.steth;
      const same = positions.find((x) => x.kind === 'staked');
      if (same) same.qty += qty;
      else positions.push({ id: w.nextId(), kind: 'staked', token: 'steth', qty });
      return { ok: true };
    }
    case 'unstake':
    case 'withdraw': {
      const pos = find(cmd.id, cmd.t === 'unstake' ? 'staked' : 'supplied') ?? (cmd.t === 'unstake' ? find(cmd.id, 'restaked') : null);
      if (!pos) return no('no such position');
      if (frozen(w, p, pos)) return no(`frozen until the ${BUILDINGS[HELD_AT[pos.kind]].name} is rebuilt`);
      const share = part(cmd.share);
      const qty = pos.qty * share;
      if (pos.kind === 'supplied') {
        const acc = bankAccount(w, p);
        const after = (acc.collateral - (COLLATERAL.includes(pos.token) ? qty * w.prices[pos.token] : 0)) * ECON.ltv;
        if (acc.debt > after + EPS) return no('repay first: the loan would be over its limit');
      }
      tokens[pos.token] += qty;
      if (share >= 1) drop(pos);
      else pos.qty -= qty;
      return { ok: true };
    }
    case 'restake': {
      const why = need('restaking') ?? enough('steth', cmd.qty);
      if (why) return no(why);
      take('steth', cmd.qty);
      const same = positions.find((x) => x.kind === 'restaked');
      if (same) same.qty += cmd.qty;
      else positions.push({ id: w.nextId(), kind: 'restaked', token: 'steth', qty: cmd.qty });
      return { ok: true };
    }
    case 'supply': {
      const why = need('bank') ?? enough(cmd.token, cmd.qty);
      if (why) return no(why);
      take(cmd.token, cmd.qty);
      const same = positions.find((x) => x.kind === 'supplied' && x.token === cmd.token);
      if (same) same.qty += cmd.qty;
      else positions.push({ id: w.nextId(), kind: 'supplied', token: cmd.token, qty: cmd.qty });
      return { ok: true };
    }
    case 'borrow': {
      const why = need('bank');
      if (why) return no(why);
      const acc = bankAccount(w, p);
      if (acc.collateral <= EPS) return no('supply collateral first');
      if (cmd.qty <= EPS || cmd.qty * w.prices[cmd.token] > acc.room + EPS) return no('above the borrowing limit');
      tokens[cmd.token] += cmd.qty;
      const same = positions.find((x) => x.kind === 'borrowed' && x.token === cmd.token);
      if (same) same.qty += cmd.qty;
      else positions.push({ id: w.nextId(), kind: 'borrowed', token: cmd.token, qty: cmd.qty });
      return { ok: true };
    }
    case 'repay': {
      const pos = find(cmd.id, 'borrowed');
      if (!pos) return no('no such loan');
      if (frozen(w, p, pos)) return no('frozen until the Bank is rebuilt');
      const qty = Math.min(cmd.qty, pos.qty, tokens[pos.token]);
      if (qty <= EPS) return no(`no ${TOKENS[pos.token].symbol} to repay with`);
      take(pos.token, qty);
      pos.qty -= qty;
      if (pos.qty <= 1e-9) drop(pos);
      return { ok: true };
    }
    case 'vaultOpen': {
      const why = need('vault') ?? enough('eth', cmd.eth);
      if (why) return no(why);
      const room = cmd.eth * w.prices.eth * ECON.vaultLtv;
      if (cmd.dai <= EPS || cmd.dai * w.prices.dai > room + EPS) return no(`at most ${Math.floor(room)} DAI against that ETH`);
      take('eth', cmd.eth);
      tokens.dai += cmd.dai;
      positions.push({ id: w.nextId(), kind: 'vault', token: 'eth', qty: cmd.eth, debt: cmd.dai });
      return { ok: true };
    }
    case 'vaultClose': {
      const pos = find(cmd.id, 'vault');
      if (!pos) return no('no such vault');
      if (frozen(w, p, pos)) return no('frozen until the Vault is rebuilt');
      if (tokens.dai < (pos.debt ?? 0) - EPS) return no(`needs ${Math.ceil(pos.debt ?? 0)} DAI to close`);
      take('dai', pos.debt ?? 0);
      tokens.eth += pos.qty;
      drop(pos);
      return { ok: true };
    }
  }
}

/** One step of `seconds`: yields paid into positions, debts grow, pools rebalance to the prices. */
export function accrue(w: EconWorld, p: PlayerId, seconds: number): void {
  for (const pos of w.positions(p)) {
    if (frozen(w, p, pos)) continue;
    const g = ECON.perMinute[pos.kind] * levelMult(w.level(p, HELD_AT[pos.kind])) * (seconds / 60);
    if (pos.kind === 'vault') pos.debt = (pos.debt ?? 0) * (1 + g);
    else if (pos.kind === 'lp') {
      // constant product: the pool's split follows the prices (impermanent loss), then the fees
      const k = pos.qty * (pos.pairQty ?? 0);
      const pa = w.prices[pos.token];
      const pb = w.prices[pos.pair!];
      pos.qty = Math.sqrt((k * pb) / pa) * (1 + g);
      pos.pairQty = Math.sqrt((k * pa) / pb) * (1 + g);
    } else pos.qty *= 1 + g;
  }
}

/** Loans under health 1 are liquidated: half the debt repaid from collateral, with a penalty. Returns how many. */
export function liquidate(w: EconWorld, p: PlayerId): number {
  let n = 0;
  const positions = w.positions(p);
  if (w.level(p, 'bank') > 0) {
    for (let guard = 0; guard < 8; guard++) {
      const acc = bankAccount(w, p);
      if (acc.health >= 1) break;
      const repay = acc.debt / 2;
      let seize = repay * (1 + ECON.penalty);
      // repay the loans, largest first
      let left = repay;
      for (const loan of positions.filter((x) => x.kind === 'borrowed').sort((a, b) => b.qty * w.prices[b.token] - a.qty * w.prices[a.token])) {
        const v = Math.min(left, loan.qty * w.prices[loan.token]);
        loan.qty -= v / w.prices[loan.token];
        left -= v;
        if (left <= EPS) break;
      }
      for (const col of positions.filter((x) => x.kind === 'supplied' && COLLATERAL.includes(x.token))) {
        const v = Math.min(seize, col.qty * w.prices[col.token]);
        col.qty -= v / w.prices[col.token];
        seize -= v;
        if (seize <= EPS) break;
      }
      for (let i = positions.length - 1; i >= 0; i--) if ((positions[i]!.kind === 'borrowed' || positions[i]!.kind === 'supplied') && positions[i]!.qty <= 1e-9) positions.splice(i, 1);
      n++;
    }
  }
  for (const pos of positions.filter((x) => x.kind === 'vault')) {
    if (frozen(w, p, pos) || vaultHealth(w, pos) >= 1) continue;
    // the vault is closed against its debt, the penalty kept
    const debtUsd = (pos.debt ?? 0) * w.prices.dai * (1 + ECON.penalty);
    const left = Math.max(0, pos.qty * w.prices.eth - debtUsd) / w.prices.eth;
    w.tokens(p).eth += left;
    positions.splice(positions.indexOf(pos), 1);
    n++;
  }
  return n;
}

/** Stablecoins first: the tokens a player can pay a building with. */
export const PAY_WITH: readonly TokenId[] = [...STABLES, 'eth'];
