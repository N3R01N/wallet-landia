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
  /** Your wallets: the heroes of your town. Lowercase addresses. */
  owned: string[];
  /** Other wallets you follow: towns you can visit. */
  followed: string[];
  /** Primary ENS names we have looked up, address → name ('' = none). */
  ens: Record<string, string>;
}

const KEY = 'wallet-landia-v4/prefs/v1';

const DEFAULTS: Prefs = {
  view: '3d',
  window: { kind: 'count', count: 100 },
  speed: 1,
  classOverrides: {},
  owned: [],
  followed: [],
  ens: {},
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

const KEY_KEY = 'wallet-landia-v4/zerion-key';

/**
 * The player's own Zerion key. It lives in this browser only and is sent
 * nowhere but api.zerion.io; it is visible in devtools, which is the trade for
 * a site with no server.
 */
export function loadApiKey(): string | null {
  try {
    const k = window.localStorage.getItem(KEY_KEY);
    return k === null || k === '' ? null : k;
  } catch {
    return null;
  }
}

export function saveApiKey(key: string | null): void {
  try {
    if (key === null) window.localStorage.removeItem(KEY_KEY);
    else window.localStorage.setItem(KEY_KEY, key);
  } catch {
    // storage unavailable: the key lasts for this session only
  }
}
