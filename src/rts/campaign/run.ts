/**
 * A campaign mission in play (docs/rts/CAMPAIGN.md): its World set up as the
 * mission says (money, buildings already standing, the enemy's base and
 * guards, what may be built), and its objectives worked through in order.
 * Each tick the current objective starts (after its wait) and is checked;
 * when the last is done the mission is won, and losing the wallet hall loses
 * it. No DOM here: the page shows it (ui/campaign.ts), the tests play it.
 */

import { BUILDINGS, type BuildingKind, type PlayerId, type TokenId } from '../data/rules.js';
import type { UnitTypeId } from '../../game/core/types.js';
import { World, type Allowed, type Building } from '../core/world.js';
import { cellCentre } from '../core/map.js';
import { spotFor, type Difficulty } from '../ai/opponent.js';
import type { Concept } from '../data/notes.js';

/** What the page knows that the World doesn't: the selection, the view, the groups made. */
export interface Ui {
  selectedUnits: number;
  /** The kind of your building selected (null: none). */
  building: BuildingKind | null;
  camera: { x: number; z: number };
  groups: number;
}

export const NO_UI: Ui = { selectedUnits: 0, building: null, camera: { x: 0, z: 0 }, groups: 0 };

export type Card = { unit: UnitTypeId } | { building: BuildingKind } | { concept: Concept };

export interface Step {
  /** What it asks, in a word (the scripted player of the tests reads it). */
  id: string;
  text: string;
  /** How to do it. */
  hint: string;
  /** The button to glow (a CSS selector, the first that shows). */
  highlight?: readonly string[];
  /** The place on the map to mark. */
  beacon?: (r: Run) => { x: number; z: number } | null;
  /** Seconds before it starts (shown as a countdown). */
  wait?: number;
  /** What happens as it starts (a raid sets off). */
  start?: (r: Run) => void;
  done: (r: Run, ui: Ui) => boolean;
  /** Something new to show beside it. */
  card?: Card;
}

export interface Mission {
  n: number;
  title: string;
  /** What it introduces, in a line (the mission list). */
  tagline: string;
  briefing: readonly string[];
  cards: readonly Card[];
  debrief: string;
  seed: string;
  /** Prices hold still. */
  still?: boolean;
  allowed: Allowed;
  player: { dollars: Partial<Record<TokenId, number>>; hall?: number; buildings?: readonly [BuildingKind, number?][]; units?: readonly [UnitTypeId, number][] };
  enemy?: {
    dollars?: Partial<Record<TokenId, number>>;
    hall?: number;
    /** Buildings standing from the start, by name (a step can ask for one destroyed). */
    buildings?: readonly { tag: string; kind: BuildingKind; level?: number; x: number; z: number }[];
    /** Units standing guard (they fight what comes near). */
    guards?: readonly { name: string; units: readonly [UnitTypeId, number][]; x: number; z: number }[];
    /** The computer plays it, with these buildings and units. */
    ai?: Difficulty;
    allowed?: Allowed;
  };
  steps: readonly Step[];
}

export type RunState = 'playing' | 'won' | 'lost';

export class Run {
  readonly world: World;
  readonly mission: Mission;
  index = 0;
  state: RunState = 'playing';
  /** When the current step starts (game seconds), and whether it has. */
  startAt: number;
  started = false;
  /** The tick it started at (commands since then count). */
  startTick = 0;
  /** Units the script put on the field, by name; buildings by tag; numbers a step keeps. */
  readonly groups = new Map<string, number[]>();
  readonly tags = new Map<string, number>();
  readonly marks = new Map<string, number>();
  /** Things to tell the player (drained by the page). */
  #said: string[] = [];

  constructor(mission: Mission) {
    this.mission = mission;
    const e = mission.enemy;
    const nothing: Allowed = { buildings: [], units: [] };
    this.world = new World({
      seed: mission.seed,
      kits: { A: 'usdc', B: 'usdc' },
      still: mission.still ?? false,
      dollars: { A: mission.player.dollars, B: e?.dollars ?? {} },
      // the computer has what the mission gives it (everything when it says nothing); a side it doesn't play builds nothing
      allowed: e?.ai ? { A: mission.allowed, ...(e.allowed ? { B: e.allowed } : {}) } : { A: mission.allowed, B: nothing },
      ...(e?.ai ? { ai: ['B' as const], difficulty: e.ai } : {}),
    });
    const w = this.world;
    raise(w.hallOf('A')!, mission.player.hall ?? 1);
    raise(w.hallOf('B')!, e?.hall ?? 1);
    for (const [kind, level] of mission.player.buildings ?? []) {
      const at = spotFor(w, 'A', kind);
      if (at) w.addBuilding(kind, 'A', at.x, at.z, level ?? 1);
    }
    const hall = w.hallOf('A')!;
    for (const [type, n] of mission.player.units ?? []) this.place('A', [[type, n]], hall.x, hall.z - 10);
    for (const b of e?.buildings ?? []) {
      const at = this.#ground(b.kind, b.x, b.z);
      if (at) this.tags.set(b.tag, w.addBuilding(b.kind, 'B', at.x, at.z, b.level ?? 1).id);
    }
    for (const g of e?.guards ?? []) this.groups.set(g.name, this.place('B', g.units, g.x, g.z));
    this.startAt = mission.steps[0]?.wait ?? 0;
  }

