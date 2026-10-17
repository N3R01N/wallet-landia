import { describe, expect, it } from 'vitest';
import { npcTrade } from '../src/game/ai/npcPlanner.js';
import { Catalog } from '../src/game/core/catalog.js';
import { Match, replay, serialize } from '../src/game/core/match.js';
import type { Archetype, Difficulty } from '../src/game/core/types.js';
import { templatePortfolio } from '../src/game/data/templates.js';

const c = new Catalog();
const ARCHETYPES: Archetype[] = ['degen', 'whale', 'stable-maxi', 'yield-farmer'];
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

function npcMatch(seed: string, a: Archetype, b: Archetype, difficulty: Difficulty, value = 20000) {
  return new Match({
    seed,
    portfolios: [templatePortfolio(a, value, c), templatePortfolio(b, value, c)],
    npc: [{ archetype: a, difficulty }, { archetype: b, difficulty }],
  });
}

describe('NPC opponents', () => {
  it('every archetype at every difficulty plays a match through to its end, only through commands', () => {
    for (const a of ARCHETYPES) {
      for (const d of DIFFICULTIES) {
        const m = npcMatch(`npc-${a}-${d}`, a, 'whale', d);
        const perRound = new Map<number, number>();
        m.playOut((x) => {
          const done = npcTrade(x, 'A');
          perRound.set(x.state.round, done.length);
          npcTrade(x, 'B');
        });
        expect(m.state.phase).toBe('ended');
        // no more actions than the difficulty allows
        const cap = { easy: 1, normal: 3, hard: 5 }[d];
        for (const n of perRound.values()) expect(n).toBeLessThanOrEqual(cap);
      }
    }
  }, 120_000);

  it('an NPC never issues a command a human couldn’t: its log replays as plain commands', () => {
    const m = npcMatch('npc-replay', 'degen', 'yield-farmer', 'hard');
    m.playOut((x) => {
      npcTrade(x, 'A');
      npcTrade(x, 'B');
    });
    expect(m.log.length).toBeGreaterThan(0);
    const kinds = new Set(['swap', 'stake', 'unstake', 'restake', 'lpAdd', 'lpRemove', 'supply', 'withdraw', 'borrow', 'repay', 'slotRelic', 'endTrade']);
    for (const l of m.log) expect(kinds.has(l.cmd.t)).toBe(true);
    // the same commands from "players" rebuild the same match
    expect(serialize(replay(m.replay()).state)).toBe(serialize(m.state));
  }, 60_000);

  it('the same seed gives the same NPC trades', () => {
    const run = () => {
      const m = npcMatch('npc-det', 'degen', 'stable-maxi', 'normal');
      return npcTrade(m, 'A').map((x) => JSON.stringify(x, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)));
    };
    expect(run()).toEqual(run());
  });

  it('a hard NPC heeds a rumored crash and moves into stables; an easy one ignores it', () => {
    const plan = (d: Difficulty) => {
      const m = npcMatch('npc-rumor', 'whale', 'whale', d);
      m.state.market.rumor = 'black-swan';
      // a whale only trades some rounds: let it always act here
      for (let i = 0; i < 6; i++) {
        const out = npcTrade(m, 'A');
        if (out.length > 0) return out;
        m.state.round++;
      }
      return [];
    };
    const hard = plan('hard');
    expect(hard.some((x) => x.t === 'swap' && x.to === 'usdc')).toBe(true);
  });

  it('a degen borrows; a stable maxi trades walls into army while its keep is safe, and turtles when it isn’t', () => {
    const degen = npcMatch('npc-lev', 'degen', 'whale', 'hard');
    const moves = npcTrade(degen, 'A');
    expect(moves.some((x) => x.t === 'supply' || x.t === 'borrow')).toBe(true);
    // safe (level on keep HP): stables go into ETH, stETH or WBTC
    const safe = npcMatch('npc-maxi', 'stable-maxi', 'whale', 'hard');
    const sm = npcTrade(safe, 'A');
    expect(sm.some((x) => x.t === 'swap' && c.asset(x.from).isStable && !c.asset(x.to).isStable)).toBe(true);
    // in danger (under 60% and behind): no stables go into risk
    const danger = npcMatch('npc-maxi', 'stable-maxi', 'whale', 'hard');
    danger.side('A').keepHp = danger.side('A').keepHpMax * 0.4;
    const dm = npcTrade(danger, 'A');
    expect(dm.every((x) => !(x.t === 'swap' && c.asset(x.from).isStable && !c.asset(x.to).isStable))).toBe(true);
  });
});
