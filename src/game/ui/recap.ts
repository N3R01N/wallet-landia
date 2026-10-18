/**
 * The post-match recap (the spec's open question: "a post-match recap screen:
 * PnL chart, liquidations, MVP squad"): who won and how, the portfolios and
 * the keeps round by round (two charts, one axis each), liquidations, the MVP
 * squads, the weeks' events, and the same numbers as a table.
 */

import { el } from '../../util/dom.js';
import { EVENTS } from '../core/market.js';
import type { Match } from '../core/match.js';
import type { RoundRecord } from '../core/types.js';
import { TEAM_COLORS } from '../render/battleView.js';

const SVG = 'http://www.w3.org/2000/svg';

export interface Mvp {
  label: string;
  damage: number;
}

export function recap(m: Match, mvp: { A: Mvp | null; B: Mvp | null }): HTMLElement {
  const s = m.state;
  const h = s.history;
  const start = h[0];
  const last = h[h.length - 1];
  const pct = (v: number, base: number) => (base > 0 ? v / base - 1 : 0);
  const liq = h.reduce<[number, number]>((t, r) => [t[0] + r.liquidations[0], t[1] + r.liquidations[1]], [0, 0]);
  const held = s.buildings.filter((b) => b.owner === 'A').length;
  const headline = s.winner === 'A' ? 'Victory' : s.winner === 'B' ? 'Defeat' : 'A draw';
  const why =
    s.winner === 'draw'
      ? 'Both keeps stood at the same strength.'
      : s.suddenDeath && (s.sides[0].keepHp > 0 && s.sides[1].keepHp > 0)
        ? 'Decided in sudden death, on keep HP.'
        : s.winner === 'A'
          ? 'The enemy keep has fallen.'
          : 'Your keep has fallen.';
  const tile = (value: string, label: string) => el('div', { class: 'siege-tile' }, el('strong', {}, value), el('span', {}, label));
  const money = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  const events = h.filter((r) => r.event).map((r) => el('li', {}, `Week ${r.round}: ${EVENTS[r.event!].name}`));
  return el(
    'section',
    { class: 'siege-recap', 'aria-label': 'Match recap' },
    el('h3', { class: `siege-recap-head siege-recap-${s.winner ?? 'draw'}` }, headline),
    el('p', {}, `${why} ${s.round} round${s.round === 1 ? '' : 's'}.`),
    el(
      'div',
      { class: 'siege-tiles' },
      tile(start && last ? money(pct(last.value[0], start.value[0])) : '—', 'your portfolio'),
      tile(start && last ? money(pct(last.value[1], start.value[1])) : '—', 'the enemy’s'),
      tile(String(liq[0]), liq[0] === 1 ? 'liquidation of yours' : 'liquidations of yours'),
      tile(`${held} of ${s.buildings.length}`, 'buildings held'),
    ),
    lineChart('Portfolio against its start', h, (r) => (start ? [pct(r.value[0], start.value[0]), pct(r.value[1], start.value[1])] : [0, 0]), (v) => money(v)),
    lineChart('Keep HP', h, (r) => r.keep, (v) => `${Math.round(v * 100)}%`, [0, 1]),
    el(
      'div',
      { class: 'siege-mvp' },
      mvp.A ? el('div', {}, el('strong', {}, '🏅 Your MVP: '), `${mvp.A.label}, ${Math.round(mvp.A.damage).toLocaleString('en-US')} damage`) : null,
      mvp.B ? el('div', {}, el('strong', {}, 'Their MVP: '), `${mvp.B.label}, ${Math.round(mvp.B.damage).toLocaleString('en-US')} damage`) : null,
      liq[1] > 0 ? el('div', {}, `The enemy was liquidated ${liq[1]} time${liq[1] === 1 ? '' : 's'}.`) : null,
    ),
    events.length > 0 ? el('ul', { class: 'siege-events' }, ...events) : null,
    table(h),
  );
}

