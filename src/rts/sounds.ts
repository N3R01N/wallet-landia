/**
 * Ledger Wars' sounds, made in the browser from the castle's soundscape
 * (src/audio/soundscape.ts, no audio files). Every blow is heard by what
 * strikes: blades clang and ring, heavy units thud, swarms bite, lances
 * pierce, arrows hiss and thunk, spells zap, battle mages' blasts boom,
 * ghosts drain, and siege engines crash into stone, with debris after. Each
 * plays a little different every time (pitch, length, which partials), a crit
 * rings out louder, and a sound sits left or right where it happens on the
 * screen. Then the rest: falls, a building coming down, the hall's bow, horns
 * for new units and alarms, coins, the end of the match.
 *
 * Busy fights are thinned (a kind at most so often, and a cap on all of them
 * together) and fights out of view are quieter. On by default here (its own
 * setting, 🔊 in the corner); the volume is the castle's.
 */

import { Soundscape, type Voice } from '../audio/soundscape.js';
import { loadPrefs } from '../settings.js';
import { UNIT_TYPES } from '../game/core/catalog.js';
import type { UnitTypeId } from '../game/core/types.js';

const KEY = 'zenigard.rts.sound';

export type RtsSound =
  // blows
  | 'blade'
  | 'blunt'
  | 'pierce'
  | 'bite'
  | 'arrow'
  | 'bolt'
  | 'drain'
  | 'blast'
  | 'smash'
  | 'chip'
  | 'hallShot'
  // abilities and ends
  | 'charge'
  | 'magic'
  | 'burst'
  | 'fall'
  | 'collapse'
  // the base and the player
  | 'trained'
  | 'placed'
  | 'ready'
  | 'upgraded'
  | 'coins'
  | 'refused'
  | 'order'
  | 'alarm'
  | 'objective'
  | 'victory'
  | 'defeat';

/** Seconds between two sounds of a kind (the fights would be a roar otherwise). */
const GAP: Partial<Record<RtsSound, number>> = { blade: 0.05, blunt: 0.07, pierce: 0.07, bite: 0.04, arrow: 0.06, bolt: 0.09, drain: 0.12, blast: 0.12, smash: 0.12, chip: 0.08, hallShot: 0.2, fall: 0.08, burst: 0.1, order: 0.08, charge: 0.15, magic: 0.25 };
/** At most this many fight sounds in any `WINDOW` seconds. */
const BUDGET = 9;
const WINDOW = 0.25;
const FIGHT = new Set<RtsSound>(['blade', 'blunt', 'pierce', 'bite', 'arrow', 'bolt', 'drain', 'blast', 'smash', 'chip', 'hallShot', 'fall', 'burst', 'charge', 'magic']);

/** Who casts rather than shoots. */
const CASTERS = new Set(['mage.swap', 'lender.ghost', 'construct']);

/** The sound of a blow, by who strikes and at what. */
export function strikeSound(attacker: UnitTypeId | null, ranged: boolean, onBuilding: boolean): RtsSound {
  const t = attacker ? UNIT_TYPES[attacker] : null;
  if (!t) return ranged ? 'arrow' : 'blade';
  if (t.role === 'siege') return onBuilding ? 'smash' : 'blunt';
  if (attacker === 'mage.battle') return 'blast';
  if (attacker === 'lender.ghost') return 'drain';
  if (ranged) return CASTERS.has(attacker!) ? 'bolt' : 'arrow';
  if (onBuilding) return 'chip';
  if (t.role === 'swarm') return 'bite';
  if (attacker === 'lancer.lido' || attacker === 'rider.name') return 'pierce';
  if (attacker === 'warden.vault') return 'blunt';
  return 'blade';
}

export interface Where {
  /** 0–1: a fight out of view is quieter. */
  loud?: number;
  /** −1 left … 1 right on the screen. */
  pan?: number;
  /** A crit: bigger. */
  crit?: boolean;
  /** For a fall: who fell (a bigger unit falls lower and heavier). */
  unit?: UnitTypeId;
}

