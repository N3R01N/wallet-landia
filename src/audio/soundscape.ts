/**
 * The town's sounds, made in the browser with Web Audio (no audio files):
 * the tower bell for each sealed block, coins for tolls and trades, a chime
 * for big ones, keys for approvals, a puff for a failed journey, the alarm
 * and thunder of a liquidation, a fanfare for a medal; under them the
 * ambience: rain when the market sets it, the murmur of the queue at the
 * tower, birds by day and crickets at night.
 *
 * Off by default. Browsers only let audio start from a click or key press,
 * so a context is made (or resumed) on the first gesture after it is on.
 */

import type { Effect, Sim } from '../world/sim.js';

type Ctx = AudioContext;

export class Soundscape {
  #ctx: Ctx | null = null;
  #master: GainNode | null = null;
  #on = false;
  #volume = 0.6;
  /** Effects already heard (so each plays once). */
  #heard = new WeakSet<Effect>();
  #lastCoins = 0;
  #noise: AudioBuffer | null = null;
  /** The ambience beds, with their gains. */
  #rain: GainNode | null = null;
  #crowd: GainNode | null = null;
  #nextBird = 0;
  #nextCricket = 0;
  #started = 0;
  /** How many of each sound played (for tests and tuning). */
  readonly played: Record<string, number> = {};

  get on(): boolean {
    return this.#on;
  }

