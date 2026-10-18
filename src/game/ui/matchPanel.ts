/**
 * A match in the town (spec: "Core match loop"): the round, the phase and its
 * timer, the regime, both keeps' HP, and per phase what it shows. The Market
 * week plays its candles day by day; the Trade phase has 30 seconds (paused at
 * will, against an NPC), the rumor, the loans' health, the portfolio and the
 * trade panel, a courier for every action; the battle is simulated in the
 * worker and played on the streets; the keeps show their damage after each
 * Siege phase.
 */

import * as THREE from 'three';
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
import type { MatchClient } from '../sim/matchClient.js';
import { fieldPanel, gauges, portfolio, powersPanel, regimeBadge, rumorCard, ticker, warnAt } from './hud.js';
import { FieldMarkers } from '../render/fieldMarkers.js';
import { BattleFx } from '../render/battleFx.js';
import { UnitMesh } from '../render/unitMeshes.js';
import { abilityName } from '../core/depth.js';
import { proxied } from '../../castle/scene/castleView.js';
import { hashString } from '../../util/rng.js';
import { account, holdingsOf } from '../core/ledger.js';
import { weatherFor, type Weather } from '../../castle/world/sky.js';
import { TradePanel } from './tradePanel.js';
import { qn } from '../core/fixed.js';

/** The castle view, as far as a match uses it. */
export interface MatchScene {
  element: HTMLElement;
  stage(): Stage;
  setDamage(obj: THREE.Object3D, state: number): void;
  focusAt(x: number, z: number, zoom?: number): void;
  readonly plan: { buildings: BuildingPlacement[] };
  sendNow(errand: Errand): void;
  setWeather(w: Weather): void;
}

/** The weather a market event brings over the town (spec: "Battlefield look"). */
const EVENT_WEATHER: Partial<Record<string, Weather>> = {
  'black-swan': { rain: 1, gloom: 0.85, clouds: 1, shine: 0 },
  'bull-run': { rain: 0, gloom: 0, clouds: 0.05, shine: 1 },
};

export interface MatchPanelOptions {
  /** The match: its replica on the page, the authoritative one in a worker (sim/matchClient.ts). */
  client: MatchClient;
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
  readonly #client: MatchClient;
  /** The NPC is deciding its trades (the player trades after: both copies apply them in the same order). */
  #npcPending = false;
  readonly #trade: TradePanel;
  #scene: MatchScene | null = null;
  #view: BattleView | null = null;
  #markers: FieldMarkers | null = null;
  #fx: BattleFx | null = null;
  readonly #props: THREE.Object3D[] = [];
  #dancers: UnitMesh | null = null;
  /** Your keep's max HP as last seen (new walls are celebrated). */
  #keepMax = 0;
  #flag: { obj: THREE.Object3D } | null = null;
  #flagStop: (() => void) | null = null;
  #stopDance: (() => void) | null = null;
  #busy = false;
  #note = '';
  /** The Trade phase's seconds left, and whether its clock is stopped. */
  #left = 0;
  #paused = false;
  /** Days of the Market week shown so far. */
  #day = 7;
  #clock: ReturnType<typeof setInterval> | null = null;
  #showPortfolio = false;
  /** What the NPC did this Trade phase (public: a PvP opponent's trades would show the same way). */
  #enemyMoves = '';
  /** Who held the buildings as the last battle began (its replay starts from there). */
  #ownersBefore: Record<string, SideId | null> = {};

  constructor(opts: MatchPanelOptions) {
    this.#opts = opts;
    this.#client = opts.client;
    this.#trade = new TradePanel({ match: opts.client.replica, command: (cmd) => opts.client.command('A', cmd), onCommand: (cmd) => this.#courier(cmd) });
    this.#openTrade();
  }

  get match(): Match {
    return this.#client.replica;
  }

