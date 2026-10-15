/**
 * Build mode: moving a building. It starts from the building's sheet ("🔨
 * Move this building"); the scene then marks every place it can go (gold rings
 * on the free plots, "Move here"; blue rings under the other buildings,
 * "Swap") and a bar says what is moving, with Cancel and Reset. A tap on a
 * marked place moves it; the arrangement is kept in the player's preferences.
 */

import { el } from '../util/dom.js';
import { moveToSlot } from './scene/plan.js';
import type { CastleView } from './scene/castleView.js';

export interface ArrangeHost {
  /** The arrangement kept (protocol id → plot). */
  get(): Record<string, number>;
  set(arranged: Record<string, number>): void;
}

/** What a tap means in build mode. */
export type ArrangeTap = { protocolId: string } | { slot: number };

export interface Arrange {
  /** Start moving this building. */
  start(protocolId: string, name: string): void;
  /** A tap in the scene while moving. */
  tap(t: ArrangeTap): void;
}

/** Adds build mode's bar to a scene view. */
export function attachArrange(view: CastleView, host: ArrangeHost): Arrange {
  let moving: { id: string; name: string } | null = null;
  const hint = el('span', { class: 'arrange-hint' }, '');
  const reset = el('button', { class: 'btn', type: 'button', title: 'Every building back where the town puts it' }, 'Reset layout');
  const done = el('button', { class: 'btn arrange-done', type: 'button' }, 'Cancel');
  const bar = el('div', { class: 'arrange-bar', role: 'group', 'aria-label': 'Move a building', hidden: '' }, hint, reset, done);

  const end = () => {
    moving = null;
    bar.hidden = true;
    view.setArranging(false, null);
  };
  const show = () => {
    if (!moving) return end();
    hint.textContent = `Moving ${moving.name}: tap a gold plot to move it there, or a blue one to swap it with that building.`;
    bar.hidden = false;
    view.setArranging(true, moving.id);
  };
  done.addEventListener('click', end);
  reset.addEventListener('click', () => {
    host.set({});
    view.rearrange({});
    end();
  });
  view.element.append(bar);

  return {
    start(id, name) {
      moving = { id, name };
      show();
    },
    tap(t) {
      if (!moving) return;
      // the building being moved: cancel
      if ('protocolId' in t && t.protocolId === moving.id) return end();
      const current = new Map(view.plan.buildings.map((b) => [b.protocol.id, b.slot] as const));
      const slot = 'slot' in t ? t.slot : current.get(t.protocolId);
      if (slot === undefined) return;
      const arranged = moveToSlot(current, moving.id, slot);
      host.set(arranged);
      view.rearrange(arranged);
      end();
    },
  };
}
