/**
 * A match in the town (spec: "Core match loop"): the round, the phase and its
 * timer, the regime, both keeps' HP, and per phase what it shows. The Market
 * week plays its candles day by day; the Trade phase has 30 seconds (paused at
 * will, against an NPC), the rumor, the loans' health, the portfolio and the
 * trade panel, a courier for every action; the battle is simulated in the
 * worker and played on the streets; the keeps show their damage after each
 * Siege phase.
 */

import type * as THREE from 'three';
import type { Stage } from '../../castle/scene/castleView.js';
import type { BuildingPlacement } from '../../castle/scene/plan.js';
import type { Errand } from '../../castle/world/world.js';
import { el } from '../../util/dom.js';
import { unitCount } from '../core/army.js';
import { gasCost } from '../core/ledger.js';
import { EVENTS } from '../core/market.js';
import { damageState, type Match } from '../core/match.js';
import type { Command, SideId } from '../core/types.js';
import { BattleView } from '../render/battleView.js';
import { tradeErrand } from '../render/tradeCouriers.js';
import { BattleClient } from '../sim/battleClient.js';
import { gauges, portfolio, regimeBadge, rumorCard, ticker } from './hud.js';
import { TradePanel } from './tradePanel.js';

/** The castle view, as far as a match uses it. */
export interface MatchScene {
  element: HTMLElement;
  stage(): Stage;
  setDamage(obj: THREE.Object3D, state: number): void;
  focusAt(x: number, z: number, zoom?: number): void;
  readonly plan: { buildings: BuildingPlacement[] };
  sendNow(errand: Errand): void;
}

export interface MatchPanelOptions {
  match: Match;
  /** The middle of the field, for the camera during the battle. */
  centre: { x: number; z: number };
  onLeave: () => void;
  /** Seconds of a Trade phase (spec: 30), and of one day of the Market week (spec: ~8 s a week). */
  tradeSeconds?: number;
  marketDaySeconds?: number;
}

const PHASE_LABEL: Record<string, string> = { market: 'Market', trade: 'Trade', battle: 'Battle', siege: 'Siege', ended: 'Match over' };
/** Which placed pieces make each side's castle (CastleView's keys; the siege extension's). */
const CASTLE_KEYS: Record<SideId, string[]> = { A: ['castle'], B: ['enemy', 'enemy-piece', 'enemy-keep'] };

export class MatchPanel {
  readonly element = el('div', { class: 'siege-match' });
  readonly #opts: MatchPanelOptions;
  readonly #client = new BattleClient();
  readonly #trade: TradePanel;
  #scene: MatchScene | null = null;
  #view: BattleView | null = null;
  #busy = false;
  #note = '';
  /** The Trade phase's seconds left, and whether its clock is stopped. */
  #left = 0;
  #paused = false;
  /** Days of the Market week shown so far. */
  #day = 7;
  #clock: ReturnType<typeof setInterval> | null = null;
  #showPortfolio = false;

  constructor(opts: MatchPanelOptions) {
    this.#opts = opts;
    this.#trade = new TradePanel({ match: opts.match, onCommand: (cmd) => this.#courier(cmd) });
    this.#openTrade();
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
    this.#stopClock();
    this.#view?.dispose();
    this.#view = null;
    this.#client.dispose();
  }

