import { describe, expect, it } from 'vitest';
import { hallName, nextHall, walletFocus } from '../src/castle/world/halls.js';
import type { Item, Stash } from '../src/domain/model.js';

const item = (usd: number): Item => ({ id: 'x', chainId: 'ethereum', name: 'X', symbol: 'X', category: 'token' as Item['category'], quantity: 1, usd, tier: 0, iconUrl: null });
const stash = (grossUsd: number): Stash => ({ protocolId: 'aave', entries: [], netUsd: grossUsd, grossUsd, tier: 0, hasRewards: false, hasDebt: false });

describe('wallet halls', () => {
  it('a wallet’s focus is what it mostly holds by value', () => {
    expect(walletFocus({ items: [item(500)], stashes: [stash(100)], nftWorth: 50 })).toBe('tokens');
    expect(walletFocus({ items: [item(100)], stashes: [stash(900)], nftWorth: 50 })).toBe('defi');
    expect(walletFocus({ items: [item(100)], stashes: [stash(200)], nftWorth: 5_000 })).toBe('nft');
  });

  it('an empty wallet, or a tie, keeps tokens', () => {
    expect(walletFocus({ items: [], stashes: [], nftWorth: 0 })).toBe('tokens');
    expect(walletFocus({ items: [item(100)], stashes: [stash(100)], nftWorth: 100 })).toBe('tokens');
  });

  it('names each tier’s hall, and how far the next one is', () => {
    expect(hallName(0)).toBe('Dust lean-to');
    expect(hallName(6)).toBe('Mythic palace spire');
    expect(nextHall(2_500, 3)).toEqual({ name: 'Epic tower house', needUsd: 7_500 });
    expect(nextHall(5_000_000, 6)).toBeNull();
  });
});
