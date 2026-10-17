/**
 * A match in the town: the round and phase, both keeps' HP, and the phase's
 * controls. The battle is simulated in the worker and played on the streets;
 * the keeps show their damage after each Siege phase. (The trade panel, the
 * ticker and the rest of the HUD come with M4.)
 */

import type * as THREE from 'three';
import type { Stage } from '../../castle/scene/castleView.js';
import { el } from '../../util/dom.js';
import { unitCount } from '../core/army.js';
import { damageState, type Match } from '../core/match.js';
import type { SideId } from '../core/types.js';
import { BattleView } from '../render/battleView.js';
import { BattleClient } from '../sim/battleClient.js';

/** The castle view, as far as a match uses it. */
export interface MatchScene {
  element: HTMLElement;
  stage(): Stage;
  setDamage(obj: THREE.Object3D, state: number): void;
  focusAt(x: number, z: number, zoom?: number): void;
}

export interface MatchPanelOptions {
  match: Match;
  /** The middle of the field, for the camera during the battle. */
  centre: { x: number; z: number };
  onLeave: () => void;
}

const PHASE_LABEL: Record<string, string> = { market: 'Market', trade: 'Trade', battle: 'Battle', siege: 'Siege', ended: 'Match over' };
/** Which placed pieces make each side's castle (CastleView's keys; the siege extension's). */
const CASTLE_KEYS: Record<SideId, string[]> = { A: ['castle'], B: ['enemy', 'enemy-piece', 'enemy-keep'] };

export class MatchPanel {
  readonly element = el('div', { class: 'siege-match' });
  readonly #opts: MatchPanelOptions;
  readonly #client = new BattleClient();
  #scene: MatchScene | null = null;
  #view: BattleView | null = null;
  #busy = false;
  #note = '';

  constructor(opts: MatchPanelOptions) {
    this.#opts = opts;
    this.render();
  }

  get match(): Match {
    return this.#opts.match;
  }

