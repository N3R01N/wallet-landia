/**
 * Ledger Wars' help: the controls, how the money works, and every building
 * with what it trains and for which token (from the rules, so it says what
 * the game does). Opens from "? Help" in the top bar, or with F1.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import { el } from '../../util/dom.js';
import { BUILDINGS, BUILDING_KINDS, RULES, TOKENS, TRAIN } from '../data/rules.js';
import { COMBAT } from '../core/combat.js';
import { ECON } from '../core/economy.js';

type Tab = 'controls' | 'economy' | 'buildings';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export class Help {
  readonly element = el('dialog', { class: 'rts-help', 'aria-label': 'Help' });
  #tab: Tab = 'controls';

  constructor() {
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
  }

  show(tab: Tab = this.#tab): void {
    this.#tab = tab;
    if (!this.element.isConnected) document.body.append(this.element);
    this.#render();
    if (!this.element.open) this.element.showModal();
  }

  #render(): void {
    const close = el('button', { class: 'btn', type: 'button', 'aria-label': 'Close the help' }, '✕');
    close.addEventListener('click', () => this.element.close());
    const tabs = (['controls', 'economy', 'buildings'] as const).map((t) => {
      const b = el('button', { class: 'rts-help-tab', type: 'button', role: 'tab', 'aria-selected': String(t === this.#tab), 'data-tab': t }, { controls: 'Controls', economy: 'Money', buildings: 'Buildings & units' }[t]);
      b.addEventListener('click', () => this.show(t));
      return b;
    });
    this.element.replaceChildren(el('div', { class: 'rts-help-head' }, el('h2', {}, '⚔ Ledger Wars'), close), el('div', { class: 'rts-help-tabs', role: 'tablist' }, ...tabs), el('div', { class: 'rts-help-body' }, ...this.#body()));
  }

  #body(): HTMLElement[] {
    if (this.#tab === 'controls') {
      const rows: [string, string][] = [
        ['Left click', 'Select a unit or a building (Shift adds units)'],
        ['Left drag', 'Select your units in the box'],
        ['Double-click', 'All your units of that type in view'],
        ['Right click', 'Move there, or attack what is under the cursor; with a building selected: where its new units go'],
        ['A, then click', 'Attack-move: walk there, fighting whatever is met'],
        ['S / H', 'Stop / hold (stand and strike only what comes in reach)'],
        ['Ctrl + 1–9', 'Make the selection a group; 1–9 selects it again, twice jumps to it'],
        ['Arrow keys, the arrow strips at the edges, middle drag', 'Move the view (point at a strip to scroll that way); the wheel zooms; Q/E turn'],
        ['Minimap', 'Click to look there; right-click to send the selected units'],
        ['Esc', 'Clear the selection, stop placing'],
      ];
      return [
        el('p', {}, 'You start with your wallet hall and money. Destroy the enemy’s wallet hall to win; lose yours and you lose.'),
        el('table', { class: 'rts-help-table' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v))))),
        el('p', {}, `Idle units guard their spot: they take on enemies within ${COMBAT.sight} m and come back. A plain move ignores enemies on the way.`),
      ];
    }
    if (this.#tab === 'economy') {
      const p = ECON.perMinute;
      return [
        el('p', {}, el('strong', {}, 'Tokens in your wallet earn nothing. '), 'Positions earn, every second, more at higher building levels (+', pct(ECON.levelBonus), ' a level):'),
        el(
          'ul',
          {},
          el('li', {}, `Staked ETH (Staking House): ${pct(p.staked)} a minute, paid as stETH.`),
          el('li', {}, `Restaked stETH (Restaking Hall): ${pct(p.restaked)} a minute.`),
          el('li', {}, `A pool (Exchange): ${pct(p.lp)} a minute in fees, and it follows the prices (half and half).`),
          el('li', {}, `Supplied at the Bank: ${pct(p.supplied)} a minute, and it backs loans.`),
        ),
        el('p', {}, `To spend what they earn, take it back out (Unstake, Remove, Withdraw). Swapping needs an Exchange: build it first.`),
        el('p', {}, `Borrowing at the Bank: up to ${pct(ECON.ltv)} of your collateral, the debt growing ${pct(p.borrowed)} a minute. If prices fall and its health drops under 1, part of your collateral is sold to repay it, with a ${pct(ECON.penalty)} penalty. The Vault lends DAI against ETH the same way.`),
        el('p', {}, 'Buildings cost dollars, paid in stablecoins first, then ETH. Units cost their own token: swap for it at the Exchange.'),
        el('p', {}, 'If the enemy destroys a building that holds positions, they freeze: no income, no withdrawing, until you build another of the same kind.'),
      ];
    }
    return [
      el(
        'table',
        { class: 'rts-help-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Building'), el('th', {}, 'Cost'), el('th', {}, 'Needs'), el('th', {}, 'Trains (level: unit, token)'))),
        el(
          'tbody',
          {},
          ...BUILDING_KINDS.map((k) => {
            const r = BUILDINGS[k];
            const needs = [r.hallLevel > 1 ? `hall ${r.hallLevel}` : '', ...r.needs.map((n) => BUILDINGS[n].name)].filter(Boolean).join(', ') || '—';
            const trains = TRAIN.filter((t) => t.at === k).map((t) => `${t.level}: ${UNIT_TYPES[t.unit]!.name} (${TOKENS[t.token].symbol}, $${RULES.unitValue * UNIT_TYPES[t.unit]!.costMult})`);
            return el('tr', {}, el('th', {}, r.name), el('td', {}, k === 'hall' ? '—' : `$${r.cost}`), el('td', {}, needs), el('td', {}, trains.join('; ') || '—'));
          }),
        ),
      ),
      el('p', {}, 'Melee beats Cavalry, Cavalry beats Ranged, Ranged beats Melee (+50%). Area attacks hit Swarms harder. Siege units are slow and weak against units but smash buildings. Your wallet hall shoots arrows at anything close.'),
    ];
  }
}
