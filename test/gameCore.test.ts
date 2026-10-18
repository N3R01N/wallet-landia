import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/game/config/balance.js';
import { buildArmy, stackSquads, unitCount, unitValueFor } from '../src/game/core/army.js';
import { Catalog, UNIT_TYPES } from '../src/game/core/catalog.js';
import { dexp, dlog, dpow, normal, streamOf } from '../src/game/core/detmath.js';
import { q, qn } from '../src/game/core/fixed.js';
import { account, applyCommand, holding, liquidate, netValue, rebalancePools, refreshKeep, swapCostRate, type LedgerCtx } from '../src/game/core/ledger.js';
import { drawNext, EVENT_IDS, initialMarket, rumorFor, runMarket } from '../src/game/core/market.js';
import { Match, replay, serialize, siegeDamage } from '../src/game/core/match.js';
import type { Portfolio, SideState, Squad } from '../src/game/core/types.js';
import { templatePortfolio } from '../src/game/data/templates.js';

const catalog = new Catalog();
const prices = initialMarket(catalog, []).prices;

function side(positions: Portfolio['positions'], id: 'A' | 'B' = 'A'): SideState {
  return {
    id,
    portfolio: { positions, nfts: [], relics: [null, null, null] },
    keepHp: 0,
    keepHpMax: 0,
    buildingsOwned: [],
    isNpc: false,
    tradeDone: false,
    valueBeforeMarket: 0,
    liquidations: [],
    shutdownUsed: false,
    keepBonus: 0,
  };
}

const ctx = (unitValue = 100, over: Partial<LedgerCtx> = {}): LedgerCtx => ({ catalog, prices, unitValue, round: 1, gasMult: 1, ...over });

describe('deterministic maths', () => {
  it('dexp, dlog and dpow agree with Math to 1e-12 (relative)', () => {
    for (const x of [-20, -3.3, -0.5, -1e-6, 0, 1e-6, 0.1, 0.69, 1, 2.5, 10, 50]) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12);
    for (const x of [1e-9, 0.01, 0.5, 0.999, 1, 1.0001, 2, 3.7, 1000, 1e9]) expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(1e-12);
    expect(dpow(0.65, 1 / 7)).toBeCloseTo(0.65 ** (1 / 7), 12);
  });

  it('the normal draw has mean 0 and variance 1', () => {
    const rng = streamOf('seed', 'test');
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = normal(rng);
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });

  it('fixed-point quantities round-trip', () => {
    expect(q(1.5)).toBe(1_500_000_000n);
    expect(qn(q(123456.789))).toBeCloseTo(123456.789, 9);
    expect(q(-1)).toBe(0n);
  });
});

describe('ArmyBuilder', () => {
  it('count = floor(value / (UNIT_VALUE × costMult)), with dust making no units', () => {
    // ETH Paladin costMult 2: $1,000 at UNIT_VALUE 100 → 5 units; PEPE frogs (costMult from units.json): $130 → 2 units at 0.6
    const s = side([
      { asset: 'eth', qty: q(1000 / 3000), kind: 'spot' },
      { asset: 'pepe', qty: q(130 / prices.pepe!), kind: 'spot' },
      // $20 of LINK: under the dust line of 0.25 × 100
      { asset: 'link', qty: q(20 / prices.link!), kind: 'spot' },
      { asset: 'usdc', qty: q(5000), kind: 'spot' },
    ]);
    const army = buildArmy(s, { catalog, prices, unitValue: 100 });
    const by = Object.fromEntries(army.squads.map((x) => [x.asset, x.count]));
    expect(by).toEqual({ eth: 5, pepe: 2 });
    // stables make no units
    expect(army.squads.find((x) => x.asset === 'usdc')).toBeUndefined();
  });

  it('staked ETH fields Staked Paladins, a pool fields both of its tokens', () => {
    const s = side([
      { asset: 'steth', qty: q(1), kind: 'staked', protocol: 'staking' },
      { asset: 'link', qty: q(100), kind: 'lp', protocol: 'dex', pairWith: 'uni', pairQty: q(150) },
    ]);
    const army = buildArmy(s, { catalog, prices, unitValue: 100 });
    expect(army.squads.map((x) => x.unit).sort()).toEqual(['archer.oracle', 'mage.swap', 'paladin.staked']);
  });

  it('UNIT_VALUE: the larger starting army ÷ 120, stables and NFTs left out', () => {
    const a = side([{ asset: 'eth', qty: q(10), kind: 'spot' }, { asset: 'usdc', qty: q(1e6), kind: 'spot' }]);
    const b = side([{ asset: 'eth', qty: q(4), kind: 'spot' }], 'B');
    expect(unitValueFor([a, b], catalog, prices)).toBeCloseTo(30000 / 120, 6);
  });

  it('above 300 units a side merges into equal stacks and stays under the cap', () => {
    const squads: Squad[] = [
      { asset: 'pepe', unit: 'swarm.frog', count: 500, stacks: [] },
      { asset: 'eth', unit: 'paladin.eth', count: 101, stacks: [] },
      { asset: 'wbtc', unit: 'titan.bitcoin', count: 7, stacks: [] },
    ];
    stackSquads(squads);
    for (const s of squads) expect(s.stacks.reduce((a, b) => a + b, 0)).toBe(s.count);
    const entities = squads.reduce((n, s) => n + s.stacks.length, 0);
    expect(entities).toBeLessThanOrEqual(BALANCE.match.renderCap);
    expect(squads[0]!.stacks[0]).toBeGreaterThan(1);
    // under the cap every unit is its own entity
    const small: Squad[] = [{ asset: 'eth', unit: 'paladin.eth', count: 40, stacks: [] }];
    stackSquads(small);
    expect(small[0]!.stacks).toEqual(Array(40).fill(1));
  });
});