  get step(): Step | null {
    return this.mission.steps[this.index] ?? null;
  }

  /** Seconds until the current step starts (0: it has). */
  get waiting(): number {
    return this.started ? 0 : Math.max(0, this.startAt - this.world.time);
  }

  /** After each world step (or frame): starts the current objective, checks it, moves on. */
  tick(ui: Ui): void {
    if (this.state !== 'playing') return;
    const w = this.world;
    if (w.winner) {
      this.state = w.winner === 'A' ? 'won' : 'lost';
      return;
    }
    for (;;) {
      const step = this.step;
      if (!step) {
        this.state = 'won';
        w.finish('A');
        return;
      }
      if (!this.started) {
        if (w.time + 1e-9 < this.startAt) return;
        this.started = true;
        this.startTick = w.tick;
        step.start?.(this);
      }
      if (!step.done(this, ui)) return;
      this.say(`✓ ${step.text}`);
      this.index++;
      this.started = false;
      this.startAt = w.time + (this.step?.wait ?? 0);
    }
  }

  say(text: string): void {
    this.#said.push(text);
  }

  takeSaid(): string[] {
    const s = this.#said;
    this.#said = [];
    return s;
  }

  /** Units put on the field in rows round (x, z), on open ground. */
  place(owner: PlayerId, list: readonly [UnitTypeId, number][], x: number, z: number): number[] {
    const ids: number[] = [];
    const types = list.flatMap(([t, n]) => Array.from({ length: n }, () => t));
    const cols = Math.ceil(Math.sqrt(types.length * 1.5));
    types.forEach((type, i) => {
      const cx = x + ((i % cols) - (cols - 1) / 2) * 1.5;
      const cz = z + Math.floor(i / cols) * 1.5 * (owner === 'A' ? 1 : -1);
      const cell = this.world.paths.nearestOpen(cx, cz, 10);
      const p = cell >= 0 ? cellCentre(this.world.map, cell) : { x: cx, z: cz };
      ids.push(this.world.addUnit(owner, type, p.x, p.z).id);
    });
    return ids;
  }

  /** A raid: enemies put on the field, walking (and fighting) towards your wallet hall. */
  raid(name: string, list: readonly [UnitTypeId, number][], x: number, z: number): void {
    const ids = this.place('B', list, x, z);
    this.groups.set(name, ids);
    const hall = this.world.hallOf('A');
    if (hall) this.world.command('B', { t: 'order', units: ids, kind: 'attackMove', x: hall.x, z: hall.z - 4 });
  }

  /** The script's units of a group still standing. */
  alive(name: string): { x: number; z: number }[] {
    const ids = new Set(this.groups.get(name) ?? []);
    return this.world.units.filter((u) => ids.has(u.id) && u.died < 0);
  }

  /** Where a group stands (the middle of those alive), or null when it's gone. */
  where(name: string): { x: number; z: number } | null {
    const us = this.alive(name);
    return us.length ? { x: us.reduce((s, u) => s + u.x, 0) / us.length, z: us.reduce((s, u) => s + u.z, 0) / us.length } : null;
  }

  building(tag: string): Building | null {
    return this.world.buildings.find((b) => b.id === this.tags.get(tag)) ?? null;
  }

  /** Free ground for a building of the setup at (or near) (x, z). */
  #ground(kind: BuildingKind, x: number, z: number): { x: number; z: number } | null {
    const w = this.world;
    for (let r = 0; r <= 12; r++) {
      const n = Math.max(1, r * 6);
      for (let a = 0; a < n; a++) {
        const at = w.snap(kind, x + Math.cos((a / n) * Math.PI * 2) * r, z + Math.sin((a / n) * Math.PI * 2) * r);
        if (w.cantPlace('B', kind, at.x, at.z, true) === null) return at;
      }
    }
    return null;
  }
}

function raise(b: Building, level: number): void {
  const r = BUILDINGS[b.kind];
  b.level = level;
  b.maxHp = b.hp = r.hp + r.hpPerLevel * (level - 1);
}
