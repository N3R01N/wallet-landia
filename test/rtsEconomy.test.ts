import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES, type BuildingKind } from '../src/rts/data/rules.js';
import { bankAccount, ECON, incomePerMinute } from '../src/rts/core/economy.js';
import { World } from '../src/rts/core/world.js';

const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * RULES.tickHz); i++) w.step();
};

/** Builds and places a building for A beside its hall (the first free spot). */
export function addBuilding(w: World, kind: BuildingKind): void {
  expect(w.command('A', { t: 'build', kind })).toEqual({ ok: true });
  run(w, BUILDINGS[kind].time + 0.1);
  const hall = w.hallOf('A')!;
  for (let r = 7; r < 20; r++) {
    for (let a = 0; a < 16; a++) {
      const x = hall.x + Math.cos((a / 16) * Math.PI * 2) * r;
      const z = hall.z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (w.command('A', { t: 'place', x, z }).ok) return;
    }
  }
  throw new Error(`no room for ${kind}`);
}

/** Holds the market still (no price moves) for exact sums. */
function still(w: World): void {
  w.still = true;
}

describe('the economy', () => {
  it('swapping needs an Exchange; a swap pays its fee', () => {
    const w = new World({ seed: 'econ', kits: { A: 'usdc', B: 'usdc' } });
    expect(w.command('A', { t: 'swap', from: 'usdc', to: 'eth', qty: 1000 })).toEqual({ ok: false, reason: 'needs an Exchange' });
    addBuilding(w, 'exchange');
    const before = w.usd('A', 'usdc');
    expect(w.command('A', { t: 'swap', from: 'usdc', to: 'eth', qty: 1000 }).ok).toBe(true);
    expect(w.usd('A', 'usdc')).toBeCloseTo(before - 1000, 6);
    const got = w.usd('A', 'eth');
    expect(got).toBeLessThan(1000);
    expect(got).toBeGreaterThan(1000 * (1 - ECON.swapFee - 0.002));
  });

  it('staked ETH grows; spot tokens earn nothing; a destroyed Staking House freezes it', () => {
    const w = new World({ seed: 'econ', kits: { A: 'eth', B: 'eth' } });
    addBuilding(w, 'staking');
    const eth = w.players.A.tokens.eth;
    expect(w.command('A', { t: 'stake', qty: eth / 2 }).ok).toBe(true);
    const pos = w.players.A.positions[0]!;
    expect(pos.kind).toBe('staked');
    const q0 = pos.qty;
    run(w, 60);
    expect(pos.qty / q0).toBeCloseTo(1 + ECON.perMinute.staked, 2);
    expect(w.players.A.tokens.eth).toBeCloseTo(eth / 2, 9);
    expect(incomePerMinute(w.econ, 'A')).toBeGreaterThan(0);
    // the building falls: frozen, nothing earned, nothing taken out
    const house = w.buildings.find((b) => b.kind === 'staking')!;
    house.hp = 0;
    const q1 = pos.qty;
    run(w, 30);
    expect(pos.qty).toBe(q1);
    expect(w.command('A', { t: 'unstake', id: pos.id }).reason).toContain('frozen');
    expect(incomePerMinute(w.econ, 'A')).toBe(0);
  });

  it('a pool follows the prices (constant product) and earns fees', () => {
    const w = new World({ seed: 'econ', kits: { A: 'mix', B: 'mix' } });
    addBuilding(w, 'exchange');
    const eth = w.players.A.tokens.eth / 2;
    expect(w.command('A', { t: 'lpAdd', a: 'eth', b: 'usdc', qty: eth }).ok).toBe(true);
    const pos = w.players.A.positions.find((x) => x.kind === 'lp')!;
    expect(pos.pairQty! * w.market.prices.usdc).toBeCloseTo(pos.qty * w.market.prices.eth, 6);
    run(w, 60);
    // still half and half in value after the prices moved
    expect(pos.pairQty! * w.market.prices.usdc).toBeCloseTo(pos.qty * w.market.prices.eth, 3);
    expect(w.command('A', { t: 'lpRemove', id: pos.id }).ok).toBe(true);
    expect(w.players.A.positions.some((x) => x.kind === 'lp')).toBe(false);
  });

  it('borrowing: up to the limit against collateral; a crash liquidates with a penalty', () => {
    const w = new World({ seed: 'econ', kits: { A: 'eth', B: 'eth' } });
    addBuilding(w, 'bank');
    still(w);
    const eth = w.players.A.tokens.eth;
    expect(w.command('A', { t: 'borrow', token: 'usdc', qty: 100 }).reason).toBe('supply collateral first');
    expect(w.command('A', { t: 'supply', token: 'eth', qty: eth }).ok).toBe(true);
    const room = bankAccount(w.econ, 'A').room;
    expect(room).toBeCloseTo(eth * w.market.prices.eth * ECON.ltv, 0);
    expect(w.command('A', { t: 'borrow', token: 'usdc', qty: room + 10 }).ok).toBe(false);
    expect(w.command('A', { t: 'borrow', token: 'usdc', qty: room }).ok).toBe(true);
    expect(w.players.A.tokens.usdc).toBeCloseTo(room, 6);
    // ETH falls a third: under health 1
    w.market.prices.eth *= 2 / 3;
    const before = bankAccount(w.econ, 'A');
    expect(before.health).toBeLessThan(1);
    run(w, 1.05);
    const after = bankAccount(w.econ, 'A');
    expect(after.debt).toBeLessThan(before.debt);
    expect(after.collateral).toBeLessThan(before.collateral);
  });

  it('the vault mints DAI against ETH, up to its limit, and closes against the DAI', () => {
    const w = new World({ seed: 'econ', kits: { A: 'eth', B: 'eth' } });
    const hall = w.hallOf('A')!;
    w.command('A', { t: 'upgrade', id: hall.id });
    run(w, BUILDINGS.hall.upgradeTime + 0.1);
    addBuilding(w, 'bank');
    addBuilding(w, 'vault');
    still(w);
    expect(w.command('A', { t: 'vaultOpen', eth: 1, dai: w.market.prices.eth * ECON.vaultLtv + 1 }).ok).toBe(false);
    expect(w.command('A', { t: 'vaultOpen', eth: 1, dai: 1500 }).ok).toBe(true);
    expect(w.players.A.tokens.dai).toBe(1500);
    const v = w.players.A.positions.find((x) => x.kind === 'vault')!;
    run(w, 10);
    expect(v.debt).toBeGreaterThan(1500);
    expect(w.command('A', { t: 'vaultClose', id: v.id }).reason).toContain('DAI to close');
  });
});
