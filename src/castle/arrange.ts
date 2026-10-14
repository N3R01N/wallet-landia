/**
 * Build mode on the scene: "🔨 Arrange" lets the player move the town's
 * buildings. Tap a building, then another (they swap) or an empty plot (it
 * moves there). Reset goes back to the automatic layout; Done ends it. The
 * arrangement is kept in the player's preferences.
 */

import { el } from '../util/dom.js';
import { moveToSlot } from './scene/plan.js';
import type { CastleView } from './scene/castleView.js';

export interface ArrangeHost {
  /** The arrangement kept (protocol id → plot). */
  get(): Record<string, number>;
  set(arranged: Record<string, number>): void;
}

/** What a tap means in build mode, given the building chosen so far. */
export type ArrangeTap = { protocolId: string } | { slot: number };

/** Adds the Arrange button and its bar to a scene view; returns the handler for the view's taps in build mode. */
export function attachArrange(view: CastleView, host: ArrangeHost): (tap: ArrangeTap) => void {
  let selected: string | null = null;
  const open = el('button', { class: 'btn scene-action arrange-open', type: 'button' }, '🔨 Arrange');
  const hint = el('span', { class: 'arrange-hint' }, '');
  const reset = el('button', { class: 'btn', type: 'button' }, 'Reset');
  const done = el('button', { class: 'btn arrange-done', type: 'button' }, 'Done');
  const bar = el('div', { class: 'arrange-bar', role: 'group', 'aria-label': 'Arrange the town', hidden: '' }, hint, reset, done);

  const show = () => {
    hint.textContent = selected ? 'Now tap where it should go: another building (they swap) or an empty plot.' : 'Tap a building to move it.';
    view.setArranging(true, selected);
  };
  open.addEventListener('click', () => {
    selected = null;
    bar.hidden = false;
    open.hidden = true;
    show();
  });
  done.addEventListener('click', () => {
    selected = null;
    bar.hidden = true;
    open.hidden = false;
    view.setArranging(false, null);
  });
  reset.addEventListener('click', () => {
    selected = null;
    host.set({});
    view.rearrange({});
    show();
  });
  view.element.append(open, bar);

  return (tap) => {
    if ('protocolId' in tap && selected === null) {
      selected = tap.protocolId;
      return show();
    }
    if ('protocolId' in tap && tap.protocolId === selected) {
      selected = null;
      return show();
    }
    if (selected === null) return;
    const current = new Map(view.plan.buildings.map((b) => [b.protocol.id, b.slot] as const));
    const slot = 'slot' in tap ? tap.slot : current.get(tap.protocolId);
    if (slot === undefined) return;
    const arranged = moveToSlot(current, selected, slot);
    selected = null;
    host.set(arranged);
    view.rearrange(arranged);
    show();
  };
}
