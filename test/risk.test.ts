import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harvestOf, loanHealth, priceMove } from '../src/domain/risk.js';
import type { Stash, StashEntry } from '../src/domain/model.js';
import { buildGuild } from '../src/domain/mappers.js';
import { planTown } from '../src/world/layout.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const entry = (kind: StashEntry['kind'], usd: number): StashEntry => ({ name: '', symbol: 'X', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });
const stash = (protocolId: string, ...entries: StashEntry[]): Stash => ({ protocolId, entries, netUsd: entries.reduce((s, e) => s + e.usd, 0), grossUsd: 0, tier: 3, hasRewards: entries.some((e) => e.kind === 'reward'), hasDebt: entries.some((e) => e.kind === 'loan') });

describe('loan health', () => {
  it('estimates a health factor from collateral and debt, from safe to near liquidation', () => {
    expect(loanHealth(stash('a', entry('deposit', 10_000)))).toBeNull();
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -2_000)))).toMatchObject({ health: 4, level: 'safe', ltv: 0.2 });
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -5_000)))?.level).toBe('watch'); // 1.6
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -6_500)))?.level).toBe('danger'); // 1.23
    expect(loanHealth(stash('a', entry('deposit', 10_000), entry('loan', -7_500)))?.level).toBe('critical'); // 1.07
  });
});

describe('harvests and the market', () => {
  it('sizes a harvest: a little, some, a lot', () => {
    expect(harvestOf(stash('a', entry('reward', 0.5)))).toBeNull();
    expect(harvestOf(stash('a', entry('reward', 12)))?.size).toBe('little');
    expect(harvestOf(stash('a', entry('reward', 300)))?.size).toBe('some');
    expect(harvestOf(stash('a', entry('reward', 2500)))?.size).toBe('lot');
  });

  it('reads how ETH moved since the last visit', () => {
    expect(priceMove(3300, { usd: 3000, at: 0 })).toMatchObject({ mood: 'boom' });
    expect(priceMove(3060, { usd: 3000, at: 0 }).mood).toBe('up');
    expect(priceMove(3010, { usd: 3000, at: 0 }).mood).toBe('flat');
    expect(priceMove(2900, { usd: 3000, at: 0 }).mood).toBe('down');
    expect(priceMove(2500, { usd: 3000, at: 0 }).pct).toBeCloseTo(-16.67, 1);
  });
});

describe('the town reacts', () => {
  const demoDir = resolve(__dirname, '../fixtures/demo');
  const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

  it('posts bailiffs at a Counting House whose loan is in danger, and heaps a harvest at the door', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const base = buildGuild(demo);
    const plan = planTown(base);
    const [bank, farm] = plan.buildings.filter((b) => b.protocolId !== undefined);
    const hero = { ...base.heroes[0]!, stashes: [stash(bank!.protocolId!, entry('deposit', 10_000), entry('loan', -7_500)), stash(farm!.protocolId!, entry('reward', 2500))] };
    const guild = { ...base, heroes: [hero, ...base.heroes.slice(1)] };
    const sim = new Sim(guild, plan);
    expect(sim.loans.get(bank!.id)?.level).toBe('critical');
    expect(sim.harvests.get(farm!.id)?.size).toBe('lot');
    const watchers = () => sim.agents.filter((a) => a.kind === 'bailiff' && a.loiterAt !== undefined);
    expect(watchers()).toHaveLength(2);
    for (let i = 0; i < 400; i++) sim.step(0.05);
    // they stay near the door
    for (const a of watchers()) expect(Math.hypot(a.x - bank!.doorAt.x, a.y - bank!.doorAt.y)).toBeLessThan(2);
    sim.seek(10); // still there after a jump along the timeline
    expect(watchers()).toHaveLength(2);
  });

  it('a falling market brings rain that does not clear, a crash a storm', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const guild = buildGuild(demo);
    const sim = new Sim(guild, planTown(guild));
    sim.setPriceMove(priceMove(2500, { usd: 3000, at: 0 }));
    for (let i = 0; i < 400; i++) sim.step(0.05);
    expect(sim.gloom).toBeGreaterThan(0.6);
    sim.setPriceMove(priceMove(3100, { usd: 3000, at: 0 }));
    for (let i = 0; i < 400; i++) sim.step(0.05);
    expect(sim.gloom).toBe(0);
  });
});