describe('keep HP and the walls', () => {
  it('swapping into stables raises max and current HP alike; out of stables lowers the max and clamps', () => {
    const s = side([
      { asset: 'eth', qty: q(10), kind: 'spot' },
      { asset: 'usdc', qty: q(1000), kind: 'spot' },
    ]);
    const c = ctx(100);
    refreshKeep(s, c);
    s.keepHp = s.keepHpMax;
    // 100 + 2 × 1000/100
    expect(s.keepHpMax).toBeCloseTo(120, 6);
    s.keepHp = 90; // damage taken stays taken
    expect(applyCommand(s, { t: 'swap', from: 'eth', to: 'usdc', qty: q(1) }, c).ok).toBe(true);
    const gained = s.keepHpMax - 120;
    expect(gained).toBeGreaterThan(50); // ~$2,900 of new walls after fees and gas
    expect(s.keepHp).toBeCloseTo(90 + gained, 6);
    // out of stables: the max drops, the current is clamped to it
    expect(applyCommand(s, { t: 'swap', from: 'usdc', to: 'eth', qty: holding(s, 'usdc') }, c).ok).toBe(true);
    expect(s.keepHpMax).toBeLessThan(101);
    expect(s.keepHp).toBeLessThanOrEqual(s.keepHpMax);
  });
});

