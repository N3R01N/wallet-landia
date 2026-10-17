/**
 * Named loadouts kept on this device (spec: "The edited portfolio can be
 * saved locally as a named loadout"). Storage may be missing or full: every
 * read and write is guarded, and the game works without it.
 */

import type { Draft } from './editor.js';

const KEY = 'wallet-landia-v4/siege/loadouts';

export interface Loadout {
  name: string;
  savedAt: number;
  draft: Draft;
}

/** JSON with bigints as "123n" (and back). */
export function encodeDraft(d: Draft): string {
  return JSON.stringify(d, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));
}

export function decodeDraft(json: string): Draft {
  return JSON.parse(json, (_k, v: unknown) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as Draft;
}

function readAll(storage: Storage | null): Loadout[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as { name: string; savedAt: number; draft: string }[];
    return rows.filter((r) => typeof r.name === 'string' && typeof r.draft === 'string').map((r) => ({ name: r.name, savedAt: r.savedAt, draft: decodeDraft(r.draft) }));
  } catch {
    return [];
  }
}

function writeAll(storage: Storage | null, rows: Loadout[]): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify(rows.map((r) => ({ name: r.name, savedAt: r.savedAt, draft: encodeDraft(r.draft) }))));
    return storage !== null;
  } catch {
    return false;
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function listLoadouts(storage: Storage | null = defaultStorage()): Loadout[] {
  return readAll(storage).sort((a, b) => b.savedAt - a.savedAt);
}

/** Saves (or replaces) a loadout by name; false if it couldn't be kept. */
export function saveLoadout(name: string, draft: Draft, now: number, storage: Storage | null = defaultStorage()): boolean {
  const clean = name.trim().slice(0, 40);
  if (!clean) return false;
  const rows = readAll(storage).filter((r) => r.name !== clean);
  rows.push({ name: clean, savedAt: now, draft: { ...structuredClone(draft), notice: null } });
  return writeAll(storage, rows);
}

export function deleteLoadout(name: string, storage: Storage | null = defaultStorage()): void {
  writeAll(storage, readAll(storage).filter((r) => r.name !== name));
}
