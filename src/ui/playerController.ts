/**
 * You, the player: your level and badges from everything kept of your own
 * wallets' history, worked out now and then as that history grows, the
 * badges remembered in your preferences, and the titles they unlock.
 */

import type { Session, Shown } from '../data/session.js';
import type { RawWallet } from '../data/zerion/endpoints.js';
import { defaultTitle, medalById, titleOptions, type Earned } from '../domain/feats.js';
import type { HeroClass } from '../domain/model.js';
import { badgeMoments, type PlayerBadge, type PlayerProfile, type Provenance } from '../domain/player.js';
import { fromWire, workPlayer, type PlayerJob, type WireProfile } from '../domain/playerJob.js';
import { savePrefs, type Prefs } from '../settings.js';
import { el } from './dom.js';
import type { PlayerReply, PlayerRequest } from './player.worker.js';

export interface PlayerHost {
  session: Session;
  prefs: Prefs;
  /** The town on show (the player is worked out only at home). */
  shown(): Shown | null;
  names(): Map<string, string>;
  classOf(address: string): HeroClass;
  /** A new profile arrived (the open sheet follows it). */
  changed(): void;
}

export class PlayerController {
  readonly button = el('button', { class: 'btn player-btn', title: 'You: your level and badges, from all your wallets' }, '🛡 Lv 1');
  /** Null until first worked out. */
  profile: PlayerProfile | null = null;
  /** Journeys that earned a badge or a tier, to announce them as the replay plays them. */
  #moments = new Map<string, { badge: PlayerBadge; tier: number }[]>();
  /** When the player was last worked out (the walk back through history updates it now and then). */
  #at = 0;
  /** What the player was last worked out from (or is being, off the main thread), and how long that took (ms). */
  #from: { raws: RawWallet[]; names: Map<string, string>; at: number } | null = null;
  #working: { raws: RawWallet[]; names: Map<string, string> } | null = null;
  #cost = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Each refresh's number: only the latest one started may land (a worker can answer out of order). */
  #seq = 0;
  readonly #worker = new PlayerWorker();
  readonly #host: PlayerHost;

  constructor(host: PlayerHost) {
    this.#host = host;
  }

  /** Badges (and tiers) this journey earned. */
  momentsOf(key: string): readonly { badge: PlayerBadge; tier: number }[] {
    return this.#moments.get(key) ?? [];
  }

  badgeIds(): string[] {
    return [...(this.profile?.badges.keys() ?? [])];
  }

