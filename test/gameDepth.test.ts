import { describe, expect, it } from 'vitest';
import { planCastle } from '../src/castle/scene/plan.js';
import { stackSquads } from '../src/game/core/army.js';
import { simulateBattle, straightMap, type CapturePoint } from '../src/game/core/battle.js';
import { Catalog, UNIT_TYPES } from '../src/game/core/catalog.js';
import { abilitiesOf, armyMods, relicId, relicOf } from '../src/game/core/depth.js';
import { q } from '../src/game/core/fixed.js';
import { holding, liquidate } from '../src/game/core/ledger.js';
import { Match, siegeDamage, wallVolley } from '../src/game/core/match.js';
import { BALANCE } from '../src/game/config/balance.js';
import type { Army, Portfolio, SideState, Squad } from '../src/game/core/types.js';
import { templatePortfolio } from '../src/game/data/templates.js';
import { siegePlan } from '../src/game/render/siegePlan.js';

const c = new Catalog();
const squad = (asset: string, unit: string, count: number): Squad => {
  const s: Squad = { asset, unit, count, stacks: [] };
  stackSquads([s]);
  return s;
};
const sideOf = (positions: Portfolio['positions'], nfts: Portfolio['nfts'] = []): SideState => ({
  id: 'A',
  portfolio: { positions, nfts, relics: [null, null, null] },
  keepHp: 100,
  keepHpMax: 100,
  buildingsOwned: [],
  isNpc: false,
  tradeDone: false,
  valueBeforeMarket: 0,
  liquidations: [],
  shutdownUsed: false,
  keepBonus: 0,
});

describe('protocol abilities', () => {
  it('positions grant their protocol’s ability', () => {
    const s = sideOf([
      { asset: 'steth', qty: q(1), kind: 'staked', protocol: 'staking' },
      { asset: 'steth', qty: q(1), kind: 'restaked', protocol: 'restaking' },
      { asset: 'eth', qty: q(1), kind: 'lp', protocol: 'dex', pairWith: 'usdc', pairQty: q(3000) },
      { asset: 'link', qty: q(10), kind: 'supplied', protocol: 'lending' },
    ]);
    expect(abilitiesOf(s).sort()).toEqual(['flash-loan', 'flash-swap', 'slashing-guard', 'validator-shield']);
    expect(abilitiesOf(sideOf([{ asset: 'eth', qty: q(1), kind: 'spot' }]))).toEqual([]);
  });

  it('Validator Shield casts at 10 s; a Flash Loan’s units join at 20 s and vanish at 28 s', () => {
    const mods = { hp: {}, stakedHp: 1, atk: 1, rangedRange: 0, siege: 0, earlySpeed: 1, abilities: ['validator-shield', 'flash-loan'] as const };
    const a: Army = { side: 'A', squads: [squad('eth', 'paladin.eth', 20)], atkMult: 1, mods: { ...mods, abilities: [...mods.abilities] } };
    // far apart lanes: no fighting, the battle runs its course
    const b: Army = { side: 'B', squads: [squad('ens', 'rider.name', 4)], atkMult: 1 };
    const run = simulateBattle([a, b], { seed: 'ab', round: 1, map: straightMap(400, 40) });
    const cast = run.events.filter((e) => e.t === 'side-ability');
    expect(cast.map((e) => (e.t === 'side-ability' ? [e.ability, e.tick] : null))).toEqual([
      ['validator-shield', 200],
      ['flash-loan', 400],
    ]);
    const reserves = run.entities.map((e, i) => ({ e, i })).filter(({ e, i }) => e.side === 'A' && i >= 20);
    expect(reserves.length).toBe(10);
    const n = run.entities.length;
    const hpAt = (frame: number, i: number) => run.frames[(frame * n + i) * 4 + 2]!;
    const i = reserves[0]!.i;
    expect(hpAt(50, i)).toBe(-1); // 10 s: not on the field
    expect(hpAt(220, i)).toBeGreaterThan(0); // 22 s: fighting
    expect(run.events.some((e) => e.t === 'vanish' && e.id === i && e.tick === 560)).toBe(true);
    // borrowed units never count as survivors
    expect(run.survivors[0].reduce((s, x) => s + x.count, 0)).toBeLessThanOrEqual(20);
  });
});

