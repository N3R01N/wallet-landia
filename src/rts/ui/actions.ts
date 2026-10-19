/**
 * What a selected building of yours can do with your money, in the
 * selection panel: swaps and pools at the Exchange, staking, restaking,
 * supplying and borrowing at the Bank, DAI at the Vault, each with its
 * positions and their worth. One tap does it (25%, 50% or all); the
 * from/to choices stay between taps.
 */

import { el } from '../../util/dom.js';
import { BUILDINGS, TOKEN_IDS, TOKENS, type PlayerId, type TokenId } from '../data/rules.js';
import { bankAccount, COLLATERAL, ECON, frozen, positionValue, swapOut, vaultHealth, type EconCommand, type Position } from '../core/economy.js';
import type { Building, World } from '../core/world.js';

export interface Live {
  text: HTMLElement;
  read: () => string;
}

export interface ActionContext {
  world: World;
  me: PlayerId;
  send: (cmd: EconCommand) => void;
  /** Choices that outlive a rebuild of the panel. */
  choice: { from: TokenId; to: TokenId; pool: TokenId; pair: TokenId; supply: TokenId; borrow: TokenId };
  /** Rebuild the panel (a choice changed). */
  refresh: () => void;
  live: Live[];
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const SHARES = [0.25, 0.5, 1] as const;
const shareLabel = (s: number) => (s === 1 ? 'All' : `${s * 100}%`);

/** The part of the panel's key that changes what the actions show (not their numbers). */
export function actionsKey(w: World, me: PlayerId, b: Building): string {
  const p = w.players[me];
  return JSON.stringify([b.kind, p.positions.map((x) => [x.id, x.kind, frozen(w.econ, me, x)]), TOKEN_IDS.filter((t) => p.tokens[t] * w.market.prices[t] >= 1)]);
}

export function actions(c: ActionContext, b: Building): HTMLElement[] {
  const w = c.world;
  const me = w.players[c.me];
  const held = TOKEN_IDS.filter((t) => me.tokens[t] * w.market.prices[t] >= 1);
  // the tokens worth offering (a campaign mission: those it uses)
  const inPlay = w.tokensInPlay(c.me);
  const select = (label: string, options: readonly TokenId[], value: TokenId, set: (t: TokenId) => void) => {
    const s = el('select', { class: 'rts-select', 'aria-label': label }, ...options.map((t) => Object.assign(el('option', { value: t }, TOKENS[t].symbol), { selected: t === value })));
    s.addEventListener('change', () => {
      set(s.value as TokenId);
      c.refresh();
    });
    return s;
  };
  const taps = (label: string, run: (share: number) => EconCommand | null, cls = '') =>
    el(
      'div',
      { class: 'rts-taps' },
      el('span', {}, label),
      ...SHARES.map((share) => {
        const btn = el('button', { class: `btn rts-tap ${cls}`, type: 'button', 'data-share': String(share) }, shareLabel(share));
        btn.addEventListener('click', () => {
          const cmd = run(share);
          if (cmd) c.send(cmd);
        });
        return btn;
      }),
    );
  const liveText = (read: () => string, cls = '') => {
    const text = el('span', { class: cls });
    text.textContent = read();
    c.live.push({ text, read });
    return text;
  };
  const posRow = (pos: Position, label: string, buttons: HTMLElement[]) =>
    el('div', { class: 'rts-pos', 'data-pos': String(pos.id) }, el('span', {}, label), liveText(() => usd(positionValue(w.econ, pos))), ...(frozen(w.econ, c.me, pos) ? [el('em', {}, '❄ frozen')] : buttons));
  const button = (label: string, cmd: () => EconCommand) => {
    const btn = el('button', { class: 'btn rts-tap', type: 'button' }, label);
    btn.addEventListener('click', () => c.send(cmd()));
    return btn;
  };
  const mine = (kind: Position['kind']) => me.positions.filter((x) => x.kind === kind);
  const out: HTMLElement[] = [];

  switch (b.kind) {
    case 'exchange': {
      const from = held.includes(c.choice.from) ? c.choice.from : (held[0] ?? 'usdc');
      out.push(
        el('h3', {}, 'Swap'),
        el('div', { class: 'rts-row' }, select('From', held.length ? held : ['usdc'], from, (t) => (c.choice.from = t)), el('span', {}, '→'), select('To', inPlay, c.choice.to, (t) => (c.choice.to = t))),
        el('p', { class: 'rts-why' }, liveText(() => `All your ${TOKENS[from].symbol} → about ${swapOut(w.econ, from, c.choice.to, me.tokens[from]).toPrecision(4)} ${TOKENS[c.choice.to].symbol}`)),
        taps('Swap', (s) => ({ t: 'swap', from, to: c.choice.to, qty: me.tokens[from] * s }), 'rts-swap'),
        el('h3', {}, 'Pool (earns fees)'),
        el('div', { class: 'rts-row' }, select('Token', inPlay, c.choice.pool, (t) => (c.choice.pool = t)), el('span', {}, '+'), select('Paired with', ['usdc', 'dai', 'eth'], c.choice.pair, (t) => (c.choice.pair = t))),
        taps(`Add (of your ${TOKENS[c.choice.pool].symbol})`, (s) => {
          // as much as the pair allows
          const a = c.choice.pool;
          const b2 = c.choice.pair;
          const qty = Math.min(me.tokens[a] * s, (me.tokens[b2] * w.market.prices[b2]) / w.market.prices[a]);
          return { t: 'lpAdd', a, b: b2, qty };
        }, 'rts-pool'),
        ...mine('lp').map((pos) => posRow(pos, `${TOKENS[pos.token].symbol}–${TOKENS[pos.pair!].symbol} pool`, [button('Remove', () => ({ t: 'lpRemove', id: pos.id }))])),
      );
      break;
    }
    case 'staking': {
      out.push(
        el('p', {}, `Staked ETH earns ${ECON.perMinute.staked * 100}% a minute (more at higher levels).`),
        taps('Stake ETH', (s) => ({ t: 'stake', qty: me.tokens.eth * s }), 'rts-stake'),
        ...mine('staked').map((pos) => posRow(pos, 'Staked stETH', [button('Unstake', () => ({ t: 'unstake', id: pos.id }))])),
      );
      break;
    }
    case 'restaking': {
      out.push(
        el('p', {}, `Restaked stETH earns ${ECON.perMinute.restaked * 100}% a minute. Unstake at the Staking House first for spot stETH.`),
        taps('Restake stETH', (s) => ({ t: 'restake', qty: me.tokens.steth * s }), 'rts-restake'),
        ...mine('restaked').map((pos) => posRow(pos, 'Restaked stETH', [button('Withdraw', () => ({ t: 'unstake', id: pos.id }))])),
      );
      break;
    }
    case 'bank': {
      const supplyable = held.filter((t) => COLLATERAL.includes(t));
      const sup = supplyable.includes(c.choice.supply) ? c.choice.supply : (supplyable[0] ?? 'eth');
      out.push(
        el('p', { class: 'rts-bank' }, liveText(() => {
          const a = bankAccount(w.econ, c.me);
          return `Collateral ${usd(a.collateral)} · debt ${usd(a.debt)} · health ${Number.isFinite(a.health) ? a.health.toFixed(2) : '—'} · can borrow ${usd(a.room)}`;
        })),
        el('div', { class: 'rts-row' }, el('span', {}, 'Supply'), select('Supply', supplyable.length ? supplyable : ['eth'], sup, (t) => (c.choice.supply = t))),
        taps('Supply', (s) => ({ t: 'supply', token: sup, qty: me.tokens[sup] * s }), 'rts-supply'),
        el('div', { class: 'rts-row' }, el('span', {}, 'Borrow'), select('Borrow', inPlay.filter((t) => t !== 'steth'), c.choice.borrow, (t) => (c.choice.borrow = t))),
        taps('Borrow (of the room)', (s) => ({ t: 'borrow', token: c.choice.borrow, qty: (bankAccount(w.econ, c.me).room * s * 0.999) / w.market.prices[c.choice.borrow] }), 'rts-borrow'),
        ...mine('supplied').map((pos) => posRow(pos, `Supplied ${TOKENS[pos.token].symbol}`, [button('Withdraw', () => ({ t: 'withdraw', id: pos.id }))])),
        ...mine('borrowed').map((pos) => posRow(pos, `Owed ${TOKENS[pos.token].symbol}`, [button('Repay', () => ({ t: 'repay', id: pos.id, qty: pos.qty }))])),
      );
      break;
    }
    case 'vault': {
      out.push(
        el('p', {}, `Lock ETH, take DAI: half its worth (the most is ${ECON.vaultLtv * 100}%). The debt grows ${ECON.perMinute.vault * 100}% a minute.`),
        taps('Lock ETH', (s) => {
          const eth = me.tokens.eth * s;
          return { t: 'vaultOpen', eth, dai: Math.floor(eth * w.market.prices.eth * 0.5) };
        }, 'rts-vault'),
        ...mine('vault').map((pos) =>
          el('div', { class: 'rts-pos', 'data-pos': String(pos.id) }, el('span', {}, 'Vault'), liveText(() => `${pos.qty.toPrecision(3)} ETH · owes ${Math.ceil(pos.debt ?? 0)} DAI · health ${vaultHealth(w.econ, pos).toFixed(2)}`), ...(frozen(w.econ, c.me, pos) ? [el('em', {}, '❄ frozen')] : [button('Close', () => ({ t: 'vaultClose', id: pos.id }))])),
        ),
      );
      break;
    }
    default:
      break;
  }
  if (out.length > 0) out.unshift(el('h3', { class: 'rts-actions-head' }, `At the ${BUILDINGS[b.kind].name}`));
  return out;
}
