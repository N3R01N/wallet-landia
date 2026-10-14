/**
 * A castle theme's manifest (public/themes/<id>/theme.json): its name and
 * version. The version goes on every file's URL (`?v=`), so a player's device
 * keeps the files until the version changes (public/sw.js, public/_headers).
 * The manifest itself is fetched fresh each visit.
 */

import { THEME_DIR } from './manifest.js';

export const THEME_FORMAT = 'wallet-landia-theme/1';

export interface CastleTheme {
  id: string;
  name: string;
  version: string;
  /** The theme's folder URL, ending in a slash. */
  root: string;
}

/** Reads a manifest; returns null (with the reason) for anything that is not a usable one. */
export function parseTheme(raw: unknown, root: string): { theme: CastleTheme } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.format !== THEME_FORMAT) return { error: `format is not ${THEME_FORMAT}` };
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(r.id)) return { error: 'id must be 2–40 of a-z 0-9 -' };
  if (typeof r.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version)) return { error: 'version must look like 1.2.3' };
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : r.id;
  return { theme: { id: r.id, name, version: r.version, root } };
}

/** The URL of a file in the theme, with its version. */
export function themeFileUrl(theme: CastleTheme, path: string): string {
  return `${theme.root}${path}?v=${encodeURIComponent(theme.version)}`;
}

/**
 * Loads the bundled theme's manifest. When it cannot be read, the theme is still
 * usable with version "0" (files are then fetched without a lasting version, so
 * nothing stale is kept for long).
 */
export async function loadCastleTheme(base: string): Promise<CastleTheme> {
  const root = `${base}${THEME_DIR}/`;
  try {
    const res = await fetch(`${root}theme.json`, { cache: 'no-cache' });
    if (res.ok) {
      const parsed = parseTheme(await res.json(), root);
      if ('theme' in parsed) return parsed.theme;
      console.warn(`theme.json: ${parsed.error}`);
    }
  } catch (e) {
    console.warn('theme.json', e);
  }
  return { id: 'medieval-castle', name: 'Medieval castle', version: '0', root };
}
