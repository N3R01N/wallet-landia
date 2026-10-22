import { describe, expect, it } from 'vitest';
import { GAS_LEVELS, GRUMBLES, TOLL_WAIT, gasLevel, grumble, queueOffsets, tollTiming } from '../src/castle/world/gas.js';
import { DEFAULT_TIMING, buildCourierScript } from '../src/castle/scene/courier.js';

describe('the toll by the base fee', () => {
  it('reads the fee against one table: quiet, busy, jammed', () => {
    expect(gasLevel(0.2)).toBe('quiet');
    expect(gasLevel(1)).toBe('busy');
    expect(gasLevel(6)).toBe('busy');
    expect(gasLevel(10)).toBe('jammed');
    expect(gasLevel(250)).toBe('jammed');
    // the table's edges are where the levels change
    for (const [i, g] of GAS_LEVELS.slice(0, -1).entries()) {
      expect(gasLevel(g.below - 1e-6)).toBe(g.level);
      expect(gasLevel(g.below)).toBe(GAS_LEVELS[i + 1]!.level);
    }
  });

  it('knows nothing without a fee', () => {
    expect(gasLevel(null)).toBeNull();
    expect(gasLevel(undefined)).toBeNull();
    expect(gasLevel(NaN)).toBeNull();
    expect(gasLevel(-1)).toBeNull();
  });

  it('a jammed road holds couriers longer at the barrier, a quiet one waves them through', () => {
    expect(TOLL_WAIT.quiet).toBeLessThan(TOLL_WAIT.busy);
    expect(TOLL_WAIT.jammed).toBeGreaterThan(TOLL_WAIT.busy * 2);
    expect(tollTiming(DEFAULT_TIMING, null)).toBe(DEFAULT_TIMING);
    expect(tollTiming(DEFAULT_TIMING, 'jammed')).toEqual({ ...DEFAULT_TIMING, toll: TOLL_WAIT.jammed });
    const route = [
      { x: 0, z: -3 },
      { x: 0, z: 1, stop: 'toll' as const },
      { x: 0, z: 9, stop: 'hand-over' as const },
    ];
    const wait = (level: 'quiet' | 'jammed') => {
      const leg = buildCourierScript(route, tollTiming(DEFAULT_TIMING, level)).legs.find((l) => l.kind === 'wait' && l.tag === 'toll')!;
      return leg.end - leg.start;
    };
    expect(wait('jammed')).toBeCloseTo(TOLL_WAIT.jammed);
    expect(wait('quiet')).toBeCloseTo(TOLL_WAIT.quiet);
  });

  it('queues couriers back from the barrier, the first at the stop', () => {
    expect(queueOffsets(0)).toEqual([]);
    const q = queueOffsets(3);
    expect(q[0]).toBeCloseTo(0);
    expect(q[1]).toBeLessThan(0);
    expect(q[2]).toBeLessThan(q[1]!);
  });

  it('the toll keeper grumbles only on a jammed road', () => {
    expect(grumble('busy', 0.5)).toBeNull();
    expect(grumble('quiet', 0.5)).toBeNull();
    expect(grumble(null, 0.5)).toBeNull();
    expect(grumble('jammed', 0)).toBe(GRUMBLES[0]);
    expect(grumble('jammed', 1)).toBe(GRUMBLES[GRUMBLES.length - 1]);
  });
});
