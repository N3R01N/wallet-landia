/**
 * The campaign on the page: the mission list (on the start screen), a
 * mission's briefing with a card for each new unit, building and idea, the
 * objectives panel in play (the current objective, its hint, the button it
 * means aglow), and the debrief.
 */

import { el } from '../../util/dom.js';
import { ROLE_NOTES, CONCEPTS, buildingNote, unitNote } from '../data/notes.js';
import type { Card, Mission, Run } from '../campaign/run.js';
import { MISSIONS } from '../campaign/missions.js';
import { isOpen, wonMissions } from '../campaign/progress.js';

/** One card: a unit, a building or an idea. */
export function cardEl(card: Card, compact = false): HTMLElement {
  if ('unit' in card) {
    const n = unitNote(card.unit);
    const role = ROLE_NOTES[n.role];
    return el(
      'article',
      { class: `rts-card rts-card-unit${compact ? ' compact' : ''}`, 'data-unit': card.unit },
      el('h4', {}, `${role.icon} ${n.name}`, el('span', { class: 'rts-card-tag' }, role.name)),
      el('p', {}, n.line),
      n.ability ? el('p', { class: 'rts-card-ability' }, `✦ ${n.ability}`) : null,
      compact ? null : el('p', { class: 'rts-card-role' }, role.note),
      el('p', { class: 'rts-card-meta' }, `$${n.usd} in ${n.token} · ${n.where}`),
      compact ? null : el('p', { class: 'rts-card-meta' }, n.stats),
    );
  }
  if ('building' in card) {
    const n = buildingNote(card.building);
    return el(
      'article',
      { class: `rts-card rts-card-building${compact ? ' compact' : ''}`, 'data-building': card.building },
      el('h4', {}, `🏛 ${n.name}`),
      el('p', {}, n.line),
      n.trains ? el('p', { class: 'rts-card-meta' }, n.trains) : null,
      el('p', { class: 'rts-card-meta' }, [n.cost, n.needs].filter(Boolean).join(' · ')),
    );
  }
  const c = CONCEPTS[card.concept];
  return el('article', { class: `rts-card rts-card-concept${compact ? ' compact' : ''}`, 'data-concept': card.concept }, el('h4', {}, `${c.icon} ${c.title}`), el('p', {}, c.text));
}

/** The missions, the open ones to pick (the start screen). */
export function missionList(pick: (m: Mission) => void): HTMLElement {
  const won = wonMissions();
  return el(
    'ol',
    { class: 'rts-missions' },
    ...MISSIONS.map((m) => {
      const open = isOpen(m.n, won);
      const b = el(
        'button',
        { class: 'rts-mission', type: 'button', 'data-mission': String(m.n) },
        el('span', { class: 'rts-mission-n' }, won.has(m.n) ? '✓' : open ? String(m.n) : '🔒'),
        el('span', {}, el('strong', {}, m.title), el('small', {}, m.tagline)),
      );
      b.toggleAttribute('disabled', !open);
      b.title = open ? '' : `Win mission ${m.n - 1} first`;
      b.addEventListener('click', () => pick(m));
      return el('li', {}, b);
    }),
  );
}

/** A mission's briefing: the story, then what is new. */
export function briefing(m: Mission, start: () => void, back: () => void): HTMLElement {
  const go = el('button', { class: 'btn rts-go', type: 'button' }, '⚔ Start the mission');
  go.addEventListener('click', start);
  const ret = el('button', { class: 'btn', type: 'button' }, '← Missions');
  ret.addEventListener('click', back);
  return el(
    'main',
    { class: 'rts-start rts-briefing' },
    el('p', { class: 'rts-kicker' }, `Campaign · mission ${m.n} of ${MISSIONS.length}`),
    el('h1', {}, m.title),
    ...m.briefing.map((p) => el('p', {}, p)),
    el('h2', {}, 'New in this mission'),
    el('div', { class: 'rts-cards' }, ...m.cards.map((c) => cardEl(c))),
    el('h2', {}, 'Objectives'),
    el('ol', { class: 'rts-brief-steps' }, ...m.steps.map((s) => el('li', {}, s.text))),
    el('div', { class: 'rts-row' }, ret, go),
  );
}

/** The objectives in play, top left. */
export class ObjectivesPanel {
  readonly element = el('section', { class: 'rts-objectives', 'aria-label': 'Objectives' });
  readonly #dialog = el('dialog', { class: 'rts-help rts-brief-dialog', 'aria-label': 'Briefing' });
  readonly #run: Run;
  readonly #restart: () => void;
  #key = '';
  #wait: HTMLElement | null = null;
  #collapsed = false;

