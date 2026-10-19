/**
 * Speech bubbles over Ledger Wars' units: the winners of a moment talk
 * (data/barks.ts). Now and then a unit that lands a kill gloats; when a fight
 * is won (no enemy left near), the victors cheer; when a building falls,
 * those who brought it down say so; when the match ends, the winning army
 * goes wild. A bubble follows its unit and fades; only a few at a time, and
 * none for a unit out of view.
 */

import { el } from '../../util/dom.js';
import type { PlayerId } from '../data/rules.js';
import { groundHeight } from '../core/map.js';
import type { Unit } from '../core/units.js';
import type { World, WorldEvent } from '../core/world.js';
import { bark, type BarkMoment } from '../data/barks.js';
import type { RtsView } from './view.js';

/** A bubble's life (s), and how many show at once. */
const LIFE = 2.6;
const MAX = 5;
/** Metres: an enemy this near the fallen means the fight goes on; friends this near the killer join the cheer. */
const FIGHT_R = 11;
const FRIENDS_R = 8;
/** A lone kill is gloated over this often (chance), at most every this many seconds. */
const KILL_CHANCE = 0.18;
const KILL_GAP = 2.5;
/** Head height of a bubble's foot (m). */
const HEAD = 2.5;

interface Bubble {
  el: HTMLElement;
  unit: number;
  /** Seconds left; before 0 it waits (a staggered cheer). */
  left: number;
  wait: number;
  x: number;
  z: number;
}

export class Barks {
  readonly element = el('div', { class: 'rts-barks', 'aria-hidden': 'true' });
  readonly #world: World;
  readonly #view: RtsView;
  readonly #me: PlayerId;
  #bubbles: Bubble[] = [];
  /** Buildings by id as they last stood (a fallen one is gone from the world). */
  readonly #seen = new Map<number, { x: number; z: number }>();
  /** Who last struck each unit or building (its killer when it falls). */
  readonly #lastHit = new Map<number, number>();
  #lastGloat = -99;
  #clock = 0;
  /** Test hook: every line said. */
  readonly said: string[] = [];

  constructor(world: World, view: RtsView, me: PlayerId) {
    this.#world = world;
    this.#view = view;
    this.#me = me;
  }

  handle(events: readonly WorldEvent[]): void {
    const w = this.#world;
    for (const b of w.buildings) this.#seen.set(b.id, { x: b.x, z: b.z });
    for (const e of events) {
      if (e.t === 'strike') this.#lastHit.set(e.target, e.from);
      else if (e.t === 'death') {
        const fallen = w.units.find((u) => u.id === e.id);
        const killer = w.units.find((u) => u.id === this.#lastHit.get(e.id) && u.died < 0);
        this.#lastHit.delete(e.id);
        if (!fallen || !killer || killer.owner === fallen.owner) continue;
        const foesLeft = w.units.some((u) => u.died < 0 && u.owner === fallen.owner && u.id !== fallen.id && Math.hypot(u.x - fallen.x, u.z - fallen.z) < FIGHT_R);
        if (!foesLeft) {
          // the fight is won: the killer and a couple of friends cheer
          const friends = this.#near(killer.owner, killer.x, killer.z, FRIENDS_R).filter((u) => u.id !== killer.id).slice(0, 2);
          [killer, ...friends].forEach((u, i) => this.#say(u, 'fight', i * 0.45));
        } else if (Math.random() < KILL_CHANCE && this.#clock - this.#lastGloat > KILL_GAP) {
          this.#lastGloat = this.#clock;
          this.#say(killer, 'kill');
        }
      } else if (e.t === 'destroyed') {
        const winner = e.owner === 'A' ? 'B' : 'A';
        const b = this.#seen.get(e.id);
        this.#seen.delete(e.id);
        // the building is gone from the world: its last strikers stand round where it was
        const attackers = w.units.filter((u) => u.died < 0 && u.owner === winner && (this.#lastHit.get(e.id) === u.id || u.target === e.id));
        const near = attackers.length ? attackers : b ? this.#near(winner, b.x, b.z, 12) : [];
        near.slice(0, 2).forEach((u, i) => this.#say(u, 'building', i * 0.5));
        this.#lastHit.delete(e.id);
      } else if (e.t === 'won') {
        const army = w.units.filter((u) => u.owner === e.winner && u.died < 0 && this.#view.inView(u.x, u.z));
        // a handful, all over the place
        for (let i = army.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [army[i], army[j]] = [army[j]!, army[i]!];
        }
        army.slice(0, 6).forEach((u, i) => this.#say(u, 'match', i * 0.35, true));
      }
    }
  }

  /** Each frame: the bubbles follow their units, fade, and go. */
  update(dt: number): void {
    this.#clock += dt;
    const w = this.#world;
    const r = this.#view.canvas.getBoundingClientRect();
    this.#bubbles = this.#bubbles.filter((b) => {
      if (b.wait > 0) {
        b.wait -= dt;
        return true;
      }
      if (!b.el.isConnected) {
        // its turn: shown now (if its unit is still up and in view)
        const u = w.units.find((x) => x.id === b.unit && x.died < 0);
        if (!u || !this.#view.inView(u.x, u.z)) return false;
        this.element.append(b.el);
      }
      b.left -= dt;
      if (b.left <= 0) {
        b.el.remove();
        return false;
      }
      const u = w.units.find((x) => x.id === b.unit);
      if (u) {
        b.x = u.x;
        b.z = u.z;
      }
      const p = this.#view.toScreen(b.x, HEAD + groundHeight(w.map, b.x, b.z), b.z);
      b.el.hidden = !p;
      if (p) {
        b.el.style.transform = `translate(${p.x - r.left}px, ${p.y - r.top}px) translate(-50%, -100%)`;
        b.el.style.opacity = String(Math.min(1, b.left / 0.4));
      }
      return true;
    });
  }

  #near(owner: PlayerId, x: number, z: number, r: number): Unit[] {
    return this.#world.units.filter((u) => u.owner === owner && u.died < 0 && Math.hypot(u.x - x, u.z - z) < r).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }

  #say(u: Unit, moment: BarkMoment, wait = 0, always = false): void {
    if (!always && !this.#view.inView(u.x, u.z)) return;
    if (this.#bubbles.some((b) => b.unit === u.id)) return;
    if (!always && this.#bubbles.length >= MAX) return;
    const mine = u.owner === this.#me;
    const line = bark(moment, mine);
    this.said.push(line);
    const bubble = el('div', { class: `rts-bark ${mine ? 'mine' : 'foe'}` }, line);
    this.#bubbles.push({ el: bubble, unit: u.id, left: moment === 'match' ? LIFE * 1.6 : LIFE, wait, x: u.x, z: u.z });
  }
}
