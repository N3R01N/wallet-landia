/**
 * What a hero is doing right now, for their quest card: the quest they are on
 * (or last finished), and where in it they are. Read from the living town,
 * never stored: it changes every frame.
 */

import type { Journey } from '../domain/model.js';
import type { Sim } from './sim.js';

/**
 * - `toll`: at (or on the way to) the Chronicle Tower to pay the toll;
 * - `step`: at (or on the way to) the `step`th stop;
 * - `returning`: the business done, heading home;
 * - `resting`: at home; `journey` is the last one, if any.
 */
export type HeroPhase = 'toll' | 'step' | 'returning' | 'resting';

export interface HeroNow {
  journey: Journey | null;
  phase: HeroPhase;
  /** The stop under way while `phase` is `step`. */
  step: number | null;
  /** Doing it now (not walking there). */
  busy: boolean;
}

export function heroNow(sim: Sim, address: string): HeroNow {
  const a = sim.heroAgent(address);
  // the last one the replay has reached (the quest log keeps only the newest few)
  const last = (): Journey | null => {
    const s = sim.scheduled;
    for (let i = s.length - 1; i >= 0; i--) if (s[i]!.at <= sim.t && s[i]!.journey.hero === address) return s[i]!.journey;
    return null;
  };
  const j = a?.journey ?? null;
  if (a === undefined || j === null) return { journey: last(), phase: 'resting', step: null, busy: false };
  const busy = a.acting !== null && a.actStep !== undefined;
  // doing a stop right now
  if (busy) return a.actStep === -1 ? { journey: j, phase: 'toll', step: null, busy } : { journey: j, phase: 'step', step: a.actStep ?? 0, busy };
  // else walking to the next stop still ahead
  for (const t of a.tasks) {
    if (t.type !== 'act' || t.journey !== j || t.seconds === 0) continue;
    if (t.verb === 'toll') return { journey: j, phase: 'toll', step: null, busy: false };
    if (t.step !== undefined) return { journey: j, phase: 'step', step: j.steps.indexOf(t.step), busy: false };
  }
  const home = a.tasks.length === 0 && a.path.length === 0 && a.acting === null;
  return { journey: j, phase: home ? 'resting' : 'returning', step: null, busy: false };
}
