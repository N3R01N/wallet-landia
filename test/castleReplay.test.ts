import { describe, expect, it } from 'vitest';
import { REPLAY_SPEEDS, ReplayClock } from '../src/castle/world/replay.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items = [5, 0, 2, 2.5, 9].map((d, i) => ({ time: T0 + d * DAY, id: i }));

describe('replay clock', () => {
  it('spans the window from the first item to now (or the last item)', () => {
    const c = new ReplayClock(items, T0 + 10 * DAY);
    expect(c.from).toBe(T0);
    expect(c.to).toBe(T0 + 10 * DAY);
    expect(c.position).toBe(T0);
  });

  it('hands out what it passes, in order, and nothing while paused', () => {
    const c = new ReplayClock(items, T0 + 10 * DAY);
    expect(c.advance(1)).toEqual([]); // paused
    c.playing = true;
    c.speed = REPLAY_SPEEDS[1].ms; // a day a second
    expect(c.advance(1).map((i) => i.id)).toEqual([1]); // day 0 (the start) … day 1
    expect(c.advance(2).map((i) => i.id)).toEqual([2, 3]); // day 2, day 2.5
    expect(c.advance(2.5).map((i) => i.id)).toEqual([0]); // day 5
  });

  it('stops at the end of the window', () => {
    const c = new ReplayClock(items, T0 + 10 * DAY);
    c.playing = true;
    c.speed = REPLAY_SPEEDS[2].ms; // a week a second
    expect(c.advance(10)).toHaveLength(5);
    expect(c.playing).toBe(false);
    expect(c.progress).toBe(1);
  });

  it('a seek skips: what lies between is not handed out', () => {
    const c = new ReplayClock(items, T0 + 10 * DAY);
    c.seek(T0 + 4 * DAY);
    c.playing = true;
    expect(c.advance(1.5).map((i) => i.id)).toEqual([0]); // only day 5
    c.seek(T0 - DAY);
    expect(c.position).toBe(c.from); // clamped
  });

  it('an empty history is a window of nothing', () => {
    const c = new ReplayClock([], T0);
    c.playing = true;
    expect(c.advance(5)).toEqual([]);
    expect(c.progress).toBe(1);
  });
});