describe('Ledger', () => {
  it('a swap pays the fee, size slippage and gas in ETH', () => {
    const s = side([{ asset: 'eth', qty: q(10), kind: 'spot' }]);
    const c = ctx(100);
    applyCommand(s, { t: 'swap', from: 'eth', to: 'usdc', qty: q(1) }, c);
    // $3,000 is 30 UNIT_VALUEs: 0.3% fee + 1.5% slippage
    expect(swapCostRate(3000, 100)).toBeCloseTo(0.018, 9);
    expect(qn(holding(s, 'usdc'))).toBeCloseTo(3000 * (1 - 0.018), 6);
    // gas: 0.1 × 100 = $10 of ETH
    expect(qn(holding(s, 'eth'))).toBeCloseTo(9 - 10 / 3000, 9);
  });

  it('gas falls back to stables, and a command without gas is refused and changes nothing', () => {
    const s = side([{ asset: 'usdc', qty: q(100), kind: 'spot' }, { asset: 'link', qty: q(10), kind: 'spot' }]);
    expect(applyCommand(s, { t: 'swap', from: 'link', to: 'uni', qty: q(1) }, ctx(100)).ok).toBe(true);
    expect(qn(holding(s, 'usdc'))).toBeCloseTo(90, 6);
    const broke = side([{ asset: 'link', qty: q(10), kind: 'spot' }]);
    const before = structuredClone(broke);
    const r = applyCommand(broke, { t: 'swap', from: 'link', to: 'uni', qty: q(1) }, ctx(100));
    expect(r.ok).toBe(false);
    expect(broke).toEqual(before);
  });

  it('borrowing: collateral first, up to 70% LTV, no memecoin collateral, vaults mint stables only', () => {
    const s = side([{ asset: 'eth', qty: q(11), kind: 'spot' }, { asset: 'pepe', qty: q(1e9), kind: 'spot' }]);
    const c = ctx(100);
    expect(applyCommand(s, { t: 'borrow', asset: 'usdc', qty: q(100) }, c).ok).toBe(false);
    expect(applyCommand(s, { t: 'supply', asset: 'eth', qty: q(10) }, c).ok).toBe(true);
    expect(applyCommand(s, { t: 'borrow', asset: 'usdc', qty: q(21001) }, c).ok).toBe(false);
    expect(applyCommand(s, { t: 'borrow', asset: 'usdc', qty: q(20000) }, c).ok).toBe(true);
    expect(account(s, 'lending', c).hf).toBeCloseTo((30000 * 0.8) / 20000, 6);
    expect(applyCommand(s, { t: 'supply', asset: 'pepe', qty: q(1e8), via: 'vault' }, c).ok).toBe(false);
    // memecoins supplied to lending add no borrowing power
    expect(applyCommand(s, { t: 'supply', asset: 'pepe', qty: q(1e8) }, c).ok).toBe(true);
    expect(account(s, 'lending', c).collateral).toBeCloseTo(30000, 6);
    expect(applyCommand(s, { t: 'borrow', asset: 'link', qty: q(1), via: 'vault' }, c).ok).toBe(false);
  });

  it('unstaking takes a round: the stETH is ETH again at the next Market phase', () => {
    const m = new Match({ seed: 'unstake', portfolios: [templatePortfolio('stable-maxi', 10000, catalog), templatePortfolio('whale', 10000, catalog)] });
    const staked = holding(m.side('A'), 'steth', 'staked', 'staking');
    expect(m.command('A', { t: 'unstake', asset: 'steth', qty: staked }).ok).toBe(true);
    expect(holding(m.side('A'), 'eth')).toBe(0n);
    m.advance(); // battle
    m.advance(); // siege
    m.advance(); // round 2's market
    expect(m.state.round).toBe(2);
    expect(holding(m.side('A'), 'eth')).toBeGreaterThan(0n);
    expect(m.side('A').portfolio.positions.some((p) => p.asset === 'steth')).toBe(false);
  });

  it('pool impermanent loss matches the constant-product formula', () => {
    const s = side([{ asset: 'eth', qty: q(10), kind: 'lp', protocol: 'dex', pairWith: 'usdc', pairQty: q(30000) }]);
    for (const r of [0.25, 0.5, 2, 4]) {
      const p = { ...prices, eth: 3000 * r };
      const pool = structuredClone(s);
      rebalancePools(pool, p);
      const held = 10 * 3000 * r + 30000;
      expect(netValue(pool, p) / held).toBeCloseTo((2 * Math.sqrt(r)) / (1 + r), 6);
    }
  });

  it('a liquidation repays half the debt by seizing collateral plus 10%, until HF is back above 1', () => {
    const s = side([
      { asset: 'eth', qty: q(10), kind: 'supplied', protocol: 'lending' },
      { asset: 'usdc', qty: q(20000), kind: 'borrowed', protocol: 'lending' },
    ]);
    const crash = { ...prices, eth: 2400 }; // HF = 24000 × 0.8 / 20000 = 0.96
    const liqs = liquidate(s, 3, 2, { catalog, prices: crash });
    expect(liqs).toHaveLength(1);
    expect(liqs[0]!.repaid).toBeCloseTo(10000, 6);
    expect(liqs[0]!.seized[0]!.value).toBeCloseTo(11000, 3);
    expect(account(s, 'lending', { catalog, prices: crash }).hf).toBeGreaterThanOrEqual(1);
    expect(s.liquidations).toHaveLength(1);
  });
});

