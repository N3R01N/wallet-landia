/**
 * The rename to Zenigard: saved keys move to the new names once, and history
 * files saved before it still load.
 */

import { describe, expect, it } from 'vitest';
import { moveOldKeys } from '../src/renamed.js';
import { decodeLedgerFile } from '../src/data/ledgerFile.js';

function memory(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('the rename to Zenigard', () => {
  it('moves saved keys to the new names, keeping one already saved there', () => {
    const s = memory({
      'wallet-landia-v4/prefs/v1': '{"speed":2}',
      'wallet-landia/budget/v1': '{"used":3}',
      'wallet-landia.rts.sound': 'off',
      'wallet-landia-v4/zerion-key': 'old',
      'zenigard/zerion-key': 'new',
      'gondi/x': 'kept',
    });
    moveOldKeys(s);
    const all = Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i)!, s.getItem(s.key(i)!)]));
    expect(all).toEqual({
      'zenigard/prefs/v1': '{"speed":2}',
      'zenigard/budget/v1': '{"used":3}',
      'zenigard.rts.sound': 'off',
      'zenigard/zerion-key': 'new',
      'gondi/x': 'kept',
    });
  });

  it('loads a history file saved under the old name', async () => {
    const f = { format: 'wallet-landia-ledger/1', scope: 'ethereum', wallets: [] };
    const back = await decodeLedgerFile(new TextEncoder().encode(JSON.stringify(f)).buffer as ArrayBuffer);
    expect(back.format).toBe('zenigard-ledger/1');
  });
});
