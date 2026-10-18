import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/game/core/catalog.js';
import { q } from '../src/game/core/fixed.js';
import { serialize } from '../src/game/core/match.js';
import { templatePortfolio } from '../src/game/data/templates.js';
import { MatchClient } from '../src/game/sim/matchClient.js';

const c = new Catalog();

describe('the match in lockstep (the worker’s match and the page’s replica)', () => {
  it('a whole match: commands, NPC trades and battles keep both copies identical', async () => {
    const client = new MatchClient(
      {
        seed: 'lockstep',
        portfolios: [templatePortfolio('balanced', 20000, c), templatePortfolio('degen', 20000, c)],
        npc: [undefined, { archetype: 'degen', difficulty: 'normal' }],
      },
      false,
    );
    const m = client.replica;
    let battles = 0;
    let guard = 0;
    while (m.state.phase !== 'ended' && guard++ < 100) {
      if (m.state.phase === 'trade') {
        client.command('A', { t: 'swap', from: 'eth', to: 'usdc', qty: q(0.01) });
        await client.npc('B');
      }
      const run = await client.advance();
      if (run) {
        battles++;
        // the replica took the worker's battle: same outcome
        expect(m.state.lastBattle?.seconds).toBe(run.seconds);
      }
    }
    expect(m.state.phase).toBe('ended');
    expect(battles).toBeGreaterThan(0);
    expect(client.desyncs).toBe(0);
    // and the replica is the match a replay of its log rebuilds
    const { replay } = await import('../src/game/core/match.js');
    expect(serialize(replay(m.replay()).state)).toBe(serialize(m.state));
  }, 120_000);

  it('a refused command is refused on the page at once and never sent', () => {
    const client = new MatchClient({ seed: 'refuse', portfolios: [templatePortfolio('whale', 20000, c), templatePortfolio('whale', 20000, c)] }, false);
    const r = client.command('A', { t: 'borrow', asset: 'usdc', qty: q(10) });
    expect(r.ok).toBe(false);
    expect(client.replica.log).toHaveLength(0);
  });
});
