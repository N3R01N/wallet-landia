/**
 * The living town: a replay clock over the guild's journeys, and the agents
 * that act them out. Renderer-agnostic — it only moves points around in tile
 * space and emits effects; both renderers draw the same state.
 */

import type { Goods, Guild, Hero, HeroClass, Journey, JourneyStep, Target, Verb } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import { makeRng } from '../util/rng.js';
import { MAP_W, type Placed, type Pt, type TownPlan } from './layout.js';
import { harvestOf, harvestOfUsd, loanHealth, type Harvest, type LoanHealth, type PriceMove } from '../domain/risk.js';
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

/** Something a person does with their hands while busy (rigged people play it; sprites hop). */
export type Gesture = 'talk' | 'interact' | 'pickup' | 'cheer' | 'push';

/** Goods as they are drawn changing hands: a coin with the token's logo (or the NFT's picture). */
export interface Coin {
  symbol: string;
  quantity: number;
  icon: string | null;
  nft: boolean;
}

/**
 * `toll`, `give`, `seize`: paying, delivering, seizing. `stash`: putting what
 * was brought home inside. `pickup`: catching what is handed out of a door.
 * `talk` and `wait`: townsfolk passing the time.
 */
type ActVerb = Verb | 'toll' | 'give' | 'seize' | 'stash' | 'pickup' | 'talk' | 'wait';

interface ActTask {
  type: 'act';
  verb: ActVerb;
  seconds: number;
  journey?: Journey;
  /** The step of the journey done here: what is handed over, and what comes back. */
  step?: JourneyStep;
  /** Business at this building's door: it opens, and goods pass through it. */
  door?: Placed;
  gesture?: Gesture;
  /** Who or what to look at meanwhile. */
  face?: Pt;
  /** Goods handed out of this building's door to the agent. */
  pickup?: { coins: Coin[]; from: Placed };
}

type Task =
  /** `door`: arriving at a building, so claim a free waiting spot there. */
  | { type: 'walk'; to: Pt; fly?: boolean; door?: Placed }
  | ActTask
  /** Go in through the door (handing `give` in on the way), out of sight until `exit`. */
  | { type: 'enter'; b: Placed; give?: Coin[] }
  | { type: 'exit'; b: Placed }
  /** Markers: through the doorway (in, or out). */
  | { type: 'inside' }
  | { type: 'outside' }
  | { type: 'vanish' };

