/**
 * The Trade phase's panel (spec: "Trade = drafting"): swap, stake, unstake,
 * restake, add to and take from a pool, supply, withdraw, borrow, repay, and
 * slot a relic. Amounts are shares of what is available; before sending, the
 * preview shows the gas, the fee and slippage, and what it does to the army,
 * the walls and the loans. Commands go through the match like an NPC's.
 */

import { el } from '../../util/dom.js';
import { STAKES_INTO, UNSTAKES_INTO } from '../core/catalog.js';
import { qmul, qn } from '../core/fixed.js';
import { account, holding, swapCostRate, type CommandResult } from '../core/ledger.js';
import { available, previewCommand, type Match } from '../core/match.js';
import { warnAt } from './hud.js';
import type { AssetId, Command } from '../core/types.js';

type Action = 'swap' | 'stake' | 'unstake' | 'restake' | 'lpAdd' | 'lpRemove' | 'supply' | 'withdraw' | 'borrow' | 'repay' | 'slotRelic';

const ACTIONS: { id: Action; label: string }[] = [
  { id: 'swap', label: 'Swap' },
  { id: 'stake', label: 'Stake ETH' },
  { id: 'unstake', label: 'Unstake' },
  { id: 'restake', label: 'Restake' },
  { id: 'lpAdd', label: 'Add to a pool' },
  { id: 'lpRemove', label: 'Leave a pool' },
  { id: 'supply', label: 'Supply' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'borrow', label: 'Borrow' },
  { id: 'repay', label: 'Repay' },
  { id: 'slotRelic', label: 'Slot a relic' },
];

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export interface TradePanelOptions {
  match: Match;
  /** Sends a command (through the match's client; the match itself when absent). */
  command?: (cmd: Command) => CommandResult;
  /** A command was accepted (the courier goes out). */
  onCommand: (cmd: Command) => void;
}

export class TradePanel {
  readonly element = el('div', { class: 'siege-trade' });
  readonly #opts: TradePanelOptions;
  #action: Action = 'swap';
  #a: AssetId = '';
  #b: AssetId = '';
  #via: 'lending' | 'vault' = 'lending';
  #pct = 50;
  #slot: 0 | 1 | 2 = 0;
  #message = '';

  constructor(opts: TradePanelOptions) {
    this.#opts = opts;
    this.render();
  }

