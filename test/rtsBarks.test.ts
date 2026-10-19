import { describe, expect, it } from 'vitest';
import { bark, type BarkMoment } from '../src/rts/data/barks.js';
import { strikeSound } from '../src/rts/sounds.js';

describe('the banter', () => {
  it('has lines for every moment, hype for your side and taunts from theirs', () => {
    for (const m of ['kill', 'fight', 'building', 'match'] as BarkMoment[]) {
      for (const mine of [true, false]) {
        const seen = new Set<string>();
        for (let i = 0; i < 40; i++) seen.add(bark(m, mine, () => i / 40));
        expect(seen.size, `${m} ${mine}`).toBeGreaterThan(3);
        for (const line of seen) expect(line.length, line).toBeLessThanOrEqual(30);
      }
    }
    expect(bark('fight', false, () => 0)).toBe('You are NGMI');
    expect(bark('fight', true, () => 0)).toBe('WAGMI');
  });
});

describe('the blows’ sounds', () => {
  it('follow who strikes, and at what', () => {
    expect(strikeSound('knight', false, false)).toBe('blade');
    expect(strikeSound('warden.vault', false, false)).toBe('blunt');
    expect(strikeSound('pack.shiba', false, false)).toBe('bite');
    expect(strikeSound('lancer.lido', false, false)).toBe('pierce');
    expect(strikeSound('archer.scout', true, false)).toBe('arrow');
    expect(strikeSound('mage.swap', true, false)).toBe('bolt');
    expect(strikeSound('mage.battle', true, false)).toBe('blast');
    expect(strikeSound('lender.ghost', true, false)).toBe('drain');
    expect(strikeSound('golem.stone', false, true)).toBe('smash');
    expect(strikeSound('knight', false, true)).toBe('chip');
  });
});
