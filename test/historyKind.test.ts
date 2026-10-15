import { describe, expect, it } from 'vitest';
import { historyKind, walletDisplayName } from '../src/castle/guildTab.js';

describe('the history walk at a glance', () => {
  it('complete, partial, reaching back, needs attention, waiting', () => {
    expect(historyKind({ complete: true, capped: false }, 'budget')).toBe('done');
    expect(historyKind({ complete: false, capped: true }, null)).toBe('partial');
    expect(historyKind({ complete: false, capped: false }, null)).toBe('walking');
    expect(historyKind({ complete: false, capped: false }, 'auth')).toBe('problem');
    expect(historyKind({ complete: false, capped: false }, 'hidden')).toBe('waiting');
  });
});

describe('wallet names', () => {
  it('the name the player gave, else the ENS name, else "Wallet N" (never empty: an unknown ENS is stored as "")', () => {
    const p = { owned: ['0xa', '0xb', '0xc'], ens: { '0xa': 'alice.eth', '0xb': '' }, names: { '0xc': 'Savings' } };
    expect(walletDisplayName(p, '0xa')).toBe('alice.eth');
    expect(walletDisplayName(p, '0xb')).toBe('Wallet 2');
    expect(walletDisplayName(p, '0xc')).toBe('Savings');
  });
});