export interface Agent {
  id: string;
  kind: AgentKind;
  hero?: Hero;
  x: number;
  y: number;
  path: Pt[];
  tasks: Task[];
  acting: { verb: string; left: number; total: number; gesture?: Gesture; door?: string } | null;
  facing: 1 | -1;
  /** Inside a building, out of sight (trading at the counter, shopping, waiting for a page in the tower). */
  inside: boolean;
  /** The building whose doorway this agent is passing through (its door stands open meanwhile). */
  doorway: string | null;
  /** What is in hand: drawn as coins over the head while out and about. */
  goods: Coin[];
  /** Where to look while standing still (someone to talk to, the tower door), or null. */
  face: Pt | null;
  speed: number;
  flying: boolean;
  /** Height above the ground, in tiles (flyers in the air). */
  alt: number;
  /** Height it keeps when not flying: griffins and dragons hover low over the road. */
  hover: number;
  /** Waiting in line at the Chronicle Tower (a transaction waiting for a page). */
  queued?: boolean;
  /** Hangs about here (bailiffs watching a risky loan's Counting House). */
  loiterAt?: Pt;
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

export type EffectKind = 'float' | 'coins' | 'ring' | 'smoke' | 'key' | 'sparkle' | 'alarm' | 'storm' | 'transfer' | 'bubble';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  age: number;
  ttl: number;
  text?: string;
  color?: string;
  drama: number;
  /** transfer: where the coins land; they follow `toAgent` (and leave from `fromAgent`) while it is about. bubble: who speaks. */
  to?: Pt;
  toAgent?: string;
  fromAgent?: string;
  /** transfer: what changes hands. */
  coins?: Coin[];
  /** transfer: `in` handed over (dropped off), `out` handed back (picked up). */
  dir?: 'in' | 'out';
  /** Seconds before it shows (the age counts from when it was made). */
  delay?: number;
}

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
  /** Each lending building's riskiest loan (by building id): its marker, and bailiffs at its door when in danger. */
  readonly loans = new Map<string, LoanHealth>();
  /** Rewards waiting to be harvested, per building id. */
  readonly harvests = new Map<string, Harvest>();
  /** How ETH moved since the player last looked (the market board and the weather), if known. */
  priceMove: PriceMove | null = null;
  /** The weather the market sets: rain after a drop, a storm after a crash (0..1, the floor under `gloom`). */
  #mood = 0;
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
  #chatTimer = 2;
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
    this.#spawnHeroes();
    this.#readStashes();
    this.#spawnWatchers();
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

    const villagers = this.#streetVillagers();
    if (villagers < this.#villagerTarget && this.#rng() < dtReal * 0.8) this.#spawnVillager(false);

    for (const e of this.effects) e.age += dtReal;
    this.effects = this.effects.filter((e) => e.age < e.ttl);
    this.gloom = Math.max(this.#mood, this.gloom - dtReal * 0.08);
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
      this.#idle(a);
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
          a.carrying = task.journey && task.journey.valueUsd > 0 ? task.journey.tier : null;
          a.goods = task.journey ? this.coins(task.journey.steps[0]?.give ?? []) : [];
          break;
        }
        a.acting = { verb: task.verb, left: task.seconds, total: task.seconds };
        if (task.gesture) a.acting.gesture = task.gesture;
        if (task.face) a.face = task.face;
        this.#exchange(a, task);
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
        this.#transfer(door, { x: a.x, y: a.y }, coins, 'out', { toAgent: a.id, drama, color: '#ff5e5e' });
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

  #transfer(from: Pt, to: Pt, coins: Coin[], dir: 'in' | 'out', o: { fromAgent?: string; toAgent?: string; drama: number; delay?: number; color?: string }): void {
    if (coins.length === 0) return;
    const delay = o.delay ?? 0;
    const e: Effect = { kind: 'transfer', x: from.x, y: from.y, to: { x: to.x, y: to.y }, coins, dir, delay, age: 0, ttl: delay + TRANSFER_FLIGHT + 1.4, drama: o.drama };
    if (o.fromAgent !== undefined) e.fromAgent = o.fromAgent;
    if (o.toAgent !== undefined) e.toAgent = o.toAgent;
    if (o.color !== undefined) e.color = o.color;
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
    else if (big >= 2) this.effects.push({ kind: 'sparkle', ...at, age: 0, ttl: 1.4 + big * 0.5, drama: big });
    // (the goods themselves fly as coins: a burst only when nothing visible changes hands)
    else if ((step ?? first) === undefined || ((step ?? first)!.give.length === 0 && (step ?? first)!.get.length === 0)) this.effects.push({ kind: 'coins', ...at, age: 0, ttl: 1.4 + big * 0.5, drama: big });
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
      a.tasks = [{ type: 'walk', to: this.plan.tower.doorAt }, { type: 'enter', b: this.plan.tower }, { type: 'vanish' }];
    }
    this.#placeQueue();
  }

  /** Keep the line as long as the chain is busy: newcomers join at the back, the tail drifts away when it calms. */
  #tendQueue(dtReal: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.gone) this.queue.splice(i, 1);
    // a long wait: now and then someone turns to chat with the one behind
    this.#chatTimer -= dtReal;
    if (this.#chatTimer <= 0 && this.queue.length >= 3) {
      this.#chatTimer = 1.5 + this.#rng() * 3;
      const i = 1 + Math.floor(this.#rng() * (this.queue.length - 2));
      const q = this.queue[i]!;
      const mate = this.queue[i + 1]!;
      if (q.path.length === 0 && q.acting === null && mate.path.length === 0) {
        const seconds = 2.5 + this.#rng() * 3;
        q.acting = { verb: 'talk', left: seconds, total: seconds, gesture: 'talk' };
        q.face = { x: mate.x, y: mate.y };
        this.#bubble(q, seconds, 0);
      }
    }
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
    a.goods = [];
    if (a.loiterAt) {
      // pacing outside, waiting for the loan to slip
      const at = a.loiterAt;
      a.tasks = [{ type: 'walk', to: { x: at.x + (this.#rng() - 0.5) * 1.4, y: at.y + this.#rng() * 0.8 } }, { type: 'act', verb: 'unknown', seconds: 2 + this.#rng() * 4 }];
      return;
    }
    if (a.queued) {
      // waiting their turn: face the tower
      const door = this.plan.tower.doorAt;
      if (Math.abs(door.x - a.x) > 0.05) a.facing = door.x > a.x ? 1 : -1;
      a.face = door;
      return;
    }
    if (a.kind === 'villager') {
      const b = this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)];
      if (b === undefined || this.#streetVillagers() > this.#villagerTarget + 2) {
        // home time: in through the door they stand at, else away
        const here = a.slotAt !== null ? this.plan.buildings.find((x) => x.id === a.slotAt) : undefined;
        if (here !== undefined && this.#enterable(here)) {
          a.tasks = [{ type: 'enter', b: here }, { type: 'vanish' }];
          return;
        }
        this.#releaseSlot(a);
        a.gone = true;
        return;
      }
      if (this.#rng() < 0.2 && this.#chat(a)) return;
      a.acting = null;
      if (this.#enterable(b) && this.#rng() < 0.65) {
        // in to shop (or pray, or bank), and out again
        a.tasks = [this.#toDoor(b), { type: 'enter', b }, { type: 'act', verb: 'wait', seconds: 2 + this.#rng() * 7 }, { type: 'exit', b }];
        return;
      }
      // a look at the door, a knock, a word with whoever is inside
      const act: ActTask = { type: 'act', verb: 'unknown', seconds: 0.5 + this.#rng() * 2, face: { x: b.doorAt.x, y: b.y + b.h - 0.5 } };
      if (this.#rng() < 0.5) act.gesture = 'interact';
      a.tasks = [this.#toDoor(b), act];
    }
  }

  /** Villagers out in the streets (not in line, not indoors). */
  #streetVillagers(): number {
    let n = 0;
    for (const x of this.agents) if (x.kind === 'villager' && !x.queued && !x.inside) n++;
    return n;
  }

  /** Stop a passer-by for a chat: walk up, face each other, talk a while. */
  #chat(a: Agent): boolean {
    const mate = this.agents.find((o) => o !== a && o.kind === 'villager' && !o.queued && !o.inside && o.doorway === null && o.acting === null && o.path.length > 0 && o.alt === 0 && Math.hypot(o.x - a.x, o.y - a.y) < 4);
    if (mate === undefined) return false;
    const d = Math.hypot(a.x - mate.x, a.y - mate.y);
    if (d < 0.1) return false;
    const spot = { x: mate.x + ((a.x - mate.x) / d) * 0.5, y: mate.y + ((a.y - mate.y) / d) * 0.5 };
    const tx = Math.floor(spot.x);
    const ty = Math.floor(spot.y);
    if (tx < 0 || ty < 0 || this.plan.walkable[ty * MAP_W + tx] !== 1) return false;
    const talk = 3 + this.#rng() * 4;
    const travel = d / a.speed + 0.6;
    this.#releaseSlot(mate);
    mate.path = [];
    mate.tasks = [
      { type: 'act', verb: 'wait', seconds: travel, face: spot },
      { type: 'act', verb: 'talk', seconds: talk, gesture: 'talk', face: spot },
    ];
    a.tasks = [{ type: 'walk', to: spot }, { type: 'act', verb: 'talk', seconds: talk, gesture: 'talk', face: { x: mate.x, y: mate.y } }];
    this.#bubble(mate, talk, travel);
    this.#bubble(a, talk, travel + 0.6);
    return true;
  }

  /** A speech bubble over someone's head while they talk. */
  #bubble(a: Agent, seconds: number, delay: number): void {
    const words = ['…', '!', '?', '♪', '$', '☺'];
    this.effects.push({ kind: 'bubble', x: a.x, y: a.y, age: 0, ttl: delay + seconds, delay, drama: 0, fromAgent: a.id, text: words[Math.floor(this.#rng() * words.length)]! });
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

  #spawnVillager(anywhere: boolean): void {
    const b = this.plan.buildings[Math.floor(this.#rng() * this.plan.buildings.length)];
    if (!anywhere && b !== undefined && this.#enterable(b) && this.#rng() < 0.5) {
      // out of a door, into the street
      const at = this.doorway(b)!;
      const a = this.#makeAgent('villager', at.x, at.y);
      a.inside = true;
      a.tasks = [{ type: 'exit', b }];
      this.agents.push(a);
      return;
    }
    const from = anywhere ? b?.doorAt : this.plan.gate.doorAt;
    if (from === undefined) return;
    this.agents.push(this.#makeAgent('villager', from.x, from.y));
  }
}
