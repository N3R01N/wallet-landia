/**
 * Ledger Wars' HUD: the treasury along the top (each token, its dollars, the
 * total; the clock and the market), the hall's build menu at the bottom left
 * (C&C style: pick, wait, place), and the selection panel at the bottom
 * right. It reads the World and sends commands through `send`.
 */

import { el } from '../../util/dom.js';
import { BUILDINGS, BUILDING_KINDS, TOKEN_IDS, TOKENS, type BuildingKind, type PlayerId } from '../data/rules.js';
import type { Building, Command, Result, World } from '../core/world.js';

export interface HudOptions {
  world: World;
  me: PlayerId;
  send: (cmd: Command) => Result;
  /** Start placing what the hall finished (the view shows the ghost). */
  onPlace: (kind: BuildingKind) => void;
  selected: () => Building | null;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const REGIME: Record<string, string> = { bull: '🐂 Bull', crab: '🦀 Crab', bear: '🐻 Bear' };

export class Hud {
  readonly element = el('div', { class: 'rts-hud' });
  readonly #top = el('div', { class: 'rts-top', role: 'status' });
  readonly #build = el('section', { class: 'rts-build', 'aria-label': 'Build' });
  readonly #info = el('section', { class: 'rts-info', 'aria-label': 'Selection' });
  readonly #toast = el('div', { class: 'rts-toast', role: 'alert' });
  readonly #o: HudOptions;
  #toastUntil = 0;
  /** What each section was last built from: rebuilt only when it changes (a button replaced under the pointer loses its click). */
  #keys = { build: '', info: '' };
  /** Live parts updated in place between rebuilds. */
  #live: { text: HTMLElement; bar: HTMLElement; read: () => [string, number] | null }[] = [];

