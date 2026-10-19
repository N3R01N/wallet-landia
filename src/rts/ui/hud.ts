/**
 * Ledger Wars' HUD: the treasury along the top (each token, its dollars, the
 * total; the clock and the market), the hall's build menu at the bottom left
 * (C&C style: pick, wait, place), and the selection panel at the bottom
 * right: a building's level, upgrade, money actions and training, or the
 * selected units and their orders. It reads the World and sends commands
 * through `send`.
 */

import { el } from '../../util/dom.js';
import { BUILDINGS, BUILDING_KINDS, RULES, TOKEN_IDS, TOKENS, TRAIN, type BuildingKind, type PlayerId } from '../data/rules.js';
import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { OrderKind, Unit } from '../core/units.js';
import { NOT_YET, type Building, type Command, type Result, type World } from '../core/world.js';
import { incomePerMinute, positionValue } from '../core/economy.js';
import { ROLE_NOTES, unitNote } from '../data/notes.js';
import type { UnitTypeId } from '../../game/core/types.js';
import { actions, actionsKey, type ActionContext, type Live } from './actions.js';

export interface HudOptions {
  world: World;
  me: PlayerId;
  send: (cmd: Command) => Result;
  /** Start placing what the hall finished (the view shows the ghost). */
  onPlace: (kind: BuildingKind) => void;
  /** What is selected: units (yours), or one building. */
  selection: () => { units: Unit[]; building: Building | null };
  /** An order for the selected units from the panel (attack-move arms the next click). */
  order: (kind: OrderKind | 'armAttack') => void;
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
  #liveText: Live[] = [];
  /** The panel's token choices (they outlive its rebuilds). */
  readonly #choice: ActionContext['choice'] = { from: 'usdc', to: 'eth', pool: 'eth', pair: 'usdc', supply: 'eth', borrow: 'usdc' };

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
    const tokensHeld = TOKEN_IDS.filter((t) => me.tokens[t] * w.market.prices[t] >= 0.5);
    const spot = TOKEN_IDS.reduce((s, t) => s + w.usd(this.#o.me, t), 0);
    const held = me.positions.reduce((s, x) => s + positionValue(w.econ, x), 0);
    const income = incomePerMinute(w.econ, this.#o.me);
    this.#top.replaceChildren(
      el('span', { class: 'rts-clock' }, `⏱ ${clock(w.time)}`),
      el('span', { class: 'rts-market' }, `${REGIME[w.market.regime] ?? ''} · day ${w.market.day + 1}`),
      el('span', { class: 'rts-total', title: 'Your tokens and your positions' }, el('strong', {}, usd(spot + held))),
      el('span', { class: 'rts-income', title: 'What your positions earn a minute' }, `📈 ${income >= 0 ? '+' : '−'}${usd(Math.abs(income))}/min`),
      held !== 0 ? el('span', { class: 'rts-held' }, `in positions ${usd(held)}`) : '',
      ...tokensHeld.map((t) => el('span', { class: 'rts-token', title: `${me.tokens[t].toPrecision(4)} ${TOKENS[t].symbol} at ${usd(w.market.prices[t])}` }, el('b', {}, TOKENS[t].symbol), ` ${usd(w.usd(this.#o.me, t))}`)),
    );

    // the hall's construction (rebuilt when what it offers changes; the timers tick in place)
    // a campaign mission shows only what it has opened
    const kinds = BUILDING_KINDS.filter((k) => k !== 'hall' && !w.locked(this.#o.me, k));
    const whys = kinds.map((k) => w.cantBuild(this.#o.me, k));
    const sel = this.#o.selection();
    const s = sel.units.length > 0 ? null : sel.building;
    const upWhy = s && s.owner === this.#o.me ? w.cantUpgrade(this.#o.me, s) : null;
    const buildKey = JSON.stringify([me.build?.kind, me.ready, kinds, whys]);
    const mine = s?.owner === this.#o.me;
    const infoKey = JSON.stringify(
      sel.units.length > 0
        ? ['units', countByType(sel.units)]
        : s
          ? [s.id, s.level, s.upgrading?.to, upWhy, s.owner, mine ? actionsKey(w, this.#o.me, s) : '', s.queue.map((q) => q.unit), mine ? TRAIN.filter((t) => t.at === s.kind).map((t) => w.cantTrain(this.#o.me, s, t.unit)) : []]
          : null,
    );
    if (buildKey !== this.#keys.build || infoKey !== this.#keys.info) {
      this.#live = [];
      this.#liveText = [];
      if (buildKey !== this.#keys.build) this.#renderBuild(kinds, whys);
      if (sel.units.length > 0) this.#renderUnits(sel.units);
      else this.#renderInfo(s, upWhy);
      this.#keys = { build: buildKey, info: infoKey };
    }
    for (const l of this.#live) {
      const v = l.read();
      if (!v) continue;
      l.text.textContent = v[0];
      l.bar.style.setProperty('--p', String(Math.max(0, Math.min(1, v[1]))));
    }
    for (const l of this.#liveText) l.text.textContent = l.read();
  }

  #renderBuild(kinds: BuildingKind[], whys: (string | null)[]): void {
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
    if (kinds.length === 0) rows.push(el('p', { class: 'rts-hint' }, 'Nothing to build yet: buildings come in the next missions.'));
    const grid = el('div', { class: 'rts-build-grid' });
    kinds.forEach((kind, i) => {
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
      this.#info.replaceChildren(
        el('p', { class: 'rts-hint' }, 'Click a building or a unit to select it; drag a box round units. Right-click to move or attack. A: attack-move, S: stop, H: hold.'),
        el('p', { class: 'rts-hint' }, 'The arrow keys, the arrow strips at the edges (point at one) or the middle button move the view; the wheel zooms; Q/E turn.'),
      );
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
      } else if (why === NOT_YET) parts.push(el('p', { class: 'rts-why' }, 'Higher levels open in later missions.'));
      else if (s.level < r.maxLevel) {
        const up = el('button', { class: 'btn rts-upgrade', type: 'button', title: why ?? '' }, `⬆ Level ${s.level + 1} · ${usd(r.upgrade[s.level - 1]!)} · ${r.upgradeTime} s`);
        up.toggleAttribute('disabled', why !== null);
        up.addEventListener('click', () => this.#send({ t: 'upgrade', id: s.id }));
        parts.push(up);
        if (why) parts.push(el('p', { class: 'rts-why' }, why));
      } else parts.push(el('p', { class: 'rts-why' }, 'At its highest level.'));
      const ctx: ActionContext = {
        world: this.#o.world,
        me: this.#o.me,
        send: (cmd) => this.#send(cmd),
        choice: this.#choice,
        refresh: () => {
          this.#keys.info = '';
          this.render();
        },
        live: this.#liveText,
      };
      parts.push(...actions(ctx, s), ...this.#training(s));
    }
    this.#info.replaceChildren(...parts);
  }

  /** What a building of yours trains: a button each (cost, time, or why not), the queue, and the rally point. */
  #training(b: Building): HTMLElement[] {
    const w = this.#o.world;
    const rules = TRAIN.filter((t) => t.at === b.kind && !w.unitLocked(this.#o.me, t.unit));
    if (rules.length === 0) return [];
    const out: HTMLElement[] = [el('h3', {}, 'Train')];
    const grid = el('div', { class: 'rts-build-grid' });
    for (const t of rules) {
      const u = UNIT_TYPES[t.unit]!;
      const why = w.cantTrain(this.#o.me, b, t.unit);
      const cost = RULES.unitValue * u.costMult;
      const btn = el('button', { class: 'rts-build-item rts-train', type: 'button', 'data-unit': t.unit, title: unitTitle(t.unit, why) }, el('strong', {}, u.name), el('span', {}, `${usd(cost)} in ${TOKENS[t.token].symbol} · ${t.time} s`));
      btn.toggleAttribute('disabled', why !== null);
      btn.addEventListener('click', () => this.#send({ t: 'train', id: b.id, unit: t.unit }));
      grid.append(btn);
    }
    out.push(grid);
    if (b.queue.length > 0) {
      const first = b.queue[0]!;
      const text = el('span', {});
      const bar = progress(0);
      this.#live.push({ text, bar, read: () => (b.queue[0] === first ? [`${UNIT_TYPES[first.unit]!.name} ${Math.ceil(first.left)} s`, 1 - first.left / first.total] : null) });
      const cancel = el('button', { class: 'btn rts-tap', type: 'button' }, 'Cancel last');
      cancel.addEventListener('click', () => this.#send({ t: 'cancelTrain', id: b.id }));
      out.push(el('div', { class: 'rts-progress-row rts-queue' }, text, bar, cancel), el('p', { class: 'rts-why' }, `Queue: ${b.queue.map((q) => UNIT_TYPES[q.unit]!.name).join(', ')}`));
    }
    out.push(el('p', { class: 'rts-why' }, b.rally ? 'New units walk to the rally flag. Right-click the ground to move it.' : 'Right-click the ground to set where new units go.'));
    return out;
  }

  /** The selected units: how many of each, and their orders. */
  #renderUnits(units: Unit[]): void {
    const counts = countByType(units);
    const btn = (label: string, kind: OrderKind | 'armAttack', cls: string) => {
      const b = el('button', { class: `btn rts-tap ${cls}`, type: 'button' }, label);
      b.addEventListener('click', () => this.#o.order(kind));
      return b;
    };
    this.#info.replaceChildren(
      el('h2', {}, `${units.length} unit${units.length === 1 ? '' : 's'}`),
      el('div', { class: 'rts-unit-list' }, ...counts.map(([type, n]) => el('span', { class: 'rts-unit-count' }, `${n} × ${UNIT_TYPES[type]!.name}`))),
      el('div', { class: 'rts-row' }, btn('⚔ Attack-move (A)', 'armAttack', 'rts-attack-move'), btn('■ Stop (S)', 'stop', 'rts-stop'), btn('⛨ Hold (H)', 'hold', 'rts-hold')),
      el('p', { class: 'rts-why' }, 'Right-click the ground to move, an enemy to attack it. Attack-move fights whatever it meets on the way; hold stands and fights only what comes in reach.'),
    );
  }

  #send(cmd: Command): void {
    const r = this.#o.send(cmd);
    if (!r.ok && r.reason) this.say(r.reason);
    this.render();
  }
}

/** A unit's tooltip: what it is for, and why it can't be trained now. */
function unitTitle(unit: UnitTypeId, why: string | null): string {
  const n = unitNote(unit);
  return [`${n.name} · ${ROLE_NOTES[n.role].name}`, n.line, n.ability, ROLE_NOTES[n.role].note, n.stats, why ? `✗ ${why}` : null].filter(Boolean).join('\n');
}

function progress(fraction: number, cls = ''): HTMLElement {
  return Object.assign(el('span', { class: `rts-bar ${cls}`, role: 'progressbar', 'aria-valuenow': String(Math.round(fraction * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' }), {
    style: `--p: ${Math.max(0, Math.min(1, fraction))}`,
  });
}

function countByType(units: readonly Unit[]): [string, number][] {
  const m = new Map<string, number>();
  for (const u of units) m.set(u.type, (m.get(u.type) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
