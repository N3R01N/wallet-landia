import { describe, expect, it } from 'vitest';
import { PhaseSchedule } from '../src/castle/loadPhases.js';

const timing = { minMs: 700, welcomeMs: 900 };

describe('loading phases', () => {
  it('nothing shows before the first phase; then each in turn', () => {
    const s = new PhaseSchedule(timing);
    expect(s.at(0)).toBeNull();
    s.report('wallets', 0);
    expect(s.at(0)).toBe('wallets');
    s.report('castle', 2000);
    expect(s.at(1999)).toBe('wallets');
    expect(s.at(2000)).toBe('castle');
  });

  it('a fast phase still shows its moment: the next waits its turn', () => {
    const s = new PhaseSchedule(timing);
    s.report('wallets', 0);
    s.report('castle', 100); // the wallets came at once
    expect(s.at(500)).toBe('wallets');
    expect(s.at(700)).toBe('castle');
    s.report('welcome', 800); // and the models were cached
    expect(s.at(1000)).toBe('castle');
    expect(s.at(1400)).toBe('welcome');
    expect(s.nextChange(1400)).toBe(900);
    expect(s.at(2299)).toBe('welcome');
    expect(s.at(2300)).toBe('done');
    expect(s.nextChange(2300)).toBeNull();
  });

  it('phases only move forward: a repeat or a step back is ignored', () => {
    const s = new PhaseSchedule(timing);
    s.report('castle', 0);
    s.report('wallets', 10);
    s.report('castle', 20);
    expect(s.at(5000)).toBe('castle');
  });

  it('a phase may be skipped (no castle to raise when the first tab has no scene)', () => {
    const s = new PhaseSchedule(timing);
    s.report('wallets', 0);
    s.report('welcome', 50);
    expect(s.at(700)).toBe('welcome');
    expect(s.at(1600)).toBe('done');
  });
});
