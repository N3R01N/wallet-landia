/**
 * The first-visit tour: a few cards that explain what is on screen (a demo
 * town of demo wallets, the heroes and buildings, the Chronicle Tower, the
 * quest log, the value scale, the timeline) and walk the visitor into the
 * Guild panel to add a Zerion key and a wallet. Each card points at what it
 * talks about; Skip ends it at any time, and the ? button replays it.
 */

import { el } from './dom.js';

export interface TourStep {
  title: string;
  body: (string | HTMLElement)[];
  /** What to point at (null: a card in the middle). */
  target?: () => HTMLElement | null;
  /** Set the scene before showing (e.g. open the Guild panel). */
  before?: () => void;
}

export class Tour {
  readonly #steps: TourStep[];
  readonly #onEnd: () => void;
  readonly #shade = el('div', { class: 'tour-shade' });
  readonly #spot = el('div', { class: 'tour-spot' });
  readonly #card = el('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-live': 'polite' });
  #at = 0;
  #onResize = (): void => this.#place();
  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.end();
    else if (e.key === 'ArrowRight') this.#go(this.#at + 1);
    else if (e.key === 'ArrowLeft') this.#go(this.#at - 1);
  };

  constructor(steps: TourStep[], onEnd: () => void) {
    this.#steps = steps;
    this.#onEnd = onEnd;
  }

  start(): void {
    document.body.append(this.#shade, this.#spot, this.#card);
    window.addEventListener('resize', this.#onResize);
    window.addEventListener('keydown', this.#onKey);
    this.#go(0);
  }

  end(): void {
    this.#shade.remove();
    this.#spot.remove();
    this.#card.remove();
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('keydown', this.#onKey);
    this.#onEnd();
  }

  #go(i: number): void {
    if (i < 0) return;
    if (i >= this.#steps.length) {
      this.end();
      return;
    }
    this.#at = i;
    const step = this.#steps[i]!;
    step.before?.();
    const last = i === this.#steps.length - 1;
    const back = el('button', { class: 'btn small' }, 'Back');
    back.onclick = () => this.#go(this.#at - 1);
    back.disabled = i === 0;
    const next = el('button', { class: 'btn small primary' }, last ? 'Got it' : 'Next');
    next.onclick = () => this.#go(this.#at + 1);
    const skip = el('button', { class: 'tour-skip' }, last ? '' : 'Skip tour');
    skip.onclick = () => this.end();
    this.#card.replaceChildren(
      el('div', { class: 'tour-count' }, `${i + 1} / ${this.#steps.length}`),
      el('h3', {}, step.title),
      ...step.body.map((b) => (typeof b === 'string' ? el('p', {}, b) : b)),
      el('div', { class: 'tour-actions' }, last ? null : skip, el('span', { class: 'spacer' }), back, next),
    );
    // the panel a step opens may take a frame to appear
    requestAnimationFrame(() => this.#place());
    next.focus();
  }

  /** Light up the target and put the card beside it (below, else above, else in the middle). */
  #place(): void {
    const target = this.#steps[this.#at]?.target?.() ?? null;
    const card = this.#card;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // a target inside a scrolled panel (the Guild's wallet field): bring it into view first
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.top < 0 || r.bottom > vh) target.scrollIntoView({ block: 'center' });
    }
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      this.#spot.hidden = true;
      this.#shade.hidden = false;
      card.style.left = `${Math.max(12, (vw - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
      return;
    }
    this.#shade.hidden = true;
    this.#spot.hidden = false;
    const pad = 6;
    Object.assign(this.#spot.style, { left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let top = rect.bottom + 14;
    if (top + h > vh - 12) top = rect.top - h - 14;
    if (top < 12) top = Math.max(12, Math.min(vh - h - 12, rect.top + rect.height / 2 - h / 2));
    let left = rect.left + rect.width / 2 - w / 2;
    // a tall target (a panel): beside it rather than over it
    if (rect.height > vh * 0.5) {
      left = rect.left - w - 16 > 12 ? rect.left - w - 16 : rect.right + 16;
      top = Math.max(12, Math.min(vh - h - 12, rect.top + 40));
    }
    card.style.left = `${Math.max(12, Math.min(vw - w - 12, left))}px`;
    card.style.top = `${Math.max(12, Math.min(vh - h - 12, top))}px`;
  }
}
