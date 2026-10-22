import { describe, expect, it } from 'vitest';
import { grownSince, growthLine } from '../src/castle/world/growth.js';

describe('the castle grows with you', () => {
  const now = { tier: 3, walletIds: ['0xAA', '0xbb', '0xcc'], walletTiers: [2, 5, 1] };

  it('the keep and each wallet’s hall that reached a higher tier than at the last visit', () => {
    expect(grownSince(now, { keep: 2, wallets: { '0xaa': 2, '0xbb': 3, '0xcc': 2 } })).toEqual([
      { piece: 'keep', from: 2, to: 3 },
      { piece: 1, from: 3, to: 5 },
    ]);
  });

  it('nothing for a piece that stayed or shrank, nor for a wallet new since', () => {
    expect(grownSince(now, { keep: 3, wallets: { '0xaa': 2 } })).toEqual([]);
    expect(grownSince(now, { keep: 4, wallets: { '0xaa': 3, '0xbb': 6 } })).toEqual([]);
  });

  it('wallets matched whatever the case of their address', () => {
    expect(grownSince(now, { keep: 3, wallets: { '0xaa': 1 } })).toEqual([{ piece: 0, from: 1, to: 2 }]);
  });

  it('says what it became', () => {
    expect(growthLine({ piece: 'keep', from: 2, to: 3 }, () => '')).toBe('Your keep is now Rare');
    expect(growthLine({ piece: 1, from: 3, to: 5 }, (i) => (i === 1 ? 'Vault' : '?'))).toBe('Vault’s hall is now Legendary');
  });
});
