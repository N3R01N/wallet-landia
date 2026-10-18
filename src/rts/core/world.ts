/**
 * Ledger Wars' simulation: the players' tokens, their buildings, the hall's
 * construction (C&C style: build, then place), upgrades, and the market,
 * at `RULES.tickHz` ticks a second. Deterministic: the seed and the command
 * log make the same match. Commands are checked here, whoever sends them
 * (the player's UI or the AI).
 */

import { streamOf, type Rng } from '../../game/core/detmath.js';
import { BUILDINGS, aName, RULES, START_KITS, STABLES, TOKEN_IDS, TOKENS, type BuildingKind, type PlayerId, type StartKit, type TokenId } from '../data/rules.js';
import { generateMap, markRect, type GameMap, cellOf } from './map.js';
import { openingMarket, stepMarket, type Market } from './market.js';
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
  | { t: 'upgrade'; id: number };

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
  | { t: 'liquidated'; owner: PlayerId; count: number };

export interface WorldSetup {
  seed: string;
  kits: Record<PlayerId, StartKit>;
  /** Prices hold still (tests, a tutorial). */
  still?: boolean;
}

const DT = 1 / RULES.tickHz;

export class World {
  readonly seed: string;
  readonly map: GameMap;
  readonly market: Market;
  readonly players: Record<PlayerId, Player>;
  readonly buildings: Building[] = [];
  tick = 0;
  winner: PlayerId | null = null;
  readonly log: { tick: number; player: PlayerId; cmd: Command }[] = [];
  #nextId = 1;
  #events: WorldEvent[] = [];
  readonly #rng: Rng;
  #priceClock = 0;
  /** Prices hold still (the setup's `still`). */
  still: boolean;

  constructor(setup: WorldSetup) {
    this.seed = setup.seed;
    this.map = generateMap(setup.seed);
    this.market = openingMarket();
    this.#rng = streamOf(setup.seed, 'rts-world');
    this.still = setup.still ?? false;
    const player = (id: PlayerId): Player => {
      const tokens = Object.fromEntries(TOKEN_IDS.map((t) => [t, 0])) as Record<TokenId, number>;
      for (const [t, usd] of Object.entries(START_KITS[setup.kits[id]].dollars) as [TokenId, number][]) tokens[t] = usd / TOKENS[t].price;
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

  /** Why a player can't build this now (null: it can). */
  cantBuild(p: PlayerId, kind: BuildingKind): string | null {
    const r = BUILDINGS[kind];
    const me = this.players[p];
    if (kind === 'hall') return 'one wallet hall each';
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

  /** Why a building can't go at (x, z) (already snapped); null: it can. */
  cantPlace(p: PlayerId, kind: BuildingKind, x: number, z: number): string | null {
    const f = BUILDINGS[kind].footprint;
    const h = this.map.size / 2 - 1;
    if (Math.abs(x) + f / 2 > h || Math.abs(z) + f / 2 > h) return 'off the map';
    for (let dz = -f / 2; dz < f / 2; dz++) {
      for (let dx = -f / 2; dx < f / 2; dx++) {
        const c = cellOf(this.map, x + dx + 0.5, z + dz + 0.5);
        if (c < 0 || this.map.blocked[c] !== 0) return 'the ground is taken';
      }
    }
    const near = this.buildings.some((b) => b.owner === p && Math.hypot(b.x - x, b.z - z) <= RULES.buildRadius);
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
  }

  #add(kind: BuildingKind, owner: PlayerId, x: number, z: number): Building {
    const r = BUILDINGS[kind];
    const b: Building = { id: this.#nextId++, kind, owner, x, z, level: 1, hp: r.hp, maxHp: r.hp, upgrading: null };
    this.buildings.push(b);
    const f = r.footprint;
    markRect(this.map, x - f / 2, z - f / 2, x + f / 2, z + f / 2, 2);
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
