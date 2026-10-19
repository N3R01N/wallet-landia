/**
 * Ledger Wars' simulation: the players' tokens, their buildings, the hall's
 * construction (C&C style: build, then place), upgrades, and the market,
 * at `RULES.tickHz` ticks a second. Deterministic: the seed and the command
 * log make the same match. Commands are checked here, whoever sends them
 * (the player's UI or the AI).
 */

import { streamOf, type Rng } from '../../game/core/detmath.js';
import { BUILDINGS, aName, RULES, TRAIN, type TrainRule, START_KITS, STABLES, TOKEN_IDS, TOKENS, type BuildingKind, type PlayerId, type StartKit, type TokenId } from '../data/rules.js';
import { generateMap, markRect, type GameMap, cellOf } from './map.js';
import { openingMarket, stepMarket, type Market } from './market.js';
import { Paths } from './path.js';
import { formation, newUnit, separate, walk, type OrderKind, type Unit } from './units.js';
import { COMBAT, fight, type FightEvent } from './combat.js';
import { newOpponent, opponentTick, type Difficulty, type OpponentState } from '../ai/opponent.js';
import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { UnitTypeId } from '../../game/core/types.js';
import { accrue, applyEcon, ECON_COMMANDS, liquidate, type EconCommand, type EconWorld, type Position } from './economy.js';

export interface Building {
  id: number;
  kind: BuildingKind;
  owner: PlayerId;
  x: number;
  z: number;
  level: number;
  hp: number;
  maxHp: number;
  /** An upgrade under way: the level it goes to and the seconds left. */
  upgrading: { to: number; left: number; total: number } | null;
  /** Units in training, the first one under way. */
  queue: { unit: UnitTypeId; left: number; total: number }[];
  /** Where its new units walk to (null: they stay by the door). */
  rally: { x: number; z: number } | null;
  /** A wallet hall's seconds until its next arrow. */
  shot?: number;
}

export interface Player {
  id: PlayerId;
  tokens: Record<TokenId, number>;
  /** The hall's construction: what, and the seconds left. */
  build: { kind: BuildingKind; left: number; total: number } | null;
  /** A finished building waiting to be placed. */
  ready: BuildingKind | null;
  /** What it holds at the protocols (economy.ts). */
  positions: Position[];
}

/** The commands of building (the economy's are in economy.ts). */
export type BuildCommand =
  | { t: 'build'; kind: BuildingKind }
  | { t: 'cancelBuild' }
  | { t: 'place'; x: number; z: number }
  | { t: 'upgrade'; id: number }
  | { t: 'train'; id: number; unit: UnitTypeId }
  | { t: 'cancelTrain'; id: number }
  | { t: 'rally'; id: number; x: number; z: number }
  /** Units ordered: to a point (move, attack-move), at a target (attack), or to stop or hold. */
  | { t: 'order'; units: number[]; kind: OrderKind; x?: number; z?: number; target?: number };

export type Command = BuildCommand | EconCommand;

export interface Result {
  ok: boolean;
  reason?: string;
}

/** What happened, for the view (drained by `takeEvents`). */
export type WorldEvent =
  | { t: 'placed'; id: number }
  | { t: 'built'; owner: PlayerId; kind: BuildingKind }
  | { t: 'upgraded'; id: number }
  | { t: 'paid'; owner: PlayerId; usd: number }
  | { t: 'liquidated'; owner: PlayerId; count: number }
  | { t: 'trained'; id: number }
  | { t: 'destroyed'; id: number; kind: BuildingKind; owner: PlayerId }
  | { t: 'won'; winner: PlayerId }
  | FightEvent;

export interface WorldSetup {
  seed: string;
  kits: Record<PlayerId, StartKit>;
  /** Prices hold still (tests, a tutorial). */
  still?: boolean;
  /** The sides the computer plays (ai/opponent.ts); it thinks inside the ticks, so a match replays exactly. */
  ai?: PlayerId[];
  /** How well the computer plays (default normal). */
  difficulty?: Difficulty;
  /** Dollars per token each side starts with, in place of its kit (a campaign mission). */
  dollars?: Partial<Record<PlayerId, Partial<Record<TokenId, number>>>>;
  /** What each side may build and train (a campaign mission); a side not listed has everything. */
  allowed?: Partial<Record<PlayerId, Allowed>>;
}

