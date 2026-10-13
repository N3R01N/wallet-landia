import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { priceMove, type PriceMood } from '../src/domain/risk.js';
import { buildGuild } from '../src/domain/mappers.js';
import { planTown } from '../src/world/layout.js';
import { chatterFor, phrasesFor } from '../src/world/marketChatter.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

describe('what the townsfolk say about the price move', () => {
  it('a drop, a flat day and a rise each have their own phrases', () => {
    expect(chatterFor('crash')).toBe('dropped');
    expect(chatterFor('down')).toBe('dropped');
    expect(chatterFor('flat')).toBe('flat');
    expect(chatterFor('up')).toBe('rose');
    expect(chatterFor('boom')).toBe('rose');
    expect(phrasesFor('crash')).toContain('NGMI');
    expect(phrasesFor('flat')).toContain('slow day');
    expect(phrasesFor('boom')).toContain('to the moon');
  });

  it('every phrase is short enough for a bubble, and no phrase belongs to two groups', () => {
    const moods: PriceMood[] = ['crash', 'flat', 'boom'];
    const all = moods.flatMap((m) => [...phrasesFor(m)]);
    expect(new Set(all).size).toBe(all.length);
    for (const p of all) expect(p.length).toBeLessThanOrEqual(28);
  });

  it('a shown price move makes a villager say one of its phrases, held in full', async () => {
    const { Sim } = await import('../src/world/sim.js');
    const demoDir = resolve(__dirname, '../fixtures/demo');
    const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);
    const guild = buildGuild(demo);
    const sim = new Sim(guild, planTown(guild));
    sim.setPriceMove(priceMove(2500, { usd: 3000, at: 0 }));
    // a bubble lasts a few seconds: look at every step, not only the last
    const said = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      sim.step(0.05); // (a bigger guild fills the streets more slowly)
      for (const e of sim.effects) if (e.kind === 'bubble' && e.sticky === true && e.text !== undefined) said.add(e.text);
    }
    expect(said.size).toBeGreaterThan(0);
    for (const text of said) expect(phrasesFor('crash')).toContain(text);
  });
});
