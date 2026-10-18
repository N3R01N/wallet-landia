/**
 * Plays a simulated battle in the town (spec: "Battle phase", M3): every
 * entity of the run as an instance of its unit type's mesh, moved along the
 * run's frames (10 Hz, interpolated), its clip from what it does (marching,
 * striking on the event's beat, falling), an HP bar once hurt, and a banner
 * per squad with its token and how many are left. The renderer only reads the
 * run: the same run plays the same battle again (a replay).
 */

import * as THREE from 'three';
import type { Stage } from '../../castle/scene/castleView.js';
import { el } from '../../util/dom.js';
import { FRAME_EVERY, METRES_PER_SPEED, WALK_CLIP_SPEED, type BattleRun } from '../core/battle.js';
import { UNIT_TYPES } from '../core/catalog.js';
import { ABILITY_NAME, type Ability } from '../core/depth.js';
import type { FieldMarkers } from './fieldMarkers.js';
import type { BattleFx, Burst, Projectile } from './battleFx.js';
import { BALANCE } from '../config/balance.js';
import type { Army, SideId } from '../core/types.js';
import { UnitMesh } from './unitMeshes.js';

/** Seconds of battle per frame of the run. */
const FRAME_DT = FRAME_EVERY / BALANCE.battle.tickHz;
/** When the strike lands in every unit's attack clip (docs/batches/19-siege-units-pilot.md). */
const STRIKE_AT = 0.4;
/** The fallen lie this long, then sink away. */
const LIE = 2.2;
const SINK = 0.8;
const HP_BAR_Y = 2.25;

export const TEAM_COLORS: Record<SideId, string> = { A: '#3f6fa8', B: '#b84a32' };

export interface BattleViewOptions {
  stage: Stage;
  /** Where the squad banners go (the castle view's element). */
  overlay: HTMLElement;
  /** A token's label for its banner. */
  symbol: (asset: string) => string;
  /** A token's badge: its icon (an URL the page may load), else a disc in its colour. */
  badge?: (asset: string) => { icon?: string; color: string };
  /** The battlefield buildings' rings and banners, to play the captures on. */
  markers?: FieldMarkers;
  /** The effects: sparks, projectiles, puffs, detonations. */
  fx?: BattleFx;
  /** Points the camera (the lane-follow view). */
  look?: (x: number, z: number) => void;
  /** A side's name for an ability (a curated protocol's, or a generic one). */
  abilityName?: (side: SideId, ability: Ability) => string;
}

/** An effect due at a moment of the battle. */
interface Cue {
  at: number;
  burst?: Burst;
  projectile?: Projectile;
  /** Where: an entity (its place at that moment), or a point. */
  from: number;
  to?: number;
  x?: number;
  z?: number;
}

/** Shooters' projectiles: archers loose arrows, mages and the Ghost Lender bolts. */
const SHOT: Partial<Record<string, Projectile>> = {
  'archer.oracle': 'fx.arrow',
  'archer.scout': 'fx.arrow',
  'mage.swap': 'fx.bolt',
  'mage.battle': 'fx.bolt',
  'lender.ghost': 'fx.bolt',
};

/** A moment of the battle shown as a toast: an ability cast, a liquidation blowing up. */
interface Moment {
  at: number;
  text: string;
  side: SideId;
  shown: boolean;
}

/** A building's capture timeline: who was taking it from when, and when it changed hands. */
interface CaptureStep {
  at: number;
  point: string;
  kind: 'capturing' | 'capture' | 'stop';
  side: SideId | null;
  seconds: number;
}

interface Track {
  /** Battle seconds of each strike, ascending. */
  strikes: number[];
  death: number;
  phase: number;
}

export class BattleView {
  readonly #opts: BattleViewOptions;
  readonly #meshes = new Map<string, UnitMesh>();
  readonly #group = new THREE.Group();
  readonly #team = { A: new THREE.Color(TEAM_COLORS.A), B: new THREE.Color(TEAM_COLORS.B) };
  readonly #bars: THREE.InstancedMesh;
  readonly #barBack: THREE.InstancedMesh;
  readonly #labels = el('div', { class: 'siege-banners' });
  readonly #toasts = el('div', { class: 'siege-toasts', 'aria-live': 'polite' });
  #moments: Moment[] = [];
  #cues: Cue[] = [];
  /** The lane the camera follows (0 left, 1 centre, 2 right; null: free). */
  follow: number | null = null;
  readonly #lookAt = { x: 0, z: 0, set: false };
  #cue = 0;
  #captures: CaptureStep[] = [];
  #owners: Record<string, SideId | null> = {};
  #run: BattleRun | null = null;
  #tracks: Track[] = [];
  #time = 0;
  #speed = 1;
  #stopFrame: (() => void) | null = null;
  #onDone: (() => void) | null = null;
  #done = false;
  #banners: { el: HTMLElement; text: HTMLElement; side: SideId; squad: number; label: string }[] = [];

