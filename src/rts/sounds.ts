/**
 * Ledger Wars' sounds, made in the browser from the castle's soundscape
 * (src/audio/soundscape.ts, no audio files): blades and arrows as units
 * fight, the hall's bow, a fall, a building coming down; a horn for a new
 * unit, a thud for a building placed, a chime when one is ready, coins for
 * the money, a horn call under attack, and the end of the match. Busy
 * fights are thinned (a sound of a kind at most so often) and fights out of
 * view are quieter.
 *
 * On by default here (its own setting, 🔊 in the corner); the volume is the
 * castle's.
 */

import { Soundscape } from '../audio/soundscape.js';
import { loadPrefs } from '../settings.js';

const KEY = 'wallet-landia.rts.sound';

export type RtsSound = 'blade' | 'arrow' | 'bolt' | 'smash' | 'hallShot' | 'fall' | 'collapse' | 'trained' | 'placed' | 'ready' | 'upgraded' | 'coins' | 'refused' | 'order' | 'alarm' | 'objective' | 'charge' | 'magic' | 'victory' | 'defeat';

/** Seconds between two sounds of a kind (the fights would be a roar otherwise). */
const GAP: Partial<Record<RtsSound, number>> = { blade: 0.07, arrow: 0.09, bolt: 0.12, smash: 0.15, hallShot: 0.2, fall: 0.12, order: 0.08, charge: 0.2, magic: 0.3 };

export class RtsSounds {
  readonly #s = new Soundscape();
  readonly #last = new Map<RtsSound, number>();
  /** How many of each played (tests). */
  readonly played: Partial<Record<RtsSound, number>> = {};

  constructor() {
    this.#s.setVolume(loadPrefs().volume);
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== 'off';
    } catch {
      // storage blocked: on
    }
    // browsers start audio only from a click or a key: the soundscape waits for one
    if (on) this.#s.setOn(true);
  }

  get on(): boolean {
    return this.#s.on;
  }

  setOn(on: boolean): void {
    this.#s.setOn(on);
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // not kept
    }
  }

  /** Birds now and then. */
  ambience(): void {
    this.#s.ambience(0, 0);
  }

  /** A sound; `loud` 0–1 (a fight out of view is quieter). */
  play(what: RtsSound, loud = 1): void {
    if (!this.#s.on) return;
    const now = performance.now() / 1000;
    const gap = GAP[what] ?? 0;
    if (gap && now - (this.#last.get(what) ?? -9) < gap) return;
    this.#last.set(what, now);
    this.played[what] = (this.played[what] ?? 0) + 1;
    const s = this.#s;
    const v = Math.max(0.05, loud);
    const jitter = () => 0.9 + Math.random() * 0.2;
    switch (what) {
      case 'blade':
        // steel on steel: a bright clank and a ring
        s.noiseIn(0, 'bandpass', 3200 * jitter(), 0.1 * v, 0.06);
        s.toneIn(0, 1900 * jitter(), 0.025 * v, 0.14, 'triangle');
        s.toneIn(0, 2900 * jitter(), 0.012 * v, 0.09, 'sine');
        break;
      case 'arrow':
        // the hiss of its flight, then the thud
        s.noiseIn(0, 'highpass', 2500, 0.05 * v, 0.12);
        s.noiseIn(0.14, 'lowpass', 500, 0.12 * v, 0.07);
        break;
      case 'bolt':
        // a spell: a falling zap
        s.toneIn(0, 880 * jitter(), 0.04 * v, 0.22, 'sawtooth');
        s.toneIn(0.03, 660 * jitter(), 0.03 * v, 0.2, 'square');
        break;
      case 'smash':
        // stone struck: a deep knock
        s.noiseIn(0, 'lowpass', 260, 0.35 * v, 0.22);
        s.toneIn(0, 70, 0.12 * v, 0.3, 'sine');
        break;
      case 'hallShot':
        // a big bow's twang
        s.toneIn(0, 196, 0.06 * v, 0.25, 'triangle');
        s.noiseIn(0, 'bandpass', 1500, 0.05 * v, 0.08);
        break;
      case 'fall':
        s.noiseIn(0, 'lowpass', 420, 0.18 * v, 0.25);
        s.toneIn(0, 150 * jitter(), 0.04 * v, 0.3, 'sawtooth');
        break;
      case 'collapse':
        // a building down: a long rumble
        s.noiseIn(0, 'lowpass', 180, 0.6 * v, 1.4);
        s.noiseIn(0.15, 'lowpass', 400, 0.3 * v, 0.9);
        s.toneIn(0, 55, 0.25 * v, 1.2, 'sine');
        break;
      case 'trained':
        // a short horn: two notes up
        s.toneIn(0, 392, 0.05, 0.18, 'triangle');
        s.toneIn(0.12, 523.25, 0.05, 0.3, 'triangle');
        break;
      case 'placed':
        // a wooden thud as it is set down
        s.noiseIn(0, 'lowpass', 600, 0.3, 0.15);
        s.toneIn(0, 110, 0.12, 0.25, 'sine');
        break;
      case 'ready':
        s.chime(0.6);
        break;
      case 'upgraded':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => s.toneIn(i * 0.07, f, 0.05, 0.4, 'triangle'));
        break;
      case 'coins':
        [1318.5, 1567.98, 2093].forEach((f, i) => s.toneIn(i * 0.06, f, 0.035, 0.18, 'triangle'));
        break;
      case 'refused':
        s.refused();
        break;
      case 'order':
        s.toneIn(0, 1250, 0.025, 0.05, 'sine');
        break;
      case 'alarm':
        // a war horn, twice
        for (const t of [0, 0.45]) {
          s.toneIn(t, 220, 0.07, 0.38, 'sawtooth');
          s.toneIn(t, 330, 0.03, 0.38, 'triangle');
        }
        break;
      case 'objective':
        [783.99, 1046.5].forEach((f, i) => s.toneIn(i * 0.09, f, 0.06, 0.5, 'sine'));
        break;
      case 'charge':
        s.noiseIn(0, 'lowpass', 300, 0.25 * v, 0.3);
        s.toneIn(0, 330, 0.04 * v, 0.2, 'sawtooth');
        break;
      case 'magic':
        [1046.5, 1318.5, 1568].forEach((f, i) => s.toneIn(i * 0.04, f, 0.03 * v, 0.6, 'sine'));
        break;
      case 'victory':
        s.fanfare();
        break;
      case 'defeat':
        [392, 329.63, 261.63, 196].forEach((f, i) => s.toneIn(i * 0.3, f, 0.06, i === 3 ? 1.4 : 0.4, 'triangle'));
        break;
    }
  }
}
