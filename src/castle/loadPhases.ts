/**
 * The first load's phases and their timing, with no DOM: the wallets are
 * gathered, the castle is raised (its models load), then the bell rings a
 * welcome. Phases come in order as they happen, but each stays on screen at
 * least a moment, so a fast one still shows its animation instead of a flicker.
 */

export const LOAD_PHASES = ['wallets', 'castle', 'welcome'] as const;
export type LoadPhase = (typeof LOAD_PHASES)[number];

export const PHASE_TEXT: Record<LoadPhase, string> = {
  wallets: 'Summoning your wallets…',
  castle: 'Raising the castle…',
  welcome: 'The bell rings: welcome!',
};

export interface PhaseTiming {
  /** A phase shows at least this long (ms). */
  minMs: number;
  /** The welcome shows this long before the loader goes (ms). */
  welcomeMs: number;
}

export const DEFAULT_PHASE_TIMING: PhaseTiming = { minMs: 700, welcomeMs: 900 };

export class PhaseSchedule {
  readonly #timing: PhaseTiming;
  /** Each phase reported, when, in order (a phase reported twice, or after a later one, is ignored). */
  readonly #reported: { phase: LoadPhase; at: number }[] = [];

  constructor(timing: PhaseTiming = DEFAULT_PHASE_TIMING) {
    this.#timing = timing;
  }

  /** A phase began (now). Phases only move forward. */
  report(phase: LoadPhase, now: number): void {
    const last = this.#reported[this.#reported.length - 1];
    if (last && LOAD_PHASES.indexOf(phase) <= LOAD_PHASES.indexOf(last.phase)) return;
    this.#reported.push({ phase, at: now });
  }

  /** When each reported phase shows: when it was reported, or when the one before has shown long enough. */
  #starts(): { phase: LoadPhase; start: number }[] {
    const out: { phase: LoadPhase; start: number }[] = [];
    for (const r of this.#reported) {
      const prev = out[out.length - 1];
      out.push({ phase: r.phase, start: prev ? Math.max(r.at, prev.start + this.#timing.minMs) : r.at });
    }
    return out;
  }

  /** What shows now: a phase, 'done' once the welcome has had its moment, or null before anything began. */
  at(now: number): LoadPhase | 'done' | null {
    const starts = this.#starts();
    let current: { phase: LoadPhase; start: number } | null = null;
    for (const s of starts) if (s.start <= now) current = s;
    if (!current) return null;
    if (current.phase === 'welcome' && now >= current.start + this.#timing.welcomeMs) return 'done';
    return current.phase;
  }

  /** When the next change is due (ms from now), or null when nothing more is scheduled. */
  nextChange(now: number): number | null {
    const starts = this.#starts();
    const next = starts.find((s) => s.start > now);
    if (next) return next.start - now;
    const last = starts[starts.length - 1];
    if (last?.phase === 'welcome' && now < last.start + this.#timing.welcomeMs) return last.start + this.#timing.welcomeMs - now;
    return null;
  }
}