  constructor(opts: BattleViewOptions) {
    this.#opts = opts;
    opts.stage.scene.add(this.#group);
    const plane = new THREE.PlaneGeometry(1, 0.12);
    this.#barBack = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0x2a2118, depthTest: false, transparent: true, opacity: 0.75 }), 640);
    this.#bars = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), 640);
    for (const m of [this.#barBack, this.#bars]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.#group.add(m);
    }
    this.#barBack.renderOrder = 4;
    opts.overlay.append(this.#labels, this.#toasts);
  }

  /** Loads the meshes for these unit types (a missing model stands in as the Militia). */
  async prepare(units: Iterable<string>, capacity = 640): Promise<void> {
    for (const id of new Set(units)) {
      if (this.#meshes.has(id)) continue;
      const loaded = (await this.#opts.stage.load(`unit.${id}`)) ?? (await this.#opts.stage.load('unit.militia'));
      if (!loaded) continue;
      try {
        const mesh = new UnitMesh(loaded, capacity);
        this.#meshes.set(id, mesh);
        this.#group.add(mesh.mesh);
      } catch (error) {
        console.warn('unit mesh', id, error);
      }
    }
  }

  /** How fast the battle plays (1 = real time). */
  set speed(v: number) {
    this.#speed = v;
  }

  get speed(): number {
    return this.#speed;
  }

  /** A paused battle holds its frame (the player looks around; spec open question: pause to inspect). */
  paused = false;

  get playing(): boolean {
    return this.#run !== null && !this.#done;
  }

  /** Plays a run from its start; `onDone` when its last frame is reached. */
  async play(run: BattleRun, armies: [Army, Army], onDone?: () => void, owners: Record<string, SideId | null> = {}): Promise<void> {
    await this.prepare(run.entities.map((e) => e.unit));
    this.#run = run;
    this.#time = this.#skipPending ? run.seconds + 0.01 : 0;
    this.#skipPending = false;
    this.#done = false;
    this.#onDone = onDone ?? null;
    this.#tracks = run.entities.map((_, i) => ({ strikes: [], death: Infinity, phase: (i * 0.37) % 1 }));
    const tickDt = 1 / BALANCE.battle.tickHz;
    this.#moments = [];
    this.#captures = [];
    this.#owners = { ...owners };
    const detonated = new Set<SideId>();
    for (const e of run.events) {
      if (e.t === 'attack') this.#tracks[e.id]?.strikes.push(e.tick * tickDt);
      if (e.t === 'death' || e.t === 'vanish') {
        const track = this.#tracks[e.id];
        if (track) track.death = Math.min(track.death, e.tick * tickDt);
      }
      if (e.t === 'side-ability') this.#moments.push({ at: e.tick * tickDt, text: `${this.#opts.abilityName?.(e.side, e.ability) ?? ABILITY_NAME[e.ability]}!`, side: e.side, shown: false });
      if (e.t === 'detonate') {
        const side = run.entities[e.id]?.side;
        if (side && !detonated.has(side)) {
          detonated.add(side);
          this.#moments.push({ at: e.tick * tickDt, text: '💥 Liquidated collateral blows up!', side, shown: false });
        }
      }
      if (e.t === 'capturing') this.#captures.push({ at: e.tick * tickDt, point: e.point, kind: 'capturing', side: e.side, seconds: e.seconds });
      if (e.t === 'capture') this.#captures.push({ at: e.tick * tickDt, point: e.point, kind: 'capture', side: e.side, seconds: 0 });
      if (e.t === 'capture-stop') this.#captures.push({ at: e.tick * tickDt, point: e.point, kind: 'stop', side: null, seconds: 0 });
    }
    this.#toasts.replaceChildren();
    this.#opts.markers?.setOwners(this.#owners);
    // the effects, in battle time
    this.#cues = [];
    this.#cue = 0;
    let melee = 0;
    for (const e of run.events) {
      const at = e.tick * tickDt;
      if (e.t === 'attack') {
        const shot = SHOT[run.entities[e.id]?.unit ?? ''];
        if (shot) this.#cues.push({ at: Math.max(0, at - 0.15), projectile: shot, from: e.id, to: e.target });
        // one melee hit in three shows sparks: a big melee would bury the field in them
        else if (melee++ % 3 === 0) this.#cues.push({ at, burst: 'fx.hit.spark', from: e.target });
      }
      if (e.t === 'death' && run.entities[e.id]?.unit === 'swarm.frog') this.#cues.push({ at: at + 0.43, burst: 'fx.puff', from: e.id });
      if (e.t === 'vanish') this.#cues.push({ at, burst: 'fx.puff', from: e.id });
      if (e.t === 'detonate') this.#cues.push({ at, burst: 'fx.detonation', from: -1, x: e.x, z: e.z });
    }
    this.#cues.sort((a, b) => a.at - b.at);
    this.#opts.fx?.clear();
    this.#banners = [];
    this.#labels.replaceChildren();
    armies.forEach((army) =>
      army.squads.forEach((sq, si) => {
        // stacked squads fight as entities of ×k units each (spec: "a banner showing N")
        const k = Math.max(...(sq.stacks.length > 0 ? sq.stacks : [1]));
        const label = `${this.#opts.symbol(sq.asset)}${k > 1 ? ` ×${k}` : ''}`;
        const badge = this.#opts.badge?.(sq.asset);
        const mark = badge?.icon
          ? el('img', { class: 'siege-banner-icon', src: badge.icon, alt: '', width: '14', height: '14' })
          : badge
            ? Object.assign(el('span', { class: 'siege-banner-dot' }), { style: `background: ${badge.color}` })
            : null;
        const text = el('span', {}, label);
        const b = el('div', { class: `siege-banner siege-banner-${army.side}` }, mark, text);
        this.#labels.append(b);
        this.#banners.push({ el: b, text, side: army.side, squad: si, label });
      }),
    );
    this.#stopFrame?.();
    this.#stopFrame = this.#opts.stage.onFrame((dt) => this.#update(dt));
    this.#update(0);
  }

  /** Jumps to the end (the result stands); asked before the battle has started, it skips it as soon as it does. */
  skip(): void {
    if (!this.#run || this.#done) {
      this.#skipPending = true;
      return;
    }
    this.#time = this.#run.seconds + 0.01;
  }

  #skipPending = false;

  /** Takes the units off the field. */
  clear(): void {
    this.#stopFrame?.();
    this.#stopFrame = null;
    this.#run = null;
    for (const m of this.#meshes.values()) m.commit(0);
    this.#bars.count = 0;
    this.#barBack.count = 0;
    this.#labels.replaceChildren();
    this.#toasts.replaceChildren();
    this.#banners = [];
  }

  dispose(): void {
    this.clear();
    for (const m of this.#meshes.values()) m.dispose();
    this.#meshes.clear();
    this.#bars.geometry.dispose();
    (this.#bars.material as THREE.Material).dispose();
    (this.#barBack.material as THREE.Material).dispose();
    this.#group.removeFromParent();
    this.#labels.remove();
    this.#toasts.remove();
  }

  readonly #m = new THREE.Matrix4();
  readonly #v = new THREE.Vector3();
  readonly #s = new THREE.Vector3();
  readonly #color = new THREE.Color();

  #update(dt: number): void {
    const run = this.#run;
    if (!run) return;
    if (!this.paused) this.#time += dt * this.#speed;
    const end = run.seconds;
    const t = Math.min(this.#time, end);
    const n = run.entities.length;
    const fpos = Math.min(run.frameCount - 1, t / FRAME_DT);
    const f0 = Math.floor(fpos);
    const f1 = Math.min(run.frameCount - 1, f0 + 1);
    const a = fpos - f0;
    const fr = run.frames;
    const counts = new Map<string, number>();
    let bars = 0;
    const camQ = this.#opts.stage.camera.quaternion;
    const squadPos = new Map<string, { x: number; z: number; n: number; alive: number }>();
    const finished = this.#time > end;
    for (let i = 0; i < n; i++) {
      const ent = run.entities[i]!;
      const mesh = this.#meshes.get(ent.unit);
      const b0 = (f0 * n + i) * 4;
      const b1 = (f1 * n + i) * 4;
      const x = fr[b0]! + (fr[b1]! - fr[b0]!) * a;
      const z = fr[b0 + 1]! + (fr[b1 + 1]! - fr[b0 + 1]!) * a;
      const hp = fr[b1 + 2]!;
      // not on the field (a Flash Loan's units before and after the loan)
      if (hp < 0 && fr[b0 + 2]! < 0) continue;
      const face = lerpAngle(fr[b0 + 3]!, fr[b1 + 3]!, a);
      const track = this.#tracks[i]!;
      const sinceDeath = t - track.death;
      if (sinceDeath > LIE + SINK) continue;
      const key = `${ent.side}|${ent.squad}`;
      const sp = squadPos.get(key) ?? { x: 0, z: 0, n: 0, alive: 0 };
      if (sinceDeath < 0) {
        sp.x += x;
        sp.z += z;
        sp.n++;
        sp.alive += Math.max(1, Math.ceil(hp * ent.mult - 1e-6));
      }
      squadPos.set(key, sp);
      if (!mesh) continue;
      const idx = counts.get(ent.unit) ?? 0;
      counts.set(ent.unit, idx + 1);
      const team = this.#team[ent.side];
      if (sinceDeath >= 0) {
        const y = sinceDeath > LIE ? -((sinceDeath - LIE) / SINK) * 0.9 : 0;
        mesh.set(idx, x, z, face, 'death', sinceDeath, false, team, y);
        continue;
      }
      // the last strike before now, or the next one coming (the clip winds up for it)
      const strike = nearestStrike(track.strikes, t);
      const moved = Math.hypot(fr[b1]! - fr[b0]!, fr[b1 + 1]! - fr[b0 + 1]!) > 0.03;
      if (finished) mesh.set(idx, x, z, face, 'cheer', t + track.phase, true, team);
      else if (strike !== null && Math.abs(t - strike) < 0.6) mesh.set(idx, x, z, face, 'attack', t - strike + STRIKE_AT, true, team);
      // the walk clip at the pace the unit covers the ground (no sliding feet)
      else if (moved) mesh.set(idx, x, z, face, 'walk', (t * (UNIT_TYPES[ent.unit]?.speed ?? 1) * METRES_PER_SPEED) / WALK_CLIP_SPEED + track.phase, true, team);
      else mesh.set(idx, x, z, face, 'idle', t + track.phase * 2, true, team);
      if (hp < 0.999 && bars < 640) {
        this.#v.set(x, HP_BAR_Y, z);
        this.#s.set(0.9, 1, 1);
        this.#m.compose(this.#v, camQ, this.#s);
        this.#barBack.setMatrixAt(bars, this.#m);
        this.#s.set(Math.max(0.02, 0.9 * hp), 1, 1);
        // shift the fill to the bar's left end
        this.#v.add(new THREE.Vector3(-(0.9 - 0.9 * hp) / 2, 0, 0).applyQuaternion(camQ));
        this.#m.compose(this.#v, camQ, this.#s);
        this.#bars.setMatrixAt(bars, this.#m);
        this.#color.set(hp > 0.5 ? 0x6fbf4a : hp > 0.25 ? 0xe0b13a : 0xd0442c);
        this.#bars.setColorAt(bars, this.#color);
        bars++;
      }
    }
    for (const [unit, mesh] of this.#meshes) mesh.commit(counts.get(unit) ?? 0);
    this.#bars.count = bars;
    this.#barBack.count = bars;
    this.#bars.instanceMatrix.needsUpdate = true;
    this.#barBack.instanceMatrix.needsUpdate = true;
    if (this.#bars.instanceColor) this.#bars.instanceColor.needsUpdate = true;
    // a banner over each squad still fighting: its token and how many are left
    for (const b of this.#banners) {
      const sp = squadPos.get(`${b.side}|${b.squad}`);
      if (!sp || sp.n === 0) {
        b.el.hidden = true;
        continue;
      }
      const p = this.#opts.stage.screen(this.#v.set(sp.x / sp.n, 3, sp.z / sp.n));
      b.el.hidden = !p;
      if (p) {
        b.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        b.text.textContent = `${b.label} · ${sp.alive}`;
      }
    }
    this.#playCaptures(t);
    this.#playCues(t, run);
    this.#followLane(run, f0, n, dt);
    for (const mo of this.#moments) {
      if (mo.shown || mo.at > t) continue;
      mo.shown = true;
      const toast = el('div', { class: `siege-toast siege-toast-${mo.side}` }, mo.text);
      this.#toasts.append(toast);
      setTimeout(() => toast.remove(), 2400);
    }
    if (finished && !this.#done) {
      this.#done = true;
      this.#onDone?.();
    }
  }

  /** The camera eases after the fighting in the followed lane: the middle of its units still standing. */
  #followLane(run: BattleRun, frame: number, n: number, dt: number): void {
    const look = this.#opts.look;
    if (this.follow === null || !look) {
      this.#lookAt.set = false;
      return;
    }
    let x = 0;
    let z = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (run.entities[i]!.lane !== this.follow) continue;
      const b = (frame * n + i) * 4;
      if (!(run.frames[b + 2]! > 0)) continue;
      x += run.frames[b]!;
      z += run.frames[b + 1]!;
      count++;
    }
    if (count === 0) return;
    x /= count;
    z /= count;
    if (!this.#lookAt.set) Object.assign(this.#lookAt, { x, z, set: true });
    const k = Math.min(1, dt * 2.5);
    this.#lookAt.x += (x - this.#lookAt.x) * k;
    this.#lookAt.z += (z - this.#lookAt.z) * k;
    look(this.#lookAt.x, this.#lookAt.z);
  }

  /** Effects due by now; ones long past (a skip) are dropped rather than all fired at once. */
  #playCues(t: number, run: BattleRun): void {
    const fx = this.#opts.fx;
    if (!fx) return;
    while (this.#cue < this.#cues.length && this.#cues[this.#cue]!.at <= t) {
      const c = this.#cues[this.#cue++]!;
      if (t - c.at > 0.5) continue;
      const p = this.#placeAt(run, c.from, c.at) ?? (c.x !== undefined && c.z !== undefined ? { x: c.x, z: c.z } : null);
      if (!p) continue;
      if (c.burst === 'fx.detonation') fx.burst('fx.detonation', c.x ?? p.x, 0, c.z ?? p.z);
      else if (c.burst === 'fx.puff') fx.burst('fx.puff', p.x, 0, p.z);
      else if (c.burst) fx.burst(c.burst, p.x, 1.1, p.z);
      if (c.projectile && c.to !== undefined) {
        const q = this.#placeAt(run, c.to, c.at + 0.15);
        if (q) fx.shoot(c.projectile, new THREE.Vector3(p.x, 1.3, p.z), new THREE.Vector3(q.x, 1.0, q.z));
      }
    }
  }

  /** Where an entity stands at a moment of the battle. */
  #placeAt(run: BattleRun, id: number, at: number): { x: number; z: number } | null {
    if (id < 0) return null;
    const n = run.entities.length;
    const f = Math.min(run.frameCount - 1, Math.max(0, Math.round(at / FRAME_DT)));
    const b = (f * n + id) * 4;
    const x = run.frames[b];
    const z = run.frames[b + 1];
    return x === undefined || z === undefined ? null : { x, z };
  }

  /** The rings fill as a side takes a building; a taken one turns its colour. */
  #playCaptures(t: number): void {
    const markers = this.#opts.markers;
    if (!markers) return;
    const owners = { ...this.#owners };
    const taking = new Map<string, CaptureStep>();
    for (const c of this.#captures) {
      if (c.at > t) break;
      if (c.kind === 'capture') {
        owners[c.point] = c.side;
        taking.delete(c.point);
      } else if (c.kind === 'stop') taking.delete(c.point);
      else taking.set(c.point, c);
    }
    markers.setOwners(owners);
    for (const [id, c] of taking) if (c.side) markers.progress(id, c.side, (t - c.at) / c.seconds);
  }
}

function nearestStrike(strikes: readonly number[], t: number): number | null {
  // strikes are ascending: the last at or before t + 0.6
  let best: number | null = null;
  for (const s of strikes) {
    if (s > t + 0.6) break;
    best = s;
  }
  return best;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
