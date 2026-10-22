/**
 * The river east of the town: it meanders down from the hills, widens as it
 * goes, and runs into its pond (no gap, no wall between them); the bridge sits
 * on it, across it.
 */

import { describe, expect, it } from 'vitest';
import { planRiver, pondReach, pondShore } from '../src/castle/scene/river.js';

describe('the river', () => {
  const river = planRiver(50, -40, 126, 57);
  const first = river.path[0]!;
  const last = river.path[river.path.length - 1]!;

  it('runs from its source down into the pond: it crosses the shore at its rim and runs on under the water', () => {
    expect(first.z).toBeCloseTo(-40, 0);
    const { pond, rim } = river;
    expect(pondReach(pond, river.path[rim - 1]!)).toBeGreaterThanOrEqual(1);
    expect(pondReach(pond, river.path[rim]!)).toBeLessThan(1);
    // no end shows: it stops well inside the pond
    expect(pondReach(pond, last)).toBeLessThan(0.55);
  });

  it('opens like a funnel at the mouth, widening smoothly to the shore', () => {
    const before = river.path[river.rim - 12]!.width;
    const at = river.path[river.rim]!.width;
    expect(at).toBeGreaterThan(before * 1.5);
    for (let i = river.rim - 10; i < river.rim; i++) expect(river.path[i + 1]!.width - river.path[i]!.width).toBeLessThan(0.6);
  });

  it('meanders: it swings to both sides of its valley, never far', () => {
    const xs = river.path.map((p) => p.x);
    expect(Math.max(...xs) - 50).toBeGreaterThan(2);
    expect(50 - Math.min(...xs)).toBeGreaterThan(2);
    expect(Math.max(...xs.map((x) => Math.abs(x - 50)))).toBeLessThan(10);
  });

  it('widens downstream, a step at a time (no jumps)', () => {
    expect(last.width).toBeGreaterThan(first.width);
    for (let i = 1; i < river.path.length; i++) {
      expect(river.path[i]!.width).toBeGreaterThanOrEqual(river.path[i - 1]!.width);
      expect(Math.hypot(river.path[i]!.x - river.path[i - 1]!.x, river.path[i]!.z - river.path[i - 1]!.z)).toBeLessThan(1.5);
    }
  });

  it('carries its bridge where it crosses, the deck across the stream', () => {
    const on = river.path.some((p) => Math.hypot(p.x - river.bridge.x, p.z - river.bridge.z) < 0.01);
    expect(on).toBe(true);
    expect(Math.abs(river.bridge.z - 57)).toBeLessThan(2);
  });

  it('is the same every time, and the pond’s shore is a closed, uneven round', () => {
    expect(planRiver(50, -40, 126, 57)).toEqual(river);
    const a = pondShore(river.pond, 0);
    const b = pondShore(river.pond, Math.PI * 2);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    const radii = Array.from({ length: 12 }, (_, i) => pondShore(river.pond, (i / 12) * Math.PI * 2)).map((p) => Math.hypot((p.x - river.pond.x) / river.pond.rx, (p.z - river.pond.z) / river.pond.rz));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
  });
});
