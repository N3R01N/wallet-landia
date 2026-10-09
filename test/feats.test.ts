import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Guild, Hero, Journey } from '../src/domain/model.js';
import { ALL_MEDALS, defaultTitle, earnedMedals, medalsByJourney, teachingQuests, titleOptions } from '../src/domain/feats.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

const hero = (over: Partial<Hero> = {}): Hero => ({
  address: '0xabc',
  label: '',
  name: 'Test',
  netWorth: 0,
  tokenWorth: 0,
  nftWorth: 0,
  tier: 0,
  items: [],
  nfts: [],
  spamCount: 0,
  stashes: [],
  suggestedClass: 'adventurer',
  verbCounts: {},
  lastActiveAt: null,
  ...over,
});

let n = 0;
const journey = (over: Partial<Journey>): Journey => ({
  key: `k${n++}`,
  hash: '',
  chainId: 'ethereum',
  hero: '0xabc',
  time: 1_000 * n,
  status: 'confirmed',
  feeUsd: 1,
  feeNative: 0.001,
  block: null,
  method: null,
  initiated: true,
  verb: 'swap',
  steps: [{ verb: 'swap', target: { kind: 'building', protocolId: 'uni' }, give: [], get: [] }],
  valueUsd: 0,
  tier: 0,
  drama: 0,
  counterparty: null,
  counterpartyHero: null,
  label: '',
  ...over,
});

const guildOf = (h: Hero, journeys: Journey[]): Guild => ({ heroes: [h], protocols: new Map(), journeys, windowStart: 0, windowEnd: 0 });

describe('medals', () => {
  it('are earned by the first journey that qualifies', () => {
    const h = hero();
    const swap1 = journey({ verb: 'swap' });
    const swap2 = journey({ verb: 'swap' });
    const m = earnedMedals(h, guildOf(h, [swap1, swap2]));
    expect(m.get('barter')).toEqual({ at: swap1.time, journey: swap1.key });
    expect(m.get('first-steps')?.journey).toBe(swap1.key);
    expect(m.has('keys')).toBe(false);
  });

  it('need the hero to have signed, and to have succeeded', () => {
    const h = hero();
    const m = earnedMedals(h, guildOf(h, [journey({ verb: 'swap', initiated: false }), journey({ verb: 'revoke', status: 'failed' })]));
    expect(m.has('barter')).toBe(false);
    expect(m.has('keys')).toBe(false);
    expect(m.has('scarred')).toBe(true);
  });

  it('surviving the bailiffs takes a journey after the liquidation', () => {
    const h = hero();
    const liq = journey({ verb: 'liquidated', initiated: false });
    expect(earnedMedals(h, guildOf(h, [liq])).has('survived')).toBe(false);
    const after = journey({ verb: 'repay' });
    expect(earnedMedals(h, guildOf(h, [liq, after])).get('survived')?.journey).toBe(after.key);
  });

  it('can come from what a hero holds', () => {
    const items = ['ETH', 'USDC', 'LINK', 'UNI'].map((symbol, i) => ({ id: symbol, chainId: 'ethereum', name: symbol, symbol, category: i === 1 ? ('stable' as const) : ('token' as const), quantity: 1, usd: 100, tier: 2 as const, iconUrl: null }));
    const h = hero({ items, tier: 5 });
    const m = earnedMedals(h, guildOf(h, []));
    expect(m.get('steward')).toEqual({ at: null, journey: null });
    expect(m.has('hoard')).toBe(true);
  });

  it('give titles, the hardest one by default', () => {
    expect(titleOptions('merchant', ['barter', 'keys'])).toEqual(['the Merchant', 'the Barterer', 'Keeper of Keys']);
    expect(defaultTitle('merchant', ['barter', 'keys'])).toBe('Keeper of Keys');
    expect(defaultTitle('monk', ['first-steps'])).toBe('the Monk');
  });

  it('every medal has a lesson and a unique id; the demo guild earns some', () => {
    expect(new Set(ALL_MEDALS.map((m) => m.id)).size).toBe(ALL_MEDALS.length);
    for (const m of ALL_MEDALS) expect(m.lesson.length).toBeGreaterThan(20);
    const g = buildGuild(demo);
    const total = g.heroes.reduce((s, h) => s + earnedMedals(h, g).size, 0);
    expect(total).toBeGreaterThan(3);
    // each journey-earned medal can be announced when its journey plays
    const announced = [...medalsByJourney(g).values()].flat().length;
    const fromJourneys = g.heroes.reduce((s, h) => s + [...earnedMedals(h, g).values()].filter((e) => e.journey !== null).length, 0);
    expect(announced).toBe(fromJourneys);
  });
});

describe('teaching quests', () => {
  it('track keys handed out and taken back', () => {
    const h = hero();
    const approve = journey({ verb: 'approve', steps: [{ verb: 'approve', target: { kind: 'building', protocolId: 'uni' }, give: [], get: [] }] });
    const open = teachingQuests(h, guildOf(h, [approve])).find((q) => q.id === 'keys');
    expect(open?.done).toBe(false);
    expect(open?.link?.href).toBe('https://revoke.cash/address/0xabc');
    const revoke = journey({ verb: 'revoke', steps: [{ verb: 'revoke', target: { kind: 'building', protocolId: 'uni' }, give: [], get: [] }] });
    expect(teachingQuests(h, guildOf(h, [approve, revoke])).find((q) => q.id === 'keys')?.done).toBe(true);
  });

  it('only appear when they mean something for the wallet', () => {
    const empty = hero();
    expect(teachingQuests(empty, guildOf(empty, []))).toEqual([]);
    const eth = { id: 'eth', chainId: 'ethereum', name: 'Ether', symbol: 'ETH', category: 'native' as const, quantity: 1, usd: 3000, tier: 3 as const, iconUrl: null };
    const h = hero({ items: [eth] });
    const qs = teachingQuests(h, guildOf(h, []));
    expect(qs.find((q) => q.id === 'temple')?.done).toBe(false);
    expect(qs.find((q) => q.id === 'diversify')).toMatchObject({ done: false, progress: '100% of the treasury is ETH.' });
  });
});