  render(): void {
    const m = this.match;
    const s = m.state;
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
    const body: (HTMLElement | null)[] = [];
    if (s.phase === 'market') {
      body.push(el('p', { class: 'siege-soon' }, `The market moves: day ${Math.max(1, Math.min(7, this.#day))} of 7`), ticker(m, 'A', this.#day));
      button('⏩ Skip', 'siege-skip', () => this.#endMarket());
    }
    if (s.phase === 'trade') {
      body.push(ticker(m), rumorCard(m), gauges(m));
      if (s.market.gasMult > 1) body.push(el('p', { class: 'siege-warning' }, `⛽ Gas spike: every action costs ${s.market.gasMult}× gas this round.`));
      const toggle = el('button', { class: 'btn siege-portfolio-toggle', type: 'button', 'aria-expanded': String(this.#showPortfolio) }, this.#showPortfolio ? '▾ Your portfolio' : '▸ Your portfolio');
      toggle.addEventListener('click', () => {
        this.#showPortfolio = !this.#showPortfolio;
        this.render();
      });
      body.push(toggle, this.#showPortfolio ? portfolio(m) : null, this.#trade.element);
      button(this.#paused ? '▶ Resume' : '⏸ Pause', 'siege-pause', () => {
        this.#paused = !this.#paused;
        this.render();
      });
      button('⚔ To battle', 'siege-go', () => void this.#toBattle());
    }
    if (s.phase === 'battle') {
      button('⏩ Skip', 'siege-skip', () => this.#view?.skip());
      button('2×', 'siege-fast', () => {
        if (this.#view) this.#view.speed = 2;
      });
    }
    if (s.phase === 'siege') {
      button(s.winner ? 'See the result' : 'Next round', 'siege-next', () => this.#nextRound());
      // the run is the battle: played again from it, it plays out the same
      const run = m.run;
      const armies = m.armies;
      if (run && armies) button('↺ Replay the battle', 'siege-replay', () => void this.#view?.play(run, armies));
    }
    if (s.phase === 'ended') button('New match', 'siege-new', () => this.#opts.onLeave());
    const leave = el('button', { class: 'btn siege-leave', type: 'button' }, 'Leave the match');
    leave.addEventListener('click', () => this.#opts.onLeave());
    const winner = s.winner === 'A' ? 'You win: the enemy keep has fallen!' : s.winner === 'B' ? 'Your keep has fallen.' : s.winner === 'draw' ? 'A draw: both keeps stand at the same strength.' : '';
    const momentum = s.momentum && s.phase === 'trade' ? el('p', { class: 'siege-soon' }, `Momentum: ${s.momentum === 'A' ? 'you' : 'the enemy'} had the better week (+10% ATK this battle)`) : null;
    const timer = s.phase === 'trade' ? el('span', { class: `siege-timer${this.#paused ? ' paused' : ''}`, 'aria-label': 'Seconds left to trade' }, this.#paused ? '⏸' : `${Math.ceil(this.#left)} s`) : null;
    this.element.replaceChildren(
      ...[
        el('div', { class: 'siege-head' }, el('span', { class: 'siege-round' }, `Round ${s.round}${s.suddenDeath ? ' · sudden death' : ''} · ${PHASE_LABEL[s.phase] ?? s.phase}`), timer, regimeBadge(s.market.regime)),
        keepBar('Your keep', a, 'siege-keep-A'),
        keepBar('Enemy keep', b, 'siege-keep-B'),
        momentum,
        this.#note ? el('p', { class: 'siege-note', role: 'status' }, this.#note) : null,
        winner ? el('p', { class: 'siege-winner' }, winner) : null,
        ...body,
        el('div', { class: 'siege-row' }, ...controls),
        leave,
      ].filter((x): x is HTMLElement => x !== null),
    );
    this.element.dataset.phase = s.phase;
  }

  // ---------- phases ----------

  #openTrade(): void {
    const m = this.match;
    this.#left = this.#opts.tradeSeconds ?? 30;
    this.#paused = false;
    this.#trade.render();
    this.render();
    this.#startClock(0.25, () => {
      if (m.state.phase !== 'trade' || this.#busy) return;
      if (!this.#paused) this.#left -= 0.25;
      if (this.#left <= 0) void this.#toBattle();
      else {
        const t = this.element.querySelector('.siege-timer');
        if (t && !this.#paused) t.textContent = `${Math.ceil(this.#left)} s`;
      }
    });
  }

  #openMarket(): void {
    const m = this.match;
    const ev = m.state.market.current;
    const liq = m.side('A').liquidations;
    this.#note = [
      ev ? `This week: ${EVENTS[ev.id].name}.` : 'A quiet week on the market.',
      ...liq.map((l) => `💥 Liquidated on day ${l.day + 1}: $${Math.round(l.seized.reduce((s, x) => s + x.value, 0)).toLocaleString('en-US')} of collateral seized. It blows up at the next battle.`),
    ].join(' ');
    this.#day = 0;
    this.render();
    this.#startClock(this.#opts.marketDaySeconds ?? 8 / 7, () => {
      this.#day++;
      if (this.#day >= 7) this.#endMarket();
      else this.render();
    });
  }

  #endMarket(): void {
    const m = this.match;
    this.#stopClock();
    this.#day = 7;
    if (m.state.phase !== 'market') return;
    // sudden death has no trade phase
    if (m.state.suddenDeath) {
      void this.#toBattle();
      return;
    }
    m.advance();
    this.#openTrade();
  }

  async #toBattle(): Promise<void> {
    const m = this.match;
    if (this.#busy) return;
    if (m.state.phase !== 'trade' && !(m.state.phase === 'market' && m.state.suddenDeath)) return;
    this.#stopClock();
    this.#busy = true;
    // the player's time is up; the opponent ends too
    m.command('A', { t: 'endTrade' });
    m.command('B', { t: 'endTrade' });
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
    const before = m.state.sides.map((s) => s.keepHp);
    m.advance();
    const after = m.state.sides.map((s) => s.keepHp);
    this.#note = `Siege: your survivors deal ${Math.round(before[1]! - after[1]!)} to the enemy keep, theirs ${Math.round(before[0]! - after[0]!)} to yours.`;
    this.#showDamage();
    this.render();
  }

  #nextRound(): void {
    const m = this.match;
    this.#view?.clear();
    m.advance();
    this.#showDamage();
    if (m.state.phase === 'market') this.#openMarket();
    else this.render();
  }

  // ---------- helpers ----------

  #courier(cmd: Command): void {
    const scene = this.#scene;
    const m = this.match;
    if (scene) scene.sendNow(tradeErrand(m, cmd, scene.plan.buildings, gasCost({ unitValue: m.state.unitValue, gasMult: m.state.market.gasMult })));
    this.render();
  }

  #startClock(seconds: number, fn: () => void): void {
    this.#stopClock();
    this.#clock = setInterval(fn, seconds * 1000);
  }

  #stopClock(): void {
    if (this.#clock) clearInterval(this.#clock);
    this.#clock = null;
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
export function showCastleDamage(scene: Pick<MatchScene, 'stage' | 'setDamage'>, states: readonly [number, number]): void {
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