/** A side's buildings and units in a campaign mission, and the highest level each building may reach (default 1). */
export interface Allowed {
  buildings: readonly BuildingKind[];
  units: readonly UnitTypeId[];
  levels?: Partial<Record<BuildingKind, number>>;
}

export const NOT_YET = 'not in this mission';

const DT = 1 / RULES.tickHz;

export class World {
  readonly seed: string;
  readonly map: GameMap;
  readonly market: Market;
  readonly players: Record<PlayerId, Player>;
  readonly buildings: Building[] = [];
  readonly units: Unit[] = [];
  readonly paths: Paths;
  tick = 0;
  winner: PlayerId | null = null;
  readonly log: { tick: number; player: PlayerId; cmd: Command }[] = [];
  #nextId = 1;
  #events: WorldEvent[] = [];
  readonly #rng: Rng;
  #priceClock = 0;
  /** Prices hold still (the setup's `still`). */
  still: boolean;
  /** The computer's sides and their state. */
  readonly ai = new Map<PlayerId, OpponentState>();
  /** What each side may build and train (null: everything). */
  readonly allowed: Record<PlayerId, Allowed | null>;

  constructor(setup: WorldSetup) {
    this.seed = setup.seed;
    this.map = generateMap(setup.seed);
    this.paths = new Paths(this.map);
    this.market = openingMarket();
    this.#rng = streamOf(setup.seed, 'rts-world');
    this.still = setup.still ?? false;
    for (const id of setup.ai ?? []) this.ai.set(id, newOpponent(setup.difficulty));
    this.allowed = { A: setup.allowed?.A ?? null, B: setup.allowed?.B ?? null };
    const player = (id: PlayerId): Player => {
      const tokens = Object.fromEntries(TOKEN_IDS.map((t) => [t, 0])) as Record<TokenId, number>;
      for (const [t, usd] of Object.entries(setup.dollars?.[id] ?? START_KITS[setup.kits[id]].dollars) as [TokenId, number][]) tokens[t] = usd / TOKENS[t].price;
      return { id, tokens, build: null, ready: null, positions: [] };
    };
    this.players = { A: player('A'), B: player('B') };
    for (const id of ['A', 'B'] as const) this.#add('hall', id, RULES.start[id].x, RULES.start[id].z);
  }

  get time(): number {
    return this.tick * DT;
  }

  /** What happened since the last call. */
  takeEvents(): WorldEvent[] {
    const e = this.#events;
    this.#events = [];
    return e;
  }

  /** A player's holdings in dollars, by token, at today's prices. */
  usd(p: PlayerId, t: TokenId): number {
    return this.players[p].tokens[t] * this.market.prices[t];
  }

  /** What a player can spend on buildings: its stablecoins and ETH, in dollars. */
  spendable(p: PlayerId): number {
    return [...STABLES, 'eth' as const].reduce((s, t) => s + this.usd(p, t), 0);
  }

  hallOf(p: PlayerId): Building | null {
    return this.buildings.find((b) => b.owner === p && b.kind === 'hall') ?? null;
  }

  has(p: PlayerId, kind: BuildingKind): boolean {
    return this.buildings.some((b) => b.owner === p && b.kind === kind);
  }

  /** Whether this mission keeps a kind of building from the player. */
  locked(p: PlayerId, kind: BuildingKind): boolean {
    const a = this.allowed[p];
    return !!a && kind !== 'hall' && !a.buildings.includes(kind);
  }

  /** Whether this mission keeps a unit from the player. */
  unitLocked(p: PlayerId, unit: UnitTypeId): boolean {
    const a = this.allowed[p];
    return !!a && !a.units.includes(unit);
  }

  /** The highest level this mission lets a kind of building reach. */
  levelCap(p: PlayerId, kind: BuildingKind): number {
    const a = this.allowed[p];
    return a ? Math.min(BUILDINGS[kind].maxLevel, a.levels?.[kind] ?? 1) : BUILDINGS[kind].maxLevel;
  }

