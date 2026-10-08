/**
 * The living town: a replay clock over the guild's journeys, and the agents
 * that act them out. Renderer-agnostic — it only moves points around in tile
 * space and emits effects; both renderers draw the same state.
 */

import type { Guild, Hero, HeroClass, Journey, Target, Verb } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import { makeRng } from '../util/rng.js';
import { type Placed, type Pt, type TownPlan } from './layout.js';
import { doorSlot, flightRoute, walkRoute } from './route.js';

// --- schedule ----------------------------------------------------------------

export interface Scheduled {
  journey: Journey;
  /** Seconds into the replay at speed 1. */
  at: number;
}

/**
 * Event time, not wall time: a wallet idle for two weeks then busy for an hour
 * would otherwise replay as two weeks of nothing. Gaps are log-compressed into
 * 1.5–9 s, so order and rough rhythm survive but nothing drags.
 */
export function schedule(journeys: readonly Journey[]): Scheduled[] {
  const out: Scheduled[] = [];
  let at = 2;
  let prev: number | null = null;
  for (const j of journeys) {
    if (prev !== null) {
      const gapH = Math.max(0, (j.time - prev) / 3_600_000);
      at += 1.5 + Math.min(7.5, 2.2 * Math.log1p(gapH));
    }
    out.push({ journey: j, at });
    prev = j.time;
  }
  return out;
}

// --- agents ------------------------------------------------------------------

export type AgentKind = 'hero' | 'raven' | 'villager' | 'herald' | 'bailiff';

type Task =
  /** `door`: arriving at a building, so claim a free waiting spot there. */
  | { type: 'walk'; to: Pt; fly?: boolean; door?: Placed }
  | { type: 'act'; verb: Verb | 'toll' | 'give' | 'seize'; seconds: number; at?: Pt; journey?: Journey }
  | { type: 'vanish' };

export interface Agent {
  id: string;
  kind: AgentKind;
  hero?: Hero;
  x: number;
  y: number;
  path: Pt[];
  tasks: Task[];
  acting: { verb: string; left: number; total: number } | null;
  facing: 1 | -1;
  speed: number;
  flying: boolean;
  /** Height above the ground, in tiles (flyers in the air). */
  alt: number;
  /** The door this agent is waiting at, if any (see door slots). */
  slotAt: string | null;
  /** Value tier of what is being carried right now, or null when empty-handed. */
  carrying: Tier | null;
  journey: Journey | null;
  /** Recent positions, so a caravan can follow the leader. */
  trail: Pt[];
  phase: number;
  dim: boolean;
  gone: boolean;
}

export type EffectKind = 'float' | 'coins' | 'ring' | 'smoke' | 'key' | 'sparkle' | 'alarm' | 'storm';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  age: number;
  ttl: number;
  text?: string;
  color?: string;
  drama: number;
}

/** A journey's path, for drawing: the full walk plus numbered stops. */
export interface Route {
  key: string;
  points: Pt[];
  stops: { at: Pt; n: number; label: string }[];
}

export interface LogEntry {
  journey: Journey;
  at: number;
}

const WALK_SPEED = 3.4;
const MOUNT_SPEED = [0.8, 0.9, 1, 1.15, 1.3, 1.9, 2.2] as const;

export interface SimOptions {
  classOverride?: (address: string) => HeroClass | null;
}

export class Sim {
  readonly guild: Guild;
  readonly plan: TownPlan;
  readonly scheduled: Scheduled[];
  readonly duration: number;

  agents: Agent[] = [];
  effects: Effect[] = [];
  log: LogEntry[] = [];

  t = 0;
  speed = 1;
  playing = true;
  /** Wall-clock seconds since start, for idle animation. */
  elapsed = 0;
  /** 0..1, a darkening for dramatic moments (a siege brings the storm). */
  gloom = 0;
  shake = 0;
  /** Busy buildings glow briefly. */
  readonly lastVisit = new Map<string, number>();

  /** The route on display (Quest Replay), if any. */
  route: Route | null = null;
  /** A journey replaying on its own; the timeline holds while it plays. */
  #solo: { journey: Journey; agent: Agent | null } | null = null;

  #next = 0;
  #rng = makeRng(42);
  #heroAgents = new Map<string, Agent>();
  #villagerTarget = 10;
  #uid = 0;

