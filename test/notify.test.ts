import { describe, expect, it } from 'vitest';
import { burstTitle, courierLine, courierNote } from '../src/castle/notify.js';
import type { Errand } from '../src/castle/world/world.js';
import type { Goods } from '../src/domain/model.js';

const coin = (symbol: string, quantity: number, usd: number | null = null): Goods => ({ symbol, quantity, usd, isNft: false });
const PLACES: Record<string, string> = { aave: 'Aave', uniswap: 'Uniswap' };
const place = (id: string) => PLACES[id] ?? id;
const walletName = (a: string) => (a === '0xa' ? 'Main' : a);

let n = 0;
function errand(over: Partial<Errand> = {}, give: Goods[] = [], get: Goods[] = []): Errand {
  n++;
  return {
    key: `k${n}`,
    protocolId: null,
    direction: 'out',
    failed: false,
    hash: `0x${n}`,
    chainId: 'ethereum',
    verb: 'send',
    valueUsd: 0,
    feeUsd: null,
    wallet: '0xa',
    steps: [{ verb: 'send', where: 'somewhere', give, get }],
    method: null,
    block: null,
    tier: 0,
    time: n,
    label: `errand ${n}`,
    ...over,
  };
}

describe('courierLine', () => {
  it('tells what came in', () => {
    expect(courierLine(errand({ direction: 'in' }, [], [coin('ETH', 0.5)]), place)).toBe('A courier brought you 0.5 ETH');
    expect(courierLine(errand({ direction: 'in', protocolId: 'aave' }, [], [coin('USDC', 12.5)]), place)).toBe('A courier brought you 12.5 USDC from Aave');
    expect(courierLine(errand({ direction: 'in' }), place)).toBe('A courier came in');
  });

  it('tells what went out, and where', () => {
    expect(courierLine(errand({ protocolId: 'aave' }, [coin('USDC', 1200)]), place)).toBe('A courier took 1,200 USDC to Aave');
    expect(courierLine(errand({}, [coin('ETH', 0.25)]), place)).toBe('A courier took 0.25 ETH away');
    expect(courierLine(errand({ protocolId: 'uniswap' }, [coin('USDC', 1200)], [coin('ETH', 0.5)]), place)).toBe('A courier traded 1,200 USDC for 0.5 ETH at Uniswap');
    expect(courierLine(errand({ protocolId: 'aave' }, [], [coin('AAVE', 3)]), place)).toBe('A courier brought back 3 AAVE from Aave');
    expect(courierLine(errand({ protocolId: 'aave' }), place)).toBe('A courier went to Aave');
    expect(courierLine(errand(), place)).toBe('A courier went out');
  });

  it('names the most valuable goods and counts the rest', () => {
    expect(courierLine(errand({ direction: 'in' }, [], [coin('DAI', 10, 10), coin('ETH', 1, 2500), coin('PEPE', 5000, 1)]), place)).toBe('A courier brought you 1 ETH and 2 more');
  });

  it('tells a failed one and one between your wallets', () => {
    expect(courierLine(errand({ failed: true, protocolId: 'aave' }, [coin('USDC', 5)]), place)).toBe('A courier was turned back on the way to Aave');
    expect(courierLine(errand({ failed: true }), place)).toBe('A courier was turned back');
    expect(courierLine(errand({ direction: 'inside' }, [coin('ETH', 2)]), place)).toBe('A courier carried 2 ETH between your wallets');
  });

  it('leaves a loan’s collateral out', () => {
    const lock: Goods = { symbol: 'Elders', quantity: 1, usd: null, isNft: true, name: 'Elders #29', collateral: true };
    expect(courierLine(errand({ direction: 'in' }, [], [lock]), place)).toBe('A courier came in');
  });
});

describe('courierNote', () => {
  it('none: nothing to tell', () => {
    expect(courierNote([], place, walletName)).toBeNull();
  });

  it('one: its line, and the wallet it was for', () => {
    expect(courierNote([errand({ direction: 'in' }, [], [coin('ETH', 0.5)])], place, walletName)).toEqual({ title: 'A courier brought you 0.5 ETH', body: 'Main' });
  });

  it('a burst is one notification: how many came and went, the first lines oldest first', () => {
    const a = errand({ direction: 'in', time: 1 }, [], [coin('ETH', 0.5)]);
    const b = errand({ time: 2, protocolId: 'aave' }, [coin('USDC', 1200)]);
    const c = errand({ direction: 'in', time: 3 });
    expect(courierNote([c, b, a], place, walletName)).toEqual({
      title: '3 couriers came and went',
      body: 'A courier brought you 0.5 ETH\nA courier took 1,200 USDC to Aave\nA courier came in',
    });
  });

  it('a long burst lists three and counts the rest', () => {
    const list = Array.from({ length: 5 }, (_, i) => errand({ direction: 'in', time: i }));
    const note = courierNote(list, place, walletName)!;
    expect(note.title).toBe('5 couriers came in');
    expect(note.body.split('\n')).toEqual(['A courier came in', 'A courier came in', 'A courier came in', 'and 2 more']);
  });

  it('a burst’s title follows the way they went', () => {
    expect(burstTitle([errand(), errand()])).toBe('2 couriers went out');
    expect(burstTitle([errand({ direction: 'in' }), errand({ direction: 'in' })])).toBe('2 couriers came in');
    expect(burstTitle([errand({ direction: 'inside' }), errand({ direction: 'inside' })])).toBe('2 couriers went between your wallets');
    expect(burstTitle([errand({ direction: 'inside' }), errand({ direction: 'in' })])).toBe('2 couriers came and went');
  });
});
