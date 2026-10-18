import { describe, expect, it } from 'vitest';
import { UNIT_TYPES } from '../src/game/core/catalog.js';
import { ABILITY_NAME } from '../src/game/core/depth.js';
import { EVENTS } from '../src/game/core/market.js';
import { EVENT_TEXT, RELIC_TEXT, SIDE_ABILITY_TEXT, UNIT_ABILITY_TEXT, counters, unitSources, unitsByRole } from '../src/game/data/guide.js';

describe('the guide', () => {
  it('describes every unit’s ability, and every unit comes from some token', () => {
    for (const u of Object.values(UNIT_TYPES)) {
      if (u.ability) expect(UNIT_ABILITY_TEXT[u.ability], u.id).toBeDefined();
      const s = unitSources(u.id);
      expect(s.tokens.length + s.categories.length, u.id).toBeGreaterThan(0);
    }
    expect(unitsByRole()).toHaveLength(Object.keys(UNIT_TYPES).length);
    expect(unitSources('paladin.eth').tokens).toEqual(['ETH', 'WETH']);
    expect(unitSources('swarm.goblin').categories).toEqual(['meme']);
  });

  it('the counter triangle both ways', () => {
    expect(counters('melee')).toEqual({ beats: 'cavalry', beatenBy: 'ranged' });
    expect(counters('cavalry')).toEqual({ beats: 'ranged', beatenBy: 'melee' });
    expect(counters('swarm')).toEqual({ beats: null, beatenBy: null });
  });

  it('every protocol ability, event and relic has its words, with the numbers filled in', () => {
    for (const a of Object.keys(ABILITY_NAME)) expect(SIDE_ABILITY_TEXT[a as keyof typeof SIDE_ABILITY_TEXT], a).toBeDefined();
    for (const e of Object.keys(EVENTS)) expect(EVENT_TEXT[e as keyof typeof EVENT_TEXT], e).toBeTruthy();
    expect(EVENT_TEXT['gas-spike']).toContain('5×');
    for (const r of RELIC_TEXT) expect(r.text).not.toMatch(/\{/);
  });
});
