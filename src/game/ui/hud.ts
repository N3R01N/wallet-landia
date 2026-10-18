/**
 * The match HUD's pieces (spec: "HUD (HTML overlay)"): the price ticker with
 * the week's daily candles, the regime badge, the portfolio (positions →
 * squads), the Health Factor gauges and the rumor card. Each is drawn from
 * the match state; the match panel puts them together.
 */

import { el } from '../../util/dom.js';
import { BALANCE } from '../config/balance.js';
import { buildArmy } from '../core/army.js';
import { UNIT_TYPES } from '../core/catalog.js';
import { qn } from '../core/fixed.js';
import { account, holdingsOf, positionValue } from '../core/ledger.js';
import { CALM_RUMOR, EVENTS } from '../core/market.js';
import type { Match } from '../core/match.js';
import type { AssetId, Regime, SideId } from '../core/types.js';
import { BUILDING_BUFF, BUILDING_NAME, abilitiesOf, abilityName, canShutdown, homeAt, relicOf } from '../core/depth.js';

const SVG = 'http://www.w3.org/2000/svg';
const usd = (n: number) => (Math.abs(n) >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(n < 10 ? 2 : 0)}`);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

const REGIME: Record<Regime, { label: string; icon: string }> = {
  bull: { label: 'Bull market', icon: '🐂' },
  crab: { label: 'Crab market', icon: '🦀' },
  bear: { label: 'Bear market', icon: '🐻' },
};

export function regimeBadge(regime: Regime): HTMLElement {
  const r = REGIME[regime];
  return el('span', { class: `siege-regime siege-regime-${regime}`, title: r.label }, `${r.icon} ${r.label}`);
}

/** The assets worth watching: the player's biggest non-stable holdings, then ETH and BTC. */
function watched(m: Match, side: SideId, n = 4): AssetId[] {
  const prices = m.state.market.prices;
  const by = new Map<AssetId, number>();
  for (const h of holdingsOf(m.side(side))) {
    if (m.catalog.asset(h.asset).isStable) continue;
    by.set(h.asset, (by.get(h.asset) ?? 0) + qn(h.qty) * (prices[h.asset] ?? 0));
  }
  const ids = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of ['eth', 'wbtc']) if (!ids.includes(id)) ids.push(id);
  return ids.slice(0, n);
}

/**
 * The ticker: per watched asset, the last week's daily candles and its change.
 * `days` shows the week only so far (the Market phase plays it day by day).
 */
export function ticker(m: Match, side: SideId = 'A', days = 7): HTMLElement {
  const candles = m.state.market.candles.slice(0, Math.max(1, days));
  const today = candles[candles.length - 1];
  const rows = watched(m, side).map((id) => {
    const a = m.catalog.asset(id);
    const price = today?.close[id] ?? m.state.market.prices[id] ?? a.price;
    if (candles.length === 0) return el('div', { class: 'siege-tick' }, el('span', { class: 'siege-tick-sym' }, a.symbol), el('span', {}, usd(price)), el('span', { class: 'siege-tick-chg' }, 'opening'));
    const opens = candles.map((c) => c.open[id] ?? price);
    const closes = candles.map((c) => c.close[id] ?? price);
    const lo = Math.min(...opens, ...closes);
    const hi = Math.max(...opens, ...closes);
    const span = hi - lo || hi * 0.01 || 1;
    const w = 7 * 8;
    const h = 22;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('class', 'siege-candles');
    svg.setAttribute('aria-hidden', 'true');
    const y = (v: number) => h - 1 - ((v - lo) / span) * (h - 2);
    candles.forEach((_, i) => {
      const o = opens[i]!;
      const c = closes[i]!;
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(i * 8 + 1.5));
      r.setAttribute('width', '5');
      r.setAttribute('y', String(Math.min(y(o), y(c))));
      r.setAttribute('height', String(Math.max(1, Math.abs(y(o) - y(c)))));
      r.setAttribute('class', c >= o ? 'up' : 'down');
      svg.append(r);
    });
    const week = closes[closes.length - 1]! / opens[0]! - 1;
    return el('div', { class: 'siege-tick' }, el('span', { class: 'siege-tick-sym' }, a.symbol), svg, el('span', {}, usd(price)), el('span', { class: `siege-tick-chg ${week >= 0 ? 'up' : 'down'}` }, pct(week)));
  });
  return el('div', { class: 'siege-ticker', 'aria-label': 'Prices this week' }, ...rows);
}

/** The rumor for the next Market phase (true 70% of the time). */
export function rumorCard(m: Match): HTMLElement | null {
  if (m.state.phase !== 'trade') return null;
  const r = m.state.market.rumor;
  return el('div', { class: 'siege-rumor', role: 'note' }, el('strong', {}, '🗞 Rumor: '), r ? String(EVENTS[r].rumor) : CALM_RUMOR, el('small', {}, ' (rumors are right about 7 times in 10)'));
}

/** Health Factor gauges, one per loan (lending, vault). Amber under 1.2. */
export function gauges(m: Match, side: SideId = 'A'): HTMLElement | null {
  const x = m.side(side);
  const ctx = { catalog: m.catalog, prices: m.state.market.prices };
  const loans = (['lending', 'vault'] as const).map((p) => account(x, p, ctx)).filter((a) => a.debt > 0);
  if (loans.length === 0) return null;
  return el(
    'div',
    { class: 'siege-gauges' },
    ...loans.map((a) => {
      const hf = a.hf;
      const level = hf < 1.05 ? 'danger' : hf < warnAt(m, side) ? 'warn' : 'ok';
      const fill = Math.max(0, Math.min(1, (hf - 1) / 1.5));
      return el(
        'div',
        { class: `siege-gauge siege-gauge-${level}`, title: `Collateral ${usd(a.collateral)}, debt ${usd(a.debt)}` },
        el('span', {}, a.protocol === 'vault' ? 'Vault HF' : 'Loan HF'),
        el('span', { class: 'siege-gauge-bar' }, Object.assign(el('span', { class: 'siege-gauge-fill' }), { style: `width: ${(fill * 100).toFixed(0)}%` })),
        el('span', { class: 'siege-gauge-val' }, Number.isFinite(hf) ? hf.toFixed(2) : '∞'),
      );
    }),
  );
}

const KIND: Record<string, string> = { spot: '', staked: 'staked', restaked: 'restaked', lp: 'pool', supplied: 'supplied', borrowed: 'debt' };

/** The portfolio: each position, its value, and the squad it fields (stables: walls). */
export function portfolio(m: Match, side: SideId = 'A'): HTMLElement {
  const s = m.state;
  const x = m.side(side);
  const army = buildArmy(x, { catalog: m.catalog, prices: s.market.prices, unitValue: s.unitValue });
  const units = new Map(army.squads.filter((q) => !q.detonates).map((q) => [q.asset, q]));
  const rows = x.portfolio.positions
    .map((p) => ({ p, v: positionValue(p, s.market.prices) }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .map(({ p, v }) => {
      const a = m.catalog.asset(p.asset);
      const sq = units.get(p.asset);
      const what = p.kind === 'borrowed' ? 'debt' : a.isStable ? 'walls' : sq ? unitLink(sq.unit, sq.count) : 'no units';
      return el(
        'tr',
        {},
        el('td', {}, a.symbol, p.pairWith ? ` + ${m.catalog.asset(p.pairWith).symbol}` : '', KIND[p.kind] ? el('small', {}, ` ${KIND[p.kind]}`) : null),
        el('td', { class: 'num' }, usd(v)),
        el('td', { class: 'siege-units' }, what),
      );
    });
  return el('table', { class: 'siege-portfolio' }, el('tbody', {}, ...rows));
}

/** A count of a unit, its name a button that opens the guide at it (siegeMode listens). */
export function unitLink(unit: string, count: number): HTMLElement {
  return el('span', {}, `${count} `, el('button', { class: 'siege-unit-link', type: 'button', 'data-guide-unit': unit, title: 'What this unit does' }, UNIT_TYPES[unit]?.name ?? unit));
}

/** The battlefield buildings: who holds each, what it gives its holder, and where you have home advantage. */
export function fieldPanel(m: Match, side: SideId = 'A'): HTMLElement | null {
  const bs = m.state.buildings;
  if (bs.length === 0) return null;
  const me = m.side(side);
  return el(
    'div',
    { class: 'siege-field' },
    el('strong', {}, 'Battlefield'),
    ...bs.map((b) => {
      const owner = b.owner === null ? 'neutral' : b.owner === side ? 'yours' : 'theirs';
      const name = b.id === 'tower' ? '' : ` · ${b.id}`;
      return el(
        'div',
        { class: `siege-field-row siege-owner-${owner}`, title: BUILDING_BUFF[b.kind] },
        el('span', {}, `${BUILDING_NAME[b.kind]}${name}`),
        el('span', { class: 'siege-field-buff' }, BUILDING_BUFF[b.kind]),
        el('span', { class: 'siege-field-owner' }, owner, homeAt(me, b.kind) ? ' · home' : ''),
      );
    }),
  );
}

/** Your protocol abilities (from your positions) and slotted relics, at today's tiers. */
export function powersPanel(m: Match, side: SideId = 'A'): HTMLElement | null {
  const me = m.side(side);
  const abilities = abilitiesOf(me).map((a) => abilityName(me, a));
  if (canShutdown(me)) abilities.push(abilityName(me, 'emergency-shutdown'));
  if (abilities.length === 0 && me.portfolio.nfts.length === 0) return null;
  return el(
    'div',
    { class: 'siege-powers' },
    abilities.length > 0 ? el('div', {}, el('strong', {}, 'Abilities: '), abilities.join(', ')) : null,
    ...me.portfolio.relics.map((slot, i) => {
      if (!slot) return el('div', { class: 'siege-relic empty' }, `Relic slot ${i + 1}: empty`);
      const nft = me.portfolio.nfts.find((n) => n.collection === slot.nft);
      const r = nft ? relicOf(nft.collection, m.state.market.nftFloors[nft.collection] ?? nft.floor, m.state.unitValue) : null;
      return r ? el('div', { class: `siege-relic siege-tier-${r.tier}` }, `Relic ${i + 1}: ${r.name} (${r.tierName}) · ${r.text}`) : null;
    }),
  );
}

/** HF under this warns; the Liquidator's Eye warns a candle earlier. */
export function warnAt(m: Match, side: SideId = 'A'): number {
  return BALANCE.ledger.hfWarning + (m.relics(side).some((r) => r.effect === 'liq-eye') ? 0.1 : 0);
}