  /** The tokens a player has a use for: the ones it holds and the ones it can spend or earn here (all, outside a mission). */
  tokensInPlay(p: PlayerId): TokenId[] {
    const a = this.allowed[p];
    if (!a) return TOKEN_IDS;
    const use = new Set<TokenId>(['usdc', 'eth']);
    for (const t of TRAIN) if (a.units.includes(t.unit)) use.add(t.token);
    if (a.buildings.includes('staking') || a.buildings.includes('restaking')) use.add('steth');
    if (a.buildings.includes('vault')) use.add('dai');
    return TOKEN_IDS.filter((t) => use.has(t) || this.players[p].tokens[t] * this.market.prices[t] >= 1);
  }

  /** Why a player can't build this now (null: it can). */
  cantBuild(p: PlayerId, kind: BuildingKind): string | null {
    const r = BUILDINGS[kind];
    const me = this.players[p];
    if (kind === 'hall') return 'one wallet hall each';
    if (this.locked(p, kind)) return NOT_YET;
    const hall = this.hallOf(p);
    if (!hall) return 'no wallet hall';
    if (hall.level < r.hallLevel) return `needs the wallet hall at level ${r.hallLevel}`;
    const missing = r.needs.find((n) => !this.has(p, n));
    if (missing) return `needs ${aName(missing)}`;
    if (me.build || me.ready) return 'the hall is busy';
    if (this.spendable(p) < r.cost) return `needs $${r.cost.toLocaleString('en-US')} in stablecoins or ETH`;
    return null;
  }

  /** Why a building can't be raised a level now (null: it can). */
  cantUpgrade(p: PlayerId, b: Building): string | null {
    const r = BUILDINGS[b.kind];
    if (b.owner !== p) return 'not yours';
    if (b.level >= r.maxLevel) return 'at its highest level';
    if (b.level >= this.levelCap(p, b.kind)) return NOT_YET;
    if (b.upgrading) return 'already upgrading';
    const hall = this.hallOf(p);
    if (b.kind !== 'hall' && (!hall || hall.level <= b.level)) return `needs the wallet hall at level ${b.level + 1}`;
    if (this.spendable(p) < r.upgrade[b.level - 1]!) return `needs $${r.upgrade[b.level - 1]!.toLocaleString('en-US')}`;
    return null;
  }

  /** Where a building of this kind would stand if put at (x, z): snapped to the grid. */
  snap(kind: BuildingKind, x: number, z: number): { x: number; z: number } {
    const f = BUILDINGS[kind].footprint;
    const off = f % 2 === 0 ? 0 : 0.5;
    return { x: Math.round(x - off) + off, z: Math.round(z - off) + off };
  }

  /** Why a building can't go at (x, z) (already snapped); null: it can. `anywhere`: not only near the player's buildings (a mission's setup). */
  cantPlace(p: PlayerId, kind: BuildingKind, x: number, z: number, anywhere = false): string | null {
    const f = BUILDINGS[kind].footprint;
    const h = this.map.size / 2 - 1;
    if (Math.abs(x) + f / 2 > h || Math.abs(z) + f / 2 > h) return 'off the map';
    for (let dz = -f / 2; dz < f / 2; dz++) {
      for (let dx = -f / 2; dx < f / 2; dx++) {
        const c = cellOf(this.map, x + dx + 0.5, z + dz + 0.5);
        if (c < 0 || this.map.blocked[c] !== 0) return 'the ground is taken';
      }
    }
    const near = anywhere || this.buildings.some((b) => b.owner === p && Math.hypot(b.x - x, b.z - z) <= RULES.buildRadius);
    if (!near) return 'too far from your buildings';
    return null;
  }

  /** A player's command, checked and applied now (the log keeps it with its tick). */
  command(p: PlayerId, cmd: Command): Result {
    const r = this.#apply(p, cmd);
    if (r.ok) this.log.push({ tick: this.tick, player: p, cmd });
    return r;
  }

  /** The economy's view of this world. */
  get econ(): EconWorld {
    return {
      prices: this.market.prices,
      tokens: (p) => this.players[p].tokens,
      positions: (p) => this.players[p].positions,
      level: (p, kind) => this.level(p, kind),
      nextId: () => this.#nextId++,
    };
  }