/** One measure, both sides, round by round: one axis, a legend, end labels, a tooltip per round. */
function lineChart(title: string, h: readonly RoundRecord[], pick: (r: RoundRecord) => [number, number], fmt: (v: number) => string, domain?: [number, number]): HTMLElement {
  const w = 320;
  const ht = 120;
  const pad = { l: 34, r: 42, t: 10, b: 18 };
  const values = h.map(pick);
  const all = values.flat();
  let lo = domain?.[0] ?? Math.min(0, ...all);
  let hi = domain?.[1] ?? Math.max(0, ...all);
  if (hi - lo < 1e-6) {
    hi += 0.05;
    lo -= 0.05;
  }
  const x = (i: number) => pad.l + (h.length <= 1 ? 0 : (i / (h.length - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (ht - pad.t - pad.b);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  svg.setAttribute('class', 'siege-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  // recessive axis: the baseline (0, or the bottom of a fixed domain) and the extremes as ticks
  const base = domain ? lo : 0;
  add('line', { x1: pad.l, x2: w - pad.r, y1: y(base), y2: y(base), class: 'siege-chart-base' });
  add('text', { x: pad.l - 4, y: y(hi) + 4, class: 'siege-chart-tick', 'text-anchor': 'end' }, fmt(hi));
  add('text', { x: pad.l - 4, y: y(lo) + 4, class: 'siege-chart-tick', 'text-anchor': 'end' }, fmt(lo));
  h.forEach((r, i) => add('text', { x: x(i), y: ht - 4, class: 'siege-chart-tick', 'text-anchor': 'middle' }, String(r.round)));
  ([['A', 0], ['B', 1]] as const).forEach(([side, si]) => {
    const pts = values.map((v, i) => `${x(i)},${y(v[si])}`).join(' ');
    add('polyline', { points: pts, fill: 'none', stroke: TEAM_COLORS[side], 'stroke-width': 2, 'stroke-linejoin': 'round' });
    values.forEach((v, i) => {
      add('circle', { cx: x(i), cy: y(v[si]), r: 4, fill: TEAM_COLORS[side], stroke: '#f3ead6', 'stroke-width': 2 });
      // a bigger, invisible target with the round's numbers
      const hit = add('circle', { cx: x(i), cy: y(v[si]), r: 9, fill: 'transparent' });
      const t = document.createElementNS(SVG, 'title');
      t.textContent = `Round ${h[i]!.round} · ${side === 'A' ? 'You' : 'Enemy'}: ${fmt(v[si])}`;
      hit.append(t);
    });
    const end = values[values.length - 1];
    if (end) add('text', { x: x(values.length - 1) + 6, y: y(end[si]) + 4, class: 'siege-chart-label' }, side === 'A' ? 'You' : 'Enemy');
  });
  return el(
    'figure',
    { class: 'siege-figure' },
    el('figcaption', {}, title, el('span', { class: 'siege-legend' }, swatch('A'), ' You ', swatch('B'), ' Enemy')),
    svg as unknown as HTMLElement,
  );
}

function swatch(side: 'A' | 'B'): HTMLElement {
  return Object.assign(el('span', { class: 'siege-swatch' }), { style: `background: ${TEAM_COLORS[side]}` });
}

/** The same numbers as a table (for screen readers, and for exact values). */
function table(h: readonly RoundRecord[]): HTMLElement {
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  return el(
    'details',
    { class: 'siege-recap-table' },
    el('summary', {}, 'Round by round'),
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ...['Round', 'Your value', 'Their value', 'Your keep', 'Their keep', 'Event'].map((x) => el('th', {}, x)))),
      el(
        'tbody',
        {},
        ...h.map((r) =>
          el(
            'tr',
            {},
            el('td', {}, String(r.round)),
            el('td', {}, usd(r.value[0])),
            el('td', {}, usd(r.value[1])),
            el('td', {}, `${Math.round(r.keep[0] * 100)}%`),
            el('td', {}, `${Math.round(r.keep[1] * 100)}%`),
            el('td', {}, r.event ? EVENTS[r.event].name : ''),
          ),
        ),
      ),
    ),
  );
}
