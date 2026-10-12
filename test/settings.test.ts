import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAINS } from '../src/data/zerion/endpoints.js';
import { apiKeyProblem, loadApiKey, loadPrefs, saveApiKey } from '../src/settings.js';

function fakeStorage(init: Record<string, string> = {}): void {
  const m = new Map(Object.entries(init));
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('preferences', () => {
  it('start from the defaults, with the realm chains endpoints.ts asks for', () => {
    fakeStorage();
    expect(loadPrefs().chains).toEqual([...DEFAULT_CHAINS]);
  });

  it('keep saved fields of the right kind and drop the rest', () => {
    fakeStorage({ 'wallet-landia-v4/prefs/v1': JSON.stringify({ speed: 2, window: null, chains: 'base', owned: ['0xabc', 3], fog: true, volume: 'loud', stray: 1 }) });
    const p = loadPrefs();
    expect(p.speed).toBe(2);
    expect(p.fog).toBe(true);
    expect(p.window).toEqual({ kind: 'count', count: 100 }); // null: the default
    expect(p.chains).toEqual([...DEFAULT_CHAINS]);
    expect(p.owned).toEqual([]);
    expect(p.volume).toBe(0.6);
    expect('stray' in p).toBe(false);
  });

  it('survive saved junk', () => {
    fakeStorage({ 'wallet-landia-v4/prefs/v1': '[1,2]' });
    expect(loadPrefs().view).toBe('3d');
    fakeStorage({ 'wallet-landia-v4/prefs/v1': '{oops' });
    expect(loadPrefs().view).toBe('3d');
  });
});

describe('the Zerion key', () => {
  it('is refused, with a reason, when it has characters a key never has', () => {
    fakeStorage();
    expect(apiKeyProblem('zk_dev_abc123')).toBeNull();
    expect(saveApiKey('zk_dev_abc“123')).toMatch(/characters/);
    expect(loadApiKey()).toBeNull();
    expect(saveApiKey('zk dev')).not.toBeNull();
    expect(saveApiKey('zk_dev_abc123')).toBeNull();
    expect(loadApiKey()).toBe('zk_dev_abc123');
  });
});
