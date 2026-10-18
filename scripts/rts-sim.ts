/**
 * Ledger Wars' computer, headless: how long matches run and who wins.
 *
 *   npx vite-node scripts/rts-sim.ts [matches] [A: easy|normal|hard|passive] [B: …] [kit]
 *
 * "passive" never fights: it only sits in its hall (the newcomer who doesn't
 * build an army). The default: normal against easy, 6 matches, USDC kits.
 */

import { World } from '../src/rts/core/world.js';
import { newOpponent, type Difficulty } from '../src/rts/ai/opponent.js';
import { incomePerMinute } from '../src/rts/core/economy.js';
import type { StartKit } from '../src/rts/data/rules.js';

const n = Number(process.argv[2] ?? 6);
const a = process.argv[3] ?? 'normal';
const b = process.argv[4] ?? 'easy';
const kit = (process.argv[5] ?? 'usdc') as StartKit;
const LIMIT = 40 * 60;
const lengths: number[] = [];
const wins = { A: 0, B: 0, none: 0 };
for (let i = 0; i < n; i++) {
  const w = new World({ seed: `sim-${i}`, kits: { A: kit, B: kit } });
  if (a !== 'passive') w.ai.set('A', newOpponent(a as Difficulty));
  if (b !== 'passive') w.ai.set('B', newOpponent(b as Difficulty));
  let peak = 0;
  let income = 0;
  while (!w.winner && w.time < LIMIT) {
    w.step();
    if (w.tick % 200 === 0) {
      peak = Math.max(peak, w.units.filter((u) => u.died < 0).length);
      income = Math.max(income, incomePerMinute(w.econ, 'A'), incomePerMinute(w.econ, 'B'));
    }
  }
  wins[w.winner ?? 'none']++;
  if (w.winner) lengths.push(w.time / 60);
  console.log(`#${i} ${w.winner ?? 'none'} at ${(w.time / 60).toFixed(1)} min · units peak ${peak} · income peak $${Math.round(income)}/min`);
}
lengths.sort((x, y) => x - y);
console.log(`${a} (A) vs ${b} (B): A ${wins.A}, B ${wins.B}, undecided ${wins.none}; median length ${lengths.length ? lengths[Math.floor(lengths.length / 2)]!.toFixed(1) : '—'} min`);
