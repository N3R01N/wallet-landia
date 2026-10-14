import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, artTheme, parseTheme, themeChain, themeFileUrl, themeFromUrl, type CastleTheme } from '../src/castle/assets/theme.js';

const ROOT = '/themes/medieval-castle/';

describe('castle theme manifest', () => {
  it('the bundled theme.json is valid', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../public/themes/medieval-castle/theme.json', import.meta.url), 'utf8'));
    const parsed = parseTheme(raw, ROOT);
    expect('theme' in parsed && parsed.theme.id).toBe('medieval-castle');
  });

  it('refuses a wrong format, a bad id or a version that is not x.y.z', () => {
    const ok = { format: 'wallet-landia-theme/1', id: 'x-1', version: '1.0.0' };
    expect('theme' in parseTheme(ok, ROOT)).toBe(true);
    expect(parseTheme({ ...ok, format: 'wallet-landia-pack/2' }, ROOT)).toEqual({ error: expect.stringContaining('format') });
    expect(parseTheme({ ...ok, id: 'Bad Id' }, ROOT)).toEqual({ error: expect.stringContaining('id') });
    expect(parseTheme({ ...ok, version: 'latest' }, ROOT)).toEqual({ error: expect.stringContaining('version') });
    expect(parseTheme(null, ROOT)).toEqual({ error: 'not an object' });
  });

  it('every file URL carries the theme version, so a new version means new URLs', () => {
    const parsed = parseTheme({ format: 'wallet-landia-theme/1', id: 'xy', version: '0.2.0', name: 'X' }, ROOT);
    if (!('theme' in parsed)) throw new Error(parsed.error);
    expect(themeFileUrl(parsed.theme, 'models/castle/keep.t0.glb')).toBe('/themes/medieval-castle/models/castle/keep.t0.glb?v=0.2.0');
  });
});

describe('themes that extend others (a style pilot)', () => {
  it('a manifest may extend another theme and say it has no art of its own', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../public/themes/medieval-castle-v2/theme.json', import.meta.url), 'utf8'));
    const parsed = parseTheme(raw, '/themes/medieval-castle-v2/') as { theme: CastleTheme; extends?: string };
    expect(parsed.extends).toBe('medieval-castle');
    expect(parsed.theme.art).toBe(false);
    // its models are made for the v2 castle (halls in the walls); a theme that does not say gets its parent's
    expect(parsed.theme.castleLayout).toBe(2);
    const plain = parseTheme({ format: 'wallet-landia-theme/1', id: 'ab', version: '1.0.0', castleLayout: 7 }, ROOT) as { theme: CastleTheme };
    expect(plain.theme.castleLayout).toBeUndefined();
    expect(parseTheme({ format: 'wallet-landia-theme/1', id: 'ab', version: '1.0.0', extends: 'ab' }, ROOT)).toEqual({ error: expect.stringContaining('extends') });
  });

  it('models come from the nearest theme that has them; art from the nearest that has art', () => {
    const base: CastleTheme = { id: 'medieval-castle', name: 'B', version: '1.0.0', root: '/b/', art: true };
    const pilot: CastleTheme = { id: 'pilot', name: 'P', version: '0.1.0', root: '/p/', art: false, parent: base };
    expect(themeChain(pilot).map((t) => t.id)).toEqual(['pilot', 'medieval-castle']);
    expect(artTheme(pilot)).toBe(base);
    expect(artTheme(base)).toBe(base);
  });

  it('?theme= names a theme plainly, or the default is used', () => {
    expect(themeFromUrl('?theme=medieval-castle-v2')).toBe('medieval-castle-v2');
    expect(themeFromUrl('?theme=../../etc')).toBe(DEFAULT_THEME);
    expect(themeFromUrl('')).toBe(DEFAULT_THEME);
  });
});