export class RtsSounds {
  readonly #s = new Soundscape();
  readonly #last = new Map<RtsSound, number>();
  #recent: number[] = [];
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

  play(what: RtsSound, where: Where = {}): void {
    if (!this.#s.on) return;
    const now = performance.now() / 1000;
    const gap = GAP[what] ?? 0;
    if (gap && now - (this.#last.get(what) ?? -9) < gap) return;
    if (FIGHT.has(what)) {
      this.#recent = this.#recent.filter((t) => now - t < WINDOW);
      if (this.#recent.length >= BUDGET) return;
      this.#recent.push(now);
    }
    this.#last.set(what, now);
    this.played[what] = (this.played[what] ?? 0) + 1;
    const v = Math.max(0.06, where.loud ?? 1) * (where.crit ? 1.5 : 1);
    const pan = (where.pan ?? 0) * 0.7;
    // one voice, at this loudness and place
    const say = (x: Voice) => this.#s.voice({ pan, ...x, peak: x.peak * v });
    const r = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    switch (what) {
      case 'blade': {
        // steel on steel: a sharp transient, then inharmonic ringing partials
        const f = r(1100, 1900);
        say({ type: 'noise', freq: 0, filter: 'highpass', cutoff: 3500, peak: 0.16, decay: 0.035 });
        for (const [m, p, d] of [[1, 0.035, 0.22], [2.76, 0.02, 0.16], [5.4, 0.012, 0.1], [8.93, 0.006, 0.06]] as const) say({ freq: f * m * r(0.98, 1.02), peak: p, decay: d * r(0.8, 1.3), type: 'sine' });
        if (Math.random() < 0.4) say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(700, 1100), q: 2, peak: 0.08, decay: 0.08 }); // the shield takes it
        if (where.crit) say({ freq: f * 1.5, peak: 0.03, decay: 0.45, type: 'triangle' });
        break;
      }
      case 'blunt':
        // a club or a fist of stone: a thump that drops in pitch, and the crack
        say({ freq: r(140, 190), to: 45, peak: 0.28, decay: 0.22, type: 'sine' });
        say({ type: 'noise', freq: 0, rate: 0.6, filter: 'lowpass', cutoff: 900, cutoffTo: 200, peak: 0.3, decay: 0.14 });
        say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(1800, 2600), q: 3, peak: 0.05, decay: 0.03 });
        break;
      case 'pierce':
        // a lance: a quick rushing swish, then the punch
        say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: 900, cutoffTo: 3000, q: 1.5, peak: 0.07, attack: 0.05, decay: 0.08 });
        say({ delay: 0.07, freq: r(220, 280), to: 90, peak: 0.16, decay: 0.12, type: 'triangle' });
        say({ delay: 0.07, type: 'noise', freq: 0, filter: 'lowpass', cutoff: 1500, peak: 0.16, decay: 0.08 });
        break;
      case 'bite':
        // a swarm: little snaps and a squeak
        for (let i = 0; i < 2; i++) say({ delay: i * r(0.03, 0.06), type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(2200, 3400), q: 4, peak: 0.12, decay: 0.025 });
        if (Math.random() < 0.5) say({ freq: r(900, 1300), to: r(1500, 2000), peak: 0.02, decay: 0.07, type: 'square' });
        break;
      case 'arrow': {
        // the hiss of the flight (rising), then it lands: a thunk, or a ping off armour
        say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: 1800, cutoffTo: 5000, q: 2, peak: 0.05, attack: 0.08, decay: 0.06 });
        const hit = 0.15;
        if (Math.random() < 0.3) say({ delay: hit, freq: r(2400, 3200), peak: 0.03, decay: 0.12, type: 'sine' });
        else {
          say({ delay: hit, type: 'noise', freq: 0, filter: 'lowpass', cutoff: 700, peak: 0.16, decay: 0.06 });
          say({ delay: hit, freq: r(160, 220), to: 90, peak: 0.08, decay: 0.08, type: 'triangle' });
        }
        if (where.crit) say({ delay: hit, freq: 1760, to: 2640, peak: 0.04, decay: 0.3, type: 'triangle' });
        break;
      }
      case 'bolt':
        // a spell: a falling zap through a closing filter, and a fizz
        say({ freq: r(1100, 1500), to: 180, peak: 0.06, decay: 0.24, type: 'sawtooth', filter: 'lowpass', cutoff: 5000, cutoffTo: 500 });
        say({ type: 'noise', freq: 0, filter: 'highpass', cutoff: 4000, peak: 0.04, decay: 0.15 });
        break;
      case 'drain':
        // a ghost: a hollow, sinking moan
        say({ freq: r(520, 600), to: 260, peak: 0.05, attack: 0.04, decay: 0.35, type: 'triangle', filter: 'bandpass', cutoff: 800, q: 3 });
        say({ freq: r(780, 900), to: 390, peak: 0.025, attack: 0.04, decay: 0.3, type: 'sine' });
        break;
      case 'blast':
        // an area spell: a crackle and a low boom
        say({ type: 'noise', freq: 0, rate: 0.5, filter: 'lowpass', cutoff: 2500, cutoffTo: 150, peak: 0.32, decay: 0.4 });
        say({ freq: 110, to: 40, peak: 0.22, decay: 0.35, type: 'sine' });
        say({ freq: r(900, 1200), to: 300, peak: 0.03, decay: 0.15, type: 'sawtooth' });
        break;
      case 'smash':
        // siege on stone: a deep crash, then debris rattling down
        say({ freq: 90, to: 32, peak: 0.36, decay: 0.45, type: 'sine' });
        say({ type: 'noise', freq: 0, rate: 0.5, filter: 'lowpass', cutoff: 1200, cutoffTo: 120, peak: 0.42, decay: 0.35 });
        for (let i = 0; i < 4; i++) say({ delay: 0.1 + i * r(0.05, 0.11), type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(1500, 3500), q: 5, peak: 0.07, decay: 0.03 });
        break;
      case 'chip':
        // a blade or an arrow on a wall: a stony knock
        say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(1200, 2000), q: 3, peak: 0.12, decay: 0.05 });
        say({ freq: r(260, 340), to: 160, peak: 0.07, decay: 0.07, type: 'triangle' });
        break;
      case 'hallShot':
        // a big bow: the string's twang sagging, and the release
        say({ freq: 210, to: 160, peak: 0.08, decay: 0.3, type: 'triangle' });
        say({ freq: 420, to: 320, peak: 0.02, decay: 0.2, type: 'sine' });
        say({ type: 'noise', freq: 0, filter: 'bandpass', cutoff: 1400, q: 2, peak: 0.06, decay: 0.07 });
        break;
      case 'charge':
        // hooves and a war cry
        for (let i = 0; i < 3; i++) say({ delay: i * 0.08, type: 'noise', freq: 0, rate: 0.5, filter: 'lowpass', cutoff: 400, peak: 0.25, decay: 0.06 });
        say({ freq: 330, to: 440, peak: 0.05, attack: 0.03, decay: 0.3, type: 'sawtooth', filter: 'lowpass', cutoff: 1500 });
        break;
      case 'magic':
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => say({ delay: i * 0.04, freq: f, peak: 0.03, decay: 0.6, type: 'sine' }));
        break;
      case 'burst':
        // a frog pops: a squelchy rising blip and a splat
        say({ freq: 200, to: 900, peak: 0.12, decay: 0.12, type: 'sine' });
        say({ type: 'noise', freq: 0, filter: 'lowpass', cutoff: 1200, peak: 0.2, decay: 0.12 });
        break;
      case 'fall': {
        // a grunt that falls away, and the body on the ground (heavier for the big)
        const role = where.unit ? UNIT_TYPES[where.unit]?.role : undefined;
        const low = role === 'siege' ? 0.4 : role === 'swarm' ? 1.8 : role === 'cavalry' ? 0.8 : 1;
        say({ freq: r(200, 260) * low, to: 80 * low, peak: 0.05, attack: 0.02, decay: 0.28, type: 'sawtooth', filter: 'bandpass', cutoff: 700 * low, q: 2 });
        say({ delay: 0.18, type: 'noise', freq: 0, rate: 0.6, filter: 'lowpass', cutoff: 500 / low, peak: role === 'siege' ? 0.4 : 0.16, decay: role === 'siege' ? 0.4 : 0.15 });
        break;
      }
      case 'collapse':
        // a building down: a long rumble, stones falling, a last boom
        say({ type: 'noise', freq: 0, rate: 0.4, filter: 'lowpass', cutoff: 600, cutoffTo: 80, peak: 0.6, attack: 0.05, decay: 1.6 });
        say({ freq: 70, to: 28, peak: 0.35, decay: 1.4, type: 'sine' });
        for (let i = 0; i < 8; i++) say({ delay: 0.15 + i * r(0.07, 0.16), type: 'noise', freq: 0, filter: 'bandpass', cutoff: r(800, 2800), q: 4, peak: 0.09, decay: 0.05 });
        break;
      case 'trained':
        // a short horn: two notes up
        say({ freq: 392, peak: 0.05, attack: 0.02, decay: 0.2, type: 'sawtooth', filter: 'lowpass', cutoff: 1400 });
        say({ delay: 0.13, freq: 523.25, peak: 0.05, attack: 0.02, decay: 0.32, type: 'sawtooth', filter: 'lowpass', cutoff: 1600 });
        break;
      case 'placed':
        // a wooden thud as it is set down, and a hammer twice
        say({ type: 'noise', freq: 0, rate: 0.6, filter: 'lowpass', cutoff: 600, peak: 0.3, decay: 0.15 });
        say({ freq: 120, to: 60, peak: 0.14, decay: 0.25, type: 'sine' });
        for (const d of [0.25, 0.42]) say({ delay: d, type: 'noise', freq: 0, filter: 'bandpass', cutoff: 1800, q: 3, peak: 0.08, decay: 0.04 });
        break;
      case 'ready':
        this.#s.chime(0.6);
        break;
      case 'upgraded':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => say({ delay: i * 0.07, freq: f, peak: 0.05, decay: 0.4, type: 'triangle' }));
        break;
      case 'coins':
        [1318.5, 1567.98, 2093].forEach((f, i) => say({ delay: i * 0.06, freq: f * r(0.99, 1.01), peak: 0.035, decay: 0.18, type: 'triangle' }));
        break;
      case 'refused':
        this.#s.refused();
        break;
      case 'order':
        say({ freq: 1250, peak: 0.025, decay: 0.05, type: 'sine' });
        break;
      case 'alarm':
        // a war horn, twice
        for (const t of [0, 0.45]) {
          say({ delay: t, freq: 220, to: 230, peak: 0.07, attack: 0.05, decay: 0.38, type: 'sawtooth', filter: 'lowpass', cutoff: 1200 });
          say({ delay: t, freq: 330, peak: 0.03, attack: 0.05, decay: 0.38, type: 'triangle' });
        }
        break;
      case 'objective':
        [783.99, 1046.5].forEach((f, i) => say({ delay: i * 0.09, freq: f, peak: 0.06, decay: 0.5, type: 'sine' }));
        break;
      case 'victory':
        this.#s.fanfare();
        break;
      case 'defeat':
        [392, 329.63, 261.63, 196].forEach((f, i) => say({ delay: i * 0.3, freq: f, peak: 0.06, decay: i === 3 ? 1.4 : 0.4, type: 'triangle' }));
        break;
    }
  }
}