  constructor(run: Run, restart: () => void) {
    this.#run = run;
    this.#restart = restart;
    this.#dialog.addEventListener('click', (e) => {
      if (e.target === this.#dialog) this.#dialog.close();
    });
  }

  /** Rebuilt when the objective changes; the countdown and the glow every time. */
  render(): void {
    const r = this.#run;
    const key = `${r.index}|${r.started}|${this.#collapsed}|${r.state}`;
    if (key !== this.#key) {
      this.#key = key;
      this.#build();
    }
    if (this.#wait) this.#wait.textContent = `Starts in ${Math.ceil(r.waiting)} s`;
    glow(r.state === 'playing' ? (r.step?.highlight ?? []) : []);
  }

  /** The briefing's cards again, in a dialog. */
  showBriefing(): void {
    const m = this.#run.mission;
    const close = el('button', { class: 'btn', type: 'button', 'aria-label': 'Close' }, '✕');
    close.addEventListener('click', () => this.#dialog.close());
    this.#dialog.replaceChildren(
      el('div', { class: 'rts-help-head' }, el('h2', {}, `${m.n}. ${m.title}`), close),
      el('div', { class: 'rts-help-body' }, ...m.briefing.map((p) => el('p', {}, p)), el('div', { class: 'rts-cards' }, ...m.cards.map((c) => cardEl(c)))),
    );
    if (!this.#dialog.isConnected) document.body.append(this.#dialog);
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  #build(): void {
    const r = this.#run;
    const m = r.mission;
    const steps = m.steps;
    const toggle = el('button', { class: 'rts-obj-toggle', type: 'button', 'aria-expanded': String(!this.#collapsed), title: this.#collapsed ? 'Show' : 'Hide' }, this.#collapsed ? '▸' : '▾');
    toggle.addEventListener('click', () => {
      this.#collapsed = !this.#collapsed;
      this.render();
    });
    const head = el('div', { class: 'rts-obj-head' }, toggle, el('h2', {}, `${m.n}. ${m.title}`), el('span', { class: 'rts-obj-count' }, `${Math.min(r.index, steps.length)}/${steps.length}`));
    this.#wait = null;
    if (this.#collapsed) {
      this.element.replaceChildren(head);
      return;
    }
    const list = el('ol', { class: 'rts-obj-list' });
    steps.forEach((s, i) => {
      if (i > r.index) return;
      const li = el('li', { class: i < r.index ? 'done' : 'current' }, el('span', { class: 'rts-obj-mark' }, i < r.index ? '✓' : '▶'), el('span', {}, s.text));
      list.append(li);
    });
    const more = steps.length - r.index - 1;
    if (more > 0) list.append(el('li', { class: 'later' }, el('span', { class: 'rts-obj-mark' }, '…'), el('span', {}, `${more} more to come`)));
    const step = r.step;
    const parts: HTMLElement[] = [head, list];
    if (step && r.state === 'playing') {
      if (!r.started && r.waiting > 0) {
        this.#wait = el('p', { class: 'rts-obj-wait' });
        parts.push(this.#wait);
      }
      parts.push(el('p', { class: 'rts-obj-hint' }, `💡 ${step.hint}`));
      if (step.card) parts.push(cardEl(step.card, true));
    }
    const brief = el('button', { class: 'btn rts-tap rts-obj-brief', type: 'button' }, '📖 Briefing');
    brief.addEventListener('click', () => this.showBriefing());
    const again = el('button', { class: 'btn rts-tap rts-obj-restart', type: 'button' }, '↻ Restart');
    again.addEventListener('click', () => this.#restart());
    parts.push(el('div', { class: 'rts-row' }, brief, again));
    this.element.replaceChildren(...parts);
  }
}

/** The first of these that shows glows; whatever glowed before stops. */
function glow(selectors: readonly string[]): void {
  let target: Element | null = null;
  for (const s of selectors) {
    target = document.querySelector(`.rts-hud ${s}`);
    if (target) break;
  }
  for (const e of document.querySelectorAll('.rts-glow')) if (e !== target) e.classList.remove('rts-glow');
  target?.classList.add('rts-glow');
}

/** The end of a mission: what was learned, and what next. */
export function debrief(m: Mission, won: boolean, minutes: number, act: { next: (() => void) | null; retry: () => void }): HTMLElement {
  const buttons: HTMLElement[] = [];
  if (won && act.next) {
    const next = el('button', { class: 'btn rts-next', type: 'button' }, 'Next mission →');
    next.addEventListener('click', act.next);
    buttons.push(next);
  }
  const retry = el('button', { class: 'btn rts-retry', type: 'button' }, won ? 'Play it again' : 'Try again');
  retry.addEventListener('click', act.retry);
  buttons.push(retry, el('a', { class: 'btn', href: 'rts.html' }, 'Missions'));
  return el(
    'div',
    { class: `rts-over ${won ? 'won' : 'lost'}`, role: 'dialog', 'aria-label': won ? 'Mission complete' : 'Mission failed' },
    el('h2', {}, won ? '🏆 Mission complete' : '💀 Mission failed'),
    el('p', {}, won ? m.debrief : `Your wallet hall has fallen, after ${minutes} min. Try again: the hints in the corner show the way.`),
    won && !act.next ? el('p', {}, el('strong', {}, 'The campaign is won!')) : null,
    el('div', { class: 'rts-row' }, ...buttons),
  );
}
