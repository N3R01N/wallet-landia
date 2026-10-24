/**
 * A castle theme's manifest (public/themes/<id>/theme.json): its name and
 * version. The version goes on every file's URL (`?v=`), so a player's device
 * keeps the files until the version changes (public/sw.js, public/_headers).
 * The manifest itself is fetched fresh each visit.
 *
 * A theme may extend another (`"extends": "medieval-castle"`): a model it does
 * not have comes from the one it extends. A theme of models only (a style
 * pilot) says `"art": false`, and its icons, badges and effects come from the
 * one it extends too.
 */

import { THEME_DIR } from './manifest.js';

export const THEME_FORMAT = 'zenigard-theme/1';

export interface CastleTheme {
  id: string;
  name: string;
  version: string;
  /** The theme's folder URL, ending in a slash. */
  root: string;
  /** The theme it extends: models it lacks come from there. */
  parent?: CastleTheme;
  /** Whether its folder has the 2D art (icons, badges, effects); false: the parent's art is used. */
  art: boolean;
  /** The castle's layout its models are made for (plan.ts: 1 towers on the walls, 2 halls in the walls); the parent's when it does not say. */
  castleLayout?: 1 | 2;
}

/** The theme on show by default. */
export const DEFAULT_THEME = THEME_DIR.replace(/^themes\//, '');
const ID = /^[a-z0-9-]{2,40}$/;

/** Reads a manifest; returns null (with the reason) for anything that is not a usable one. */
export function parseTheme(raw: unknown, root: string): { theme: CastleTheme } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.format !== THEME_FORMAT) return { error: `format is not ${THEME_FORMAT}` };
  if (typeof r.id !== 'string' || !ID.test(r.id)) return { error: 'id must be 2–40 of a-z 0-9 -' };
  if (r.extends !== undefined && (typeof r.extends !== 'string' || !ID.test(r.extends) || r.extends === r.id)) return { error: 'extends must name another theme' };
  if (typeof r.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version)) return { error: 'version must look like 1.2.3' };
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : r.id;
  const castleLayout = r.castleLayout === 1 || r.castleLayout === 2 ? { castleLayout: r.castleLayout } : {};
  return { theme: { id: r.id, name, version: r.version, root, art: r.art !== false, ...castleLayout }, ...(typeof r.extends === 'string' ? { extends: r.extends } : {}) } as { theme: CastleTheme; extends?: string };
}

/** The theme whose folder has the 2D art (icons, badges, effects): this one, or the nearest it extends that has it. */
export function artTheme(theme: CastleTheme): CastleTheme {
  let t: CastleTheme | undefined = theme;
  while (t && !t.art) t = t.parent;
  return t ?? theme;
}

/** Every theme a model may come from, nearest first. */
export function themeChain(theme: CastleTheme): CastleTheme[] {
  const out: CastleTheme[] = [];
  for (let t: CastleTheme | undefined = theme; t && out.length < 4; t = t.parent) out.push(t);
  return out;
}

/** The theme a page asks for (`?theme=`), when it names one plainly; else the default. */
export function themeFromUrl(search: string): string {
  const id = new URLSearchParams(search).get('theme');
  return id && ID.test(id) ? id : DEFAULT_THEME;
}

/**
 * A picture from the nearest theme in the chain that has it (the protocol
 * logos live in the first theme's `logos/`, whichever theme has the art).
 */
export async function loadThemeImage(theme: CastleTheme, path: string): Promise<HTMLImageElement> {
  for (const t of themeChain(theme)) {
    const img = new Image();
    img.src = themeFileUrl(t, path);
    try {
      await img.decode();
      return img;
    } catch {
      // not in this one: the next
    }
  }
  throw new Error(`no theme has ${path}`);
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
export async function loadCastleTheme(base: string, id: string = DEFAULT_THEME, depth = 0): Promise<CastleTheme> {
  const root = `${base}themes/${id}/`;
  try {
    const res = await fetch(`${root}theme.json`, { cache: 'no-cache' });
    if (res.ok) {
      const parsed = parseTheme(await res.json(), root) as { theme: CastleTheme; extends?: string } | { error: string };
      if ('theme' in parsed) {
        // the theme it extends (a couple of steps at most)
        if (parsed.extends && depth < 3) parsed.theme.parent = await loadCastleTheme(base, parsed.extends, depth + 1);
        if (parsed.theme.castleLayout === undefined && parsed.theme.parent?.castleLayout) parsed.theme.castleLayout = parsed.theme.parent.castleLayout;
        return parsed.theme;
      }
      console.warn(`theme.json: ${parsed.error}`);
    }
  } catch (e) {
    console.warn('theme.json', e);
  }
  // an unknown theme falls back to the default one
  if (id !== DEFAULT_THEME) return loadCastleTheme(base, DEFAULT_THEME, depth + 1);
  return { id: DEFAULT_THEME, name: 'Medieval castle', version: '0', root, art: true };
}
