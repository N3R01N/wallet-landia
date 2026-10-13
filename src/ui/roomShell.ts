/**
 * The frame every house interior shares: a full-screen view with a bar (the
 * house's name, how to look around, ‹ › and leave) over the room's own content.
 * Esc leaves; the arrow keys step when the view can step.
 */

import { el } from './dom.js';

export interface ShellOptions {
  /** A hint for how to look around, shown in the bar. */
  hint: string;
  /** Step the view left (-1) or right (1); omit when the view does not scroll. */
  step?: (dir: -1 | 1) => void;
}

/** Opens the view over the page; returns the function that closes it. */
export function openShell(title: string, content: HTMLElement, opts: ShellOptions): () => void {
  const bar = el('div', { class: 'room-bar' }, el('strong', {}, title), el('span', { class: 'muted small' }, opts.hint));
  const button = (label: string, aria: string, on: () => void): HTMLButtonElement => {
    const b = el('button', { class: 'btn room-step', 'aria-label': aria }, label);
    b.onclick = on;
    return b;
  };
  const step = opts.step;
  if (step) bar.append(button('‹', 'Look left', () => step(-1)), button('›', 'Look right', () => step(1)));
  const close = (): void => {
    root.remove();
    window.removeEventListener('keydown', onKey);
  };
  bar.append(button('Leave ×', 'Leave the house', close));
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (step && e.key === 'ArrowLeft') step(-1);
    else if (step && e.key === 'ArrowRight') step(1);
  };
  window.addEventListener('keydown', onKey);
  const root = el('div', { class: 'room-view', role: 'dialog', 'aria-label': `Inside ${title}` }, bar, content);
  document.body.append(root);
  return close;
}