describe('Market', () => {
  it('the same seed gives the same week, another seed another', () => {
    const run = (seed: string) => {
      const m = initialMarket(catalog, [{ collection: 'punks', floor: 100000 }]);
      runMarket(m, seed, 2, catalog, () => {});
      return JSON.stringify(m);
    };
    expect(run('s1')).toBe(run('s1'));
    expect(run('s1')).not.toBe(run('s2'));
  });

  it('stablecoins stay at 1.00 without a depeg; seven candles per week', () => {
    const m = initialMarket(catalog, []);
    let days = 0;
    runMarket(m, 'calm', 2, catalog, () => days++);
    expect(days).toBe(7);
    for (const id of catalog.stables()) expect(m.prices[id]).toBe(1);
  });

  it('a depeg drops one stablecoin to 0.85, and half the gap closes each round after', () => {
    const m = initialMarket(catalog, []);
    m.next = { id: 'depeg', target: 'usdc' };
    runMarket(m, 'd', 2, catalog, () => {});
    expect(m.prices.usdc).toBeCloseTo(0.85, 9);
    runMarket(m, 'd', 3, catalog, () => {});
    expect(m.prices.usdc).toBeCloseTo(0.925, 9);
  });

  it('meme mania lifts memecoins, then they fall the week after', () => {
    const m = initialMarket(catalog, []);
    m.next = { id: 'meme-mania' };
    const before = m.prices.pepe!;
    runMarket(m, 'm', 2, catalog, () => {});
    expect(m.aftermath.some((a) => a.id === 'meme-fall')).toBe(true);
    expect(m.prices.pepe! / before).toBeGreaterThan(1);
    runMarket(m, 'm', 3, catalog, () => {});
    expect(m.aftermath.some((a) => a.id === 'meme-fall')).toBe(false);
  });

  it('a liquidation can trigger on a candle in the middle of the week', () => {
    const s = side([
      { asset: 'eth', qty: q(10), kind: 'supplied', protocol: 'lending' },
      { asset: 'usdc', qty: q(20900), kind: 'borrowed', protocol: 'lending' },
    ]);
    const m = initialMarket(catalog, []);
    m.next = { id: 'black-swan', size: 0.35 };
    runMarket(m, 'swan', 2, catalog, (candle) => liquidate(s, 2, candle.day, { catalog, prices: candle.close }));
    expect(s.liquidations.length).toBeGreaterThan(0);
    expect(s.liquidations[0]!.day).toBeLessThan(6);
  });

  it('the rumor tells the truth about 70% of the time over 10,000 draws', () => {
    const rng = streamOf('rumors', 'test');
    let right = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const truth = i % 3 === 0 ? null : EVENT_IDS[i % EVENT_IDS.length]!;
      if (rumorFor(rng, truth) === truth) right++;
    }
    expect(right / n).toBeGreaterThan(0.68);
    expect(right / n).toBeLessThan(0.72);
  });

  it('about 40% of Market phases have an event', () => {
    let events = 0;
    for (let r = 0; r < 4000; r++) if (drawNext('chance', r, catalog, { held: new Set() }).next) events++;
    expect(events / 4000).toBeGreaterThan(0.37);
    expect(events / 4000).toBeLessThan(0.43);
  });
});

describe('MatchController', () => {
  const setup = (seed: string) => ({
    seed,
    portfolios: [templatePortfolio('balanced', 50000, catalog), templatePortfolio('degen', 40000, catalog)] as const,
  });
  /** A few trades per round, the same each time. */
  const trades = (m: Match) => {
    if (m.state.round === 1) {
      m.command('A', { t: 'supply', asset: 'eth', qty: q(2) });
      m.command('A', { t: 'borrow', asset: 'usdc', qty: q(3000) });
    }
    if (m.state.round === 3) m.command('B', { t: 'swap', from: 'pepe', to: 'usdc', qty: holding(m.side('B'), 'pepe') / 2n });
    m.command('A', { t: 'endTrade' });
    m.command('B', { t: 'endTrade' });
  };

  it('a match opens on round 1 trading at known prices, and plays out to a winner within 8 rounds', () => {
    const m = new Match(setup('full'));
    expect(m.state.round).toBe(1);
    expect(m.state.phase).toBe('trade');
    expect(m.state.market.candles).toEqual([]);
    const end = m.playOut(trades);
    expect(end.phase).toBe('ended');
    expect(end.winner).not.toBeNull();
    expect(end.round).toBeLessThanOrEqual(BALANCE.match.rounds + 1);
  }, 60_000);

  it('7 rounds complete headlessly over many seeds', () => {
    for (let i = 0; i < 6; i++) {
      const m = new Match(setup(`seed-${i}`));
      expect(m.playOut(trades).phase).toBe('ended');
    }
  }, 60_000);

  it('the same seed and commands give byte-identical state; the replay rebuilds it', () => {
    const a = new Match(setup('det'));
    a.playOut(trades);
    const b = new Match(setup('det'));
    b.playOut(trades);
    expect(serialize(b.state)).toBe(serialize(a.state));
    const again = replay(a.replay());
    expect(serialize(again.state)).toBe(serialize(a.state));
    const other = new Match(setup('other'));
    other.playOut(trades);
    expect(serialize(other.state)).not.toBe(serialize(a.state));
  }, 60_000);

  it('phases run market → trade → battle → siege, and trading is refused outside the trade phase', () => {
    const m = new Match(setup('phases'));
    const seen: string[] = [m.state.phase];
    for (let i = 0; i < 7; i++) {
      m.advance();
      seen.push(m.state.phase);
    }
    expect(seen).toEqual(['trade', 'battle', 'siege', 'market', 'trade', 'battle', 'siege', 'market']);
    expect(m.command('A', { t: 'swap', from: 'eth', to: 'usdc', qty: q(0.1) }).ok).toBe(false);
  });

  it('Momentum goes to the side with the better week', () => {
    const m = new Match(setup('momentum'));
    m.advance();
    m.advance();
    m.advance(); // round 2's market
    const change = m.state.sides.map((s) => (netValue(s, m.state.market.prices) - s.valueBeforeMarket) / s.valueBeforeMarket);
    const expected = change[0]! > change[1]! ? 'A' : change[1]! > change[0]! ? 'B' : null;
    expect(m.state.momentum).toBe(expected);
  });

  it("siege damage: survivors’ Siege values, more for Siege units", () => {
    const d = siegeDamage([
      { asset: 'eth', unit: 'paladin.eth', count: 10, stacks: [] },
      { asset: 'wbtc', unit: 'titan.bitcoin', count: 2, stacks: [] },
    ]);
    expect(d).toBeCloseTo((10 * 2 + 2 * 6 * BALANCE.keep.siegeRoleMult) * BALANCE.keep.siegeScale, 9);
  });

  it('starting armies: the bigger side fields about 120 units’ worth (cheap units count for less)', () => {
    const m = new Match(setup('size'));
    m.advance(); // battle
    const worth = m.armies!.map((a) => a.squads.reduce((s, x) => s + x.count * UNIT_TYPES[x.unit]!.costMult, 0));
    expect(Math.max(...worth)).toBeGreaterThan(110);
    expect(Math.max(...worth)).toBeLessThanOrEqual(120);
    expect(unitCount(m.armies![1])).toBeGreaterThan(unitCount(m.armies![0])); // the degen's frogs and dogs are many
  });
});

