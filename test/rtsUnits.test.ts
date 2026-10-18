import { describe, expect, it } from 'vitest';
import { RULES, TRAIN } from '../src/rts/data/rules.js';
import { isOpen } from '../src/rts/core/map.js';
import { radiusOf } from '../src/rts/core/units.js';
import { World } from '../src/rts/core/world.js';

const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * RULES.tickHz); i++) w.step();
};

function militia(w: World, n: number): number[] {
  const hall = w.hallOf('A')!;
  const time = TRAIN.find((t) => t.unit === 'militia')!.time;
  for (let left = n; left > 0; left -= RULES.queueMax) {
    const k = Math.min(left, RULES.queueMax);
    for (let i = 0; i < k; i++) expect(w.command('A', { t: 'train', id: hall.id, unit: 'militia' }), `#${i}`).toEqual({ ok: true });
    run(w, time * k + 0.5);
  }
  return w.units.filter((u) => u.owner === 'A').map((u) => u.id);
}

describe('units', () => {
  it('train for their token, queue five deep, and step out of the hall', () => {
    const w = new World({ seed: 'units', kits: { A: 'usdc', B: 'usdc' }, still: true });
    const hall = w.hallOf('A')!;
    const before = w.players.A.tokens.usdc;
    for (let i = 0; i < RULES.queueMax; i++) w.command('A', { t: 'train', id: hall.id, unit: 'militia' });
    expect(w.command('A', { t: 'train', id: hall.id, unit: 'militia' }).reason).toBe('the queue is full');
    expect(w.players.A.tokens.usdc).toBeCloseTo(before - RULES.queueMax * RULES.unitValue, 6);
    expect(w.command('A', { t: 'train', id: hall.id, unit: 'knight' }).reason).toContain('not trained at the Wallet Hall');
    w.command('A', { t: 'cancelTrain', id: hall.id });
    expect(hall.queue).toHaveLength(RULES.queueMax - 1);
    run(w, 6 * 4 + 0.5);
    expect(w.units).toHaveLength(4);
    for (const u of w.units) expect(isOpen(w.map, u.x, u.z)).toBe(true);
    // an ETH kit can't train Militia (USDC) until it swaps
    const v = new World({ seed: 'units', kits: { A: 'eth', B: 'eth' } });
    expect(v.command('A', { t: 'train', id: v.hallOf('A')!.id, unit: 'militia' }).reason).toBe('needs USDC');
  });

  it('a group walks over a bridge to the far side and spreads out there', () => {
    const w = new World({ seed: 'units', kits: { A: 'usdc', B: 'usdc' }, still: true });
    const ids = militia(w, 8);
    const goal = { x: 30, z: -20 };
    expect(w.command('A', { t: 'order', units: ids, kind: 'move', ...goal }).ok).toBe(true);
    run(w, 60);
    const units = w.units.filter((u) => ids.includes(u.id));
    for (const u of units) {
      expect(u.order.t).toBe('idle');
      expect(Math.hypot(u.x - goal.x, u.z - goal.z), `unit ${u.id}`).toBeLessThan(6);
    }
    // no two on top of each other
    for (const a of units) for (const b of units) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(radiusOf(a.type) * 1.5);
  });

  it('stop halts; the same orders give the same match', () => {
    const play = () => {
      const w = new World({ seed: 'units', kits: { A: 'usdc', B: 'usdc' } });
      const ids = militia(w, 4);
      w.command('A', { t: 'order', units: ids, kind: 'move', x: 0, z: 20 });
      run(w, 3);
      w.command('A', { t: 'order', units: ids, kind: 'stop' });
      const at = w.units.map((u) => [u.x, u.z] as const);
      run(w, 2);
      // standing (a nudge from a neighbour at most)
      w.units.forEach((u, i) => expect(Math.hypot(u.x - at[i]![0], u.z - at[i]![1])).toBeLessThan(0.3));
      return w.units.map((u) => [u.x, u.z]);
    };
    expect(play()).toEqual(play());
  });
});
