import { describe, expect, it } from 'vitest';
import { REPLAY_GAP, ReplaySequence, inRange, replayRange } from '../src/castle/world/replay.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 31);
const items = [5, 0, 2, 2.5, 29].map((d, i) => ({ time: NOW - (30 - d) * DAY, id: i }));

describe('what to replay', () => {
  it('the last N transactions, the last N days, or everything, oldest first', () => {
    expect(inRange(items, { kind: 'count', count: 2 }, NOW).map((i) => i.id)).toEqual([0, 4]);
    expect(inRange(items, { kind: 'days', days: 7 }, NOW).map((i) => i.id)).toEqual([4]);
    expect(inRange(items, { kind: 'all' }, NOW).map((i) => i.id)).toEqual([1, 2, 3, 0, 4]);
  });

  it('an unknown choice is the last 100 transactions', () => {
    expect(replayRange('days:7').label).toBe('Last 7 days');
    expect(replayRange('nonsense').id).toBe('count:100');
    expect(replayRange(undefined).id).toBe('count:100');
  });
});

describe('replay sequence', () => {
  it('sets the couriers out one after another, a beat apart, and nothing while paused', () => {
    const s = new ReplaySequence(['a', 'b', 'c', 'd']);
    expect(s.advance(1)).toEqual([]); // paused
    s.playing = true;
    expect(s.advance(0.1)).toEqual(['a']); // the first at once
    expect(s.advance(REPLAY_GAP)).toEqual(['b']);
    s.speed = 2;
    expect(s.advance(REPLAY_GAP)).toEqual(['c', 'd']); // twice as fast
    expect(s.playing).toBe(false); // the end
    expect(s.done).toBe(true);
  });

  it('a jump sets out that one next, with none of those skipped', () => {
    const s = new ReplaySequence(['a', 'b', 'c', 'd']);
    s.playing = true;
    s.seek(2);
    expect(s.advance(0.1)).toEqual(['c']);
    expect(s.current).toBe(2);
  });
});