  /** The highest level of this kind of building the player has standing (0: none). */
  level(p: PlayerId, kind: BuildingKind): number {
    return this.buildings.reduce((m, b) => (b.owner === p && b.kind === kind && b.hp > 0 ? Math.max(m, b.level) : m), 0);
  }

  #apply(p: PlayerId, cmd: Command): Result {
    if (this.winner) return { ok: false, reason: 'the match is over' };
    if (ECON_COMMANDS.has(cmd.t)) return applyEcon(this.econ, p, cmd as EconCommand);
    const me = this.players[p];
    const c = cmd as BuildCommand;
    switch (c.t) {
      case 'build': {
        const why = this.cantBuild(p, c.kind);
        if (why) return { ok: false, reason: why };
        const r = BUILDINGS[c.kind];
        this.#pay(p, r.cost);
        me.build = { kind: c.kind, left: r.time, total: r.time };
        return { ok: true };
      }
      case 'cancelBuild': {
        const kind = me.build?.kind ?? me.ready;
        if (!kind) return { ok: false, reason: 'nothing being built' };
        this.#refund(p, BUILDINGS[kind].cost * RULES.refund);
        me.build = null;
        me.ready = null;
        return { ok: true };
      }
      case 'place': {
        if (!me.ready) return { ok: false, reason: 'nothing ready to place' };
        const at = this.snap(me.ready, c.x, c.z);
        const why = this.cantPlace(p, me.ready, at.x, at.z);
        if (why) return { ok: false, reason: why };
        this.#add(me.ready, p, at.x, at.z);
        me.ready = null;
        return { ok: true };
      }
      case 'upgrade': {
        const b = this.buildings.find((x) => x.id === c.id);
        if (!b) return { ok: false, reason: 'no such building' };
        const why = this.cantUpgrade(p, b);
        if (why) return { ok: false, reason: why };
        const r = BUILDINGS[b.kind];
        this.#pay(p, r.upgrade[b.level - 1]!);
        b.upgrading = { to: b.level + 1, left: r.upgradeTime, total: r.upgradeTime };
        return { ok: true };
      }
      case 'train': {
        const b = this.buildings.find((x) => x.id === c.id);
        if (!b) return { ok: false, reason: 'no such building' };
        const why = this.cantTrain(p, b, c.unit);
        if (why) return { ok: false, reason: why };
        const rule = TRAIN.find((t) => t.unit === c.unit)!;
        me.tokens[rule.token] -= this.unitCost(rule);
        b.queue.push({ unit: c.unit, left: rule.time, total: rule.time });
        return { ok: true };
      }
      case 'cancelTrain': {
        const b = this.buildings.find((x) => x.id === c.id && x.owner === p);
        const last = b?.queue.pop();
        if (!last) return { ok: false, reason: 'nothing in training' };
        const rule = TRAIN.find((t) => t.unit === last.unit)!;
        me.tokens[rule.token] += this.unitCost(rule);
        return { ok: true };
      }
      case 'rally': {
        const b = this.buildings.find((x) => x.id === c.id && x.owner === p);
        if (!b) return { ok: false, reason: 'not your building' };
        b.rally = { x: c.x, z: c.z };
        return { ok: true };
      }
      case 'order': {
        const mine = c.units.map((id) => this.units.find((u) => u.id === id)).filter((u): u is Unit => !!u && u.owner === p && u.died < 0);
        if (mine.length === 0) return { ok: false, reason: 'no units' };
        this.#order(mine, c);
        return { ok: true };
      }
    }
  }

  /** A unit's price in its token at today's price. */
  unitCost(rule: TrainRule): number {
    return (RULES.unitValue * UNIT_TYPES[rule.unit]!.costMult) / this.market.prices[rule.token];
  }

  /** Why this building can't train this unit now (null: it can). */
  cantTrain(p: PlayerId, b: Building, unit: UnitTypeId): string | null {
    const rule = TRAIN.find((t) => t.unit === unit);
    if (!rule || rule.at !== b.kind) return `not trained at the ${BUILDINGS[b.kind].name}`;
    if (b.owner !== p) return 'not yours';
    if (this.unitLocked(p, unit)) return NOT_YET;
    if (b.level < rule.level) return `needs the ${BUILDINGS[b.kind].name} at level ${rule.level}`;
    if (b.queue.length >= RULES.queueMax) return 'the queue is full';
    if (this.units.filter((u) => u.owner === p && u.died < 0).length + this.buildings.filter((x) => x.owner === p).reduce((s, x) => s + x.queue.length, 0) >= RULES.unitCap) return `at most ${RULES.unitCap} units`;
    if (this.players[p].tokens[rule.token] < this.unitCost(rule) - 1e-12) return `needs ${TOKENS[rule.token].symbol}`;
    return null;
  }

  /** Spreads a group's order: moves into a formation round the point, the rest as they are. */
  #order(units: Unit[], c: Extract<BuildCommand, { t: 'order' }>): void {
    units.sort((a, b) => a.id - b.id);
    for (const u of units) {
      u.target = null;
      u.best = Infinity;
      u.stall = 0;
    }
    if ((c.kind === 'move' || c.kind === 'attackMove') && c.x !== undefined && c.z !== undefined) {
      const cell = this.paths.nearestOpen(c.x, c.z, 16);
      if (cell < 0) return;
      const slots = formation(units, c.x, c.z, this.paths, this.map);
      units.forEach((u, i) => (u.order = { t: 'move', x: slots[i]!.x, z: slots[i]!.z, cell, attack: c.kind === 'attackMove' }));
      return;
    }
    if (c.kind === 'attack' && c.target !== undefined) {
      for (const u of units) u.order = { t: 'attack', target: c.target };
      return;
    }
    for (const u of units) {
      u.order = c.kind === 'hold' ? { t: 'hold' } : { t: 'idle' };
      u.guard = { x: u.x, z: u.z };
    }
  }

  /** One tick. */
  step(): void {
    if (this.winner) return;
    this.tick++;
    this.#priceClock += DT;
    if (this.#priceClock >= RULES.priceStep - 1e-9) {
      this.#priceClock = 0;
      if (!this.still) stepMarket(this.market, this.#rng);
      for (const id of ['A', 'B'] as const) {
        accrue(this.econ, id, RULES.priceStep);
        const count = liquidate(this.econ, id);
        if (count > 0) this.#events.push({ t: 'liquidated', owner: id, count });
      }
    }
    for (const [id, state] of this.ai) opponentTick(this, id, state, DT);
    for (const p of Object.values(this.players)) {
      if (!p.build) continue;
      p.build.left -= DT;
      if (p.build.left <= 1e-9) {
        p.ready = p.build.kind;
        this.#events.push({ t: 'built', owner: p.id, kind: p.build.kind });
        p.build = null;
      }
    }
    for (const b of this.buildings) {
      if (!b.upgrading) continue;
      b.upgrading.left -= DT;
      if (b.upgrading.left <= 1e-9) {
        const r = BUILDINGS[b.kind];
        b.level = b.upgrading.to;
        b.maxHp += r.hpPerLevel;
        b.hp += r.hpPerLevel;
        b.upgrading = null;
        this.#events.push({ t: 'upgraded', id: b.id });
      }
    }
    // training: the first in each queue
    for (const b of this.buildings) {
      const first = b.queue[0];
      if (!first || b.hp <= 0) continue;
      first.left -= DT;
      if (first.left > 1e-9) continue;
      b.queue.shift();
      this.#spawn(b, first.unit);
    }
    this.#moveUnits();
    this.#fallen();
  }

  /** Fighting first (combat.ts), then the walking of those who didn't fight. */
  #moveUnits(): void {
    for (const u of this.units) {
      u.px = u.x;
      u.pz = u.z;
      u.moving = false;
      if (u.died >= 0) u.died += DT;
    }
    const acted = fight({ units: this.units, buildings: this.buildings, paths: this.paths, rng: this.#rng, dt: DT, emit: (e) => this.#events.push(e) });
    for (const u of this.units) {
      if (u.died >= 0 || acted.has(u.id)) continue;
      if (u.order.t === 'move' && walk(u, DT, this.paths)) {
        u.order = { t: 'idle' };
        u.guard = { x: u.x, z: u.z };
      }
    }
    separate(this.units, this.map);
  }

  /** The dead taken away; buildings at 0 HP fall (their ground opens again); a fallen wallet hall ends the match. */
  #fallen(): void {
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i]!.died > COMBAT.corpse) this.units.splice(i, 1);
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const b = this.buildings[i]!;
      if (b.hp > 0) continue;
      this.buildings.splice(i, 1);
      const f = BUILDINGS[b.kind].footprint;
      markRect(this.map, b.x - f / 2, b.z - f / 2, b.x + f / 2, b.z + f / 2, 0);
      this.paths.invalidate();
      this.#events.push({ t: 'destroyed', id: b.id, kind: b.kind, owner: b.owner });
      if (b.kind === 'hall' && !this.winner) {
        this.winner = b.owner === 'A' ? 'B' : 'A';
        this.#events.push({ t: 'won', winner: this.winner });
      }
    }
  }

  /** A trained unit steps out of its building (on the side towards its rally point, or the middle) and walks to the rally point. */
  #spawn(b: Building, type: UnitTypeId): void {
    const toward = b.rally ?? { x: 0, z: 0 };
    const f = BUILDINGS[b.kind].footprint;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let r = f / 2 + 0.5; r < f / 2 + 4 && !best; r += 1) {
      for (let a = 0; a < 24; a++) {
        const x = b.x + Math.cos((a / 24) * Math.PI * 2) * r;
        const z = b.z + Math.sin((a / 24) * Math.PI * 2) * r;
        const c = cellOf(this.map, x, z);
        if (c < 0 || this.map.blocked[c] !== 0) continue;
        const d = Math.hypot(toward.x - x, toward.z - z);
        if (d < bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    }
    const at = best ?? { x: b.x, z: b.z + f };
    const u = newUnit(this.#nextId++, type, b.owner, at.x, at.z);
    this.units.push(u);
    if (b.rally) this.#order([u], { t: 'order', units: [u.id], kind: 'move', x: b.rally.x, z: b.rally.z });
    this.#events.push({ t: 'trained', id: u.id });
  }

  /** A mission's setup: a building standing from the start, at this level (no checks but the ground). */
  addBuilding(kind: BuildingKind, owner: PlayerId, x: number, z: number, level = 1): Building {
    const b = this.#add(kind, owner, x, z);
    const r = BUILDINGS[kind];
    b.level = Math.min(level, r.maxLevel);
    b.maxHp = b.hp = r.hp + r.hpPerLevel * (b.level - 1);
    return b;
  }

  /** A mission's script: a unit put on the field (raiders, guards). */
  addUnit(owner: PlayerId, type: UnitTypeId, x: number, z: number): Unit {
    const u = newUnit(this.#nextId++, type, owner, x, z);
    this.units.push(u);
    return u;
  }

  /** Ends the match (a mission's objectives done). */
  finish(winner: PlayerId): void {
    if (this.winner) return;
    this.winner = winner;
    this.#events.push({ t: 'won', winner });
  }

  #add(kind: BuildingKind, owner: PlayerId, x: number, z: number): Building {
    const r = BUILDINGS[kind];
    const b: Building = { id: this.#nextId++, kind, owner, x, z, level: 1, hp: r.hp, maxHp: r.hp, upgrading: null, queue: [], rally: null };
    this.buildings.push(b);
    const f = r.footprint;
    markRect(this.map, x - f / 2, z - f / 2, x + f / 2, z + f / 2, 2);
    this.paths?.invalidate();
    this.#events.push({ t: 'placed', id: b.id });
    return b;
  }

  /** Pays dollars from stablecoins first, then ETH (the caller has checked there is enough). */
  #pay(p: PlayerId, usd: number): void {
    let left = usd;
    for (const t of [...STABLES, 'eth' as const]) {
      const price = this.market.prices[t];
      const take = Math.min(this.players[p].tokens[t], left / price);
      this.players[p].tokens[t] -= take;
      left -= take * price;
      if (left <= 1e-9) break;
    }
    this.#events.push({ t: 'paid', owner: p, usd });
  }

  #refund(p: PlayerId, usd: number): void {
    this.players[p].tokens.usdc += usd;
  }
}
