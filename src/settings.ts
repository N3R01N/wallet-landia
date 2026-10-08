/**
 * Per-player preferences in localStorage. Every access is guarded: storage can
 * throw (blocked site data, private windows), and then preferences simply live
 * for the session.
 */

import type { HeroClass } from './domain/model.js';
import type { HistoryWindow } from './domain/mappers.js';
import type { ViewKind } from './render/view.js';

export interface Prefs {
  view: ViewKind;
  window: HistoryWindow;
  speed: number;
  classOverrides: Record<string, HeroClass>;
}

const KEY = 'wallet-landia-v4/prefs/v1';

const DEFAULTS: Prefs = {
  view: 'top',
  window: { kind: 'count', count: 100 },
  speed: 1,
  classOverrides: {},
};

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: keep going in memory
  }
}
