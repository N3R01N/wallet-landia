/**
 * A famous castle's story, told over its replay: a card per beat (what
 * happened, what was taken and given back so far), ▶ plays the couriers on to
 * the next beat and stops there. On the way the castle's messages are pinned
 * on the notice board, and the robbed building is hit, burns, and is mended
 * (storyScene.ts). The board's sheet lists every message.
 */

import type { FamousStory, StoryBeat } from '../data/famous.js';
import type { ProtocolCategory } from '../domain/catalog.js';
import { approxUsd } from '../domain/tiers.js';
import { el, fmtDate } from '../util/dom.js';
import type { CastleView } from './scene/castleView.js';
import type { StoryScene } from './scene/storyScene.js';
import type { Timeline } from './timeline.js';
import type { Errand } from './world/world.js';

/** How fast the couriers go between beats (hundreds of them between two). */
const STORY_SPEED = 4;

export interface StoryTourHost {
  view: CastleView;
  story: FamousStory;
  errands: readonly Errand[];
  timeline: Timeline;
  /** The category of each place in town (what was given back went to a council: a multisig). */
  categories: ReadonlyMap<string, ProtocolCategory>;
  openBoard(): void;
}

interface Beat extends StoryBeat {
  errand: Errand;
}

/** The beats whose transaction is in town, in time order. Pure. */
export function storyBeats(beats: readonly StoryBeat[], errands: readonly Errand[]): Beat[] {
  const byHash = new Map(errands.map((e) => [e.hash.toLowerCase(), e]));
  return beats.flatMap((b) => {
    const errand = byHash.get(b.hash);
    return errand ? [{ ...b, errand }] : [];
  }).sort((a, b) => a.errand.time - b.errand.time);
}

/**
 * What was taken from the robbed place and given back by this time: in from
 * it, and out to it or to a council (a multisig) the story names. Pure.
 */
export function haulAt(errands: readonly Errand[], robbed: string | null, categories: ReadonlyMap<string, ProtocolCategory>, time: number): { taken: number; back: number } {
  let taken = 0;
  let back = 0;
  if (robbed === null) return { taken, back };
  for (const e of errands) {
    if (e.time > time || e.protocolId === null) continue;
    if (e.verb === 'receive' && e.protocolId === robbed) taken += e.valueUsd;
    const toStory = e.protocolId.startsWith('story:') && (e.protocolId === robbed || categories.get(e.protocolId) === 'governance');
    if (e.verb === 'send' && toStory) back += e.valueUsd;
  }
  return { taken, back };
}

