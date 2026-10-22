/**
 * The replay over the scene, as the old town had it: pick what to replay (the
 * last 25 or 100 transactions, the last 7 or 30 days, everything loaded) and
 * the couriers set out one after another, a beat apart, at 0.5× to 4×. Pause,
 * drag to any transaction ("12 of 100"), close (✕) to go back to the scene's
 * own life. One per scene view; it stops by itself when the view leaves the page.
 */

import { el, fmtDate } from '../util/dom.js';
import { REPLAY_RANGES, REPLAY_SPEEDS, ReplaySequence, inRange, replayRange } from './world/replay.js';
import type { CastleView } from './scene/castleView.js';
import type { Errand } from './world/world.js';

const TICK_MS = 200;
/** No more couriers out at once while replaying (a fast replay waits for one to come home). */
const MAX_OUT = 10;

export interface Timeline {
  /** Opens the replay at this transaction: its courier sets out now, then the rest play on from it. */
  startAt(errand: Errand): void;
  /** Replays just these transactions (those that came while you were away), at this speed. */
  playThese(errands: readonly Errand[], speed: number): void;
}

export interface TimelineHost {
  /** What to replay (a REPLAY_RANGES id), and keeping a new choice. */
  range: string;
  setRange(id: string): void;
}

/** Adds the "⏱ Replay" button and its bar to a scene view. */
export function attachTimeline(view: CastleView, errands: readonly Errand[], host: TimelineHost): Timeline {
  let seq: ReplaySequence<Errand> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let rangeId = replayRange(host.range).id;

  const open = el('button', { class: 'btn scene-action replay-open', type: 'button', 'aria-label': 'Replay your history' }, '⏱ Replay');
  const range = el('select', { 'aria-label': 'What to replay', class: 'timeline-range' });
  for (const r of REPLAY_RANGES) range.append(el('option', { value: r.id }, r.label));
  range.value = rangeId;
  const play = el('button', { class: 'btn timeline-play', type: 'button', 'aria-label': 'Pause' }, '⏸');
  const slider = el('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', 'aria-label': 'Replay position', class: 'timeline-slider' });
  const when = el('span', { class: 'timeline-when' });
  const speed = el('select', { 'aria-label': 'Replay speed', class: 'timeline-speed' });
  for (const s of REPLAY_SPEEDS) speed.append(el('option', { value: String(s) }, `${s}×`));
  speed.value = '1';
  // closes the replay: back to the town as it is now
  const live = el('button', { class: 'btn timeline-live timeline-close', type: 'button', 'aria-label': 'Close the replay and go back to live', title: 'Close the replay (back to live)' }, '✕ Close');
  const bar = el('div', { class: 'timeline', role: 'group', 'aria-label': 'Replay timeline', hidden: '' }, range, play, slider, when, speed, live);

  const show = () => {
    if (!seq) return;
    const n = seq.items.length;
    slider.max = String(n);
    slider.value = String(Math.round(seq.position));
    const at = seq.items[seq.current];
    when.textContent = n === 0 ? 'Nothing in this range' : `${seq.current + 1} of ${n}${at ? ` · ${fmtDate(at.time)}` : ''}`;
    play.textContent = seq.playing ? '⏸' : '▶';
    play.setAttribute('aria-label', seq.playing ? 'Pause' : 'Play');
    view.element.dataset.replay = seq.playing ? 'playing' : 'paused';
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    if (!view.element.isConnected) return stop();
    if (!seq) return;
    // a full town waits: the next sets out when one is home
    if (view.state().couriers >= MAX_OUT) return show();
    const reached = seq.advance(TICK_MS / 1000);
    for (const e of reached) view.sendNow(e);
    show();
  };

  /** The replay over the chosen range (or just these transactions), from its first one (or a given one). */
  const begin = (from?: Errand, only?: readonly Errand[]) => {
    seq = new ReplaySequence(inRange(only ?? errands, only ? { kind: 'all' } : replayRange(rangeId).range));
    seq.speed = Number(speed.value) || 1;
    if (from) {
      let i = seq.items.indexOf(from);
      // not in this range: everything loaded has it
      if (i === -1) {
        rangeId = 'all';
        range.value = rangeId;
        seq = new ReplaySequence(inRange(errands, replayRange(rangeId).range));
        seq.speed = Number(speed.value) || 1;
        i = seq.items.indexOf(from);
      }
      seq.seek(i);
    }
    seq.playing = true;
    view.setAutoReplay(false);
    view.clearQueue();
    bar.hidden = false;
    open.hidden = true;
    stop();
    timer = setInterval(tick, TICK_MS);
    tick();
  };
  open.addEventListener('click', () => begin());
  range.addEventListener('change', () => {
    rangeId = range.value;
    host.setRange(rangeId);
    begin();
  });
  play.addEventListener('click', () => {
    if (!seq) return;
    if (!seq.playing && seq.done) seq.seek(0); // at the end: from the start again
    seq.playing = !seq.playing;
    show();
  });
  slider.addEventListener('input', () => {
    if (!seq) return;
    seq.seek(Number(slider.value));
    view.clearQueue();
    show();
  });
  speed.addEventListener('change', () => {
    if (seq) seq.speed = Number(speed.value) || 1;
  });
  live.addEventListener('click', () => {
    stop();
    seq = null;
    bar.hidden = true;
    open.hidden = false;
    view.clearQueue();
    view.setAutoReplay(true);
    delete view.element.dataset.replay;
  });

  view.element.append(open, bar);
  return {
    startAt(errand) {
      begin(errand);
    },
    playThese(list, pace) {
      speed.value = String(REPLAY_SPEEDS.find((s) => s >= pace) ?? REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1]);
      begin(undefined, list);
    },
  };
}
