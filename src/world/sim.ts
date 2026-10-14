/**
 * The living town: a replay clock over the guild's journeys, and the agents
 * that act them out. Renderer-agnostic — it only moves points around in tile
 * space and emits effects; both renderers draw the same state.
 */

import type { Goods, Guild, HeroClass, Journey, JourneyStep, Target } from '../domain/model.js';
import { makeRng } from '../util/rng.js';
import { type Placed, type Pt, type TownPlan } from './layout.js';
import { guildNetWorth, populationFor } from './population.js';
import { harvestOf, harvestOfUsd, loanHealth, type Harvest, type LoanHealth, type PriceMove } from '../domain/risk.js';
import { ethPriceFrom, initialChain, nextChain, type BlockInfo, type ChainState } from './chain.js';
import { doorSlot, flightRoute, walkRoute, walkableAt } from './route.js';
import { realmOf } from '../domain/realms.js';
import { WALK_SPEED, type ActTask, type Agent, type AgentKind, type Coin, type Effect, type Task, type Town } from './agents.js';
import { bubble, Townsfolk } from './townsfolk.js';
import { phrasesFor } from './marketChatter.js';

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

export type { Agent, AgentKind, Coin, Effect, EffectKind, Gesture } from './agents.js';


/** Seconds coins take to fly from one hand (or door) to the other. */
export const TRANSFER_FLIGHT = 0.75;
/** Seconds a door stays open after someone last went through it. */
const DOOR_HOLD = 0.7;

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