export class StoryTour {
  readonly #host: StoryTourHost;
  readonly #beats: Beat[];
  readonly #robbed: string | null;
  /** The castle's own messages, with their transactions, oldest first. */
  readonly notes: { errand: Errand | null; time: number; text: string }[];
  #scene: StoryScene | null = null;
  #at = -1;
  /** The beat the couriers are playing on to, or null. */
  #playingTo: number | null = null;
  #card: HTMLElement | null = null;
  #pinned = 0;
  readonly #onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.#card?.isConnected) this.close();
  };

  constructor(host: StoryTourHost) {
    this.#host = host;
    this.#beats = storyBeats(host.story.beats, host.errands);
    this.#robbed = host.story.beats.find((b) => b.effect === 'hack')?.place ?? null;
    const byHash = new Map(host.errands.map((e) => [e.hash.toLowerCase(), e]));
    this.notes = [...host.story.notes]
      .map(([hash, text]) => {
        const errand = byHash.get(hash) ?? null;
        return { errand, time: errand?.time ?? 0, text };
      })
      .filter((n) => n.errand !== null)
      .sort((a, b) => a.time - b.time);
    const open = el('button', { class: 'btn scene-action story-open', type: 'button', 'aria-label': 'The story of this castle' }, '📖 The story');
    open.addEventListener('click', () => void this.show(0));
    const board = el('button', { class: 'btn scene-action story-board', type: 'button', 'aria-label': 'The notice board: the messages' }, `📌 Messages (${this.notes.length})`);
    board.addEventListener('click', () => host.openBoard());
    host.view.element.append(open, board);
    void host.view.story().then((scene) => {
      this.#scene = scene;
      scene?.board(this.#pinned);
    });
  }

  get beats(): number {
    return this.#beats.length;
  }

  /** Shows beat i: the town as it was then, its courier setting out, its card. */
  async show(i: number): Promise<void> {
    const beat = this.#beats[i];
    if (!beat) return;
    this.#host.timeline.pause();
    this.#playingTo = null;
    this.#at = i;
    const scene = this.#scene ?? (await this.#host.view.story());
    this.#scene = scene;
    // the town at that moment: what was hit and mended by then, the messages pinned by then
    scene?.reset();
    for (const b of this.#beats.slice(0, i + 1)) await this.#effect(b, false);
    this.#pinned = this.notes.filter((n) => n.time <= beat.errand.time).length;
    scene?.board(this.#pinned);
    this.#host.view.sendNow(beat.errand);
    this.#host.view.follow(beat.errand);
    this.#showCard();
  }

  /** The replay reached a transaction: a message is pinned; at the beat it plays to, it stops. */
  reached(e: Errand): void {
    if (this.#playingTo === null) return;
    if (this.#host.story.notes.has(e.hash.toLowerCase())) this.#scene?.board(++this.#pinned);
    const target = this.#beats[this.#playingTo];
    if (target && target.errand === e) {
      this.#host.timeline.pause();
      this.#at = this.#playingTo;
      this.#playingTo = null;
      void this.#effect(target, true);
      this.#host.view.follow(e);
      this.#showCard();
    }
  }

  /** Plays the couriers on from this beat to the next one. */
  next(): void {
    const from = this.#beats[this.#at];
    if (!from || this.#at + 1 >= this.#beats.length) return;
    this.#hideCard();
    this.#playingTo = this.#at + 1;
    // its own courier went already: the replay goes on from the one after it
    const i = this.#host.errands.indexOf(from.errand);
    const after = [...this.#host.errands].sort((a, b) => a.time - b.time).find((e) => e.time > from.errand.time || (e.time === from.errand.time && e !== from.errand && this.#host.errands.indexOf(e) > i));
    this.#host.timeline.startAt(after ?? this.#beats[this.#playingTo]!.errand, STORY_SPEED);
  }

  close(): void {
    this.#hideCard();
    this.#playingTo = null;
  }

  async #effect(beat: StoryBeat, live: boolean): Promise<void> {
    const scene = this.#scene;
    if (!scene) return;
    if (beat.effect === 'hack' && beat.place) await scene.hit(beat.place, live);
    if (beat.effect === 'repair' && beat.place) scene.mend(beat.place);
    if (beat.effect === 'freeze') scene.freeze(true);
  }

  #showCard(): void {
    this.#hideCard();
    const i = this.#at;
    const beat = this.#beats[i];
    if (!beat) return;
    // by the next beat: a beat tells of what happened until then (the vault's ten payouts)
    const until = this.#beats[i + 1]?.errand.time ?? Infinity;
    const haul = haulAt(this.#host.errands, this.#robbed, this.#host.categories, until - 1);
    const back = el('button', { class: 'btn story-back', type: 'button', 'aria-label': 'The beat before' }, '◀');
    back.disabled = i === 0;
    back.addEventListener('click', () => void this.show(i - 1));
    const last = i + 1 >= this.#beats.length;
    const next = el('button', { class: 'btn story-next', type: 'button' }, last ? '↺ From the start' : `▶ ${this.#beats[i + 1]!.title}`);
    next.addEventListener('click', () => (last ? void this.show(0) : this.next()));
    const close = el('button', { class: 'btn story-close', type: 'button', 'aria-label': 'Close the story' }, '✕');
    close.addEventListener('click', () => this.close());
    this.#card = el(
      'section',
      { class: 'away-card story-card', role: 'dialog', 'aria-label': 'The story', 'data-beat': String(i) },
      el('p', { class: 'story-step muted' }, `${i + 1} of ${this.#beats.length} · ${fmtDate(beat.errand.time)}`),
      el('h3', {}, beat.title),
      el('p', {}, beat.text),
      haul.taken > 0 ? el('p', { class: 'story-haul' }, `Taken so far ${approxUsd(haul.taken)}${haul.back >= 1 ? ` · given back ${approxUsd(haul.back)}` : ''}`) : null,
      el('div', { class: 'away-actions' }, back, close, next),
    );
    this.#host.view.element.append(this.#card);
    document.addEventListener('keydown', this.#onKey);
  }

  #hideCard(): void {
    this.#card?.remove();
    this.#card = null;
    document.removeEventListener('keydown', this.#onKey);
  }
}
