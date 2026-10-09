/**
 * The living town: a replay clock over the guild's journeys, and the agents
 * that act them out. Renderer-agnostic — it only moves points around in tile
 * space and emits effects; both renderers draw the same state.
 */

import type { Guild, Hero, HeroClass, Journey, Target, Verb } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import { makeRng } from '../util/rng.js';
import { type Placed, type Pt, type TownPlan } from './layout.js';
import { ethPriceFrom, initialChain, nextChain, type BlockInfo, type ChainState } from './chain.js';
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
 * 3–18 s, so order and rough rhythm survive but nothing drags (and a hero
 * walking at a real pace has time to get somewhere between them).
 */
export function schedule(journeys: readonly Journey[]): Scheduled[] {
  const out: Scheduled[] = [];
  let at = 2;
  let prev: number | null = null;
  for (const j of journeys) {
    if (prev !== null) {
      const gapH = Math.max(0, (j.time - prev) / 3_600_000);
      at += 3 + Math.min(15, 4.4 * Math.log1p(gapH));
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
  /** Height it keeps when not flying: griffins and dragons hover low over the road. */
  hover: number;
  /** Waiting in line at the Chronicle Tower (a transaction waiting for a page). */
  queued?: boolean;
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

/** Tiles per second on foot: a brisk walk (~2.2 m/s); a hero with errands piling up hurries. */
const WALK_SPEED = 1.2;
/** The longest the line at the tower gets (people). */
const QUEUE_MAX = 18;
/** Tiles between the points of an agent's trail. */
const TRAIL_STEP = 0.12;
/** How far back on its hero's trail a caravan rolls (index into the trail: ~1.4 tiles). */
export const CARAVAN_BACK = 12;
/** Mounts by tier, as multiples of walking: a donkey's amble up to a griffin's flight. */
const MOUNT_SPEED = [0.85, 0.95, 1.1, 1.35, 1.7, 2.4, 3] as const;

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
  /** Journeys played so far (the log only keeps the latest). */
  played = 0;
  /** The real chain, as of the last bell: the queue, the toll board and the beacon read it. */
  chain: ChainState = initialChain();
  /** ETH in USD, from what the guild holds (for the toll in dollars), or null. */
  readonly ethUsd: number | null;
  /** The line at the tower door, front first. */
  readonly queue: Agent[] = [];
  /** Where the line stands: spots along the road from the tower door, front first. */
  readonly queueLine: Pt[];
  #queueTimer = 0;
  /** Fog of war: buildings stay hidden until a hero first visits them in the replay. */
  fog = false;
  /** Protocols revealed so far, and when (`elapsed`), so the fog can lift as it happens. */
  readonly revealed = new Map<string, number>();

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
    this.ethUsd = ethPriceFrom(guild.heroes.flatMap((h) => h.items));
    this.queueLine = this.#lineFromTower();
    // the town opens with the line already standing
    for (let i = 0; i < this.queueTarget; i++) this.#joinQueue(this.queueLine[i]!);
    this.#placeQueue();
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

  #chart(at: number): void {
    for (const b of this.plan.buildings) if (b.protocolId !== undefined && !this.revealed.has(b.protocolId)) this.revealed.set(b.protocolId, at);
  }

  /** How hidden a building is: 1 in fog, falling to 0 as it lifts; 0 without fog of war. */
  fogOver(b: Placed): number {
    if (!this.fog || b.protocolId === undefined) return 0;
    const at = this.revealed.get(b.protocolId);
    if (at === undefined) return 1;
    return Math.max(0, 1 - (this.elapsed - at) / 1.6);
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
      if (home) Object.assign(a, { x: home.doorAt.x, y: home.doorAt.y, alt: a.hover });
      a.tasks = [];
      a.path = [];
      a.acting = null;
      a.journey = null;
      a.carrying = null;
      a.trail = [];
    }
    this.effects = [];
    this.log = this.scheduled.slice(0, this.#next).map((s) => ({ journey: s.journey, at: s.at })).slice(-40);
    this.played = this.#next;
    // everything visited before the cursor is known, without a show
    this.revealed.clear();
    for (const s of this.scheduled.slice(0, this.#next)) for (const step of s.journey.steps) if (step.target.kind === 'building') this.revealed.set(step.target.protocolId, -1e9);
    if (this.t >= this.duration) this.#chart(-1e9);
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
      if (home) Object.assign(hero, { x: home.doorAt.x, y: home.doorAt.y, alt: hero.hover });
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
  bell(block: BlockInfo): void {
    const t = this.plan.tower;
    const fresh = block.number !== this.chain.block;
    this.chain = nextChain(this.chain, block);
    this.effects.push({ kind: 'ring', x: t.x + t.w / 2, y: t.y + t.h / 2, age: 0, ttl: 2.2, drama: 1, text: `#${block.number}` });
    // Busier blocks bring more people into the streets.
    this.#villagerTarget = Math.round(6 + block.busy * 14);
    // the block takes in the front of the line
    if (fresh) this.#admit(block.busy);
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
    this.#tendQueue(dtReal);
    // the replay's end charts the whole map (buildings known only for what is kept there)
    if (this.t >= this.duration) this.#chart(this.elapsed);

    const villagers = this.agents.filter((a) => a.kind === 'villager' && !a.queued).length;
    if (villagers < this.#villagerTarget && this.#rng() < dtReal * 0.8) this.#spawnVillager(false);

    for (const e of this.effects) e.age += dtReal;
    this.effects = this.effects.filter((e) => e.age < e.ttl);
    this.gloom = Math.max(0, this.gloom - dtReal * 0.08);
    this.shake = Math.max(0, this.shake - dtReal * 2);
  }

  // --- dispatch --------------------------------------------------------------

  #dispatch(j: Journey): void {
    this.log.push({ journey: j, at: this.t });
    this.played++;
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
      // whatever sent it steps out of the fog
      for (const st of j.steps) if (st.target.kind === 'building' && !this.revealed.has(st.target.protocolId)) this.revealed.set(st.target.protocolId, this.elapsed);
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
      courier.speed = kind === 'raven' ? 4 : 1.6;
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
      b.speed = 2 + i * 0.1;
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
    a.phase += dt * (a.path.length > 0 ? 2.5 + a.speed * 1.6 : 2); // steps keep time with the pace
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
        const dz = (p.z ?? a.hover) - a.alt;
        const d = Math.hypot(dx, dy, dz);
        if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
        if (d <= budget) {
          a.x = p.x;
          a.y = p.y;
          a.alt = p.z ?? a.hover;
          a.path.shift();
          budget -= d;
        } else {
          a.x += (dx / d) * budget;
          a.y += (dy / d) * budget;
          a.alt += (dz / d) * budget;
          budget = 0;
        }
      }
      // the trail is kept by distance (a step every TRAIL_STEP tiles), so what follows on it keeps its distance at any speed
      // (filled in between, since at high replay speeds one step can cover tiles)
      const last = a.trail[0];
      if (last === undefined) a.trail.unshift({ x: a.x, y: a.y });
      else {
        const gap = Math.hypot(a.x - last.x, a.y - last.y);
        const n = Math.min(40, Math.floor(gap / TRAIL_STEP));
        for (let k = 1; k <= n; k++) a.trail.unshift({ x: last.x + ((a.x - last.x) * k * TRAIL_STEP) / gap, y: last.y + ((a.y - last.y) * k * TRAIL_STEP) / gap });
      }
      if (a.trail.length > 40) a.trail.length = 40;
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
    // the fog lifts from the building the hero stands at
    for (const b of this.plan.buildings) {
      if (b.protocolId !== undefined && !this.revealed.has(b.protocolId) && Math.hypot(b.doorAt.x - a.x, b.doorAt.y - a.y) < 1.6) this.revealed.set(b.protocolId, this.elapsed);
    }
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

  // --- the queue at the tower --------------------------------------------------

  /** Spots for the line: along the walk from the tower door towards the gate, a step apart. */
  #lineFromTower(): Pt[] {
    const door = this.plan.tower.doorAt;
    const route = walkRoute(this.plan, door, this.plan.gate.doorAt);
    const pts = [door, ...route];
    const out: Pt[] = [];
    const STEP = 0.42;
    let want = 0.7; // the first one stands a little off the door
    let walked = 0;
    for (let i = 0; i < pts.length - 1 && out.length < QUEUE_MAX; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (want <= walked + len && out.length < QUEUE_MAX) {
        const f = (want - walked) / len;
        // a little to either side, as people stand in a real line
        const side = (out.length % 2 === 0 ? 1 : -1) * 0.1;
        out.push({ x: a.x + (b.x - a.x) * f - ((b.y - a.y) / len) * side, y: a.y + (b.y - a.y) * f + ((b.x - a.x) / len) * side });
        want += STEP;
      }
      walked += len;
    }
    return out;
  }

  /** How long the line should be: a couple of people when the chain is calm, the whole street when blocks are full. */
  get queueTarget(): number {
    return Math.min(this.queueLine.length, Math.round(2 + this.chain.congestion * (QUEUE_MAX - 2)));
  }

  /** Send each person in line to their spot (after the front went in, or someone joined). */
  #placeQueue(): void {
    this.queue.forEach((a, i) => {
      const spot = this.queueLine[i];
      if (spot === undefined) return;
      const goal = a.tasks[0]?.type === 'walk' ? a.tasks[0].to : a.path.at(-1);
      if (goal && Math.hypot(goal.x - spot.x, goal.y - spot.y) < 0.05) return;
      if (a.path.length === 0 && Math.hypot(a.x - spot.x, a.y - spot.y) < 0.05) return;
      a.path = [];
      a.acting = null;
      a.tasks = [{ type: 'walk', to: spot }];
    });
  }

  /** Someone joins the back of the line, starting from `at`. */
  #joinQueue(at: Pt): void {
    const a = this.#makeAgent('villager', at.x, at.y);
    a.queued = true;
    a.speed = WALK_SPEED * (0.9 + this.#rng() * 0.25);
    this.agents.push(a);
    this.queue.push(a);
  }

  /** A block sealed: the front of the line goes in (more of it when the block was full). */
  #admit(busy: number): void {
    const n = Math.min(this.queue.length, Math.max(1, Math.round(this.queue.length * (0.35 + busy * 0.3))));
    for (const a of this.queue.splice(0, n)) {
      a.queued = false;
      a.path = [];
      a.acting = null;
      a.tasks = [{ type: 'walk', to: this.plan.tower.doorAt }, { type: 'vanish' }];
    }
    this.#placeQueue();
  }

  /** Keep the line as long as the chain is busy: newcomers join at the back, the tail drifts away when it calms. */
  #tendQueue(dtReal: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.gone) this.queue.splice(i, 1);
    const target = this.queueTarget;
    this.#queueTimer -= dtReal;
    if (this.queue.length < target && this.#queueTimer <= 0) {
      // from the gate or any street door, they come to wait their turn
      const from = this.#rng() < 0.5 ? this.plan.gate.doorAt : (this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)]?.doorAt ?? this.plan.gate.doorAt);
      this.#joinQueue(from);
      this.#placeQueue();
      this.#queueTimer = 0.35 + this.#rng() * 0.6;
    } else if (this.queue.length > target + 2) {
      const a = this.queue.pop()!;
      a.queued = false;
      a.path = [];
      a.tasks = [{ type: 'walk', to: this.plan.gate.doorAt }, { type: 'vanish' }];
    }
  }

  #idle(a: Agent): void {
    a.journey = null;
    a.carrying = null;
    if (a.queued) {
      // waiting their turn: face the tower
      const door = this.plan.tower.doorAt;
      if (Math.abs(door.x - a.x) > 0.05) a.facing = door.x > a.x ? 1 : -1;
      return;
    }
    if (a.kind === 'villager') {
      const b = this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)];
      if (b === undefined || this.agents.filter((x) => x.kind === 'villager' && !x.queued).length > this.#villagerTarget + 2) {
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
      hover: 0,
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
      // griffins and dragons keep to the roads like everyone, hovering low (their caravans roll behind)
      a.hover = hero.tier >= 5 ? 0.5 : 0;
      a.alt = a.hover;
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
