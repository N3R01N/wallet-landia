/**
 * The castle's sounds, made in the browser with Web Audio (no audio files):
 * the tower bell for each sealed block, coins at the toll, a puff for a
 * failed transaction, a fanfare for a medal; under them the ambience: rain
 * when the market sets it, birds by day and crickets at night.
 *
 * Off by default. Browsers only let audio start from a click or key press,
 * so a context is made (or resumed) on the first gesture after it is on.
 */

type Ctx = AudioContext;

/** The click sounds a player can pick (the Guild tab), in their order. */
export const TAP_SOUNDS = ['Marimba', 'Chime', 'Wood block', 'Coins', 'Harp'] as const;

export class Soundscape {
  #ctx: Ctx | null = null;
  #master: GainNode | null = null;
  #on = false;
  #volume = 0.6;
  #noise: AudioBuffer | null = null;
  /** The ambience beds, with their gains. */
  #rain: GainNode | null = null;
  #nextBird = 0;
  #nextCricket = 0;
  #started = 0;
  #awaitingGesture = false;
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
    // one pair of listeners at a time, however often sound is switched on before a gesture
    if (this.#awaitingGesture) return;
    this.#awaitingGesture = true;
    const go = (): void => {
      this.#awaitingGesture = false;
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
    // two seconds of noise, the stuff of rain, puffs and thunder
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < data.length; i++) {
      pink = pink * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = (Math.random() * 2 - 1) * 0.5 + pink * 6;
    }
    this.#noise = buf;
    this.#rain = this.#bed(ctx, 'highpass', 900, 0.4);
    this.#started = ctx.currentTime;
  }

  /** A looping noise bed through a filter, silent until `update` raises it. */
  #bed(ctx: Ctx, type: BiquadFilterType, freq: number, q: number): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.#master!);
    src.start();
    return g;
  }

  /** The ambience, called now and then (every second is plenty): `rain` and `night` 0..1. */
  ambience(rain: number, night: number): void {
    const ctx = this.#ctx;
    if (!this.#on || ctx === null || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.#rain?.gain.setTargetAtTime(Math.max(0, rain) * 0.35, t, 0.8);
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

  /** A bright chime (a badge just earned). Silent while sound is off. */
  chime(drama = 1): void {
    if (!this.#on || !this.#ctx || !this.#master) return;
    this.#chime(this.#ctx.currentTime, drama);
    this.played.chime = (this.played.chime ?? 0) + 1;
  }

  /** A failed transaction turned back at the barrier: a puff. Silent while sound is off. */
  refused(): void {
    if (!this.#on || !this.#ctx || !this.#master) return;
    this.#puff(this.#ctx.currentTime);
    this.played.refused = (this.played.refused ?? 0) + 1;
  }

  /** The audio context's state ('none' before sound was first turned on). */
  get state(): string {
    return this.#ctx?.state ?? 'none';
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

  /** A failed journey: a dull puff. */
  #puff(t: number): void {
    this.#noiseBurst(t, 'lowpass', 600, 0.25, 0.4);
  }

  /** The bell, rung now (the castle rings it for each block). Silent while sound is off. */
  ringNow(loud = 1): void {
    if (!this.#on || !this.#ctx || !this.#master) return;
    this.bell(this.#ctx.currentTime, loud);
    this.played.bell = (this.played.bell ?? 0) + 1;
  }

  /** Coins at the toll, now (a courier paying at the castle's barrier). Silent while sound is off. */
  tollNow(drama = 0): void {
    if (!this.#on || !this.#ctx || !this.#master) return;
    this.#coins(this.#ctx.currentTime, 'paid', drama);
    this.played.coins = (this.played.coins ?? 0) + 1;
  }

  /** Which click sound taps play (TAP_SOUNDS). */
  tapStyle = 0;

  /**
   * A tap on something in the scene, in the chosen style (TAP_SOUNDS): a
   * building gets the full sound, a person a lighter one, a courier a tick.
   * Silent while sound is off.
   */
  tap(what: 'building' | 'person' | 'courier' = 'building', style = this.tapStyle): void {
    if (!this.#on || !this.#ctx || !this.#master) return;
    const t = this.#ctx.currentTime;
    const light = what !== 'building';
    const lift = what === 'courier' ? 1.5 : what === 'person' ? 1.26 : 1;
    switch (style) {
      case 1: {
        // chime: two bright bell notes, a fifth apart
        const notes = light ? [1046.5 * lift] : [1046.5, 1568];
        notes.forEach((f, i) => {
          this.#tone(t + i * 0.08, f, 0.06, 0.9, 'sine');
          this.#tone(t + i * 0.08, f * 2.76, 0.012, 0.35, 'sine');
        });
        break;
      }
      case 2: {
        // wood block: two hollow knocks
        this.#noiseBurst(t, 'bandpass', 900 * lift, 0.35, 0.05);
        this.#tone(t, 820 * lift, 0.08, 0.08, 'triangle');
        if (!light) {
          this.#noiseBurst(t + 0.09, 'bandpass', 1300, 0.3, 0.045);
          this.#tone(t + 0.09, 1150, 0.07, 0.07, 'triangle');
        }
        break;
      }
      case 3:
        // coins: a few bright pings
        this.#coins(t, 'paid', light ? 0 : 1);
        break;
      case 4: {
        // harp: a quick rising arpeggio
        const notes = light ? [659.25 * lift, 987.77 * lift] : [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          this.#tone(t + i * 0.045, f, 0.05, 0.6, 'triangle');
          this.#tone(t + i * 0.045, f * 2, 0.012, 0.3, 'sine');
        });
        break;
      }
      default: {
        // marimba: a soft knock and a warm two-note pluck (a struck wooden bar)
        this.#noiseBurst(t, 'lowpass', what === 'courier' ? 1400 : 700, light ? 0.12 : 0.22, 0.07);
        const notes = what === 'building' ? [523.25, 783.99] : what === 'person' ? [659.25] : [987.77];
        notes.forEach((f, i) => {
          this.#tone(t + 0.012 + i * 0.07, f, 0.09, 0.45, 'sine');
          this.#tone(t + 0.012 + i * 0.07, f * 2, 0.025, 0.18, 'sine');
          this.#tone(t + 0.012 + i * 0.07, f * 4.02, 0.008, 0.06, 'triangle');
        });
      }
    }
    this.played.tap = (this.played.tap ?? 0) + 1;
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
