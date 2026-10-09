import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ethPriceFrom, initialChain, nextChain, tollOf } from '../src/world/chain.js';
import { buildGuild } from '../src/domain/mappers.js';
import { planTown, tileAt } from '../src/world/layout.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

describe('the chain at the tower', () => {
  it('smooths fullness over blocks, and ignores a repeated block', () => {
    let c = nextChain(initialChain(), { number: 1, busy: 1, baseFeeGwei: 10, txCount: 300 });
    expect(c.congestion).toBe(1); // the first block sets it
    c = nextChain(c, { number: 2, busy: 0, baseFeeGwei: 9, txCount: 10 });
    expect(c.congestion).toBeCloseTo(0.6);
    expect(nextChain(c, { number: 2, busy: 1, baseFeeGwei: 99, txCount: 1 })).toBe(c);
  });

  it('reads the toll: dear or cheap by what a transfer costs, and where it is heading', () => {
    const at = (busy: number, gwei: number) => nextChain(initialChain(), { number: 1, busy, baseFeeGwei: gwei, txCount: 0 });
    const cheap = tollOf(at(0.3, 0.1), 4000);
    expect(cheap.transferUsd).toBeCloseTo(0.1e-9 * 21000 * 4000);
    expect(cheap.level).toBe('low');
    expect(cheap.trend).toBe(-1); // under half full: the fee falls
    const dear = tollOf(at(0.9, 60), 4000);
    expect(dear.level).toBe('high');
    expect(dear.trend).toBe(1);
    expect(dear.heat).toBeGreaterThan(cheap.heat);
    // no ETH price: judged by gwei alone
    expect(tollOf(at(0.5, 60), null)).toMatchObject({ transferUsd: null, level: 'high', trend: 0 });
    // before any block: calm, unknown
    expect(tollOf(initialChain(), 4000)).toMatchObject({ gwei: null, trend: 0, level: 'low' });
  });

  it('takes an ETH price from what the guild holds', () => {
    expect(ethPriceFrom([{ symbol: 'ETH', category: 'native', quantity: 2, usd: 8000 }, { symbol: 'USDC', category: 'stable', quantity: 5, usd: 5 }])).toBe(4000);
    expect(ethPriceFrom([])).toBeNull();
  });
});

describe('the queue at the tower door', () => {
  const guild = buildGuild(demo);
  const plan = planTown(guild);

  it('stands on the road from the tower door, as long as the chain is busy', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    const door = plan.tower.doorAt;
    expect(sim.queueLine.length).toBeGreaterThan(10);
    expect(Math.hypot(sim.queueLine[0]!.x - door.x, sim.queueLine[0]!.y - door.y)).toBeLessThan(1.2);
    for (const p of sim.queueLine) expect(['road', 'plaza', 'path']).toContain(tileAt(plan, Math.floor(p.x), Math.floor(p.y)));
    // a calm default until the first bell, already standing
    expect(sim.queue.length).toBe(sim.queueTarget);
    const calm = sim.queueTarget;
    sim.bell({ number: 1, busy: 1, baseFeeGwei: 30, txCount: 400 });
    expect(sim.queueTarget).toBeGreaterThan(calm);
  });

  it('lets the front in when a block is sealed, and refills from the back', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const sim = new Sim(guild, plan);
    sim.bell({ number: 1, busy: 0.9, baseFeeGwei: 30, txCount: 400 });
    for (let i = 0; i < 600; i++) sim.step(0.05); // the line fills to its target
    const before = sim.queue.length;
    const front = sim.queue[0]!;
    sim.bell({ number: 2, busy: 0.9, baseFeeGwei: 31, txCount: 400 });
    expect(sim.queue.length).toBeLessThan(before);
    expect(front.queued).toBe(false); // walking in
    sim.bell({ number: 2, busy: 0.9, baseFeeGwei: 31, txCount: 400 }); // the same block again: nobody moves
    const after = sim.queue.length;
    expect(sim.queue.length).toBe(after);
    for (let i = 0; i < 600; i++) sim.step(0.05);
    expect(sim.queue.length).toBeGreaterThanOrEqual(sim.queueTarget - 1);
    expect(front.gone).toBe(true); // went in through the door
  });
});
