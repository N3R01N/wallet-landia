import { describe, expect, it } from 'vitest';
import { FRAME_EVERY, simulateBattle, straightMap } from '../src/game/core/battle.js';
import { Catalog } from '../src/game/core/catalog.js';
import { Match } from '../src/game/core/match.js';
import type { Army, Squad } from '../src/game/core/types.js';
import { templatePortfolio } from '../src/game/data/templates.js';
import { planCastle } from '../src/castle/scene/plan.js';
import { siegePlan } from '../src/game/render/siegePlan.js';
import { stackSquads } from '../src/game/core/army.js';

const squad = (asset: string, unit: string, count: number, extra: Partial<Squad> = {}): Squad => {
  const s: Squad = { asset, unit, count, stacks: [], ...extra };
  stackSquads([s]);
  return s;
};
const army = (side: 'A' | 'B', squads: Squad[], atkMult = 1): Army => ({ side, squads, atkMult });

describe('BattleSim', () => {
  it('is deterministic: the same armies, map and seed give the same run', () => {
    const c = new Catalog();
    const m = new Match({ seed: 'b', portfolios: [templatePortfolio('balanced', 50000, c), templatePortfolio('degen', 40000, c)] });
    const armies = m.nextArmies();
    const a = simulateBattle(armies, { seed: 'b', round: 1 });
    const b = simulateBattle(armies, { seed: 'b', round: 1 });
    expect(JSON.stringify(b.survivors)).toBe(JSON.stringify(a.survivors));
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(Buffer.from(b.frames.buffer).equals(Buffer.from(a.frames.buffer))).toBe(true);
  });

  it('a much bigger army wins its lane and its survivors reach the enemy gate', () => {
    // all in the centre (siege units), so they meet
    const run = simulateBattle([army('A', [squad('wbtc', 'titan.bitcoin', 30)]), army('B', [squad('wbtc', 'titan.bitcoin', 5)])], { seed: 's', round: 1 });
    const left = run.survivors.map((s) => s.reduce((n, q) => n + q.count, 0));
    expect(left[0]).toBeGreaterThan(20);
    expect(left[1]).toBe(0);
    // the battle ends when a side has no units left
    expect(run.seconds).toBeLessThan(45);
  });

  it('armies in lanes that never meet march on to the enemy gate and wait there', () => {
    // cavalry on a flank, siege in the centre: 20 m apart, well beyond the aggro radius
    const run = simulateBattle([army('A', [squad('ens', 'rider.name', 4)]), army('B', [squad('wbtc', 'titan.bitcoin', 3)])], { seed: 'g', round: 1, map: straightMap(40, 20) });
    expect(run.events.filter((e) => e.t === 'arrive').length).toBe(4 + 3);
    expect(run.survivors.map((s) => s.reduce((n, q) => n + q.count, 0))).toEqual([4, 3]);
  });

  it('the counter triangle: Ranged hit Melee for +50%, Cavalry hit Ranged for +50%, Siege hit units for half', () => {
    const hit = (a: Squad, b: Squad) => {
      const run = simulateBattle([army('A', [a]), army('B', [b])], { seed: 'c', round: 1, map: straightMap(30, 0) });
      const e = run.events.find((x) => x.t === 'attack' && x.id === 0);
      return e && e.t === 'attack' ? e.damage : null;
    };
    // one unit each: its first hit's damage is ATK × the multiplier
    expect(hit(squad('link', 'archer.oracle', 1), squad('eth', 'paladin.eth', 1))).toBeCloseTo(5 * 1.5, 6);
    expect(hit(squad('ens', 'rider.name', 1), squad('link', 'archer.oracle', 1))).toBeCloseTo(4 * 1.5, 6);
    expect(hit(squad('eth', 'paladin.eth', 1), squad('ens', 'rider.name', 1))).toBeCloseTo(6 * 1.5, 6);
    expect(hit(squad('wbtc', 'titan.bitcoin', 1), squad('eth', 'knight', 1))).toBeCloseTo(8 * 0.5, 6);
  });

  it('liquidated collateral detonates at 3 s among its own side', () => {
    const run = simulateBattle(
      [army('A', [squad('eth', 'paladin.eth', 10), squad('eth', 'paladin.eth', 6, { detonates: true })]), army('B', [squad('eth', 'paladin.eth', 2)])],
      { seed: 'd', round: 1, map: straightMap(200, 10) },
    );
    const det = run.events.filter((e) => e.t === 'detonate');
    expect(det.length).toBeGreaterThan(0);
    expect(det.every((e) => e.tick === 60)).toBe(true);
    // they are gone afterwards, and never counted as survivors
    expect(run.survivors[0].every((s) => !s.detonates)).toBe(true);
  });

  it('frames: every entity, 4 floats each, at 10 Hz', () => {
    const run = simulateBattle([army('A', [squad('eth', 'paladin.eth', 12)]), army('B', [squad('link', 'archer.oracle', 9)])], { seed: 'f', round: 2 });
    expect(run.entities).toHaveLength(21);
    expect(run.frames.length).toBe(run.frameCount * 21 * 4);
    expect(run.frameCount).toBeGreaterThanOrEqual(Math.floor((run.seconds * 20) / FRAME_EVERY));
  });

  it('600 entities stay within budget (one battle well under real time)', () => {
    const big = (side: 'A' | 'B') =>
      army(side, [squad('eth', 'paladin.eth', 100), squad('link', 'archer.oracle', 100), squad('pepe', 'swarm.frog', 60), squad('wbtc', 'titan.bitcoin', 40)]);
    const t = performance.now();
    const run = simulateBattle([big('A'), big('B')], { seed: 'p', round: 1 });
    const ms = performance.now() - t;
    expect(run.entities.length).toBe(600);
    // 45 s of battle: generous for a loaded test machine
    expect(ms).toBeLessThan(15000);
  });
});

