import { describe, expect, it } from 'vitest';
import { problems } from '../scripts/assetVersions.js';

describe('asset versions', () => {
  // Players' devices keep theme, pack and sky files until their version changes
  // (service worker, cache headers): changed files need a new version.
  it('every theme, pack and sky set that changed has a new, recorded version', () => {
    expect(problems()).toEqual([]);
  });
});

describe('the version check', () => {
  const e = (version: string, hash: string) => ({ version, hash, where: 'public/themes/x/pack.json → "version"' });
  it('fails when files changed but the version did not, and says what to bump', () => {
    const [msg] = problems({ 'themes/x': e('1.0.0', 'new') }, { 'themes/x': e('1.0.0', 'old') });
    expect(msg).toContain('still 1.0.0');
    expect(msg).toContain('public/themes/x/pack.json');
  });
  it('asks to record a bumped version, and is quiet when nothing changed', () => {
    expect(problems({ 'themes/x': e('1.1.0', 'new') }, { 'themes/x': e('1.0.0', 'old') })[0]).toContain('not recorded');
    expect(problems({ 'themes/x': e('1.0.0', 'h') }, { 'themes/x': e('1.0.0', 'h') })).toEqual([]);
  });
});
