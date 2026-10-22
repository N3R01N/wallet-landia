import { describe, expect, it } from 'vitest';
import { anniversaryOn, dropLine, firstTxTime, freshDrop, occasionsFor, pinnedDate, seasonOn } from '../src/castle/world/events.js';
import type { Errand } from '../src/castle/world/world.js';

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const DAY = 86_400_000;

const errand = (key: string, time: number, more: Partial<Errand> = {}): Errand => ({
  key,
  protocolId: null,
  direction: 'in',
  failed: false,
  hash: key,
  chainId: 'ethereum',
  verb: 'receive',
  valueUsd: 0,
  feeUsd: null,
  wallet: '0xa',
  steps: [],
  method: null,
  block: null,
  tier: 0,
  time,
  label: key,
  ...more,
});

describe('the town calendar', () => {
  it('snows in December, all of it, and no other month', () => {
    expect(seasonOn(day(2026, 12, 1)).snow).toBe(true);
    expect(seasonOn(day(2026, 12, 24)).snow).toBe(true);
    expect(seasonOn(day(2026, 12, 31)).snow).toBe(true);
    expect(seasonOn(day(2026, 11, 30)).snow).toBe(false);
    expect(seasonOn(day(2027, 1, 1)).snow).toBe(false);
  });

  it('has pumpkins from 20 October to its end', () => {
    expect(seasonOn(day(2026, 10, 19)).pumpkins).toBe(false);
    expect(seasonOn(day(2026, 10, 20)).pumpkins).toBe(true);
    expect(seasonOn(day(2026, 10, 31)).pumpkins).toBe(true);
    expect(seasonOn(day(2026, 11, 1)).pumpkins).toBe(false);
    expect(seasonOn(day(2026, 12, 24)).pumpkins).toBe(false);
  });

  it("keeps the guild's day: whole years since its first transaction, on that day only", () => {
    const first = day(2021, 7, 28, 9).getTime();
    expect(anniversaryOn(day(2026, 7, 28), first)).toBe(5);
    expect(anniversaryOn(day(2022, 7, 28, 23), first)).toBe(1);
    expect(anniversaryOn(day(2026, 7, 27), first)).toBeNull();
    expect(anniversaryOn(day(2026, 8, 28), first)).toBeNull();
    // not in its first year, and not without a first transaction
    expect(anniversaryOn(day(2021, 7, 28), first)).toBeNull();
    expect(anniversaryOn(day(2026, 7, 28), null)).toBeNull();
  });

  it('a first made on 29 February is kept on the 28th in other years', () => {
    const leap = day(2024, 2, 29).getTime();
    expect(anniversaryOn(day(2025, 2, 28), leap)).toBe(1);
    expect(anniversaryOn(day(2028, 2, 29), leap)).toBe(4);
    expect(anniversaryOn(day(2028, 2, 28), leap)).toBeNull();
  });

  it('the market dresses the town: a festival for a big rise, shuttered stalls for a crash', () => {
    const at = { date: day(2026, 6, 10), firstTx: null };
    expect(occasionsFor({ ...at, mood: 'boom' })).toEqual({ festival: true, storm: false, snow: false, pumpkins: false, anniversary: null });
    expect(occasionsFor({ ...at, mood: 'crash' })).toMatchObject({ festival: false, storm: true });
    for (const mood of ['up', 'flat', 'down', null] as const) expect(occasionsFor({ ...at, mood })).toMatchObject({ festival: false, storm: false });
    expect(occasionsFor({ date: day(2026, 12, 24), mood: null, firstTx: day(2020, 12, 24).getTime() })).toMatchObject({ snow: true, anniversary: 6 });
  });

  it('pins a real day only', () => {
    const d = pinnedDate('2026-12-24')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 24]);
    expect(pinnedDate('2026-02-30')).toBeNull();
    expect(pinnedDate('24/12/2026')).toBeNull();
    expect(pinnedDate(null)).toBeNull();
  });

  it('the first transaction is the earliest in the history', () => {
    expect(firstTxTime([errand('b', 300), errand('a', 100), errand('c', 200)])).toBe(100);
    expect(firstTxTime([])).toBeNull();
  });
});

describe('the airdrop crate', () => {
  const latest = day(2026, 8, 2).getTime();
  const drop = errand('drop', latest - DAY, { verb: 'airdrop', steps: [{ verb: 'airdrop', where: 'outside', give: [], get: [{ symbol: 'OP', quantity: 1250.4, usd: 2000, isNft: false }] }] });
  const history = [errand('old', latest - 30 * DAY), drop, errand('last', latest)];

  it('waits for an airdrop or mint from the last few days of the history', () => {
    expect(freshDrop(history, new Set())?.key).toBe('drop');
    const mint = errand('mint', latest - 2 * DAY, { verb: 'mint', direction: 'out' });
    expect(freshDrop([mint, errand('last', latest)], new Set())?.key).toBe('mint');
    // the latest of two
    expect(freshDrop([...history, mint], new Set())?.key).toBe('drop');
  });

  it('none for an old one, a failed one, an opened one, or none at all', () => {
    expect(freshDrop([errand('old', latest - 10 * DAY, { verb: 'airdrop' }), errand('last', latest)], new Set())).toBeNull();
    expect(freshDrop([errand('f', latest, { verb: 'mint', failed: true })], new Set())).toBeNull();
    expect(freshDrop(history, new Set(['drop']))).toBeNull();
    expect(freshDrop([], new Set())).toBeNull();
  });

  it('says what came', () => {
    expect(dropLine(drop)).toBe('An airdrop: 1,250 OP');
    expect(dropLine({ verb: 'mint', steps: [{ verb: 'mint', where: 'x', give: [], get: [{ symbol: 'Pudgy', quantity: 1, usd: null, isNft: true, name: 'Pudgy #12' }] }] })).toBe('Freshly minted: Pudgy #12');
    expect(dropLine({ verb: 'airdrop', steps: [] })).toBe('An airdrop: a surprise');
    expect(dropLine({ verb: 'airdrop', steps: [{ verb: 'airdrop', where: 'x', give: [], get: [{ symbol: 'ARB', quantity: 0.123456, usd: null, isNft: false }] }] })).toBe('An airdrop: 0.1235 ARB');
  });
});