  /**
   * Work out the player (level and badges) from everything kept of your own
   * wallets' history. Only at home: a visited town is someone else's.
   */
  async refresh(): Promise<void> {
    const host = this.#host;
    const shown = host.shown();
    if (shown === null || shown.visiting !== null) return;
    this.#at = Date.now();
    const raws = await host.session.lifetime(shown).catch(() => shown.raws);
    if (host.shown() !== shown) return;
    // nothing new kept, and the same names: the player is the same (but for time itself, so not for long)
    const names = host.names();
    const from = this.#from;
    if (from !== null && raws === from.raws && names === from.names && Date.now() - from.at < 60 * 60_000) return;
    if (this.#working !== null && this.#working.raws === raws && this.#working.names === names) return; // already on it
    const seq = ++this.#seq;
    this.#working = { raws, names };
    const prefs = host.prefs;
    // badges seen before that the kept history no longer shows (prefs.medals, by wallet) are kept
    const remembered = new Map<string, Provenance>();
    for (const [wallet, ids] of Object.entries(prefs.medals)) for (const [id, at] of Object.entries(ids)) if (medalById(id) && !remembered.has(id)) remembered.set(id, { at, wallet, journey: null });
    let done: { profile: WireProfile; ms: number };
    try {
      done = await this.#worker.run({ raws, names, remembered, now: Date.now() });
    } finally {
      if (seq === this.#seq) this.#working = null;
    }
    if (seq !== this.#seq || host.shown() !== shown) return;
    const player = fromWire(done.profile);
    // and new ones are remembered, under the wallet that earned them
    let changed = false;
    for (const [id, b] of player.badges) {
      const first = b.tiers[0]!;
      const kept = (prefs.medals[first.wallet] ??= {});
      if (!(id in kept)) {
        kept[id] = first.at;
        changed = true;
      }
    }
    if (changed) savePrefs(prefs);
    this.profile = player;
    this.#moments = badgeMoments(player);
    this.button.textContent = `🛡 Lv ${player.level}`;
    this.button.title = `You: level ${player.level} ${player.rank} · ${player.badges.size} badges — open your sheet`;
    host.changed();
    this.#from = { raws, names, at: Date.now() };
    this.#cost = done.ms;
  }

  /**
   * Work the player out again soon (history arriving), at most every 15 s,
   * and less often when it is costly (a very long history): at most a
   * twentieth of the time (of a worker, or of the main thread without one).
   */
  soon(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.refresh();
    }, Math.max(1500, Math.max(15_000, this.#cost * 20) - (Date.now() - this.#at)));
  }

  /** Badges this wallet earned first (for its hero's sheet). */
  firstEarnedBy(address: string): Map<string, Earned> {
    const out = new Map<string, Earned>();
    for (const [id, b] of this.profile?.badges ?? []) {
      const first = b.tiers[0]!;
      if (first.wallet === address) out.set(id, { at: first.at, journey: first.journey });
    }
    return out;
  }

  /** A hero's title: any badge of yours unlocks its title for every one of your heroes. */
  titleOf(address: string): string {
    const medals = this.badgeIds();
    const cls = this.#host.classOf(address);
    const picked = this.#host.prefs.titles[address];
    const options = titleOptions(cls, medals);
    return picked !== undefined && options.includes(picked) ? picked : defaultTitle(cls, medals);
  }
}

/** The job, here on the main thread (no worker in this browser, or it failed), and how long it took. */
function inline(job: PlayerJob): { profile: WireProfile; ms: number } {
  const started = performance.now();
  return { profile: workPlayer(job), ms: performance.now() - started };
}

/**
 * The player's worker, started on first use. Where there is none (an old
 * browser, tests in node) or it breaks, the job runs inline instead.
 */
class PlayerWorker {
  /** undefined: not started yet; null: none to be had. */
  #worker: Worker | null | undefined = undefined;
  #next = 0;
  readonly #waiting = new Map<number, { job: PlayerJob; resolve: (r: { profile: WireProfile; ms: number }) => void; reject: (e: Error) => void }>();

  run(job: PlayerJob): Promise<{ profile: WireProfile; ms: number }> {
    const w = this.#start();
    if (w === null) return Promise.resolve().then(() => inline(job));
    return new Promise((resolve, reject) => {
      const id = ++this.#next;
      this.#waiting.set(id, { job, resolve, reject });
      try {
        w.postMessage({ id, job } satisfies PlayerRequest);
      } catch (error) {
        // something in the job would not clone: this one (and what follows) runs here
        console.warn('player worker', error);
        this.#fail();
      }
    });
  }

  #start(): Worker | null {
    if (this.#worker !== undefined) return this.#worker;
    this.#worker = null;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./player.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<PlayerReply>) => {
        const r = e.data;
        const waiting = this.#waiting.get(r.id);
        if (!waiting) return;
        this.#waiting.delete(r.id);
        if (r.ok) waiting.resolve({ profile: r.profile, ms: r.ms });
        else waiting.reject(new Error(r.error));
      };
      // the worker could not load (a CSP, an old deploy's file gone) or died: carry on without it
      w.onerror = (e) => {
        console.warn('player worker', e.message);
        this.#fail();
      };
      this.#worker = w;
    } catch (error) {
      console.warn('player worker', error);
    }
    return this.#worker;
  }

  #fail(): void {
    this.#worker?.terminate();
    this.#worker = null;
    const waiting = [...this.#waiting.values()];
    this.#waiting.clear();
    for (const { job, resolve, reject } of waiting) {
      try {
        resolve(inline(job));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