/** Tiles between the points of an agent's trail. */
const TRAIL_STEP = 0.12;
/** A townsperson's hitbox radius, in tiles: two on the ground keep at least twice this apart. */
const VILLAGER_RADIUS = 0.3;
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
  /** Each lending building's riskiest loan (by building id): its marker, and bailiffs at its door when in danger. */
  readonly loans = new Map<string, LoanHealth>();
  /** Rewards waiting to be harvested, per building id. */
  readonly harvests = new Map<string, Harvest>();
  /** How ETH moved since the player last looked (the market board and the weather), if known. */
  priceMove: PriceMove | null = null;
  /** The weather the market sets: rain after a drop, a storm after a crash (0..1, the floor under `gloom`). */
  #mood = 0;
  /** The real chain, as of the last bell: the toll board and the beacon read it. */
  chain: ChainState = initialChain();
  /** Which realm (chain id) this town is: Ethereum's rings with real blocks; a province's tower has no feed yet. */
  realm = 'ethereum';
  /** ETH in USD, from what the guild holds (for the toll in dollars), or null; a province's town is given the whole guild's. */
  ethUsd: number | null;
  /** Townsfolk, and what anyone idle does next (see `townsfolk.ts`). */
  readonly #folk: Townsfolk;
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
  #uid = 0;
  /** When each building's door was last pushed (by building id, on the `elapsed` clock). */
  readonly #doorUse = new Map<string, number>();
  /** Where a building's real doorway is, as the 3D view built it (null: there is none). */
  readonly #doorways = new Map<string, Pt | null>();
  /** Token logos by symbol, from what the guild holds. */
  readonly #icons = new Map<string, string>();

  constructor(guild: Guild, plan: TownPlan) {
    this.guild = guild;
    this.plan = plan;
    for (const h of guild.heroes) for (const it of h.items) if (it.iconUrl && !this.#icons.has(it.symbol)) this.#icons.set(it.symbol, it.iconUrl);
    this.scheduled = schedule(guild.journeys);
    const last = this.scheduled[this.scheduled.length - 1];
    this.duration = (last?.at ?? 0) + 12;
    const town = this.#town();
    this.#folk = new Townsfolk(town);
    // the town's people: as many as the guild's wealth brings
    this.#folk.target = populationFor(guildNetWorth(guild));
    this.#spawnHeroes();
    this.#readStashes();
    this.#spawnWatchers();
    for (let i = 0; i < this.#folk.target; i++) this.#folk.spawn(true);
    this.ethUsd = ethPriceFrom(guild.heroes.flatMap((h) => h.items));
  }

  /** The Sim as its townsfolk see it (they share its people, effects and dice). */
  #town(): Town {
    return {
      plan: this.plan,
      rng: () => this.#rng(),
      agents: () => this.agents,
      addAgent: (a) => void this.agents.push(a),
      makeAgent: (kind, x, y) => this.#makeAgent(kind, x, y),
      addEffect: (e) => void this.effects.push(e),
      releaseSlot: (a) => this.#releaseSlot(a),
      toDoor: (b, fly) => this.#toDoor(b, fly),
      enterable: (b) => this.#enterable(b),
      doorway: (b) => this.doorway(b),
    };
  }

  get live(): boolean {
    return this.t >= this.duration;
  }

  // --- doors -------------------------------------------------------------------

  /**
   * Where people go in and out of a building (tiles): the real door when the
   * view has said where it is, else the middle of the front at the door tile.
   * Null where there is no way in (the gate, a bedroll, a tent).
   */
  doorway(b: Placed): Pt | null {
    const known = this.#doorways.get(b.id);
    if (known !== undefined) return known;
    if (b.kind === 'gate') return null;
    if (b.kind === 'home') {
      const tier = this.guild.heroes.find((h) => h.address === b.heroAddress)?.tier ?? 0;
      if (tier < 2) return null;
    }
    return { x: b.doorAt.x, y: b.y + b.h - 0.2 };
  }

  /** The view built this building's door here (or none: null), so people walk in through it. */
  setDoorway(id: string, at: Pt | null): void {
    this.#doorways.set(id, at);
  }

  /** Is this building's door open: someone passing through, or doing business at it? */
  doorOpen(id: string): boolean {
    const t = this.#doorUse.get(id);
    return t !== undefined && this.elapsed - t < DOOR_HOLD;
  }

  #touch(id: string): void {
    this.#doorUse.set(id, this.elapsed);
  }

  /** Townsfolk drop in on shops and halls (not the tower, which has its line, nor anybody's home). */
  #enterable(b: Placed): boolean {
    return b.kind !== 'tower' && b.kind !== 'home' && b.kind !== 'gate' && this.doorway(b) !== null;
  }

  /** Goods as coins to draw (the first few kinds). */
  coins(list: readonly Goods[]): Coin[] {
    return list.slice(0, 3).map((g) => ({ symbol: g.symbol, quantity: g.quantity, icon: g.isNft ? (g.image ?? null) : (this.#icons.get(g.symbol) ?? null), nft: g.isNft }));
  }

  heroAgent(address: string): Agent | undefined {
    return this.#heroAgents.get(address);
  }

  /** Whoever carries out the quest replaying on its own (the hero, or the raven, herald or bailiffs that come to them). */
  get soloActor(): Agent | null {
    return this.#solo?.agent ?? null;
  }

  /** An agent by its id, or a hero by address; undefined once gone. */
  findAgent(key: string): Agent | undefined {
    return this.#heroAgents.get(key) ?? this.agents.find((a) => a.id === key && !a.gone);
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

  /** While a price move is shown, a villager now and then says what the market is doing. */
  #chatterIn = 0;
  #chatter(dt: number): void {
    if (this.priceMove === null) return;
    this.#chatterIn -= dt;
    if (this.#chatterIn > 0) return;
    this.#chatterIn = 5 + this.#rng() * 4;
    const folk = this.agents.filter((a) => a.kind === 'villager' && !a.gone && !a.inside && a.doorway === null && a.alt === 0);
    if (folk.length === 0) return;
    const who = folk[Math.floor(this.#rng() * folk.length)]!;
    bubble(this.#town(), who, 3.5, 0, phrasesFor(this.priceMove.mood), true);
  }

  /** The market since the player last looked: a falling price brings rain, a crash a storm. */
  setPriceMove(m: PriceMove | null): void {
    this.priceMove = m;
    this.#mood = m === null ? 0 : m.mood === 'crash' ? 0.7 : m.mood === 'down' ? 0.3 : 0;
    this.gloom = Math.max(this.gloom, this.#mood);
  }

  /** Loans and harvests per building, from every hero's stashes. */
  #readStashes(): void {
    const byProtocol = new Map(this.plan.buildings.filter((b) => b.protocolId !== undefined).map((b) => [b.protocolId!, b.id]));
    const crops = new Map<string, number>();
    for (const hero of this.guild.heroes) {
      for (const stash of hero.stashes) {
        const id = byProtocol.get(stash.protocolId);
        if (id === undefined) continue;
        const loan = loanHealth(stash);
        const worst = this.loans.get(id);
        if (loan && (!worst || loan.health < worst.health)) this.loans.set(id, loan);
        const crop = harvestOf(stash);
        if (crop) crops.set(id, (crops.get(id) ?? 0) + crop.usd);
      }
    }
    for (const [id, usd] of crops) {
      const h = harvestOfUsd(usd);
      if (h) this.harvests.set(id, h);
    }
  }

  /** Bailiffs hanging about the door of a Counting House whose loan is in danger (two when it is near liquidation). */
  #spawnWatchers(): void {
    this.agents = this.agents.filter((a) => a.loiterAt === undefined);
    for (const [id, loan] of this.loans) {
      if (loan.level !== 'danger' && loan.level !== 'critical') continue;
      const b = this.plan.buildings.find((x) => x.id === id);
      if (!b) continue;
      for (let i = 0; i < (loan.level === 'critical' ? 2 : 1); i++) {
        const a = this.#makeAgent('bailiff', b.doorAt.x + (i - 0.5) * 0.6, b.doorAt.y + 0.4);
        a.loiterAt = { x: b.doorAt.x, y: b.doorAt.y + 0.3 };
        a.speed = WALK_SPEED * 0.6;
        this.agents.push(a);
      }
    }
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
      a.inside = false;
      a.doorway = null;
      a.goods = [];
      a.face = null;
    }
    this.#doorUse.clear();
    this.effects = [];
    this.log = this.scheduled.slice(0, this.#next).map((s) => ({ journey: s.journey, at: s.at })).slice(-40);
    this.played = this.#next;
    this.#spawnWatchers();
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
      hero.inside = false;
      hero.doorway = null;
      hero.goods = [];
      this.#releaseSlot(hero);
    }
    const before = new Set(this.agents);
    // a replay is not news: it stays out of the log and `played`, so its badges don't toast again
    this.#dispatch(j, false);
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
    this.chain = nextChain(this.chain, block);
    this.effects.push({ kind: 'ring', x: t.x + t.w / 2, y: t.y + t.h / 2, age: 0, ttl: 2.2, drama: 1, text: `#${block.number}` });
    // Busier blocks bring more people into the streets.
    this.#folk.target = Math.round(6 + block.busy * 14);
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
    this.#keepApart();
    this.agents = this.agents.filter((a) => !a.gone);
    // the replay's end charts the whole map (buildings known only for what is kept there)
    if (this.t >= this.duration) this.#chart(this.elapsed);

    if (this.#folk.street() < this.#folk.target && this.#rng() < dtReal * 0.8) this.#folk.spawn(false);
    this.#chatter(dtReal);

    for (const e of this.effects) e.age += dtReal;
    this.effects = this.effects.filter((e) => e.age < e.ttl);
    this.gloom = Math.max(this.#mood, this.gloom - dtReal * 0.08);
    this.shake = Math.max(0, this.shake - dtReal * 2);
  }

  // --- dispatch --------------------------------------------------------------

  #dispatch(j: Journey, record = true): void {
    if (record) {
      this.log.push({ journey: j, at: this.t });
      this.played++;
      if (this.log.length > 40) this.log.shift();
    }
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
      // goods that crossed from another realm come ashore at the harbour
      const harbour = this.#harbour();
      const crossed = j.bridge !== undefined && j.bridge.to === j.chainId && harbour !== undefined;
      const start = crossed ? harbour.doorAt : first?.target.kind === 'home' ? this.plan.gate.doorAt : from;
      if (crossed) this.effects.push({ kind: 'float', x: start.x, y: start.y - 0.5, age: 0, ttl: 3.5, drama: 1, text: `⛵ from ${realmOf(j.bridge!.from).name}`, color: '#9fd8ff' });
      const kind: AgentKind = j.verb === 'airdrop' ? 'herald' : 'raven';
      const courier = this.#makeAgent(kind, start.x, start.y);
      courier.flying = kind === 'raven';
      courier.carrying = j.tier;
      courier.journey = j;
      courier.goods = this.coins(j.steps.flatMap((s) => s.get));
      courier.speed = kind === 'raven' ? 4 : 1.6;
      courier.tasks = [
        this.#toDoor(home, courier.flying),
        { type: 'act', verb: 'give', seconds: 0.8, journey: j, door: home, gesture: 'interact' },
        { type: 'walk', to: this.plan.gate.doorAt, fly: courier.flying },
        { type: 'vanish' },
      ];
      this.agents.push(courier);
      return;
    }

    const tasks: Task[] = [];
    if (j.feeUsd !== null && j.feeUsd > 0) {
      tasks.push(this.#toDoor(this.plan.tower));
      tasks.push({ type: 'act', verb: 'toll', seconds: 0.8, journey: j, door: this.plan.tower, gesture: 'interact' });
    }
    // On foot, a hero goes in to do business; a rider stays in the saddle and it is done at the door.
    const onFoot = hero.hero.tier < 2 && hero.hover === 0;
    const failed = j.status === 'failed';
    let brought = false;
    for (const step of j.steps) {
      const place = this.#targetPlace(step.target, j.hero);
      const seconds = 1.3 + j.drama * 0.4;
      tasks.push(this.#toDoor(place));
      if (onFoot && step.target.kind === 'building' && this.doorway(place) !== null) {
        tasks.push({ type: 'enter', b: place, give: failed ? [] : this.coins(step.give) });
        tasks.push({ type: 'act', verb: step.verb, seconds, journey: j, step });
        tasks.push({ type: 'exit', b: place });
        // what comes back is handed out of the door
        if (!failed && step.get.length > 0) tasks.push({ type: 'act', verb: 'pickup', seconds: 0.9, gesture: 'pickup', pickup: { coins: this.coins(step.get), from: place } });
      } else {
        tasks.push({ type: 'act', verb: step.verb, seconds, journey: j, step, door: place, gesture: 'interact' });
      }
      if (!failed && step.get.length > 0) brought = true;
    }
    // a crossing to another realm: what was handed in sails from the harbour
    if (j.bridge !== undefined && j.bridge.from === j.chainId) {
      const harbour = this.#harbour();
      if (harbour !== undefined && tasks.at(-1)?.type === 'act') {
        const last = tasks.at(-1) as ActTask;
        if (last.door?.id !== harbour.id) tasks.push(this.#toDoor(harbour));
        tasks.push({ type: 'act', verb: 'wait', seconds: 1, sail: j.bridge.to ?? '?', door: harbour });
      }
    }
    tasks.push(this.#toDoor(home));
    // and what was brought home goes inside
    if (brought) tasks.push({ type: 'act', verb: 'stash', seconds: 0.8, door: home, gesture: 'interact' });
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
        { type: 'act', verb: 'seize', seconds: 1.6, journey: j, door: bank, gesture: 'push' },
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

  /** The harbour, where ships cross to other realms (bridges' building), if the town has one. */
  #harbour(): Placed | undefined {
    return this.plan.buildings.find((b) => b.kind === 'harbour');
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

  /**
   * Townsfolk on the ground push each other apart when they overlap, but only onto ground they may walk on
   * (never into a building, a doorway or the water). Heroes, people indoors or at a door keep their place.
   */
  #keepApart(): void {
    const folk = this.agents.filter((a) => a.kind === 'villager' && !a.gone && !a.inside && a.doorway === null && a.acting === null && a.alt === 0);
    const min = 2 * VILLAGER_RADIUS;
    for (let i = 0; i < folk.length; i++) {
      for (let j = i + 1; j < folk.length; j++) {
        const a = folk[i]!;
        const b = folk[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        // (two on the same spot part along x)
        const ux = d > 1e-6 ? dx / d : 1;
        const uy = d > 1e-6 ? dy / d : 0;
        const push = (min - d) / 2;
        const ax = a.x - ux * push;
        const ay = a.y - uy * push;
        const bx = b.x + ux * push;
        const by = b.y + uy * push;
        if (walkableAt(this.plan, { x: ax, y: ay })) {
          a.x = ax;
          a.y = ay;
        }
        if (walkableAt(this.plan, { x: bx, y: by })) {
          b.x = bx;
          b.y = by;
        }
      }
    }
  }

  #advance(a: Agent, dt: number): void {
    a.phase += dt * (a.path.length > 0 ? 2.5 + a.speed * 1.6 : 2); // steps keep time with the pace
    // a door stands open while someone goes through it, or does business at it
    if (a.doorway !== null) this.#touch(a.doorway);
    if (a.acting?.door !== undefined) this.#touch(a.acting.door);
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
      this.#folk.idle(a);
      return;
    }
    switch (task.type) {
      case 'walk': {
        const to = task.door ? this.#claimSlot(a, task.door) : (this.#releaseSlot(a), task.to);
        a.path = task.fly === true || a.flying ? flightRoute(a, to) : walkRoute(this.plan, a, to);
        a.face = null;
        break;
      }
      case 'act':
        if (task.seconds === 0) {
          // Journey start marker: setting out with what is to be handed over.
          a.journey = task.journey ?? null;
          delete a.actStep;
          a.carrying = task.journey && task.journey.valueUsd > 0 ? task.journey.tier : null;
          a.goods = task.journey ? this.coins(task.journey.steps[0]?.give ?? []) : [];
          break;
        }
        a.acting = { verb: task.verb, left: task.seconds, total: task.seconds };
        // (what the hero's quest card shows as under way; idle business is not part of the quest)
        if (task.journey !== undefined && task.journey === a.journey) a.actStep = task.verb === 'toll' ? -1 : task.step !== undefined ? task.journey.steps.indexOf(task.step) : (a.actStep ?? -1);
        else delete a.actStep;
        if (task.gesture) a.acting.gesture = task.gesture;
        if (task.face) a.face = task.face;
        this.#exchange(a, task);
        if (task.sail !== undefined) {
          const to = task.sail === '?' ? 'another realm' : realmOf(task.sail).name;
          this.effects.push({ kind: 'float', x: a.x, y: a.y - 0.5, age: 0, ttl: 3.5, drama: 1, text: `⛵ sails for ${to}`, color: '#9fd8ff' });
          this.effects.push({ kind: 'sparkle', x: a.x, y: a.y - 0.5, age: 0, ttl: 1.6, drama: 1 });
        }
        if (task.journey) this.#actEffects(a, task.verb, task.journey, task.step);
        break;
      case 'enter': {
        const at = this.doorway(task.b);
        if (at === null) break; // no way in: business at the door instead
        this.#releaseSlot(a);
        a.face = null;
        a.doorway = task.b.id;
        if (task.give && task.give.length > 0) {
          this.#transfer({ x: a.x, y: a.y }, at, task.give, 'in', { fromAgent: a.id, drama: a.journey?.drama ?? 0 });
          a.goods = [];
        }
        a.path = [{ x: at.x, y: at.y }];
        a.tasks.unshift({ type: 'inside' });
        break;
      }
      case 'inside':
        a.inside = true;
        a.doorway = null;
        break;
      case 'exit': {
        if (!a.inside) break;
        const at = this.doorway(task.b) ?? task.b.doorAt;
        a.x = at.x;
        a.y = at.y;
        a.inside = false;
        a.doorway = task.b.id;
        a.path = [{ x: task.b.doorAt.x + (this.#rng() - 0.5) * 0.4, y: task.b.doorAt.y - 0.05 }];
        a.tasks.unshift({ type: 'outside' });
        break;
      }
      case 'outside':
        a.doorway = null;
        break;
      case 'vanish':
        this.#releaseSlot(a);
        a.gone = true;
        break;
    }
  }

  /** Goods changing hands as an act begins: into the door, out of it, or to whoever waits at home. */
  #exchange(a: Agent, task: ActTask): void {
    const j = task.journey;
    if (task.door && task.verb !== 'give') a.acting!.door = task.door.id;
    const door = task.door ? (this.doorway(task.door) ?? task.door.doorAt) : null;
    const drama = j?.drama ?? 0;
    if (task.pickup) {
      const from = this.doorway(task.pickup.from) ?? task.pickup.from.doorAt;
      this.#touch(task.pickup.from.id);
      a.acting!.door = task.pickup.from.id;
      this.#transfer(from, { x: a.x, y: a.y }, task.pickup.coins, 'out', { toAgent: a.id, drama });
      a.goods = task.pickup.coins;
      return;
    }
    if (door === null) return;
    switch (task.verb) {
      case 'toll':
        if (j?.feeNative) this.#transfer({ x: a.x, y: a.y }, door, [{ symbol: 'ETH', quantity: j.feeNative, icon: this.#icons.get('ETH') ?? null, nft: false }], 'in', { fromAgent: a.id, drama: 0, color: '#ffb347' });
        return;
      case 'stash':
        this.#transfer({ x: a.x, y: a.y }, door, a.goods, 'in', { fromAgent: a.id, drama: 0 });
        a.goods = [];
        return;
      case 'seize': {
        const loot = j?.steps[0]?.give ?? [];
        const coins = loot.length > 0 ? this.coins(loot) : [{ symbol: '', quantity: 0, icon: null, nft: false }];
        this.#transfer(door, { x: a.x, y: a.y }, coins, 'out', { toAgent: a.id, drama, color: '#ff5e5e', seized: true });
        a.goods = coins;
        return;
      }
      case 'give': {
        // a delivery: into the hero's hands when they are at home, else in through the door
        if (j === undefined) return;
        const hero = this.#heroAgents.get(j.hero);
        const home = task.door!;
        const there = hero !== undefined && !hero.inside && hero.journey === null && Math.hypot(hero.x - home.doorAt.x, hero.y - home.doorAt.y) < 2.5;
        if (there) {
          this.#transfer({ x: a.x, y: a.y }, { x: hero.x, y: hero.y }, a.goods, 'in', { fromAgent: a.id, toAgent: hero.id, drama });
          if (hero.tasks.length === 0 && hero.path.length === 0 && hero.acting === null) {
            const seconds = j.verb === 'airdrop' || drama >= 2 ? 2.4 : 1.2;
            hero.acting = { verb: 'pickup', left: seconds, total: seconds, gesture: j.verb === 'airdrop' || drama >= 2 ? 'cheer' : 'pickup' };
            hero.face = { x: a.x, y: a.y };
          }
          a.face = { x: hero.x, y: hero.y };
        } else {
          a.acting!.door = home.id;
          this.#transfer({ x: a.x, y: a.y }, door, a.goods, 'in', { fromAgent: a.id, drama });
        }
        a.goods = [];
        return;
      }
    }
    // business at the door: hand over, and (a moment later) take what comes back
    const step = task.step;
    if (step === undefined || j?.status === 'failed') return;
    this.#transfer({ x: a.x, y: a.y }, door, this.coins(step.give), 'in', { fromAgent: a.id, drama });
    const back = this.coins(step.get);
    this.#transfer(door, { x: a.x, y: a.y }, back, 'out', { toAgent: a.id, drama, delay: task.seconds * 0.5 });
    a.goods = back;
  }

  #transfer(from: Pt, to: Pt, coins: Coin[], dir: 'in' | 'out', o: { fromAgent?: string; toAgent?: string; drama: number; delay?: number; color?: string; seized?: boolean }): void {
    if (coins.length === 0) return;
    const delay = o.delay ?? 0;
    const e: Effect = { kind: 'transfer', x: from.x, y: from.y, to: { x: to.x, y: to.y }, coins, dir, delay, age: 0, ttl: delay + TRANSFER_FLIGHT + 1.4, drama: o.drama };
    if (o.fromAgent !== undefined) e.fromAgent = o.fromAgent;
    if (o.toAgent !== undefined) e.toAgent = o.toAgent;
    if (o.color !== undefined) e.color = o.color;
    if (o.seized === true) e.seized = true;
    this.effects.push(e);
  }

  #actEffects(a: Agent, verb: string, j: Journey, step?: JourneyStep): void {
    // (inside, the show is at the door)
    const at = a.inside ? { x: a.x, y: a.y + 0.3 } : { x: a.x, y: a.y - 0.5 };
    const big = j.drama;
    const first = j.steps[0];
    if (first?.target.kind === 'building') this.lastVisit.set(first.target.protocolId, this.elapsed);
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
        this.effects.push({ kind: 'coins', ...at, age: 0, ttl: 1.5, drama: big, color: '#ff5e5e', seized: true });
        return;
    }
    if (j.status === 'failed') {
      this.effects.push({ kind: 'smoke', ...at, age: 0, ttl: 2, drama: 1 });
      this.effects.push({ kind: 'float', ...at, age: 0, ttl: 3, drama: 1, text: 'torn scroll — failed', color: '#ff8a8a' });
      a.carrying = null;
      return;
    }
    if (verb === 'approve' || verb === 'revoke') this.effects.push({ kind: 'key', ...at, age: 0, ttl: 2, drama: 0, color: verb === 'approve' ? '#ffd166' : '#9ad1ff' });
    else if (big >= 2) this.effects.push({ kind: 'sparkle', ...at, age: 0, ttl: 1.4 + big * 0.5, drama: big });
    // (the goods themselves fly as coins: a burst only when nothing visible changes hands)
    else if ((step ?? first) === undefined || ((step ?? first)!.give.length === 0 && (step ?? first)!.get.length === 0)) this.effects.push({ kind: 'coins', ...at, age: 0, ttl: 1.4 + big * 0.5, drama: big });
    this.effects.push({ kind: 'float', ...at, age: 0, ttl: 3 + big, drama: big, text: j.label });
    // a big one turns heads: the villagers about stop and look (on the biggest, they cheer and come closer)
    if (big >= 2) this.#folk.gawk({ x: a.x, y: a.y }, big);
    if (verb === 'give' || verb === 'send' || verb === 'lend') a.carrying = null;
    if (big >= 3) this.shake = 0.6;
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
      inside: false,
      doorway: null,
      goods: [],
      face: null,
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
}
