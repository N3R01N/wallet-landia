import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/game/core/catalog.js';
import { q, qn } from '../src/game/core/fixed.js';
import { holding } from '../src/game/core/ledger.js';
import { available, Match, previewCommand } from '../src/game/core/match.js';
import { templatePortfolio } from '../src/game/data/templates.js';
import { buildingFor, tradeErrand } from '../src/game/render/tradeCouriers.js';
import type { BuildingPlacement } from '../src/castle/scene/plan.js';

const c = new Catalog();
const match = () => new Match({ seed: 'trade', portfolios: [templatePortfolio('balanced', 20000, c), templatePortfolio('whale', 20000, c)] });

describe('the Trade phase', () => {
  it('a preview tells what a command would do, and changes nothing', () => {
    const m = match();
    const before = JSON.stringify(m.side('A'), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    const p = previewCommand(m, 'A', { t: 'swap', from: 'eth', to: 'usdc', qty: available(m, 'A', 'swap', 'eth') });
    expect(p.ok).toBe(true);
    expect(p.unitsAfter).toBeLessThan(p.unitsBefore);
    expect(p.keepMaxAfter).toBeGreaterThan(p.keepMaxBefore);
    expect(p.valueAfter).toBeLessThan(p.valueBefore); // fee, slippage and gas
    expect(p.gas).toBeCloseTo(0.1 * m.state.unitValue, 9);
    expect(JSON.stringify(m.side('A'), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).toBe(before);
    const bad = previewCommand(m, 'A', { t: 'borrow', asset: 'usdc', qty: q(1) });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('collateral');
  });

  it('what is available: a holding, the room under the LTV limit, the debt', () => {
    const m = match();
    // all the ETH but the gas
    expect(qn(holding(m.side('A'), 'eth')) - qn(available(m, 'A', 'swap', 'eth'))).toBeCloseTo((0.1 * m.state.unitValue * 1.001) / 3000, 6);
    expect(available(m, 'A', 'swap', 'wbtc')).toBe(holding(m.side('A'), 'wbtc'));
    expect(available(m, 'A', 'borrow', 'usdc')).toBe(0n);
    m.command('A', { t: 'supply', asset: 'eth', qty: holding(m.side('A'), 'eth') / 2n });
    const room = available(m, 'A', 'borrow', 'usdc');
    expect(qn(room)).toBeGreaterThan(0);
    // all of it is a valid borrow; a bit more is not
    expect(previewCommand(m, 'A', { t: 'borrow', asset: 'usdc', qty: room }).ok).toBe(true);
    expect(previewCommand(m, 'A', { t: 'borrow', asset: 'usdc', qty: room + q(100) }).ok).toBe(false);
    m.command('A', { t: 'borrow', asset: 'usdc', qty: room });
    expect(available(m, 'A', 'repay', 'usdc')).toBeGreaterThan(0n);
  });

  it('each command’s courier goes to a building of its kind (a vault to Maker/Sky), else to the town’s end', () => {
    const b = (id: string, category: string) => ({ protocol: { id, name: id, category } }) as unknown as BuildingPlacement;
    const town = [b('aave', 'lending'), b('uniswap', 'dex'), b('lido', 'staking'), b('maker', 'lending')];
    expect(buildingFor({ t: 'swap', from: 'eth', to: 'usdc', qty: 1n }, town)?.protocol.id).toBe('uniswap');
    expect(buildingFor({ t: 'borrow', asset: 'usdc', qty: 1n }, town)?.protocol.id).toBe('aave');
    expect(buildingFor({ t: 'borrow', asset: 'dai', qty: 1n, via: 'vault' }, town)?.protocol.id).toBe('maker');
    expect(buildingFor({ t: 'stake', asset: 'eth', qty: 1n }, town)?.protocol.id).toBe('lido');
    expect(buildingFor({ t: 'slotRelic', nft: 'x', slot: 0 }, town)).toBeNull();
    const e = tradeErrand(match(), { t: 'swap', from: 'eth', to: 'usdc', qty: q(1) }, town, 12);
    expect(e).toMatchObject({ protocolId: 'uniswap', direction: 'out', verb: 'swap', feeUsd: 12 });
    expect(e.steps[0]!.give[0]).toMatchObject({ symbol: 'ETH', quantity: 1, usd: 3000 });
  });
});