  constructor(o: HudOptions) {
    this.#o = o;
    this.element.append(this.#top, this.#build, this.#info, this.#toast);
  }

  /** A short message (a refusal, a building ready). */
  say(text: string): void {
    this.#toast.textContent = text;
    this.#toast.hidden = false;
    this.#toastUntil = performance.now() + 2600;
  }

  render(): void {
    const w = this.#o.world;
    const me = w.players[this.#o.me];
    if (performance.now() > this.#toastUntil) this.#toast.hidden = true;

    // the treasury
    const held = TOKEN_IDS.filter((t) => me.tokens[t] * w.market.prices[t] >= 0.5);
    const total = TOKEN_IDS.reduce((s, t) => s + w.usd(this.#o.me, t), 0);
    this.#top.replaceChildren(
      el('span', { class: 'rts-clock' }, `⏱ ${clock(w.time)}`),
      el('span', { class: 'rts-market' }, `${REGIME[w.market.regime] ?? ''} · day ${w.market.day + 1}`),
      el('span', { class: 'rts-total' }, el('strong', {}, usd(total))),
      ...held.map((t) => el('span', { class: 'rts-token', title: `${me.tokens[t].toPrecision(4)} ${TOKENS[t].symbol} at ${usd(w.market.prices[t])}` }, el('b', {}, TOKENS[t].symbol), ` ${usd(w.usd(this.#o.me, t))}`)),
    );

    // the hall's construction (rebuilt when what it offers changes; the timers tick in place)
    const whys = BUILDING_KINDS.filter((k) => k !== 'hall').map((k) => w.cantBuild(this.#o.me, k));
    const s = this.#o.selected();
    const upWhy = s && s.owner === this.#o.me ? w.cantUpgrade(this.#o.me, s) : null;
    const buildKey = JSON.stringify([me.build?.kind, me.ready, whys]);
    const infoKey = JSON.stringify(s ? [s.id, s.level, s.upgrading?.to, upWhy, s.owner] : null);
    if (buildKey !== this.#keys.build || infoKey !== this.#keys.info) {
      this.#live = [];
      if (buildKey !== this.#keys.build) this.#renderBuild(whys);
      this.#renderInfo(s, upWhy);
      this.#keys = { build: buildKey, info: infoKey };
    }
    for (const l of this.#live) {
      const v = l.read();
      if (!v) continue;
      l.text.textContent = v[0];
      l.bar.style.setProperty('--p', String(Math.max(0, Math.min(1, v[1]))));
    }
  }

  #renderBuild(whys: (string | null)[]): void {
    const w = this.#o.world;
    const me = w.players[this.#o.me];
    const rows: HTMLElement[] = [el('h2', {}, '🏗 Build')];
    if (me.build) {
      const cancel = el('button', { class: 'btn rts-cancel', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => this.#send({ t: 'cancelBuild' }));
      const text = el('span', {});
      const bar = progress(0);
      this.#live.push({ text, bar, read: () => (me.build ? [`${BUILDINGS[me.build.kind].name} ${Math.ceil(me.build.left)} s`, 1 - me.build.left / me.build.total] : null) });
      rows.push(el('div', { class: 'rts-progress-row' }, text, bar, cancel));
    } else if (me.ready) {
      const kind = me.ready;
      const place = el('button', { class: 'btn rts-place', type: 'button' }, `Place the ${BUILDINGS[kind].name}`);
      place.addEventListener('click', () => this.#o.onPlace(kind));
      const cancel = el('button', { class: 'btn rts-cancel', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => this.#send({ t: 'cancelBuild' }));
      rows.push(el('div', { class: 'rts-progress-row' }, place, cancel));
    }
    const grid = el('div', { class: 'rts-build-grid' });
    BUILDING_KINDS.filter((k) => k !== 'hall').forEach((kind, i) => {
      const r = BUILDINGS[kind];
      const why = whys[i] ?? null;
      const b = el('button', { class: 'rts-build-item', type: 'button', 'data-kind': kind, title: `${r.blurb}${why ? `\n✗ ${why}` : ''}` }, el('strong', {}, r.name), el('span', {}, `${usd(r.cost)} · ${r.time} s`));
      b.toggleAttribute('disabled', why !== null);
      b.addEventListener('click', () => this.#send({ t: 'build', kind }));
      grid.append(b);
    });
    rows.push(grid);
    this.#build.replaceChildren(...rows);
  }

  #renderInfo(s: Building | null, why: string | null): void {
    if (!s) {
      this.#info.replaceChildren(el('p', { class: 'rts-hint' }, 'Click a building to select it. WASD or the arrows to move, the wheel to zoom, Q/E to turn.'));
      return;
    }
    const r = BUILDINGS[s.kind];
    const hpText = el('span', {});
    const hpBar = progress(1, 'hp');
    this.#live.push({ text: hpText, bar: hpBar, read: () => [`${Math.ceil(s.hp)} / ${s.maxHp}`, s.hp / s.maxHp] });
    const parts: HTMLElement[] = [el('h2', {}, `${r.name} · level ${s.level}`, s.owner === this.#o.me ? '' : ' (enemy)'), el('div', { class: 'rts-hp' }, hpBar, hpText), el('p', {}, r.blurb)];
    if (s.owner === this.#o.me) {
      if (s.upgrading) {
        const text = el('span', {});
        const bar = progress(0);
        this.#live.push({ text, bar, read: () => (s.upgrading ? [`Upgrading to ${s.upgrading.to}: ${Math.ceil(s.upgrading.left)} s`, 1 - s.upgrading.left / s.upgrading.total] : null) });
        parts.push(el('div', { class: 'rts-progress-row' }, text, bar));
      } else if (s.level < r.maxLevel) {
        const up = el('button', { class: 'btn rts-upgrade', type: 'button', title: why ?? '' }, `⬆ Level ${s.level + 1} · ${usd(r.upgrade[s.level - 1]!)} · ${r.upgradeTime} s`);
        up.toggleAttribute('disabled', why !== null);
        up.addEventListener('click', () => this.#send({ t: 'upgrade', id: s.id }));
        parts.push(up);
        if (why) parts.push(el('p', { class: 'rts-why' }, why));
      } else parts.push(el('p', { class: 'rts-why' }, 'At its highest level.'));
    }
    this.#info.replaceChildren(...parts);
  }

  #send(cmd: Command): void {
    const r = this.#o.send(cmd);
    if (!r.ok && r.reason) this.say(r.reason);
    this.render();
  }
}

function progress(fraction: number, cls = ''): HTMLElement {
  return Object.assign(el('span', { class: `rts-bar ${cls}`, role: 'progressbar', 'aria-valuenow': String(Math.round(fraction * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' }), {
    style: `--p: ${Math.max(0, Math.min(1, fraction))}`,
  });
}