  /** Turn sound on or off. Call it from a click when turning on, so the browser lets audio start. */
  setOn(on: boolean): void {
    this.#on = on;
    if (on) {
      this.#ensure();
      void this.#ctx?.resume();
      if (this.#ctx?.state !== 'running') this.#resumeOnGesture();
    }
    if (this.#master && this.#ctx) this.#master.gain.setTargetAtTime(on ? this.#volume : 0, this.#ctx.currentTime, 0.15);
  }

  setVolume(v: number): void {
    this.#volume = Math.min(1, Math.max(0, v));
    if (this.#on && this.#master && this.#ctx) this.#master.gain.setTargetAtTime(this.#volume, this.#ctx.currentTime, 0.1);
  }

  /** On after a reload: wait for the first click or key to start. */
  #resumeOnGesture(): void {
    const go = (): void => {
      void this.#ctx?.resume();
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  #ensure(): void {
    if (this.#ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.#ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // a gentle limiter so busy moments do not clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    this.#master = master;
    // two seconds of noise, the stuff of rain, crowds, puffs and thunder
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < data.length; i++) {
      pink = pink * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = (Math.random() * 2 - 1) * 0.5 + pink * 6;
    }
    this.#noise = buf;
    this.#rain = this.#bed(ctx, 'highpass', 900, 0.4);
    this.#crowd = this.#bed(ctx, 'bandpass', 420, 1.2, true);
    this.#started = ctx.currentTime;
  }

  /** A looping noise bed through a filter, silent until `update` raises it. */
  #bed(ctx: Ctx, type: BiquadFilterType, freq: number, q: number, murmur = false): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    src.playbackRate.value = murmur ? 0.6 : 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.#master!);
    if (murmur) {
      // voices rise and fall
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35;
      const depth = ctx.createGain();
      depth.gain.value = 180;
      lfo.connect(depth).connect(f.frequency);
      lfo.start();
    }
    src.start();
    return g;
  }

  /** Each frame: play what just happened, and set the ambience. `night` 0..1. */
  update(sim: Sim, night: number): void {
    const ctx = this.#ctx;
    if (!this.#on || ctx === null || ctx.state !== 'running') {
      // keep effects marked as heard, so turning sound on does not replay a backlog
      for (const e of sim.effects) this.#heard.add(e);
      return;
    }
    const t = ctx.currentTime;
    for (const e of sim.effects) {
      if (this.#heard.has(e)) continue;
      this.#heard.add(e);
      if (e.age > 0.5) continue; // old news
      this.#play(e, sim);
    }
    const rain = Math.max(0, sim.gloom - 0.05);
    this.#rain?.gain.setTargetAtTime(rain * 0.35, t, 0.8);
    this.#crowd?.gain.setTargetAtTime(Math.min(1, sim.queue.length / 18) * 0.09, t, 1.2);
    // birds by day (not in the rain), crickets at night
    if (t - this.#started > 1) {
      if (night < 0.4 && rain < 0.2 && t > this.#nextBird) {
        this.#bird(t);
        this.#nextBird = t + 1.5 + Math.random() * 5;
      }
      if (night > 0.6 && t > this.#nextCricket) {
        this.#cricket(t);
        this.#nextCricket = t + 0.8 + Math.random() * 2.5;
      }
    }
  }

  /** The audio context's state ('none' before sound was first turned on). */
  get state(): string {
    return this.#ctx?.state ?? 'none';
  }

  #play(e: Effect, sim: Sim): void {
    const t = this.#ctx!.currentTime;
    this.played[e.kind] = (this.played[e.kind] ?? 0) + 1;
    switch (e.kind) {
      case 'ring':
        this.bell(t, 0.5 + sim.chain.busy * 0.5);
        break;
      case 'coins':
        if (t - this.#lastCoins < 0.12) return; // a busy replay: one jingle at a time
        this.#lastCoins = t;
        this.#coins(t, e.color === '#ff5e5e' ? 'seized' : 'paid', e.drama);
        break;
      case 'sparkle':
        this.#chime(t, e.drama);
        break;
      case 'key':
        this.#keys(t);
        break;
      case 'smoke':
        this.#puff(t);
        break;
      case 'alarm':
        for (let i = 0; i < 3 + e.drama; i++) this.bell(t + i * 0.35, 0.7, 330);
        break;
      case 'storm':
        this.#thunder(t);
        break;
      default:
    }
  }

  /** The tower bell: inharmonic partials, the low hum ringing longest. */
  bell(t: number, loud = 1, base = 196): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#master) return;
    const partials: [number, number, number][] = [
      [0.5, 0.5, 4.5], // hum
      [1, 1, 3],
      [1.19, 0.6, 2.4], // minor third: the bell's colour
      [1.5, 0.45, 2],
      [2, 0.4, 1.6],
      [2.66, 0.25, 1.1],
      [3.01, 0.2, 0.9],
    ];
    for (const [ratio, amp, decay] of partials) {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12 * amp * loud, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.#master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  /** Coins: bright pings, scattered; seized ones dull and few. */
  #coins(t: number, how: 'paid' | 'seized', drama: number): void {
    const ctx = this.#ctx!;
    const n = how === 'seized' ? 3 : 4 + Math.min(4, drama * 2);
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * 0.22;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = (how === 'seized' ? 1400 : 2600) + Math.random() * 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.06, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09 + Math.random() * 0.08);
      o.connect(g).connect(this.#master!);
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  /** A rising chime for a big trade. */
  #chime(t: number, drama: number): void {
    const notes = [784, 988, 1175, 1568].slice(0, 2 + Math.min(2, drama));
    notes.forEach((f, i) => this.#tone(t + i * 0.09, f, 0.07, 0.6, 'sine'));
  }

  /** A ring of keys: two quick metal clicks. */
  #keys(t: number): void {
    this.#tone(t, 3200, 0.05, 0.06, 'square');
    this.#tone(t + 0.07, 3900, 0.04, 0.05, 'square');
  }

  /** A failed journey: a dull puff. */
  #puff(t: number): void {
    this.#noiseBurst(t, 'lowpass', 600, 0.25, 0.4);
  }

  #thunder(t: number): void {
    this.#noiseBurst(t, 'lowpass', 140, 0.5, 2.8);
    this.#noiseBurst(t + 0.25, 'lowpass', 90, 0.4, 3.5);
  }

  /** A medal: a short fanfare. */
  fanfare(): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#on || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.#tone(t + i * 0.12, f, 0.08, i === 3 ? 0.9 : 0.25, 'triangle'));
  }

  #bird(t: number): void {
    // a few quick whistles sliding up or down
    const base = 2600 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const ctx = this.#ctx!;
      const at = t + i * (0.08 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base, at);
      o.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 1.35 : 0.75), at + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.018, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(g).connect(this.#master!);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  #cricket(t: number): void {
    for (let i = 0; i < 3; i++) this.#tone(t + i * 0.05, 4400, 0.01, 0.03, 'square');
  }

  #tone(t: number, freq: number, peak: number, decay: number, type: OscillatorType): void {
    const ctx = this.#ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.#master!);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  #noiseBurst(t: number, type: BiquadFilterType, freq: number, peak: number, decay: number): void {
    const ctx = this.#ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.#master!);
    src.start(t);
    src.stop(t + decay + 0.1);
  }
}
