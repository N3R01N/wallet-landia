import { describe, expect, it } from 'vitest';
import { chatterFor, linesFor, pickLine } from '../src/castle/world/chatter.js';

describe('townsfolk chatter', () => {
  it('reads the market in three moods', () => {
    expect(chatterFor('crash')).toBe('dropped');
    expect(chatterFor('down')).toBe('dropped');
    expect(chatterFor('flat')).toBe('flat');
    expect(chatterFor('up')).toBe('rose');
    expect(chatterFor('boom')).toBe('rose');
  });

  it('talks about the market, the road and the trade when they are known', () => {
    const all = linesFor({ mood: 'crash', road: 'crowded', trade: 'lending' });
    expect(all).toContain('rekt');
    expect(all).toContain('gas is through the roof');
    expect(all).toContain('mind your health factor');
    expect(all).not.toContain('to the moon');
  });

  it('keeps to its trade with nothing else known, and an unknown trade talks like a villager', () => {
    expect(linesFor({ mood: null, road: null, trade: 'dex' })).toContain('watch the slippage');
    expect(linesFor({ mood: null, road: null, trade: 'mystery' })).toContain('gm');
  });

  it('picks a line by a roll, the last one at 1', () => {
    const o = { mood: 'flat', road: 'quiet', trade: 'nft' } as const;
    const lines = linesFor(o);
    expect(pickLine(o, 0)).toBe(lines[0]);
    expect(pickLine(o, 1)).toBe(lines[lines.length - 1]);
  });
});
