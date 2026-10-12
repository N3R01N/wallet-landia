import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import { buildGuild } from '../src/domain/mappers.js';
import { fromWire, workPlayer } from '../src/domain/playerJob.js';
import type { Guild, Hero, Journey, Verb } from '../src/domain/model.js';
import { badgeMoments, levelForXp, playerProfile, rankOf, xpForLevel } from '../src/domain/player.js';

const DAY = 86_400_000;
const T0 = Date.parse('2016-03-01T00:00:00Z');
const NOW = Date.parse('2026-03-01T00:00:00Z');

function hero(address: string, o: Partial<Hero> = {}): Hero {
  return { address, label: '', name: address, netWorth: 0, tokenWorth: 0, nftWorth: 0, tier: 0, items: [], nfts: [], spamCount: 0, stashes: [], suggestedClass: 'adventurer', verbCounts: {}, lastActiveAt: null, ...o };
}

let n = 0;
function j(heroAddr: string, verb: Verb, time: number, o: Partial<Journey> = {}): Journey {
  n++;
  return {
    key: `ethereum:0x${n}`, hash: `0x${n}`, chainId: 'ethereum', hero: heroAddr, time, status: 'confirmed', feeUsd: 1, feeNative: 0.001, block: n, method: null,
    initiated: true, verb, steps: [{ verb, target: { kind: 'building', protocolId: `p-${verb}` }, give: [], get: [] }],
    valueUsd: 10, tier: 1, drama: 0, counterparty: null, counterpartyHero: null, label: '', ...o,
  };
}

const guild = (heroes: Hero[], journeys: Journey[]): Guild => ({ heroes, protocols: new Map(), journeys, windowStart: 0, windowEnd: NOW });

describe('the player', () => {
  it('earns badges across all their wallets, with tiers and where each came from', () => {
    const swaps = Array.from({ length: 12 }, (_, i) => j(i % 2 ? '0xa' : '0xb', 'swap', T0 + i * DAY));
    const p = playerProfile(guild([hero('0xa'), hero('0xb')], swaps), new Map(), NOW);
    const barter = p.badges.get('barter')!;
    expect(barter.count).toBe(12);
    expect(barter.tier).toBe(2); // silver at 10
    expect(barter.tiers.map((t) => t.journey)).toEqual([swaps[0]!.key, swaps[9]!.key]);
    expect(barter.tiers[0]!.wallet).toBe('0xb'); // the wallet that got there first
    expect(p.badges.get('first-steps')!.count).toBe(12);
  });

  it('milestones are one tier; holdings count for any wallet', () => {
    const many = Array.from({ length: 120 }, (_, i) => j('0xa', 'send', T0 + i * DAY));
    const rich = hero('0xb', { tier: 5 });
    const p = playerProfile(guild([hero('0xa'), rich], many), new Map(), NOW);
    expect(p.badges.get('veteran')).toMatchObject({ single: true, tier: 1, count: 1 });
    expect(p.badges.get('veteran')!.tiers[0]!.journey).toBe(many[49]!.key); // the 50th signed journey
    expect(p.badges.get('hoard')!.tiers[0]).toEqual({ at: null, wallet: '0xb', journey: null });
    expect(p.badges.get('first-steps')!.tier).toBe(3); // gold at 100
  });

  it('rewards breadth and time, not repetition', () => {
    const repeat = Array.from({ length: 200 }, (_, i) => j('0xa', 'swap', T0 + i * 3_600_000));
    const verbs: Verb[] = ['swap', 'supply', 'borrow', 'repay', 'stake', 'claim', 'bridge', 'revoke', 'addLiquidity', 'delegate'];
    const broad = verbs.map((v, i) => j('0xa', v, T0 + i * 40 * DAY));
    const a = playerProfile(guild([hero('0xa')], repeat), new Map(), NOW);
    const b = playerProfile(guild([hero('0xa')], broad), new Map(), NOW);
    // ten varied journeys over a year beat two hundred of the same in a week
    expect(b.xp).toBeGreaterThan(a.xp);
    expect(b.stats.kinds).toBe(10);
    // wealth alone earns no XP (the Dragon's Hoard badge is shown, but adds nothing)
    const poor = playerProfile(guild([hero('0xa')], broad), new Map(), NOW);
    const rich = playerProfile(guild([hero('0xa', { tier: 6 })], broad), new Map(), NOW);
    expect(rich.badges.has('hoard')).toBe(true);
    expect(rich.xp).toBe(poor.xp);
  });

  it('a send between your own wallets is one journey, counted once', () => {
    const send = j('0xa', 'send', T0, { counterpartyHero: '0xb' });
    const p = playerProfile(guild([hero('0xa'), hero('0xb')], [send]), new Map(), NOW);
    expect(p.stats.signed).toBe(1);
    expect(p.badges.get('generous')!.count).toBe(1);
  });

  it('only the player’s own wallets count; remembered badges are kept', () => {
    const p = playerProfile(guild([hero('0xa')], [j('0xother', 'swap', T0)]), new Map([['patron', { at: T0, wallet: '0xa', journey: null }]]), NOW);
    expect(p.stats.signed).toBe(0);
    expect(p.badges.has('barter')).toBe(false);
    expect(p.badges.get('patron')).toMatchObject({ tier: 1, count: 1 });
  });

  it('levels: a curve that starts quickly and takes years at the top', () => {
    for (const l of [1, 2, 5, 10, 30, 60]) expect(levelForXp(xpForLevel(l))).toBe(l);
    expect(levelForXp(xpForLevel(7) - 1)).toBe(6);
    expect(xpForLevel(2)).toBeLessThan(100);
    expect(rankOf(1)).toBe('Wanderer');
    expect(rankOf(12)).toBe('Knight');
    const empty = playerProfile(guild([hero('0xa')], []), new Map(), NOW);
    expect(empty).toMatchObject({ xp: 0, level: 1, rank: 'Wanderer' });
    expect(empty.nextXp).toBe(xpForLevel(2));
  });

  it('marks the journeys that earned a badge or a tier, for the replay to announce', () => {
    const swaps = Array.from({ length: 10 }, (_, i) => j('0xa', 'swap', T0 + i * DAY));
    const moments = badgeMoments(playerProfile(guild([hero('0xa')], swaps), new Map(), NOW));
    expect(moments.get(swaps[0]!.key)!.map((m) => m.badge.medal.id).sort()).toEqual(['barter', 'first-steps']);
    expect(moments.get(swaps[9]!.key)!.map((m) => `${m.badge.medal.id}:${m.tier}`).sort()).toEqual(['barter:2', 'first-steps:2']);
  });
});

describe('the player off the main thread', () => {
  it('crosses to a worker and back (structured clone) unchanged', () => {
    const dir = resolve(__dirname, '../fixtures');
    const raws = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawWallet);
    const remembered = new Map([['founder', { at: T0, wallet: raws[0]!.address.toLowerCase(), journey: null }]]);
    const job = { raws, names: new Map<string, string>(), remembered, now: NOW };
    const direct = playerProfile(buildGuild(raws, { kind: 'count', count: Number.MAX_SAFE_INTEGER }, { names: job.names }), remembered, NOW);
    // what a worker would receive, and what it would send back
    const back = fromWire(structuredClone(workPlayer(structuredClone(job))));
    expect(back.badges.size).toBeGreaterThan(3);
    expect([...back.badges.keys()]).toEqual([...direct.badges.keys()]);
    expect(back).toEqual(direct);
    // the medals are the very same ones (titles and icons look them up)
    for (const [id, b] of back.badges) expect(b.medal).toBe(direct.badges.get(id)!.medal);
  });
});
