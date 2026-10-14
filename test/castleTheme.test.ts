import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTheme, themeFileUrl } from '../src/castle/assets/theme.js';

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
