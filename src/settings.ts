/**
 * Per-player preferences in localStorage. Every access is guarded: storage can
 * throw (blocked site data, private windows), and then preferences simply live
 * for the session.
 */

import type { HeroClass } from './domain/model.js';
import type { HistoryWindow } from './domain/mappers.js';
import type { ViewKind } from './render/view.js';
import { DEFAULT_CHAINS } from './data/zerion/endpoints.js';

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
  /** 3D image quality: low (no post), medium (bloom + grade), high (+ ambient occlusion). */
  quality: 'low' | 'medium' | 'high';
  /** Which asset pack draws each slot (slot key → pack id). */
  loadout: Record<string, string>;
  /** The theme bundle drawing the 3D town ('' = the built-in look). */
  theme: string;
  /** Medals once seen, address → medal id → when earned (null: for holdings). Kept as the history window moves on. */
  medals: Record<string, Record<string, number | null>>;
  /** The title each hero wears, if the player picked one. */
  titles: Record<string, string>;
  /** Crest colours the player picked (field, charge), by address. */
  crests: Record<string, [string, string]>;
  /** Fog of war over unvisited buildings (opt in). */
  fog: boolean;
  /** The quest log folded down to its title. */
  questlogFolded: boolean;
  /** The value scale folded down to its title. */
  legendFolded: boolean;
  /** The first-visit tour was finished or skipped. */
  tourDone: boolean;
  /** Names the player gave heroes, by lowercase address. */
  names: Record<string, string>;
  /** ETH prices seen: this session's (`seen`), and the visit before it (`prev`), for "since you were last here". */
  eth: { seen?: { usd: number; at: number }; prev?: { usd: number; at: number } };
  /** Sound (off until the player turns it on) and its volume 0..1. */
  sound: boolean;
  volume: number;
  /** The player's own Ethereum node ('' = the free public one). */
  rpcUrl: string;
  /** The chains of the realm: Ethereum and the provinces loaded with it (Phase 6). */
  chains: string[];
  /** The realm whose town is shown (a chain id). */
  realm: string;
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
  quality: 'medium',
  loadout: {},
  theme: '',
  medals: {},
  titles: {},
  crests: {},
  fog: false,
  questlogFolded: false,
  legendFolded: false,
  tourDone: false,
  names: {},
  eth: {},
  sound: false,
  volume: 0.6,
  rpcUrl: '',
  chains: [...DEFAULT_CHAINS],
  realm: 'ethereum',
};

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw) as unknown;
    const prefs = structuredClone(DEFAULTS);
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return prefs;
    // a hand-edited or old-shape field (window: null, chains: "base") falls back to its default
    // rather than flowing into the code; only fields of the default's kind are taken
    const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    for (const [k, v] of Object.entries(saved)) {
      if (!(k in DEFAULTS) || kind(v) !== kind(DEFAULTS[k as keyof Prefs])) continue;
      if (kind(v) === 'number' && !Number.isFinite(v)) continue;
      if (Array.isArray(v) && !v.every((x) => typeof x === 'string')) continue; // every list is of strings
      (prefs as unknown as Record<string, unknown>)[k] = v;
    }
    return prefs;
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

/**
 * Why a pasted key can't be a Zerion key, or null if it can. Keys are printable
 * ASCII; anything else (a stray curly quote or space from a copy) would make
 * the Basic auth header throw (`btoa` takes Latin-1 only) on every request.
 */
export function apiKeyProblem(key: string): string | null {
  return /^[\x21-\x7e]+$/.test(key) ? null : 'That key has characters a Zerion key never has (spaces, quotes or symbols from copying?). Paste it again.';
}

/** Save (or with null, forget) the key. Returns why it was refused, or null once saved. */
export function saveApiKey(key: string | null): string | null {
  const problem = key === null ? null : apiKeyProblem(key);
  if (problem !== null) return problem;
  try {
    if (key === null) window.localStorage.removeItem(KEY_KEY);
    else window.localStorage.setItem(KEY_KEY, key);
  } catch {
    // storage unavailable: the key lasts for this session only
  }
  return null;
}