  /** The castle view the match plays in (again after every rebuild of the view). */
  attach(scene: MatchScene): void {
    this.#view?.dispose();
    this.#markers?.dispose();
    this.#scene = scene;
    const m = this.match;
    this.#markers = new FieldMarkers(scene.stage());
    this.#fx?.dispose();
    this.#fx = new BattleFx(scene.stage());
    void this.#fx.load();
    const points = m.battleCtx().map?.points ?? [];
    void this.#markers.place(points).then(() => this.#markers?.setOwners(m.battleCtx().owners));
    this.#view = new BattleView({
      stage: scene.stage(),
      overlay: scene.element,
      symbol: (asset) => (m.catalog.has(asset) ? m.catalog.asset(asset).symbol : asset),
      badge: (asset) => {
        const a = m.catalog.has(asset) ? m.catalog.asset(asset) : null;
        return { ...(a?.icon ? { icon: proxied(a.icon) } : {}), color: a?.color ?? `hsl(${hashString(asset) % 360} 55% 50%)` };
      },
      markers: this.#markers,
      fx: this.#fx,
      look: (x, z) => this.#scene?.focusAt(x, z),
      abilityName: (side, ability) => abilityName(this.match.side(side), ability),
    });
    // the meshes load while the player trades
    this.#preload();
    this.#showDamage();
    if (m.state.phase === 'trade' || m.state.phase === 'market') this.#overview();
    this.render();
  }

  dispose(): void {
    this.#stopClock();
    this.#view?.dispose();
    this.#view = null;
    this.#markers?.dispose();
    this.#markers = null;
    this.#fx?.dispose();
    this.#fx = null;
    this.#flag?.obj.removeFromParent();
    this.#flagStop?.();
    this.#flag = null;
    this.#clearProps();
    this.#scene?.setWeather(weatherFor(null));
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
      body.push(ticker(m), rumorCard(m), this.#enemyMoves ? el('p', { class: 'siege-enemy-moves' }, this.#enemyMoves) : null, gauges(m), powersPanel(m), fieldPanel(m));
      if (s.market.gasMult > 1) body.push(el('p', { class: 'siege-warning' }, `⛽ Gas spike: every action costs ${s.market.gasMult}× gas this round.`));
      const toggle = el('button', { class: 'btn siege-portfolio-toggle', type: 'button', 'aria-expanded': String(this.#showPortfolio) }, this.#showPortfolio ? '▾ Your portfolio' : '▸ Your portfolio');
      toggle.addEventListener('click', () => {
        this.#showPortfolio = !this.#showPortfolio;
        this.render();
      });
      body.push(toggle, this.#showPortfolio ? portfolio(m) : null, this.#npcPending ? el('p', { class: 'siege-soon' }, 'Waiting for the enemy’s trades…') : this.#trade.element);
      button(this.#paused ? '▶ Resume' : '⏸ Pause', 'siege-pause', () => {
        this.#paused = !this.#paused;
        this.render();
      });
      button('⚔ To battle', 'siege-go', () => void this.#toBattle());
    }
    if (s.phase === 'battle') {
      // the camera: free, or following a lane's fighting
      const follow = el('select', { class: 'siege-follow', 'aria-label': 'Camera' }, ...[
        ['free', '🎥 Free camera'],
        ['0', '🎥 Follow the left lane'],
        ['1', '🎥 Follow the centre'],
        ['2', '🎥 Follow the right lane'],
      ].map(([v, label]) => {
        const o = el('option', { value: v! }, label!);
        o.selected = (this.#view?.follow === null ? 'free' : String(this.#view?.follow)) === v;
        return o;
      }));
      follow.addEventListener('change', () => {
        if (this.#view) this.#view.follow = follow.value === 'free' ? null : Number(follow.value);
      });
      controls.push(follow);
      const v = this.#view;
      button(v?.paused ? '▶ Play' : '⏸ Pause', 'siege-battle-pause', () => {
        if (v) v.paused = !v.paused;
        this.render();
      });
      button(v && v.speed > 1 ? '1×' : '2×', 'siege-fast', () => {
        if (v) v.speed = v.speed > 1 ? 1 : 2;
        this.render();
      });
      button('⏩ Skip', 'siege-skip', () => {
        if (v) v.paused = false;
        v?.skip();
      });
    }
    if (s.phase === 'siege') {
      body.push(fieldPanel(m));
      button(s.winner ? 'See the result' : 'Next round', 'siege-next', () => void this.#nextRound());
      // the run is the battle: played again from it, it plays out the same
      const run = m.run;
      const armies = m.armies;
      if (run && armies) button('↺ Replay the battle', 'siege-replay', () => void this.#view?.play(run, armies, undefined, this.#ownersBefore));
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
    // the NPC trades by the same rules, through the same commands (decided in the worker)
    if (m.side('B').isNpc) {
      this.#npcPending = true;
      this.#enemyMoves = 'The enemy is trading…';
      void this.#client.npc('B').then((done) => {
        const said = done.map((c) => describe(m, c));
        this.#enemyMoves = said.length > 0 ? `The enemy traded: ${said.join('; ')}.` : 'The enemy holds.';
        this.#npcPending = false;
        this.#trade.render();
        this.render();
      });
    }
    this.#left = this.#opts.tradeSeconds ?? 30;
    this.#paused = false;
    this.#keepMax = m.side('A').keepHpMax;
    this.#loanFlag();
    if (this.#view) this.#view.follow = null;
    this.#overview();
    this.#preload();
    this.#trade.render();
    this.render();
    this.#startClock(0.25, () => {
      if (m.state.phase !== 'trade' || this.#busy || this.#npcPending) return;
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
    this.#eventLook(ev?.id ?? null);
    if (ev?.id === 'slashing') {
      const temple = m.battleCtx().map?.points?.find((p) => p.kind === 'temple');
      if (temple) this.#fx?.burst('fx.lightning', temple.x, 0, temple.z);
    }
    const liq = m.side('A').liquidations;
    this.#note = [
      ev ? `This week: ${EVENTS[ev.id].name}.` : 'A quiet week on the market.',
      ...liq.map((l) => `💥 Liquidated on day ${l.day + 1}: $${Math.round(l.seized.reduce((s, x) => s + x.value, 0)).toLocaleString('en-US')} of collateral seized. It blows up at the next battle.`),
    ].join(' ');
    this.#day = 0;
    this.#overview();
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
    void this.#client.advance().then(() => this.#openTrade());
  }

  async #toBattle(): Promise<void> {
    const m = this.match;
    if (this.#busy || this.#npcPending) return;
    if (m.state.phase !== 'trade' && !(m.state.phase === 'market' && m.state.suddenDeath)) return;
    this.#stopClock();
    this.#busy = true;
    // the player's time is up; the opponent ends too
    this.#client.command('A', { t: 'endTrade' });
    this.#client.command('B', { t: 'endTrade' });
    this.render();
    const armies = m.nextArmies();
    const ctx = m.battleCtx();
    this.#ownersBefore = ctx.owners;
    // the worker simulates the battle; the page's copy takes its outcome
    const run = await this.#client.advance();
    this.#busy = false;
    if (!run) {
      this.render();
      return;
    }
    const units = armies.map(unitCount);
    this.#note = `${units[0]} of yours against ${units[1]}.`;
    this.render();
    const c = this.#opts.centre;
    this.#scene?.focusAt(c.x, c.z, 0.55);
    if (this.#view) {
      this.#view.paused = false;
      this.#view.speed = 1;
    }
    await this.#view?.play(run, armies, () => void this.#siege(), this.#ownersBefore);
  }

  async #siege(): Promise<void> {
    const m = this.match;
    if (m.state.phase !== 'battle' || this.#busy) return;
    const before = m.state.sides.map((s) => s.keepHp);
    this.#busy = true;
    await this.#client.advance();
    this.#busy = false;
    const after = m.state.sides.map((s) => s.keepHp);
    this.#note = `Siege: your survivors deal ${Math.round(before[1]! - after[1]!)} to the enemy keep, theirs ${Math.round(before[0]! - after[0]!)} to yours.`;
    const [mine, theirs] = m.state.felled;
    if (mine > 0) this.#note += ` 🏹 Your walls' archers felled ${mine} attacker${mine === 1 ? '' : 's'} at the gate.`;
    if (theirs > 0) this.#note += ` 🏹 The enemy walls felled ${theirs} of yours.`;
    for (const id of m.state.shutdowns) this.#note += ` 🛡 ${id === 'A' ? 'Your' : 'The enemy'} vault called ${abilityName(m.side(id), 'emergency-shutdown')}: the keep took no damage.`;
    this.#markers?.setOwners(m.battleCtx().owners);
    this.#showDamage();
    // stones fly off the walls that were hit
    const gates = m.battleCtx().map?.gates;
    if (gates && this.#fx) {
      // the walls' volley: arrows from the front wall at the attackers before its gate
      const volley = (count: number, g: { x: number; z: number }, dir: number) => {
        for (let i = 0; i < Math.min(12, count); i++) {
          const x = g.x + ((i % 6) - 2.5) * 1.6;
          this.#fx!.shoot('fx.arrow', new THREE.Vector3(x, 3.2, g.z + dir * 5), new THREE.Vector3(x + ((i * 7) % 5) - 2, 1, g.z - dir * (2 + (i % 4))));
        }
      };
      volley(m.state.felled[0], gates.A, -1);
      volley(m.state.felled[1], gates.B, 1);
      const hit = (side: 0 | 1, g: { x: number; z: number }, dir: number) => {
        if (before[side]! - after[side]! <= 0) return;
        // at the foot of the front wall (5.3 m behind the gate point), the wall towards the castle
        for (const dx of [-3, 0, 3]) this.#fx!.burst('fx.siege.impact', g.x + dx, 0, g.z + dir * 5.3, dir > 0 ? Math.PI : 0);
      };
      hit(0, gates.A, -1);
      hit(1, gates.B, 1);
    }
    this.render();
  }

  async #nextRound(): Promise<void> {
    const m = this.match;
    if (this.#busy) return;
    this.#view?.clear();
    this.#busy = true;
    await this.#client.advance();
    this.#busy = false;
    this.#showDamage();
    if (m.state.phase === 'market') this.#openMarket();
    else this.render();
  }

  // ---------- helpers ----------

  #courier(cmd: Command): void {
    const scene = this.#scene;
    const m = this.match;
    if (scene) scene.sendNow(tradeErrand(m, cmd, scene.plan.buildings, gasCost({ unitValue: m.state.unitValue, gasMult: m.state.market.gasMult })));
    // new walls: the masons raise them as the courier comes home with the stones
    const max = m.side('A').keepHpMax;
    if (max > this.#keepMax + 0.5) {
      this.#note = `🧱 The masons raise your walls: +${Math.round(max - this.#keepMax)} HP.`;
      setTimeout(() => this.#raiseWalls(), 2500);
    }
    this.#keepMax = max;
    this.#loanFlag();
    this.render();
  }

  /** Sparkles along the front wall, where the new stones go in. */
  #raiseWalls(): void {
    const scene = this.#scene;
    if (!scene || !this.#fx) return;
    const walls = scene
      .stage()
      .placed('castle')
      .filter((o) => o.name === 'castle.wall.segment')
      .sort((a, b) => b.position.z - a.position.z)
      .slice(0, 8);
    walls.forEach((w, i) => setTimeout(() => this.#fx?.burst('fx.sparkle.burst', w.position.x, 2.6, w.position.z), i * 120));
  }

  /**
   * A loan in danger (spec: "the courier at that lending building waves a red
   * flag"): a red banner by the lending building's door while any loan's
   * health is under the warning line.
   */
  #loanFlag(): void {
    const scene = this.#scene;
    if (!scene) return;
    const m = this.match;
    const me = m.side('A');
    const ctx = { catalog: m.catalog, prices: m.state.market.prices };
    const danger = (['lending', 'vault'] as const).some((p) => {
      const a = account(me, p, ctx);
      return a.debt > 0 && a.hf < warnAt(m);
    });
    const bank = scene.plan.buildings.find((b) => b.protocol.category === 'lending');
    if (!danger || !bank) {
      this.#flag?.obj.removeFromParent();
      this.#flagStop?.();
      this.#flag = null;
      this.#flagStop = null;
      return;
    }
    if (this.#flag) return;
    void scene
      .stage()
      .load('prop.banner.owner')
      .then((loaded) => {
        if (!loaded || this.#flag || !this.#scene) return;
        const obj = loaded.scene.clone(true);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const recolor = (mat: THREE.Material) => {
            if (mat.name !== 'Tint' || !('color' in mat)) return mat;
            const c = mat.clone() as THREE.MeshStandardMaterial;
            c.color.set('#d0302a');
            return c;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
        });
        obj.position.set(bank.door.x + Math.sign(bank.door.x || 1) * 0.8, 0, bank.door.z + 0.6);
        const stage = this.#scene.stage();
        stage.scene.add(obj);
        const idle = loaded.clips.find((c) => c.name === 'idle');
        const mixer = idle ? new THREE.AnimationMixer(obj) : null;
        if (mixer && idle) mixer.clipAction(idle).play();
        this.#flag = { obj };
        this.#flagStop = stage.onFrame((dt) => mixer?.update(dt));
      });
  }

  /** The camera over the whole field (the Market and Trade phases). */
  #overview(): void {
    const c = this.#opts.centre;
    this.#scene?.focusAt(c.x, c.z, 0.42);
  }

  /** Both armies' unit models, loaded while the player trades (the battle then starts at once). */
  #preload(): void {
    const units = this.match.nextArmies().flatMap((a) => a.squads.map((q) => q.unit));
    void this.#view?.prepare(['militia', ...units]);
  }

  /** Shows an event's look on the town (no change to the match: for checking the visuals). */
  previewEvent(event: string | null): void {
    this.#eventLook(event);
  }

  /** What the week's event looks like on the town: a storm, golden light, a cart of airdropped goods at each gate. */
  #eventLook(event: string | null): void {
    const scene = this.#scene;
    if (!scene) return;
    scene.setWeather(EVENT_WEATHER[event ?? ''] ?? weatherFor(null));
    this.#clearProps();
    if (event === 'meme-mania') void this.#danceOnRoofs();
    const gates = this.match.battleCtx().map?.gates;
    if (event === 'airdrop' && gates) {
      void scene
        .stage()
        .load('prop.cart')
        .then((cart) => {
          if (!cart || !this.#scene) return;
          for (const [g, dir] of [
            [gates.A, 1],
            [gates.B, -1],
          ] as const) {
            const c = cart.scene.clone(true);
            c.position.set(g.x + 2.5, 0, g.z + dir * 3);
            c.rotation.y = dir > 0 ? 0.4 : Math.PI + 0.4;
            scene.stage().scene.add(c);
            this.#props.push(c);
          }
        });
    }
  }

  #clearProps(): void {
    for (const p of this.#props) p.removeFromParent();
    this.#props.length = 0;
    this.#dancers?.dispose();
    this.#dancers = null;
    this.#stopDance?.();
    this.#stopDance = null;
  }

  /** Meme Mania: goblins dancing on the town's rooftops for the week. */
  async #danceOnRoofs(): Promise<void> {
    const scene = this.#scene;
    if (!scene) return;
    const stage = scene.stage();
    const goblin = await stage.load('unit.swarm.goblin');
    if (!goblin || !this.#scene) return;
    // the biggest buildings' roofs, two goblins on each: a ray straight down finds the roof itself
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const visible = (o: THREE.Object3D) => {
      for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    const spots: { x: number; z: number; y: number }[] = [];
    const buildings = stage
      .placed('building')
      .map((b) => ({ b, box: new THREE.Box3().setFromObject(b) }))
      .filter(({ box }) => !box.isEmpty())
      .sort((p, q) => q.box.getSize(new THREE.Vector3()).x * q.box.getSize(new THREE.Vector3()).z - p.box.getSize(new THREE.Vector3()).x * p.box.getSize(new THREE.Vector3()).z)
      .slice(0, 6);
    for (const { b, box } of buildings) {
      const c = box.getCenter(new THREE.Vector3());
      for (const dx of [-0.7, 0.7]) {
        ray.set(new THREE.Vector3(c.x + dx, box.max.y + 5, c.z), down);
        const hit = ray.intersectObject(b, true).find((h) => visible(h.object));
        if (hit) spots.push({ x: hit.point.x, z: hit.point.z, y: hit.point.y });
      }
    }
    const dancers = new UnitMesh(goblin, spots.length);
    stage.scene.add(dancers.mesh);
    this.#dancers = dancers;
    const neutral = new THREE.Color('#d9b23a');
    let t = 0;
    this.#stopDance = stage.onFrame((dt) => {
      t += dt;
      // a little bigger than life, to be seen from the overview
      spots.forEach((p, i) => dancers.set(i, p.x, p.z, t * 0.8 + i, 'cheer', t + i * 0.3, true, neutral, p.y, 1.6));
      dancers.commit(spots.length);
    });
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
    const s = this.match.state;
    // a depeg crumbles wall sections of every castle that holds the stablecoin
    const ev = s.market.current;
    const depegged = ev?.id === 'depeg' ? ev.target : undefined;
    const crumble = s.sides.map((x) => depegged !== undefined && holdingsOf(x).some((h) => h.asset === depegged)) as [boolean, boolean];
    showCastleDamage(scene, s.sides.map((x) => damageState(x.keepHp, x.keepHpMax)) as [number, number], crumble);
  }
}

/**
 * Both castles' damage. Every wall segment carries the same cracks and breach
 * (docs/batches/20-siege-dressing.md), so along a wall every other one is
 * mirrored and one in three runs a state behind: the damage doesn't read as a
 * repeating pattern. The keep and the towers show the state itself.
 */
export function showCastleDamage(scene: Pick<MatchScene, 'stage' | 'setDamage'>, states: readonly [number, number], crumble: readonly [boolean, boolean] = [false, false]): void {
  const stage = scene.stage();
  (['A', 'B'] as const).forEach((side, si) => {
    const state = states[si]!;
    let wall = 0;
    for (const key of CASTLE_KEYS[side]) {
      for (const obj of stage.placed(key)) {
        const segment = obj.name === 'castle.wall.segment';
        const n = segment ? wall++ : 0;
        if (segment) obj.scale.x = Math.abs(obj.scale.x) * (state > 0 && n % 2 === 1 ? -1 : 1);
        let shown = segment && n % 3 === 2 ? Math.max(0, state - 1) : state;
        // a depeg: every fourth wall section breached
        if (crumble[si] && segment && n % 4 === 1) shown = Math.max(shown, 2);
        scene.setDamage(obj, shown);
      }
    }
  });
}

/** A command in words, for the HUD ("swapped 2.5 ETH for USDC"). */
export function describe(m: Match, cmd: Command): string {
  const sym = (id: string) => (m.catalog.has(id) ? m.catalog.asset(id).symbol : id);
  const amt = (q: bigint, id: string) => `${Number(qn(q).toPrecision(3))} ${sym(id)}`;
  switch (cmd.t) {
    case 'swap':
      return `swapped ${amt(cmd.qty, cmd.from)} for ${sym(cmd.to)}`;
    case 'stake':
    case 'unstake':
    case 'restake':
      return `${cmd.t}d ${amt(cmd.qty, cmd.asset)}`;
    case 'lpAdd':
      return `put ${amt(cmd.qty, cmd.a)} into a ${sym(cmd.a)}/${sym(cmd.b)} pool`;
    case 'lpRemove':
      return `left a ${sym(cmd.a)}/${sym(cmd.b)} pool`;
    case 'supply':
    case 'withdraw':
    case 'repay':
      return `${cmd.t === 'supply' ? 'supplied' : cmd.t === 'withdraw' ? 'withdrew' : 'repaid'} ${amt(cmd.qty, cmd.asset)}`;
    case 'borrow':
      return `borrowed ${amt(cmd.qty, cmd.asset)}${cmd.via === 'vault' ? ' from a vault' : ''}`;
    case 'slotRelic':
      return 'slotted a relic';
    case 'endTrade':
      return 'ended trading';
  }
}
