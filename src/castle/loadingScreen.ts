/**
 * The first load's screen: a small animation for each phase as it happens —
 * coins flying into the treasury chest while the wallets are gathered, the
 * castle rising block by block while its models load, the bell swinging as it
 * rings a welcome — then it fades away. Made of inline SVG and CSS (nothing to
 * download). If loading fails, it says why and lets the player in anyway.
 */

import { el } from '../util/dom.js';
import { DEFAULT_PHASE_TIMING, LOAD_PHASES, PHASE_TEXT, PhaseSchedule, type LoadPhase, type PhaseTiming } from './loadPhases.js';

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG element with attributes. */
function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/** Coins flying, one after another, into an open chest. */
function walletsArt(): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 120 90', class: 'load-art art-wallets', 'aria-hidden': 'true' },
    svg('rect', { x: 28, y: 44, width: 64, height: 12, rx: 3, class: 'chest-lid' }),
    ...[0, 1, 2].map((i) => svg('circle', { cx: 60, cy: 58, r: 6, class: `coin coin-${i}` })),
    svg('rect', { x: 30, y: 56, width: 60, height: 26, rx: 3, class: 'chest' }),
    svg('rect', { x: 30, y: 64, width: 60, height: 4, class: 'chest-band' }),
    svg('rect', { x: 56, y: 62, width: 8, height: 9, rx: 1.5, class: 'chest-lock' }),
  );
}

/** The castle rising: towers, wall, keep and banner, one after another. */
function castleArt(): SVGElement {
  const battlements = (x: number, y: number, n: number) => Array.from({ length: n }, (_, i) => svg('rect', { x: x + i * 6, y, width: 4, height: 4 }));
  return svg(
    'svg',
    { viewBox: '0 0 120 90', class: 'load-art art-castle', 'aria-hidden': 'true' },
    svg('line', { x1: 6, y1: 82, x2: 114, y2: 82, class: 'ground' }),
    svg('g', { class: 'rise rise-0' }, svg('rect', { x: 46, y: 22, width: 28, height: 60, class: 'stone' }), ...battlements(46, 18, 5)),
    svg('g', { class: 'rise rise-1' }, svg('rect', { x: 14, y: 40, width: 18, height: 42, class: 'stone dark' }), ...battlements(14, 36, 3)),
    svg('g', { class: 'rise rise-2' }, svg('rect', { x: 88, y: 40, width: 18, height: 42, class: 'stone dark' }), ...battlements(88, 36, 3)),
    svg('g', { class: 'rise rise-3' }, svg('rect', { x: 32, y: 58, width: 56, height: 24, class: 'stone' }), svg('path', { d: 'M54 82 v-12 a6 6 0 0 1 12 0 v12 z', class: 'gate' })),
    svg('g', { class: 'rise rise-4' }, svg('line', { x1: 60, y1: 18, x2: 60, y2: 4, class: 'pole' }), svg('path', { d: 'M60 4 h14 l-4 4 l4 4 h-14 z', class: 'banner' })),
  );
}

/** The bell swinging, rings spreading from it. */
function welcomeArt(): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 120 90', class: 'load-art art-welcome', 'aria-hidden': 'true' },
    svg('circle', { cx: 60, cy: 44, r: 20, class: 'ring ring-0' }),
    svg('circle', { cx: 60, cy: 44, r: 20, class: 'ring ring-1' }),
    svg('line', { x1: 36, y1: 14, x2: 84, y2: 14, class: 'yoke' }),
    svg('g', { class: 'bell' }, svg('path', { d: 'M60 16 c-12 0 -16 10 -16 22 c0 8 -4 12 -8 16 h48 c-4 -4 -8 -8 -8 -16 c0 -12 -4 -22 -16 -22 z', class: 'bell-body' }), svg('circle', { cx: 60, cy: 58, r: 4, class: 'clapper' })),
  );
}

const ART: Record<LoadPhase, () => SVGElement> = { wallets: walletsArt, castle: castleArt, welcome: welcomeArt };

export class LoadingScreen {
  readonly element: HTMLElement;
  readonly #schedule: PhaseSchedule;
  readonly #art = new Map<LoadPhase, SVGElement>();
  readonly #text = el('p', { class: 'load-text' });
  readonly #status = el('p', { class: 'load-status' });
  readonly #dots = el('div', { class: 'load-dots', 'aria-hidden': 'true' });
  #timer: ReturnType<typeof setTimeout> | null = null;
  #shown: LoadPhase | 'done' | null = null;
  #gone = false;
  /** Off the page; and what waits for that. */
  #left = false;
  readonly #afterGone: (() => void)[] = [];
  /** Every phase shown, in order (for tests). */
  readonly seen: LoadPhase[] = [];

  constructor(timing: PhaseTiming = DEFAULT_PHASE_TIMING) {
    this.#schedule = new PhaseSchedule(timing);
    const stage = el('div', { class: 'load-stage' });
    for (const p of LOAD_PHASES) {
      const art = ART[p]();
      art.dataset.phase = p;
      this.#art.set(p, art);
      stage.append(art);
      this.#dots.append(el('span', { 'data-phase': p }));
    }
    this.element = el(
      'div',
      { class: 'loading-screen', role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' },
      el('div', { class: 'load-card' }, el('div', { class: 'load-title' }, 'Zenigard'), stage, this.#text, this.#status, this.#dots),
    );
  }

  /** A phase began. */
  report(phase: LoadPhase): void {
    if (this.#gone) return;
    this.#schedule.report(phase, performance.now());
    this.#update();
  }

  /** Calls `fn` once the screen has faded away (at once if it has). */
  afterGone(fn: () => void): void {
    if (this.#left) fn();
    else this.#afterGone.push(fn);
  }

  /** A line under the phase (e.g. "Loading wallet 2 of 5…"); '' clears it. */
  status(text: string): void {
    this.#status.textContent = text;
  }

  /** Loading failed: say why, and let the player in. */
  fail(reason: string): void {
    if (this.#gone) return;
    this.element.dataset.failed = 'true';
    this.#status.textContent = reason;
    const go = el('button', { class: 'btn load-continue', type: 'button' }, 'Continue');
    go.addEventListener('click', () => this.#leave());
    this.#status.after(go);
  }

  #update(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const now = performance.now();
    const at = this.#schedule.at(now);
    if (at === 'done') return this.#leave();
    if (at !== null && at !== this.#shown) {
      this.#shown = at;
      this.seen.push(at);
      this.element.dataset.phase = at;
      this.#text.textContent = PHASE_TEXT[at];
      const index = LOAD_PHASES.indexOf(at);
      this.#dots.querySelectorAll('span').forEach((d, i) => d.classList.toggle('on', i <= index));
      if (at !== 'wallets') this.#status.textContent = '';
    }
    const next = this.#schedule.nextChange(now);
    if (next !== null) this.#timer = setTimeout(() => this.#update(), next + 5);
  }

  /** Fades away, then leaves the page. */
  #leave(): void {
    if (this.#gone) return;
    this.#gone = true;
    this.element.setAttribute('aria-busy', 'false');
    this.element.dataset.phase = 'done';
    this.element.classList.add('leaving');
    setTimeout(() => {
      this.element.remove();
      this.#left = true;
      for (const fn of this.#afterGone.splice(0)) fn();
    }, 400);
  }
}
