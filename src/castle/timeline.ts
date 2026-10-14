/**
 * The replay timeline over the scene: play the guild's history window as time
 * passing (an hour, a day or a week of it per second), pause, drag to any day;
 * couriers set out as the clock passes their transactions. "Live" goes back to
 * the scene's own life (new transactions, the recent ones again). One per
 * scene view; it stops by itself when the view leaves the page.
 */

import { el, fmtDate } from '../util/dom.js';
import { REPLAY_SPEEDS, ReplayClock } from './world/replay.js';
import type { CastleView } from './scene/castleView.js';
import type { Errand } from './world/world.js';

const TICK_MS = 200;
/** The slider's steps across the window. */
const STEPS = 1000;

/** Adds the "⏱ Replay" button and its timeline bar to a scene view. */
export function attachTimeline(view: CastleView, errands: readonly Errand[]): void {
  let clock: ReplayClock<Errand> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const open = el('button', { class: 'btn scene-action replay-open', type: 'button', 'aria-label': 'Replay your history' }, '⏱ Replay');
  const play = el('button', { class: 'btn timeline-play', type: 'button', 'aria-label': 'Pause' }, '⏸');
  const slider = el('input', { type: 'range', min: '0', max: String(STEPS), step: '1', value: '0', 'aria-label': 'Replay position', class: 'timeline-slider' });
  const when = el('span', { class: 'timeline-when' });
  const speed = el('select', { 'aria-label': 'Replay speed', class: 'timeline-speed' });
  REPLAY_SPEEDS.forEach((s, i) => speed.append(el('option', { value: String(i) }, s.label)));
  speed.value = '1';
  const live = el('button', { class: 'btn timeline-live', type: 'button' }, 'Live');
  const bar = el('div', { class: 'timeline', role: 'group', 'aria-label': 'Replay timeline', hidden: '' }, play, slider, when, speed, live);

  const show = () => {
    if (!clock) return;
    slider.value = String(Math.round(clock.progress * STEPS));
    when.textContent = fmtDate(clock.position);
    play.textContent = clock.playing ? '⏸' : '▶';
    play.setAttribute('aria-label', clock.playing ? 'Pause' : 'Play');
    view.element.dataset.replay = clock.playing ? 'playing' : 'paused';
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    if (!view.element.isConnected) return stop();
    if (!clock) return;
    const passed = clock.advance(TICK_MS / 1000);
    if (passed.length) view.enqueue(passed, true);
    show();
  };

  open.addEventListener('click', () => {
    clock = new ReplayClock(errands);
    clock.speed = REPLAY_SPEEDS[Number(speed.value)]?.ms ?? REPLAY_SPEEDS[1].ms;
    clock.playing = true;
    view.setAutoReplay(false);
    view.clearQueue();
    bar.hidden = false;
    open.hidden = true;
    stop();
    timer = setInterval(tick, TICK_MS);
    show();
  });
  play.addEventListener('click', () => {
    if (!clock) return;
    if (!clock.playing && clock.progress >= 1) clock.seek(clock.from); // at the end: from the start again
    clock.playing = !clock.playing;
    show();
  });
  slider.addEventListener('input', () => {
    if (!clock) return;
    clock.seek(clock.from + (Number(slider.value) / STEPS) * (clock.to - clock.from));
    view.clearQueue();
    show();
  });
  speed.addEventListener('change', () => {
    if (clock) clock.speed = REPLAY_SPEEDS[Number(speed.value)]?.ms ?? clock.speed;
  });
  live.addEventListener('click', () => {
    stop();
    clock = null;
    bar.hidden = true;
    open.hidden = false;
    view.clearQueue();
    view.setAutoReplay(true);
    delete view.element.dataset.replay;
  });

  view.element.append(open, bar);
}