describe('battlefield buildings', () => {
  const point: CapturePoint = { id: 'bank', kind: 'bank', x: 0, z: 30, lane: 1 };

  it('five units holding it uncontested for 4 s take it (2 s at home); it stays theirs', () => {
    const play = (home: string[]) =>
      simulateBattle([{ side: 'A', squads: [squad('eth', 'knight', 8)], atkMult: 1 }, { side: 'B', squads: [squad('ens', 'rider.name', 2)], atkMult: 1 }], {
        seed: 'cap',
        round: 1,
        map: straightMap(60, 30, [point]),
        home: { A: home, B: [] },
      });
    const run = play([]);
    const start = run.events.find((e) => e.t === 'capturing')!;
    const done = run.events.find((e) => e.t === 'capture')!;
    expect(done && done.t === 'capture' && done.side).toBe('A');
    expect((done.tick - start.tick) / 20).toBeCloseTo(4, 0);
    expect(run.owners.bank).toBe('A');
    const fast = play(['bank']);
    const s2 = fast.events.find((e) => e.t === 'capturing')!;
    const d2 = fast.events.find((e) => e.t === 'capture')!;
    expect((d2.tick - s2.tick) / 20).toBeCloseTo(2, 0);
  });

  it('the town gives the battle 3–5 buildings: the bell tower as the Oracle Tower, then one of each kind', () => {
    const world = {
      wallets: 1,
      tier: 3,
      protocols: [
        { id: 'aave', name: 'Aave', category: 'lending', size: 3, tier: 3, iconUrl: null, signature: 'aave' },
        { id: 'uniswap', name: 'Uniswap', category: 'dex', size: 2, tier: 2, iconUrl: null, signature: 'uniswap' },
        { id: 'lido', name: 'Lido', category: 'staking', size: 3, tier: 3, iconUrl: null, signature: 'lido' },
        { id: 'maker', name: 'Maker', category: 'lending', size: 3, tier: 3, iconUrl: null, signature: 'maker' },
        { id: 'compound', name: 'Compound', category: 'lending', size: 2, tier: 2, iconUrl: null, signature: 'compound' },
      ],
    } as unknown as Parameters<typeof planCastle>[0];
    const points = siegePlan(planCastle(world, {}, 2)).map.points!;
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.length).toBeLessThanOrEqual(5);
    expect(points.map((p) => p.kind).sort()).toEqual(['bank', 'exchange', 'oracle', 'temple', 'vault']);
  });
});

describe('relics', () => {
  it('a tier from the floor against UNIT_VALUE; effects scale with it', () => {
    expect(relicOf('sim:punks', 50, 100).tier).toBe('common');
    expect(relicOf('sim:punks', 300, 100).tier).toBe('rare');
    expect(relicOf('sim:punks', 1000, 100).tier).toBe('epic');
    expect(relicOf('sim:punks', 5000, 100)).toMatchObject({ tier: 'legendary', effect: 'siege', amount: 3 });
  });

  it('any other collection gets a generic relic, always the same', () => {
    const id = '0x1234567890abcdef1234567890abcdef12345678';
    expect(relicId(id)).toBe(relicId(id));
    expect(relicId(id.toUpperCase())).toBe(relicId(id));
    expect(['bull-banner', 'bear-pelt', 'masons-seal', 'gas-rebate', 'liquidators-eye', 'war-drum']).toContain(relicId(id));
  });

  it('relic effects: Siege for every unit, Bull ATK only in a Bull market, Swarm HP', () => {
    const s = sideOf([]);
    const mods = (effect: string, regime: 'bull' | 'bear' | 'crab') =>
      armyMods(s, [{ id: 'x', name: 'x', effect: effect as never, tier: 'common', tierName: 'Common', mult: 1, amount: 0.2, text: '' }], regime);
    expect(mods('bull-atk', 'bull').atk).toBeCloseTo(1.2, 9);
    expect(mods('bull-atk', 'bear').atk).toBe(1);
    expect(mods('swarm-hp', 'crab').hp.swarm).toBeCloseTo(1.2, 9);
    const squads = [squad('eth', 'paladin.eth', 10)];
    expect(siegeDamage(squads, 1)).toBeCloseTo(siegeDamage(squads) * 1.5, 9);
  });

  it('a Liquidator’s Eye takes points off the liquidation penalty', () => {
    const s = () =>
      sideOf([
        { asset: 'eth', qty: q(10), kind: 'supplied', protocol: 'lending' },
        { asset: 'usdc', qty: q(20000), kind: 'borrowed', protocol: 'lending' },
      ]);
    const crash = { ...Object.fromEntries(c.assets.map((a) => [a.id, a.price])), eth: 2400 };
    const plain = liquidate(s(), 1, 0, { catalog: c, prices: crash });
    const eyed = liquidate(s(), 1, 0, { catalog: c, prices: crash }, 0.02);
    expect(eyed[0]!.seized[0]!.value).toBeLessThan(plain[0]!.seized[0]!.value);
    expect(eyed[0]!.seized[0]!.value).toBeCloseTo(10000 * 1.08, 1);
  });
});