describe('price providers', () => {
  it('a historical replay plays real closes a week a round, through the same match', async () => {
    const { Match: M } = await import('../src/game/core/match.js');
    const closes = { eth: [2000, 2010, 2020, 1900, 1800, 1700, 1600, 1500, 1550, 1600] };
    const m = new M({ seed: 'hist', portfolios: [templatePortfolio('whale', 20000, catalog), templatePortfolio('degen', 20000, catalog)], prices: { kind: 'historical', closes } });
    expect(m.state.market.prices.eth).toBe(2000);
    m.advance();
    m.advance();
    m.advance(); // round 2's market: days 1–7
    expect(m.state.market.candles.map((c) => c.close.eth)).toEqual([2010, 2020, 1900, 1800, 1700, 1600, 1500]);
    // assets the history doesn't cover hold their opening price
    expect(m.state.market.prices.wbtc).toBe(catalog.asset('wbtc').price);
  });

  it('the simulated provider is the default and gives the same match as before', () => {
    const a = new Match({ seed: 'prov', portfolios: [templatePortfolio('whale', 20000, catalog), templatePortfolio('degen', 20000, catalog)] });
    const b = new Match({ seed: 'prov', portfolios: [templatePortfolio('whale', 20000, catalog), templatePortfolio('degen', 20000, catalog)], prices: { kind: 'sim' } });
    for (let i = 0; i < 3; i++) {
      a.advance();
      b.advance();
    }
    expect(serialize(b.state)).toBe(serialize(a.state));
  });
});

describe('the match history (the recap)', () => {
  it('a line at the start and after every Siege phase: values, keeps, events, liquidations', () => {
    const m = new Match({ seed: 'hist-rec', portfolios: [templatePortfolio('balanced', 20000, catalog), templatePortfolio('degen', 20000, catalog)] });
    m.playOut();
    const h = m.state.history;
    expect(h[0]).toMatchObject({ round: 0, keep: [1, 1], event: null, liquidations: [0, 0] });
    expect(h.map((r) => r.round)).toEqual(Array.from({ length: m.state.round + 1 }, (_, i) => i));
    const last = h[h.length - 1]!;
    expect(last.keep.some((k) => k <= 0) || m.state.suddenDeath).toBe(true);
    expect(h.reduce((n, r) => n + r.liquidations[0] + r.liquidations[1], 0)).toBe(m.liquidationCount);
  }, 60_000);
});