  /** The castle view the match plays in (again after every rebuild of the view). */
  attach(scene: MatchScene): void {
    this.#view?.dispose();
    this.#scene = scene;
    const m = this.match;
    this.#view = new BattleView({
      stage: scene.stage(),
      overlay: scene.element,
      symbol: (asset) => (m.catalog.has(asset) ? m.catalog.asset(asset).symbol : asset),
    });
    // the meshes load while the player trades
    void this.#view.prepare(['militia', 'paladin.eth', 'archer.oracle']);
    this.#showDamage();
    this.render();
  }

  dispose(): void {
    this.#view?.dispose();
    this.#view = null;
    this.#client.dispose();
  }

  render(): void {
    const s = this.match.state;
    const [a, b] = s.sides;
    const keepBar = (label: string, side: typeof a, cls: string) =>
      el(
        'div',
        { class: `siege-keep ${cls}` },
        el('span', {}, label),
        el('span', { class: 'siege-keep-bar' }, Object.assign(el('span', { class: 'siege-keep-fill' }), { style: `width: ${Math.max(0, (100 * side.keepHp) / side.keepHpMax).toFixed(1)}%` })),
        el('span', { class: 'siege-keep-hp' }, `${Math.min(Math.ceil(side.keepHp), Math.ceil(side.keepHpMax))} / ${Math.ceil(side.keepHpMax)}`),
      );
    const controls: HTMLElement[] = [];
    const button = (label: string, cls: string, fn: () => void, disabled = false) => {
      const btn = el('button', { class: `btn ${cls}`, type: 'button' }, label);
      if (disabled || this.#busy) btn.setAttribute('disabled', '');
      btn.addEventListener('click', fn);
      controls.push(btn);
    };
    if (s.phase === 'trade') button('⚔ To battle', 'siege-go', () => void this.#toBattle());
    if (s.phase === 'battle') {
      button('⏩ Skip', 'siege-skip', () => this.#view?.skip());
      button('2×', 'siege-fast', () => {
        if (this.#view) this.#view.speed = 2;
      });
    }
    if (s.phase === 'siege') {
      button(s.winner ? 'See the result' : 'Next round', 'siege-next', () => this.#nextRound());
      // the run is the battle: played again from it, it plays out the same
      const run = this.match.run;
      const armies = this.match.armies;
      if (run && armies) button('↺ Replay the battle', 'siege-replay', () => void this.#view?.play(run, armies));
    }
    if (s.phase === 'ended') button('New match', 'siege-new', () => this.#opts.onLeave());
    const leave = el('button', { class: 'btn siege-leave', type: 'button' }, 'Leave the match');
    leave.addEventListener('click', () => this.#opts.onLeave());
    const winner = s.winner === 'A' ? 'You win: the enemy keep has fallen!' : s.winner === 'B' ? 'Your keep has fallen.' : s.winner === 'draw' ? 'A draw: both keeps stand at the same strength.' : '';
    const momentum = s.momentum ? `Momentum: ${s.momentum === 'A' ? 'you' : 'the enemy'} (+10% ATK)` : '';
    this.element.replaceChildren(
      el('p', { class: 'siege-round' }, `Round ${s.round}${s.suddenDeath ? ' · sudden death' : ''} · ${PHASE_LABEL[s.phase] ?? s.phase}`, el('small', {}, ` · ${s.market.regime} market`)),
      keepBar('Your keep', a, 'siege-keep-A'),
      keepBar('Enemy keep', b, 'siege-keep-B'),
      ...(momentum ? [el('p', { class: 'siege-soon' }, momentum)] : []),
      ...(this.#note ? [el('p', { class: 'siege-note', role: 'status' }, this.#note)] : []),
      ...(winner ? [el('p', { class: 'siege-winner' }, winner)] : []),
      el('div', { class: 'siege-row' }, ...controls),
      leave,
    );
    this.element.dataset.phase = s.phase;
  }

  async #toBattle(): Promise<void> {
    const m = this.match;
    if (m.state.phase !== 'trade' && !(m.state.phase === 'market' && m.state.suddenDeath)) return;
    this.#busy = true;
    this.render();
    const armies = m.nextArmies();
    const run = await this.#client.run(armies, m.battleCtx());
    m.advance(run);
    this.#busy = false;
    const units = armies.map(unitCount);
    this.#note = `${units[0]} of yours against ${units[1]}.`;
    this.render();
    const c = this.#opts.centre;
    this.#scene?.focusAt(c.x, c.z, 0.55);
    await this.#view?.play(run, armies, () => this.#siege());
  }

  #siege(): void {
    const m = this.match;
    if (m.state.phase !== 'battle') return;
    const result = m.state.lastBattle;
    const before = m.state.sides.map((s) => s.keepHp);
    m.advance();
    const after = m.state.sides.map((s) => s.keepHp);
    this.#note = result
      ? `Siege: your survivors deal ${Math.round(before[1]! - after[1]!)} to the enemy keep, theirs ${Math.round(before[0]! - after[0]!)} to yours.`
      : '';
    this.#showDamage();
    this.render();
  }

  #nextRound(): void {
    const m = this.match;
    this.#view?.clear();
    m.advance();
    if (m.state.phase === 'market') {
      const ev = m.state.market.current;
      this.#note = ev ? `This week: ${ev.id.replace('-', ' ')}.` : 'A quiet week on the market.';
      // sudden death has no trade phase
      if (m.state.suddenDeath) {
        this.render();
        void this.#toBattle();
        return;
      }
      m.advance();
    }
    this.#showDamage();
    this.render();
  }

  /** Each castle shows its keep's HP as damage. */
  #showDamage(): void {
    const scene = this.#scene;
    if (!scene) return;
    showCastleDamage(scene, this.match.state.sides.map((s) => damageState(s.keepHp, s.keepHpMax)) as [number, number]);
  }
}

/**
 * Both castles' damage. Every wall segment carries the same cracks and breach
 * (docs/batches/20-siege-dressing.md), so along a wall every other one is
 * mirrored and one in three runs a state behind: the damage doesn't read as a
 * repeating pattern. The keep and the towers show the state itself.
 */
export function showCastleDamage(scene: MatchScene, states: readonly [number, number]): void {
  const stage = scene.stage();
  (['A', 'B'] as const).forEach((side, si) => {
    const state = states[si]!;
    let wall = 0;
    for (const key of CASTLE_KEYS[side]) {
      for (const obj of stage.placed(key)) {
        const segment = obj.name === 'castle.wall.segment';
        const n = segment ? wall++ : 0;
        if (segment) obj.scale.x = Math.abs(obj.scale.x) * (state > 0 && n % 2 === 1 ? -1 : 1);
        scene.setDamage(obj, segment && n % 3 === 2 ? Math.max(0, state - 1) : state);
      }
    }
  });
}