describe('the match’s depth', () => {
  it('a Gas Rebate relic cuts gas; slotting one costs gas', () => {
    const p = templatePortfolio('balanced', 20000, c);
    // a collection whose generic relic is the Gas Rebate
    let gasNft = '';
    for (let i = 0; i < 500 && !gasNft; i++) if (relicId(`sim:test-${i}`) === 'gas-rebate') gasNft = `sim:test-${i}`;
    p.nfts.push({ collection: gasNft, floor: 100 });
    const m = new Match({ seed: 'gas', portfolios: [p, templatePortfolio('whale', 20000, c)] });
    const eth = () => holding(m.side('A'), 'eth');
    const before = eth();
    m.command('A', { t: 'swap', from: 'link', to: 'usdc', qty: q(1) });
    const fullGas = before - eth();
    m.command('A', { t: 'slotRelic', nft: gasNft, slot: 0 });
    const mid = eth();
    m.command('A', { t: 'swap', from: 'link', to: 'usdc', qty: q(1) });
    expect(Number(mid - eth())).toBeCloseTo(Number(fullGas) * 0.75, -2);
  });

  it('Emergency Shutdown: a keep under 25% with a vault takes no siege damage, once', () => {
    const p = templatePortfolio('balanced', 20000, c);
    p.positions.push({ asset: 'eth', qty: q(1), kind: 'supplied', protocol: 'vault' });
    const m = new Match({ seed: 'shut', portfolios: [p, templatePortfolio('degen', 30000, c)] });
    const a = m.side('A');
    a.keepHp = a.keepHpMax * 0.2;
    m.advance(); // battle
    const hp = a.keepHp;
    m.advance(); // siege
    const enemyDealt = m.state.lastBattle!.survivors[1].length > 0;
    if (enemyDealt) {
      expect(m.state.shutdowns).toContain('A');
      expect(a.keepHp).toBe(hp);
      expect(a.shutdownUsed).toBe(true);
    }
  });

  it('owning a Vault raises the keep’s max at the round’s end', () => {
    const map = straightMap(60, 10, [{ id: 'vault', kind: 'vault', x: 0, z: 20, lane: 1 }]);
    const m = new Match({ seed: 'vault', portfolios: [templatePortfolio('whale', 20000, c), templatePortfolio('stable-maxi', 2000, c)], map });
    const max = m.side('A').keepHpMax;
    m.advance();
    m.advance();
    if (m.state.buildings[0]!.owner === 'A') expect(m.side('A').keepHpMax).toBeCloseTo(max * 1.05, 6);
    else expect(m.side('A').keepBonus).toBe(0);
  });
});

describe('walls shoot back', () => {
  it('the walls’ archers fell the most fragile attackers first, within their volley', () => {
    const attackers: Squad[] = [squad('eth', 'paladin.eth', 10), squad('pepe', 'swarm.frog', 10)];
    // 5 UNIT_VALUEs of stables: 5 × wallVolley HP of arrows
    const budget = 5 * BALANCE.keep.wallVolley;
    const { left, felled } = wallVolley(attackers, 5);
    const frogs = left.find((q) => q.asset === 'pepe')?.count ?? 0;
    expect(felled).toBe(Math.min(10, Math.floor(budget / UNIT_TYPES['swarm.frog']!.hp)));
    expect(frogs).toBe(10 - felled);
    expect(left.find((q) => q.asset === 'eth')!.count).toBe(10);
  });

  it('never more than the cap: even a keep of nothing but walls is always hit', () => {
    const attackers: Squad[] = [squad('eth', 'knight', 20)];
    const { left, felled } = wallVolley(attackers, 1e6);
    expect(felled).toBe(Math.floor(20 * BALANCE.keep.wallMaxShare));
    expect(left[0]!.count).toBe(20 - felled);
    expect(wallVolley(attackers, 0).felled).toBe(0);
  });
});
