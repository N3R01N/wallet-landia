import { describe, expect, it } from 'vitest';
import { RULES } from '../src/rts/data/rules.js';
import { newOpponent } from '../src/rts/ai/opponent.js';
import { World } from '../src/rts/core/world.js';

const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * RULES.tickHz) && !w.winner; i++) w.step();
};

describe('the computer opponent', () => {
  it('builds an Exchange first, puts money to work, and trains an army', () => {
    const w = new World({ seed: 'ai', kits: { A: 'usdc', B: 'usdc' }, ai: ['B'] });
    run(w, 90);
    expect(w.has('B', 'exchange')).toBe(true);
    expect(w.players.B.positions.length).toBeGreaterThan(0);
    expect(w.units.filter((u) => u.owner === 'B').length).toBeGreaterThan(5);
  });

  it('beats a player who never fights back, in minutes; the same seed plays the same', () => {
    const play = () => {
      const w = new World({ seed: 'ai', kits: { A: 'usdc', B: 'usdc' }, ai: ['B'] });
      run(w, 15 * 60);
      return { winner: w.winner, time: w.time };
    };
    const a = play();
    expect(a.winner).toBe('B');
    expect(a.time).toBeLessThan(12 * 60);
    expect(play()).toEqual(a);
  });

  it('starts from ETH too: it swaps for what it needs', () => {
    const w = new World({ seed: 'ai', kits: { A: 'eth', B: 'eth' } });
    w.ai.set('B', newOpponent('normal'));
    run(w, 120);
    expect(w.units.filter((u) => u.owner === 'B').length).toBeGreaterThan(3);
  });
});