  get #m(): Match {
    return this.#opts.match;
  }

  #dispatch(cmd: Command): CommandResult {
    return this.#opts.command ? this.#opts.command(cmd) : this.#m.command('A', cmd);
  }

  render(): void {
    const m = this.#m;
    const me = m.side('A');
    const symbol = (id: AssetId) => m.catalog.asset(id).symbol;
    const held = (kind: 'spot' | 'staked' | 'supplied' | 'borrowed') =>
      [...new Set(me.portfolio.positions.filter((p) => p.kind === kind && p.unlocksAtRound === undefined && (kind !== 'supplied' || p.protocol === this.#via) && (kind !== 'borrowed' || p.protocol === this.#via)).map((p) => p.asset))];
    const all = m.catalog.assets.filter((a) => a.id !== 'drop').map((a) => a.id);

    // what each action picks from
    const lists: Record<Action, { a: AssetId[]; b?: AssetId[]; via?: boolean }> = {
      swap: { a: held('spot'), b: all },
      stake: { a: held('spot').filter((id) => STAKES_INTO[id]) },
      unstake: { a: [...new Set([...held('staked'), ...held('spot')])].filter((id) => UNSTAKES_INTO[id]) },
      restake: { a: [...new Set([...held('staked'), ...held('spot')])].filter((id) => UNSTAKES_INTO[id]) },
      lpAdd: { a: held('spot'), b: held('spot') },
      lpRemove: { a: me.portfolio.positions.filter((p) => p.kind === 'lp').map((p) => `${p.asset}|${p.pairWith}`) },
      supply: { a: held('spot').filter((id) => this.#via === 'lending' || m.catalog.asset(id).collateral), via: true },
      withdraw: { a: held('supplied'), via: true },
      borrow: { a: this.#via === 'vault' ? m.catalog.stables() : all, via: true },
      repay: { a: held('borrowed'), via: true },
      slotRelic: { a: me.portfolio.nfts.map((n) => n.collection) },
    };
    const list = lists[this.#action];
    if (!list.a.includes(this.#a)) this.#a = list.a[0] ?? '';
    if (list.b && (!list.b.includes(this.#b) || this.#b === this.#a)) this.#b = list.b.find((x) => x !== this.#a) ?? '';

    const action = el('select', { class: 'siege-action', 'aria-label': 'Action' }, ...ACTIONS.map((x) => opt(x.id, x.label, x.id === this.#action)));
    action.addEventListener('change', () => {
      this.#action = action.value as Action;
      this.#message = '';
      this.render();
    });
    const label = (id: string) => {
      if (this.#action === 'lpRemove') {
        const [x, y] = id.split('|');
        return `${symbol(x!)} + ${symbol(y!)}`;
      }
      if (this.#action === 'slotRelic') return id;
      return symbol(id);
    };
    const pickA = el('select', { class: 'siege-pick-a', 'aria-label': 'From' }, ...list.a.map((id) => opt(id, label(id), id === this.#a)));
    pickA.addEventListener('change', () => {
      this.#a = pickA.value;
      this.render();
    });
    const pickB = list.b
      ? el('select', { class: 'siege-pick-b', 'aria-label': this.#action === 'swap' ? 'To' : 'Paired with' }, ...list.b.filter((id) => id !== this.#a).map((id) => opt(id, symbol(id), id === this.#b)))
      : null;
    pickB?.addEventListener('change', () => {
      this.#b = pickB.value;
      this.render();
    });
    const via = list.via
      ? el('select', { class: 'siege-via', 'aria-label': 'Where' }, opt('lending', 'at the Bank (lending)', this.#via === 'lending'), opt('vault', 'at the Vault (mints stables)', this.#via === 'vault'))
      : null;
    via?.addEventListener('change', () => {
      this.#via = via.value as 'lending' | 'vault';
      this.render();
    });
    const slot =
      this.#action === 'slotRelic'
        ? el('select', { class: 'siege-slot', 'aria-label': 'Relic slot' }, ...[0, 1, 2].map((i) => opt(String(i), `Slot ${i + 1}`, i === this.#slot)))
        : null;
    slot?.addEventListener('change', () => {
      this.#slot = Number(slot.value) as 0 | 1 | 2;
      this.render();
    });

    const amount = this.#action === 'slotRelic' ? null : el('input', { class: 'siege-pct', type: 'range', min: '1', max: '100', step: '1', value: String(this.#pct), 'aria-label': 'How much' });
    amount?.addEventListener('input', () => {
      this.#pct = Number(amount.value);
      this.#refreshPreview(previewEl, sendBtn, pctLabel);
    });
    const pctLabel = el('span', { class: 'siege-pct-label' });
    const quick = this.#action === 'slotRelic' ? [] : [25, 50, 100].map((p) => {
      const b = el('button', { class: 'btn siege-quick', type: 'button' }, p === 100 ? 'All' : `${p}%`);
      b.addEventListener('click', () => {
        this.#pct = p;
        if (amount) amount.value = String(p);
        this.#refreshPreview(previewEl, sendBtn, pctLabel);
      });
      return b;
    });
    const previewEl = el('p', { class: 'siege-preview-line', role: 'status' });
    const sendBtn = el('button', { class: 'btn siege-send', type: 'button' }, 'Send the courier');
    sendBtn.addEventListener('click', () => this.#send());
    this.#refreshPreview(previewEl, sendBtn, pctLabel);

    // one tap when a loan is in danger: repay half, or add collateral
    const warnings = (['lending', 'vault'] as const).flatMap((p) => {
      const acc = account(me, p, { catalog: m.catalog, prices: m.state.market.prices });
      if (acc.debt <= 0 || acc.hf >= warnAt(m)) return [];
      const repay = el('button', { class: 'btn siege-repay', type: 'button' }, 'Repay half');
      repay.addEventListener('click', () => this.#rescue(p, 'repay'));
      const add = el('button', { class: 'btn siege-collateral', type: 'button' }, 'Add collateral');
      add.addEventListener('click', () => this.#rescue(p, 'collateral'));
      return [el('div', { class: 'siege-warning', role: 'alert' }, `⚠ ${p === 'vault' ? 'Vault' : 'Loan'} health ${acc.hf.toFixed(2)}: close to liquidation.`, repay, add)];
    });

    this.element.replaceChildren(
      ...warnings,
      el('div', { class: 'siege-row' }, action, pickA, ...(pickB ? [el('span', {}, this.#action === 'swap' ? '→' : '+'), pickB] : []), ...(via ? [via] : []), ...(slot ? [slot] : [])),
      ...(amount ? [el('div', { class: 'siege-row' }, amount, pctLabel, ...quick)] : []),
      previewEl,
      sendBtn,
      ...(this.#message ? [el('p', { class: 'siege-message', role: 'status' }, this.#message)] : []),
    );
  }

  /** The command the form describes now (null: nothing to do). */
  #command(): Command | null {
    const m = this.#m;
    const a = this.#a;
    if (!a) return null;
    const share = (q: bigint) => (this.#pct >= 100 ? q : qmul(q, this.#pct / 100));
    switch (this.#action) {
      case 'swap':
        return this.#b ? { t: 'swap', from: a, to: this.#b, qty: share(available(m, 'A', 'swap', a)) } : null;
      case 'stake':
      case 'unstake':
      case 'restake':
        return { t: this.#action, asset: a, qty: share(available(m, 'A', this.#action, a)) };
      case 'lpAdd': {
        if (!this.#b) return null;
        // as much of a as b can pair with
        const pa = m.state.market.prices[a] ?? 0;
        const pb = m.state.market.prices[this.#b] ?? 0;
        const maxA = Math.min(qn(available(m, 'A', 'lpAdd', a)), pa > 0 ? (qn(holding(m.side('A'), this.#b)) * pb) / pa : 0);
        return { t: 'lpAdd', a, b: this.#b, qty: share(BigInt(Math.floor(maxA * 1e9))) };
      }
      case 'lpRemove': {
        const [x, y] = a.split('|') as [AssetId, AssetId];
        const lp = m.side('A').portfolio.positions.find((p) => p.kind === 'lp' && p.asset === x && p.pairWith === y);
        return lp ? { t: 'lpRemove', a: x, b: y, qty: share(lp.qty) } : null;
      }
      case 'supply':
      case 'withdraw':
      case 'borrow':
      case 'repay':
        return { t: this.#action, asset: a, qty: share(available(m, 'A', this.#action, a, this.#via)), via: this.#via };
      case 'slotRelic':
        return { t: 'slotRelic', nft: a, slot: this.#slot };
    }
  }

  #refreshPreview(line: HTMLElement, send: HTMLButtonElement, pctLabel: HTMLElement): void {
    pctLabel.textContent = `${this.#pct}%`;
    const cmd = this.#command();
    if (!cmd || ('qty' in cmd && cmd.qty <= 0n)) {
      line.textContent = 'Nothing to send.';
      send.disabled = true;
      return;
    }
    const p = previewCommand(this.#m, 'A', cmd);
    send.disabled = !p.ok;
    if (!p.ok) {
      line.textContent = p.reason ?? 'Not possible.';
      return;
    }
    const parts = [`gas ${usd(p.gas)}`];
    if (cmd.t === 'swap') {
      const dollars = qn(cmd.qty) * (this.#m.state.market.prices[cmd.from] ?? 0);
      parts.push(`fee and slippage ${(swapCostRate(dollars, this.#m.state.unitValue) * 100).toFixed(1)}%`);
    }
    if (p.unitsAfter !== p.unitsBefore) parts.push(`army ${p.unitsBefore} → ${p.unitsAfter} units`);
    if (Math.round(p.keepMaxAfter) !== Math.round(p.keepMaxBefore)) parts.push(`walls ${Math.round(p.keepMaxBefore)} → ${Math.round(p.keepMaxAfter)} HP`);
    const hf = Math.min(p.hfAfter.lending, p.hfAfter.vault);
    if (Number.isFinite(hf)) parts.push(`health ${hf.toFixed(2)}`);
    line.textContent = parts.join(' · ');
  }

  #send(): void {
    const cmd = this.#command();
    if (!cmd) return;
    const r = this.#dispatch(cmd);
    this.#message = r.ok ? 'The courier sets out.' : r.reason;
    if (r.ok) this.#opts.onCommand(cmd);
    this.render();
  }

  #rescue(via: 'lending' | 'vault', how: 'repay' | 'collateral'): void {
    const m = this.#m;
    const me = m.side('A');
    let cmd: Command | null = null;
    if (how === 'repay') {
      const debt = me.portfolio.positions.find((p) => p.kind === 'borrowed' && p.protocol === via);
      if (debt) cmd = { t: 'repay', asset: debt.asset, qty: qmul(available(m, 'A', 'repay', debt.asset, via), 0.5), via };
    } else {
      // half of the biggest holding that can back a loan
      const prices = m.state.market.prices;
      const best = me.portfolio.positions
        .filter((p) => p.kind === 'spot' && m.catalog.asset(p.asset).collateral)
        .sort((a, b) => qn(b.qty) * (prices[b.asset] ?? 0) - qn(a.qty) * (prices[a.asset] ?? 0))[0];
      if (best) cmd = { t: 'supply', asset: best.asset, qty: qmul(best.qty, 0.5), via };
    }
    if (!cmd) {
      this.#message = how === 'repay' ? 'Nothing to repay it with.' : 'Nothing that can back the loan.';
      this.render();
      return;
    }
    const r = this.#dispatch(cmd);
    this.#message = r.ok ? (how === 'repay' ? 'Half the debt repaid.' : 'Collateral added.') : r.reason;
    if (r.ok) this.#opts.onCommand(cmd);
    this.render();
  }
}

function opt(value: string, label: string, selected: boolean): HTMLOptionElement {
  const o = el('option', { value }, label);
  o.selected = selected;
  return o;
}