describe('the town as the battlefield', () => {
  const world = {
    wallets: 2,
    tier: 3,
    protocols: [
      { id: 'aave', name: 'Aave', category: 'lending', size: 3, tier: 3, iconUrl: null, signature: 'aave' },
      { id: 'uniswap', name: 'Uniswap', category: 'dex', size: 2, tier: 2, iconUrl: null, signature: 'uniswap' },
      { id: 'lido', name: 'Lido', category: 'staking', size: 4, tier: 4, iconUrl: null, signature: 'lido' },
    ],
  } as unknown as Parameters<typeof planCastle>[0];

  it('the enemy castle stands past the town, mirrored and facing it; its ground is cleared', () => {
    const plan = planCastle(world, {}, 2);
    const sp = siegePlan(plan);
    expect(sp.enemyMoat.z0).toBeGreaterThan(plan.town.z1);
    expect(sp.enemyKeep.z).toBeGreaterThan(sp.enemyMoat.z0);
    // the keep stands at the back, as at home: further from the town than the gate
    const gate = sp.enemy.find((p) => p.name === 'castle.gatehouse')!;
    expect(sp.enemyKeep.z).toBeGreaterThan(gate.z);
    expect((gate.rot ?? 0) % (2 * Math.PI)).toBeCloseTo(Math.PI, 6);
    const inside = plan.scenery.filter((p) => p.x > sp.enemyMoat.x0 && p.x < sp.enemyMoat.x1 && p.z > sp.enemyMoat.z0 && p.z < sp.enemyMoat.z1);
    for (const p of inside) expect(sp.cleared(p)).toBe(true);
  });

  it('three lanes from army to army, the centre round the bell tower, gates at both castles', () => {
    const sp = siegePlan(planCastle(world, {}, 2));
    const [left, centre, right] = sp.map.lanes;
    expect(centre.some((p) => p.x < 0)).toBe(true); // round the plaza
    expect(Math.min(...left.map((p) => p.x))).toBeLessThan(-8);
    expect(Math.max(...right.map((p) => p.x))).toBeGreaterThan(8);
    expect(sp.map.gates!.B.z).toBeGreaterThan(centre[centre.length - 1]!.z);
    expect(sp.map.gates!.A.z).toBeLessThan(centre[0]!.z);
    // a battle on it runs
    const run = simulateBattle([army('A', [squad('eth', 'paladin.eth', 10)]), army('B', [squad('eth', 'paladin.eth', 10)])], { seed: 't', round: 1, map: sp.map });
    expect(run.seconds).toBeGreaterThan(0);
  });
});

describe('rug pull', () => {
  it('a rugged token’s squad runs for home and leaves the field: it never fights and never survives', () => {
    const run = simulateBattle(
      [army('A', [squad('floki', 'swarm.goblin', 12), squad('eth', 'paladin.eth', 8)]), army('B', [squad('eth', 'paladin.eth', 8)])],
      { seed: 'rug', round: 2, flee: ['floki'] },
    );
    const goblins = run.entities.map((e, i) => ({ e, i })).filter(({ e }) => e.unit === 'swarm.goblin').map(({ i }) => i);
    expect(goblins.length).toBeGreaterThan(0);
    // none of them attacks; all of them leave
    expect(run.events.some((e) => e.t === 'attack' && goblins.includes(e.id))).toBe(false);
    for (const g of goblins) expect(run.events.some((e) => e.t === 'vanish' && e.id === g)).toBe(true);
    expect(run.survivors[0].some((s) => s.asset === 'floki')).toBe(false);
  });
});
