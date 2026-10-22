import { afterEach, describe, expect, it, vi } from 'vitest';
import { awayFor, awaySummary, errandsSince, loadVisit, parseVisit, saveVisit, visitOf, visitScope, worthTelling, type LastVisit } from '../src/castle/away.js';
import { awayLines } from '../src/castle/awayCard.js';
import type { Errand } from '../src/castle/world/world.js';
import type { Goods } from '../src/domain/model.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 22, 12);

const coin = (symbol: string, quantity: number, usd: number | null): Goods => ({ symbol, quantity, usd, isNft: false });
const nft = (symbol: string): Goods => ({ symbol, quantity: 1, usd: null, isNft: true });

let n = 0;
function errand(hoursAgo: number, over: Partial<Errand> = {}, give: Goods[] = [], get: Goods[] = []): Errand {
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
    steps: [{ verb: over.verb ?? 'send', where: 'somewhere', give, get }],
    method: null,
    block: null,
    tier: 0,
    time: NOW - hoursAgo * HOUR,
    label: `errand ${n}`,
    ...over,
  };
}

const visit = (hoursAgo: number, latestHoursAgo: number | null): LastVisit => ({
  at: NOW - hoursAgo * HOUR,
  latest: latestHoursAgo === null ? null : { time: NOW - latestHoursAgo * HOUR, key: 'seen' },
  tiers: { keep: 0, wallets: {} },
});

describe('what happened since the last visit', () => {
  const before = [errand(100, { protocolId: 'uniswap', direction: 'out', verb: 'swap' }), errand(60, { protocolId: 'aave', verb: 'supply' })];
  const since = [
    errand(40, { protocolId: 'uniswap', verb: 'swap', valueUsd: 900 }, [coin('USDC', 1000, 1000)], [coin('ETH', 0.4, 980)]),
    errand(30, { direction: 'in', verb: 'receive', valueUsd: 2000 }, [], [coin('ETH', 0.8, 1960)]),
    errand(20, { protocolId: 'lido', verb: 'stake', valueUsd: 500 }, [coin('ETH', 0.2, 490)], [coin('stETH', 0.2, 490)]),
    errand(10, { protocolId: 'ens', direction: 'in', verb: 'airdrop', valueUsd: 50 }, [], [coin('ENS', 10, 50)]),
    errand(8, { verb: 'burn', valueUsd: 5 }, [nft('Junk')], []),
    errand(5, { protocolId: 'blur', failed: true, verb: 'buyNft', valueUsd: 99_999 }, [coin('ETH', 30, 70_000)], [nft('Punk')]),
    errand(2, { direction: 'inside', fromTower: 0, toTower: 1, valueUsd: 10_000 }, [coin('ETH', 3, 7000)], []),
  ];
  const all = [...before, ...since];
  const s = awaySummary(all, visit(48, 50), NOW);

  it('counts the couriers since the newest one seen, each way, oldest first', () => {
    expect(s.errands.map((e) => e.key)).toEqual(since.map((e) => e.key));
    expect([s.incoming, s.outgoing, s.inside]).toEqual([2, 4, 1]);
    expect(s.away).toBe(48 * HOUR);
  });

  it('nets what came and went by token, the biggest in value first (failed and inside moves left out)', () => {
    const eth = s.net.find((t) => t.symbol === 'ETH')!;
    expect(eth.quantity).toBeCloseTo(0.4 + 0.8 - 0.2);
    expect(s.net[0]!.symbol).toBe('ETH');
    expect(s.net.find((t) => t.symbol === 'USDC')!.quantity).toBe(-1000);
    expect(s.net.map((t) => t.symbol)).toEqual(['ETH', 'USDC', 'stETH', 'ENS']);
    expect([s.nftsIn, s.nftsOut]).toEqual([0, 1]);
  });

  it('names places new to the couriers, and counts burns, airdrops and failures', () => {
    // uniswap was visited before; blur's courier failed: not a visit
    expect(s.newProtocols).toEqual(['lido', 'ens']);
    expect([s.burns, s.airdrops, s.failed]).toEqual([1, 1, 1]);
  });

  it('the biggest is the one that moved the most (not a failed one)', () => {
    expect(s.biggest?.valueUsd).toBe(10_000);
  });

  it('with no transaction seen then, counts from the visit itself', () => {
    expect(errandsSince(all, visit(9, null)).length).toBe(3);
  });

  it('tells only when something happened and over an hour has passed', () => {
    expect(worthTelling(s)).toBe(true);
    expect(worthTelling(awaySummary(all, visit(0.5, 50), NOW))).toBe(false);
    expect(worthTelling(awaySummary(all, visit(48, 1), NOW))).toBe(false);
  });

  it('says it in a few plain lines', () => {
    const lines = awayLines(s, (id) => id.toUpperCase());
    expect(lines[0]).toBe('7 couriers: 2 came in, 4 went out, 1 between your wallets.');
    expect(lines[1]).toBe('On balance: +1 ETH, −1,000 USDC, +0.2 stETH, −1 NFT.');
    expect(lines[2]).toBe('Somewhere new: LIDO, ENS.');
    expect(lines[3]).toBe('Also 1 airdrop, 1 burn, 1 that failed.');
    expect(lines[4]).toBe(`The biggest: ${since[6]!.label}, ~$10k.`);
  });
});

describe('how long you were away', () => {
  it('in hours, days, weeks or months', () => {
    expect(awayFor(0.5 * HOUR)).toBe('1 hour');
    expect(awayFor(5 * HOUR)).toBe('5 hours');
    expect(awayFor(49 * HOUR)).toBe('2 days');
    expect(awayFor(21 * 24 * HOUR)).toBe('3 weeks');
    expect(awayFor(90 * 24 * HOUR)).toBe('3 months');
  });
});

describe('the visit remembered', () => {
  const world = { errands: [errand(3), errand(1)], tier: 3, walletIds: ['0xAA', '0xbb'], walletTiers: [2, 4] };

  it('keeps the newest transaction and the highest tier each piece reached', () => {
    const v = visitOf(world, { at: 0, latest: { time: NOW, key: 'later' }, tiers: { keep: 4, wallets: { '0xaa': 1, '0xcc': 5 } } }, NOW);
    expect(v.at).toBe(NOW);
    expect(v.latest?.key).toBe('later'); // newer than any loaded now
    expect(v.tiers).toEqual({ keep: 4, wallets: { '0xaa': 2, '0xbb': 4, '0xcc': 5 } });
    expect(visitOf(world, null, NOW).latest?.key).toBe(world.errands[1]!.key);
  });

  it('per realm and set of wallets, in any order', () => {
    expect(visitScope('ethereum', ['0xB', '0xa'])).toBe(visitScope('ethereum', ['0xA', '0xb']));
    expect(visitScope('ethereum', ['0xa'])).not.toBe(visitScope('ethereum+base', ['0xa']));
  });

  it('forgets a broken entry', () => {
    expect(parseVisit({ at: 'yesterday' })).toBeNull();
    expect(parseVisit({ at: 5, latest: { time: 'x' }, tiers: { keep: 2, wallets: { a: 1, b: 'x' } } })).toEqual({ at: 5, latest: null, tiers: { keep: 2, wallets: { a: 1 } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is kept in local storage, and does without it', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } });
    const v = visitOf(world, null, NOW);
    saveVisit('s', v);
    expect(loadVisit('s')).toEqual(v);
    expect(loadVisit('other')).toBeNull();
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(() => saveVisit('s', v)).not.toThrow();
    expect(loadVisit('s')).toBeNull();
  });
});