  constructor(guild: Guild, plan: TownPlan) {
    this.guild = guild;
    this.plan = plan;
    this.scheduled = schedule(guild.journeys);
    const last = this.scheduled[this.scheduled.length - 1];
    this.duration = (last?.at ?? 0) + 12;
    this.#spawnHeroes();
    for (let i = 0; i < this.#villagerTarget; i++) this.#spawnVillager(true);
  }

  get live(): boolean {
    return this.t >= this.duration;
  }

  heroAgent(address: string): Agent | undefined {
    return this.#heroAgents.get(address);
  }

  /** The real-world time the replay cursor stands at. */
  realTime(): number {
    const s = this.scheduled;
    const first = s[0];
    const last = s[s.length - 1];
    if (first === undefined || last === undefined) return this.guild.windowEnd;
    if (this.t <= first.at) return first.journey.time;
    if (this.t >= last.at) return last.journey.time + ((this.t - last.at) / 12) * Math.max(0, this.guild.windowEnd - last.journey.time);
    let i = 0;
    while (i < s.length - 1 && (s[i + 1]?.at ?? Infinity) <= this.t) i++;
    const a = s[i];
    const b = s[i + 1];
    if (a === undefined || b === undefined) return last.journey.time;
    const f = (this.t - a.at) / (b.at - a.at);
    return a.journey.time + f * (b.journey.time - a.journey.time);
  }

  /** Jump the cursor. Everyone goes home; nothing before the cursor replays. */
  seek(t: number): void {
    this.#solo = null;
    this.t = Math.max(0, Math.min(this.duration, t));
    this.#next = this.scheduled.findIndex((s) => s.at >= this.t);
    if (this.#next === -1) this.#next = this.scheduled.length;
    this.agents = this.agents.filter((a) => a.kind === 'hero' || a.kind === 'villager');
    this.#slots.clear();
    for (const a of this.agents) {
      a.slotAt = null;
      if (a.kind !== 'hero' || a.hero === undefined) continue;
      const home = this.plan.homes.get(a.hero.address);
      if (home) Object.assign(a, { x: home.doorAt.x, y: home.doorAt.y, alt: 0 });
      a.tasks = [];
      a.path = [];
      a.acting = null;
      a.journey = null;
      a.carrying = null;
      a.trail = [];
    }
    this.effects = [];
    this.log = this.scheduled.slice(0, this.#next).map((s) => ({ journey: s.journey, at: s.at })).slice(-40);
    this.gloom = 0;
  }

  get soloing(): boolean {
    return this.#solo !== null;
  }

  /** Replay one journey on its own: the hero goes home first, then sets out. */
  solo(j: Journey): void {
    const hero = this.#heroAgents.get(j.hero);
    if (hero !== undefined) {
      const home = this.plan.homes.get(j.hero);
      if (home) Object.assign(hero, { x: home.doorAt.x, y: home.doorAt.y, alt: 0 });
      hero.tasks = [];
      hero.path = [];
      hero.acting = null;
      hero.trail = [];
      this.#releaseSlot(hero);
    }
    const before = new Set(this.agents);
    this.#dispatch(j);
    // Whoever carries it out: the hero, or a courier for things that arrive.
    const actor = j.initiated ? (hero ?? null) : (this.agents.find((a) => !before.has(a)) ?? null);
    this.#solo = { journey: j, agent: actor };
  }

  /** The path a journey takes through town, with its stops numbered. */
  routeFor(j: Journey): Route {
    const home = this.plan.homes.get(j.hero);
    const start: Pt = home ? home.doorAt : this.plan.gate.doorAt;
    const hero = this.#heroAgents.get(j.hero);
    const travel = (a: Pt, b: Pt, fly: boolean): Pt[] => (fly ? flightRoute(a, b) : walkRoute(this.plan, a, b)).map((p) => ({ x: p.x, y: p.y }));
    const legs: { to: Pt; label: string }[] = [];
    if (j.initiated) {
      if (j.feeUsd !== null && j.feeUsd > 0) legs.push({ to: this.plan.tower.doorAt, label: 'Toll' });
      for (const step of j.steps) legs.push({ to: this.#targetPoint(step.target, j.hero), label: step.verb });
      legs.push({ to: start, label: 'Home' });
    } else {
      // Something arrived: the route runs from where it came from to the home.
      const first = j.steps[0];
      const from = first === undefined || first.target.kind === 'home' ? this.plan.gate.doorAt : this.#targetPoint(first.target, j.hero);
      const points = [from, ...travel(from, start, j.verb !== 'airdrop')];
      return { key: j.key, points, stops: [{ at: from, n: 1, label: 'From' }, { at: start, n: 2, label: 'Home' }] };
    }
    const points: Pt[] = [start];
    const stops: Route['stops'] = [];
    let cur = start;
    legs.forEach((leg, i) => {
      points.push(...travel(cur, leg.to, hero?.flying === true));
      stops.push({ at: leg.to, n: i + 1, label: leg.label });
      cur = leg.to;
    });
    return { key: j.key, points, stops };
  }

  /** Jump to the end of the replay: from here on, only live events play. */
  goLive(): void {
    this.seek(this.duration);
  }

  /** Act out a journey right now (a live transaction that just arrived). */
  playNow(j: Journey): void {
    this.#dispatch(j);
  }

  /** A new block was sealed on the real chain. */
  bell(blockNumber: number, busy: number): void {
    const t = this.plan.tower;
    this.effects.push({ kind: 'ring', x: t.x + t.w / 2, y: t.y + t.h / 2, age: 0, ttl: 2.2, drama: 1, text: `#${blockNumber}` });
    // Busier blocks bring more people into the streets.
    this.#villagerTarget = Math.round(6 + busy * 14);
  }

  step(dtReal: number): void {
    this.elapsed += dtReal;
    const dt = Math.min(0.1, dtReal) * (this.playing ? this.speed : 0);
    if (this.playing) this.t = Math.min(this.t + dt, this.duration + 1e9);

    if (this.#solo !== null) {
      // The timeline holds still while a single quest replays.
      if (this.playing) this.t -= dt;
      const a = this.#solo.agent;
      if (a === null || (a.tasks.length === 0 && a.path.length === 0 && a.acting === null) || a.gone) this.#solo = null;
    }
    while (this.#solo === null && this.#next < this.scheduled.length && (this.scheduled[this.#next]?.at ?? Infinity) <= this.t) {
      const s = this.scheduled[this.#next];
      this.#next++;
      if (s !== undefined) this.#dispatch(s.journey);
    }

    for (const a of this.agents) this.#advance(a, dt);
    this.agents = this.agents.filter((a) => !a.gone);

    const villagers = this.agents.filter((a) => a.kind === 'villager').length;
    if (villagers < this.#villagerTarget && this.#rng() < dtReal * 0.8) this.#spawnVillager(false);

    for (const e of this.effects) e.age += dtReal;
    this.effects = this.effects.filter((e) => e.age < e.ttl);
    this.gloom = Math.max(0, this.gloom - dtReal * 0.08);
    this.shake = Math.max(0, this.shake - dtReal * 2);
  }

  // --- dispatch --------------------------------------------------------------

  #dispatch(j: Journey): void {
    this.log.push({ journey: j, at: this.t });
    if (this.log.length > 40) this.log.shift();
    const hero = this.#heroAgents.get(j.hero);
    if (hero === undefined || hero.hero === undefined) return;
    const home = this.plan.homes.get(hero.hero.address);
    if (home === undefined) return;

    if (j.verb === 'liquidated') {
      this.#liquidation(j, home);
      return;
    }

    if (!j.initiated) {
      // Something arrived without the hero lifting a finger: a raven, or the
      // Herald for gifts, flies in from wherever it came from.
      const first = j.steps[0];
      const from = first ? this.#targetPoint(first.target, j.hero) : this.plan.gate.doorAt;
      const start = first?.target.kind === 'home' ? this.plan.gate.doorAt : from;
      const kind: AgentKind = j.verb === 'airdrop' ? 'herald' : 'raven';
      const courier = this.#makeAgent(kind, start.x, start.y);
      courier.flying = kind === 'raven';
      courier.carrying = j.tier;
      courier.journey = j;
      courier.speed = kind === 'raven' ? 6 : 3;
      courier.tasks = [
        this.#toDoor(home, courier.flying),
        { type: 'act', verb: 'give', seconds: 0.8, journey: j },
        { type: 'walk', to: this.plan.gate.doorAt, fly: courier.flying },
        { type: 'vanish' },
      ];
      this.agents.push(courier);
      return;
    }

    const tasks: Task[] = [];
    if (j.feeUsd !== null && j.feeUsd > 0) {
      tasks.push(this.#toDoor(this.plan.tower));
      tasks.push({ type: 'act', verb: 'toll', seconds: 0.5, journey: j });
    }
    for (const step of j.steps) {
      tasks.push(this.#toDoor(this.#targetPlace(step.target, j.hero)));
      tasks.push({ type: 'act', verb: step.verb, seconds: 1.3 + j.drama * 0.4, journey: j });
    }
    tasks.push(this.#toDoor(home));
    // Mark the start of this journey so `carrying` is set when it begins.
    hero.tasks.push({ type: 'act', verb: 'unknown', seconds: 0, journey: j }, ...tasks);
  }

  #liquidation(j: Journey, home: Placed): void {
    const step = j.steps[0];
    const bank = step ? this.#targetPlace(step.target, j.hero) : home;
    const count = j.drama === 1 ? 1 : j.drama === 2 ? 3 : 6;
    for (let i = 0; i < count; i++) {
      const b = this.#makeAgent('bailiff', this.plan.gate.doorAt.x + ((i % 3) - 1) * 0.3, this.plan.gate.doorAt.y + Math.floor(i / 3) * 0.3);
      b.speed = 3 + i * 0.1;
      b.journey = j;
      b.tasks = [
        this.#toDoor(bank),
        { type: 'act', verb: 'seize', seconds: 1.6, journey: j },
        { type: 'walk', to: this.plan.gate.doorAt },
        { type: 'vanish' },
      ];
      b.carrying = null;
      this.agents.push(b);
    }
    const t = this.plan.tower;
    this.effects.push({ kind: 'alarm', x: t.x + t.w / 2, y: t.y, age: 0, ttl: 2 + j.drama * 2, drama: j.drama });
    if (j.drama >= 3) {
      this.gloom = 1;
      this.shake = 1.5;
      this.effects.push({ kind: 'storm', x: home.x, y: home.y, age: 0, ttl: 8, drama: 3 });
    }
  }

  #targetPlace(target: Target, hero: string): Placed {
    switch (target.kind) {
      case 'building':
        return this.plan.byProtocol.get(target.protocolId) ?? this.plan.gate;
      case 'home':
        return this.plan.homes.get(target.address) ?? this.plan.homes.get(hero) ?? this.plan.gate;
      case 'gate':
        return this.plan.gate;
    }
  }

  #targetPoint(target: Target, hero: string): Pt {
    return this.#targetPlace(target, hero).doorAt;
  }

  /** Walk (or fly) to a building's door and wait at a free spot there. */
  #toDoor(b: Placed, fly?: boolean): Task {
    return fly === undefined ? { type: 'walk', to: b.doorAt, door: b } : { type: 'walk', to: b.doorAt, door: b, fly };
  }

  // --- door slots: nobody stands inside anybody else -----------------------
  readonly #slots = new Map<string, (string | null)[]>();

  #claimSlot(a: Agent, b: Placed): Pt {
    this.#releaseSlot(a);
    const taken = this.#slots.get(b.id) ?? [];
    let n = taken.indexOf(null);
    if (n === -1) n = taken.length;
    taken[n] = a.id;
    this.#slots.set(b.id, taken);
    a.slotAt = b.id;
    return doorSlot(b, n);
  }

  #releaseSlot(a: Agent): void {
    if (a.slotAt === null) return;
    const taken = this.#slots.get(a.slotAt);
    if (taken) {
      const i = taken.indexOf(a.id);
      if (i >= 0) taken[i] = null;
      while (taken.length > 0 && taken[taken.length - 1] === null) taken.pop();
    }
    a.slotAt = null;
  }

  // --- movement --------------------------------------------------------------

  #advance(a: Agent, dt: number): void {
    a.phase += dt * (a.path.length > 0 ? 8 : 2);
    if (a.acting !== null) {
      a.acting.left -= dt;
      if (a.acting.left <= 0) a.acting = null;
      return;
    }
    if (a.path.length > 0) {
      const hurry = a.kind === 'hero' ? Math.min(3, 1 + a.tasks.filter((t) => t.type === 'act' && t.seconds === 0).length * 0.6) : 1;
      let budget = a.speed * dt * hurry;
      while (budget > 0 && a.path.length > 0) {
        const p = a.path[0];
        if (p === undefined) break;
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const dz = (p.z ?? 0) - a.alt;
        const d = Math.hypot(dx, dy, dz);
        if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
        if (d <= budget) {
          a.x = p.x;
          a.y = p.y;
          a.alt = p.z ?? 0;
          a.path.shift();
          budget -= d;
        } else {
          a.x += (dx / d) * budget;
          a.y += (dy / d) * budget;
          a.alt += (dz / d) * budget;
          budget = 0;
        }
      }
      a.trail.unshift({ x: a.x, y: a.y });
      if (a.trail.length > 40) a.trail.pop();
      return;
    }
    const task = a.tasks.shift();
    if (task === undefined) {
      this.#idle(a);
      return;
    }
    switch (task.type) {
      case 'walk': {
        const to = task.door ? this.#claimSlot(a, task.door) : (this.#releaseSlot(a), task.to);
        a.path = task.fly === true || a.flying ? flightRoute(a, to) : walkRoute(this.plan, a, to);
        break;
      }
      case 'act':
        if (task.seconds === 0) {
          // Journey start marker.
          a.journey = task.journey ?? null;
          a.carrying = task.journey && task.journey.valueUsd > 0 ? task.journey.tier : null;
          break;
        }
        a.acting = { verb: task.verb, left: task.seconds, total: task.seconds };
        if (task.journey) this.#actEffects(a, task.verb, task.journey);
        break;
      case 'vanish':
        this.#releaseSlot(a);
        a.gone = true;
        break;
    }
  }

  #actEffects(a: Agent, verb: string, j: Journey): void {
    const at = { x: a.x, y: a.y - 0.5 };
    const big = j.drama;
    const step = j.steps[0];
    if (step?.target.kind === 'building') this.lastVisit.set(step.target.protocolId, this.elapsed);
    switch (verb) {
      case 'toll':
        this.effects.push({ kind: 'coins', ...at, age: 0, ttl: 1.2, drama: 0, color: '#ffb347' });
        this.effects.push({ kind: 'float', ...at, age: 0, ttl: 1.6, drama: 0, text: j.feeUsd !== null ? `toll $${j.feeUsd.toFixed(2)}` : 'toll', color: '#ffcf8a' });
        return;
      case 'seize':
        this.effects.push({ kind: 'coins', ...at, age: 0, ttl: 1.5, drama: big, color: '#ff5e5e' });
        return;
    }
    if (j.status === 'failed') {
      this.effects.push({ kind: 'smoke', ...at, age: 0, ttl: 2, drama: 1 });
      this.effects.push({ kind: 'float', ...at, age: 0, ttl: 3, drama: 1, text: 'torn scroll — failed', color: '#ff8a8a' });
      a.carrying = null;
      return;
    }
    if (verb === 'approve' || verb === 'revoke') this.effects.push({ kind: 'key', ...at, age: 0, ttl: 2, drama: 0, color: verb === 'approve' ? '#ffd166' : '#9ad1ff' });
    else this.effects.push({ kind: big >= 2 ? 'sparkle' : 'coins', ...at, age: 0, ttl: 1.4 + big * 0.5, drama: big });
    this.effects.push({ kind: 'float', ...at, age: 0, ttl: 3 + big, drama: big, text: j.label });
    if (verb === 'give' || verb === 'send' || verb === 'lend') a.carrying = null;
    if (big >= 3) this.shake = 0.6;
  }

  #idle(a: Agent): void {
    a.journey = null;
    a.carrying = null;
    if (a.kind === 'villager') {
      const b = this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)];
      if (b === undefined || this.agents.filter((x) => x.kind === 'villager').length > this.#villagerTarget + 2) {
        this.#releaseSlot(a);
        a.gone = true;
        return;
      }
      a.tasks = [this.#toDoor(b), { type: 'act', verb: 'unknown', seconds: 0.5 + this.#rng() * 2 }];
      a.acting = null;
    }
  }

  #makeAgent(kind: AgentKind, x: number, y: number): Agent {
    return {
      id: `${kind}:${this.#uid++}`,
      kind,
      x,
      y,
      path: [],
      tasks: [],
      acting: null,
      facing: 1,
      speed: WALK_SPEED,
      flying: false,
      alt: 0,
      slotAt: null,
      carrying: null,
      journey: null,
      trail: [],
      phase: this.#rng() * 10,
      dim: kind === 'villager',
      gone: false,
    };
  }

  #spawnHeroes(): void {
    for (const hero of this.guild.heroes) {
      const home = this.plan.homes.get(hero.address);
      if (home === undefined) continue;
      const a = this.#makeAgent('hero', home.doorAt.x, home.doorAt.y);
      a.hero = hero;
      a.speed = WALK_SPEED * (MOUNT_SPEED[hero.tier] ?? 1);
      a.flying = hero.tier >= 5; // griffins and dragons do not use roads
      this.agents.push(a);
      this.#heroAgents.set(hero.address, a);
    }
  }

  #spawnVillager(anywhere: boolean): void {
    const from = anywhere
      ? this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)]?.doorAt
      : this.plan.gate.doorAt;
    if (from === undefined) return;
    this.agents.push(this.#makeAgent('villager', from.x, from.y));
  }
}
