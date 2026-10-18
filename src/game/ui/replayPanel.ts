/**
 * Watching a whole match again (the spec's "replay from event log"): a replay
 * (seed, setup, command log) rebuilds every battle exactly, and they play one
 * after another in the town, round by round, with the keeps as they stood,
 * then the recap. From a match just finished, or from a replay file.
 */

import { el } from '../../util/dom.js';
import { damageState, replayBattles, type BattleRecord, type Match, type Replay } from '../core/match.js';
import { BattleFx } from '../render/battleFx.js';
import { BattleView } from '../render/battleView.js';
import { FieldMarkers } from '../render/fieldMarkers.js';
import { showCastleDamage, type MatchScene } from './matchPanel.js';
import { recap } from './recap.js';

export interface ReplayPanelOptions {
  replay: Replay;
  onLeave: () => void;
}

export class ReplayPanel {
  readonly element = el('div', { class: 'siege-match siege-replay-panel' });
  readonly #opts: ReplayPanelOptions;
  #match: Match | null = null;
  #battles: BattleRecord[] = [];
  #index = 0;
  #scene: MatchScene | null = null;
  #view: BattleView | null = null;
  #markers: FieldMarkers | null = null;
  #fx: BattleFx | null = null;
  #error = '';
  #done = false;

  constructor(opts: ReplayPanelOptions) {
    this.#opts = opts;
    this.element.replaceChildren(el('p', {}, 'Rebuilding the match…'));
    // the battles are simulated again from the seed and the commands (a moment's work)
    setTimeout(() => {
      try {
        const r = replayBattles(opts.replay);
        this.#match = r.match;
        this.#battles = r.battles;
      } catch (error) {
        this.#error = error instanceof Error ? error.message : String(error);
      }
      this.render();
      void this.#play();
    }, 30);
  }

  attach(scene: MatchScene): void {
    this.#dispose3d();
    this.#scene = scene;
    this.#markers = new FieldMarkers(scene.stage());
    this.#fx = new BattleFx(scene.stage());
    void this.#fx.load();
    const points = this.#opts.replay.setup.map?.points ?? [];
    void this.#markers.place(points);
    this.#view = new BattleView({
      stage: scene.stage(),
      overlay: scene.element,
      symbol: (asset) => (this.#match?.catalog.has(asset) ? this.#match.catalog.asset(asset).symbol : asset),
      markers: this.#markers,
      fx: this.#fx,
      look: (x, z) => scene.focusAt(x, z),
    });
    void this.#play();
  }

  dispose(): void {
    this.#dispose3d();
  }

  render(): void {
    const m = this.#match;
    const leave = el('button', { class: 'btn siege-leave', type: 'button' }, 'Leave the replay');
    leave.addEventListener('click', () => this.#opts.onLeave());
    if (this.#error) {
      this.element.replaceChildren(el('p', { class: 'siege-message' }, `This replay can't be played: ${this.#error}`), leave);
      return;
    }
    if (!m) return;
    const b = this.#battles[this.#index];
    const controls: HTMLElement[] = [];
    const button = (label: string, cls: string, fn: () => void) => {
      const btn = el('button', { class: `btn ${cls}`, type: 'button' }, label);
      btn.addEventListener('click', fn);
      controls.push(btn);
    };
    const v = this.#view;
    if (!this.#done) {
      button(v?.paused ? '▶ Play' : '⏸ Pause', 'siege-battle-pause', () => {
        if (v) v.paused = !v.paused;
        this.render();
      });
      button(v && v.speed > 1 ? '1×' : '2×', 'siege-fast', () => {
        if (v) v.speed = v.speed > 1 ? 1 : 2;
        this.render();
      });
      button('⏭ Next battle', 'siege-replay-next', () => v?.skip());
    } else {
      button('↺ Watch again', 'siege-replay-again', () => {
        this.#index = 0;
        this.#done = false;
        void this.#play();
      });
    }
    this.element.replaceChildren(
      ...[
        el('div', { class: 'siege-head' }, el('span', { class: 'siege-round' }, this.#done ? 'Replay · the end' : `Replay · round ${b?.round ?? '–'} (battle ${this.#index + 1} of ${this.#battles.length})`)),
        this.#done ? recap(m, { A: null, B: null }) : null,
        el('div', { class: 'siege-row' }, ...controls),
        leave,
      ].filter((x): x is HTMLElement => x !== null),
    );
    this.element.dataset.phase = this.#done ? 'ended' : 'replay';
  }

  async #play(): Promise<void> {
    const view = this.#view;
    const scene = this.#scene;
    if (!view || !scene || !this.#match || this.#done) return;
    const b = this.#battles[this.#index];
    if (!b) {
      this.#done = true;
      this.render();
      return;
    }
    // the castles as they stood before this battle
    showCastleDamage(scene, [damageState(b.keeps[0], 1), damageState(b.keeps[1], 1)]);
    view.paused = false;
    view.speed = 1;
    this.render();
    await view.play(b.run, b.armies, () => {
      this.#index++;
      setTimeout(() => void this.#play(), 800);
    }, b.owners);
  }

  #dispose3d(): void {
    this.#view?.dispose();
    this.#markers?.dispose();
    this.#fx?.dispose();
    this.#view = null;
    this.#markers = null;
    this.#fx = null;
  }
}
