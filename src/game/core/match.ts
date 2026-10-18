/**
 * The MatchController: the phase machine of a match (spec: "Core match
 * loop"). Round 1 opens on the Trade phase at known prices; every later round
 * runs Market → Trade → Battle → Siege. After round 7 with both keeps standing
 * comes one sudden-death round (siege ×3, no trade), then the higher keep HP %
 * wins.
 *
 * Players and NPCs change the state only through commands; `advance` moves one
 * phase on. No clocks: the UI decides when a phase's time is up.
 */

import { BALANCE, CONFIG_VERSION } from '../config/balance.js';
import { buildArmy, unitCount, unitValueFor } from './army.js';
import { Catalog, UNIT_TYPES } from './catalog.js';
import { qtyFor } from './fixed.js';
import { account, applyCommand, gasCost, holding, stableValue, holdingsOf, liquidate, netValue, payYields, rebalancePools, refreshKeep, slash, type CommandResult, type LedgerCtx } from './ledger.js';
import { drawNext, eventNum } from './market.js';
import { providerFor, type PriceProvider, type PriceSource } from './prices.js';
import { simulateBattle, type BattleMap, type BattleRun } from './battle.js';
import { armyMods, canShutdown, homeAt, relicTotal, slottedRelics } from './depth.js';
import type { BattleResolver } from './quickBattle.js';
import type { Army, Asset, AssetId, Command, LoggedCommand, MatchState, Portfolio, SideId, SideState, Squad } from './types.js';

export interface MatchSetup {
  seed: string;
  portfolios: readonly [Portfolio, Portfolio];
  /** Which sides an NPC plays (M6). */
  npc?: readonly [SideState['npc'] | undefined, SideState['npc'] | undefined];
  /** Assets an imported wallet brought that the data files lack. */
  customAssets?: readonly Asset[];
  /** The battlefield (the town's lanes); a straight field when absent. */
  map?: BattleMap;
  /** Where prices come from (core/prices.ts); the seeded simulation when absent. */
  prices?: PriceSource;
}

/** The full battle simulation (the default). */
export const simulate: BattleResolver = (armies, ctx) => simulateBattle(armies, ctx);

/** Everything a replay needs (spec: "{seed, config version, initial portfolios, command log}"). */
export interface Replay {
  setup: MatchSetup;
  configVersion: string;
  log: LoggedCommand[];
}

export class Match {
  readonly state: MatchState;
  readonly catalog: Catalog;
  readonly log: LoggedCommand[] = [];
  readonly #setup: MatchSetup;
  readonly #resolve: BattleResolver;
  readonly #prices: PriceProvider;
  /** The armies of the current battle (for the renderer). */
  armies: [Army, Army] | null = null;
  /** The current battle in full, when it came from the simulation (for the renderer). */
  run: BattleRun | null = null;
  /** Liquidations so far this match, both sides (the balance report counts them). */
  liquidationCount = 0;
  #weekLiquidations: [number, number] = [0, 0];

  constructor(setup: MatchSetup, resolve: BattleResolver = simulate) {
    this.#setup = structuredClone(setup) as MatchSetup;
    this.#resolve = resolve;
    this.catalog = new Catalog(setup.customAssets ?? []);
    this.#prices = providerFor(setup.prices, setup.seed, this.catalog, [...setup.portfolios[0].nfts, ...setup.portfolios[1].nfts]);
    const market = this.#prices.snapshot();
    const sides = (['A', 'B'] as const).map((id, i) => newSide(id, setup.portfolios[i]!, setup.npc?.[i])) as [SideState, SideState];
    const unitValue = unitValueFor(sides, this.catalog, market.prices);
    this.state = {
      seed: setup.seed,
      configVersion: CONFIG_VERSION,
      round: 1,
      phase: 'trade',
      unitValue,
      customAssets: [...(setup.customAssets ?? [])],
      market,
      sides,
      momentum: null,
      suddenDeath: false,
      winner: null,
      lastBattle: null,
      buildings: (setup.map?.points ?? []).map((p) => ({ id: p.id, kind: p.kind, owner: null })),
      shutdowns: [],
      felled: [0, 0],
      history: [],
    };
    for (const s of sides) {
      refreshKeep(s, this.#ctx());
      s.keepHp = s.keepHpMax;
    }
    this.#record(0, [0, 0]);
    this.#openTrade();
  }

  side(id: SideId): SideState {
    return this.state.sides[id === 'A' ? 0 : 1];
  }

  /** The ledger's view of the match; for a side, its Gas Rebate relic counts. */
  #ctx(side?: SideId): LedgerCtx {
    const s = this.state;
    const rebate = side ? Math.min(0.9, relicTotal(this.relics(side), 'gas')) : 0;
    return { catalog: this.catalog, prices: s.market.prices, unitValue: s.unitValue, round: s.round, gasMult: s.market.gasMult * (1 - rebate) };
  }

  /** A side's slotted relics at today's floors. */
  relics(side: SideId): ReturnType<typeof slottedRelics> {
    return slottedRelics(this.side(side), this.state.market.nftFloors, this.state.unitValue);
  }

  /** A command from a player or an NPC; only in the Trade phase. */
  command(side: SideId, cmd: Command): CommandResult {
    if (this.state.phase !== 'trade') return { ok: false, reason: `no trading in the ${this.state.phase} phase` };
    const r = applyCommand(this.side(side), cmd, this.#ctx(side));
    if (r.ok) this.log.push({ round: this.state.round, side, cmd: structuredClone(cmd) });
    return r;
  }

  /** Both sides have ended their Trade phase. */
  get tradeDone(): boolean {
    return this.state.sides.every((s) => s.tradeDone);
  }

  /**
   * The armies the next battle will field (built as the Battle phase would):
   * the game simulates them in a worker, then passes the run to `advance`.
   */
  nextArmies(): [Army, Army] {
    const s = this.state;
    const ctx = { catalog: this.catalog, prices: s.market.prices, unitValue: s.unitValue };
    return s.sides.map((side) => ({
      ...buildArmy(side, ctx, s.momentum === side.id ? 1 + BALANCE.match.momentumAtk : 1),
      mods: armyMods(side, this.relics(side.id), s.market.regime),
    })) as [Army, Army];
  }

  /** The battle's seed, round and map, who holds the buildings, and where each side is at home (for simulating it elsewhere). */
  battleCtx(): { seed: string; round: number; map?: BattleMap; owners: Record<string, SideId | null>; home: Record<SideId, string[]>; flee?: string[] } {
    const s = this.state;
    const home = (id: SideId) => s.buildings.filter((b) => homeAt(this.side(id), b.kind)).map((b) => b.id);
    const rugged = s.market.current?.id === 'rug-pull' ? s.market.current.target : undefined;
    return {
      seed: s.seed,
      round: s.round,
      ...(this.#setup.map ? { map: this.#setup.map } : {}),
      owners: Object.fromEntries(s.buildings.map((b) => [b.id, b.owner])),
      home: { A: home('A'), B: home('B') },
      ...(rugged ? { flee: [rugged] } : {}),
    };
  }

  /**
   * Moves one phase on. A Trade phase ends here whether or not both sides
   * ended it (its time is up). Into a battle, `run` is that battle already
   * simulated (from the same armies and context), else it is simulated here.
   */
  advance(run?: BattleRun): void {
    const s = this.state;
    switch (s.phase) {
      case 'trade':
      case 'market':
        if (s.phase === 'market' && !s.suddenDeath) {
          this.#openTrade();
          return;
        }
        this.#battle(run);
        return;
      case 'battle':
        this.#siege();
        return;
      case 'siege':
        this.#nextRound();
        return;
      case 'ended':
        return;
    }
  }

  /** Runs phases until the match ends (both sides passing every Trade phase unless `onTrade` trades). */
  playOut(onTrade: (m: Match) => void = () => {}): MatchState {
    let guard = 0;
    while (this.state.phase !== 'ended' && guard++ < 1000) {
      if (this.state.phase === 'trade') onTrade(this);
      this.advance();
    }
    return this.state;
  }

  #openTrade(): void {
    const s = this.state;
    s.phase = 'trade';
    for (const side of s.sides) side.tradeDone = false;
    const held = new Set(s.sides.flatMap((side) => holdingsOf(side).map((h) => h.asset)));
    const { next, rumor } = drawNext(s.seed, s.round, this.catalog, { held });
    s.market.next = next;
    s.market.rumor = rumor;
  }

  #battle(run?: BattleRun): void {
    const s = this.state;
    this.armies = this.nextArmies();
    s.phase = 'battle';
    // the seized collateral has had its moment
    for (const side of s.sides) side.liquidations = [];
    const result = run ?? this.#resolve(this.armies, this.battleCtx());
    this.run = 'frames' in result ? (result as BattleRun) : null;
    // the buildings' owners carry over into the next battle
    if (this.run) for (const b of s.buildings) b.owner = this.run.owners[b.id] ?? b.owner;
    for (const side of s.sides) side.buildingsOwned = s.buildings.filter((b) => b.owner === side.id).map((b) => b.id);
    // the state keeps the outcome only (the frames are the renderer's)
    s.lastBattle = { survivors: result.survivors, seconds: result.seconds };
  }

  #siege(): void {
    const s = this.state;
    s.phase = 'siege';
    const result = s.lastBattle;
    if (!result) return;
    const mult = (s.suddenDeath ? BALANCE.match.suddenDeathSiegeMult : 1) * (1 + BALANCE.keep.siegeRoundGrowth * (Math.min(s.round, BALANCE.match.rounds) - 1));
    const [a, b] = s.sides;
    const extra = (i: 0 | 1) => this.armies?.[i]?.mods?.siege ?? 0;
    // Emergency Shutdown: once per match, a keep under 25% with a stable vault is immune for this Siege phase
    s.shutdowns = [];
    const immune = (x: SideState) => {
      if (x.keepHp >= x.keepHpMax * BALANCE.keep.damageStates[2] || !canShutdown(x)) return false;
      x.shutdownUsed = true;
      s.shutdowns.push(x.id);
      return true;
    };
    // the walls shoot back: each keep's archers fell some of the attackers at its gate first
    const ctx = this.#ctx();
    const volleyB = wallVolley(result.survivors[0], stableValue(b, ctx) / s.unitValue);
    const volleyA = wallVolley(result.survivors[1], stableValue(a, ctx) / s.unitValue);
    s.felled = [volleyA.felled, volleyB.felled];
    const hitB = siegeDamage(volleyB.left, extra(0)) * mult;
    const hitA = siegeDamage(volleyA.left, extra(1)) * mult;
    if (hitB > 0 && !immune(b)) b.keepHp = Math.max(0, b.keepHp - hitB);
    if (hitA > 0 && !immune(a)) a.keepHp = Math.max(0, a.keepHp - hitA);
    // the round's end: owned Vaults (+5% each) and a Mason's Seal raise the keep's max
    for (const x of s.sides) {
      x.keepBonus = 0.05 * s.buildings.filter((bl) => bl.kind === 'vault' && bl.owner === x.id).length + relicTotal(this.relics(x.id), 'keep-max');
      refreshKeep(x, this.#ctx());
    }
    this.#record(s.round, this.#weekLiquidations);
    this.#weekLiquidations = [0, 0];
    if (a.keepHp <= 0 && b.keepHp <= 0) s.winner = 'draw';
    else if (b.keepHp <= 0) s.winner = 'A';
    else if (a.keepHp <= 0) s.winner = 'B';
  }

  #nextRound(): void {
    const s = this.state;
    if (s.winner) {
      s.phase = 'ended';
      return;
    }
    if (s.suddenDeath) {
      const [a, b] = s.sides.map((x) => x.keepHp / x.keepHpMax) as [number, number];
      s.winner = a > b ? 'A' : b > a ? 'B' : 'draw';
      s.phase = 'ended';
      return;
    }
    if (s.round >= BALANCE.match.rounds) s.suddenDeath = true;
    s.round++;
    this.#market();
  }

  #market(): void {
    const s = this.state;
    s.phase = 'market';
    const ctx = this.#ctx();
    for (const side of s.sides) {
      side.valueBeforeMarket = netValue(side, s.market.prices);
      payYields(side, s.round, ctx);
    }
    // a week of daily candles; pools rebalance and loans are checked on every one
    for (const candle of this.#prices.step(s.market, s.round)) {
      for (const side of s.sides) {
        rebalancePools(side, candle.close);
        const n = liquidate(side, s.round, candle.day, { catalog: this.catalog, prices: candle.close }, relicTotal(this.relics(side.id), 'liq-eye')).length;
        this.liquidationCount += n;
        this.#weekLiquidations[side.id === 'A' ? 0 : 1] += n;
      }
    }
    const event = s.market.current;
    if (event?.id === 'slashing') for (const side of s.sides) slash(side, eventNum('slashing', 'burn'));
    if (event?.id === 'airdrop') {
      const asset = 'drop';
      const qty = qtyFor(eventNum('airdrop', 'units') * s.unitValue, s.market.prices[asset] ?? 1);
      for (const side of s.sides) side.portfolio.positions.push({ asset, qty, kind: 'spot' });
    }
    const after = this.#ctx();
    for (const side of s.sides) refreshKeep(side, after);
    // Momentum: the better portfolio % change this week
    const change = s.sides.map((side) => {
      const before = side.valueBeforeMarket;
      return before > 0 ? (netValue(side, s.market.prices) - before) / before : 0;
    }) as [number, number];
    s.momentum = change[0] > change[1] ? 'A' : change[1] > change[0] ? 'B' : null;
  }

  /** A round's line in the history (the recap's charts). */
  #record(round: number, liquidations: [number, number]): void {
    const s = this.state;
    s.history.push({
      round,
      value: s.sides.map((x) => netValue(x, s.market.prices)) as [number, number],
      keep: s.sides.map((x) => (x.keepHpMax > 0 ? x.keepHp / x.keepHpMax : 0)) as [number, number],
      event: round === 0 ? null : (s.market.current?.id ?? null),
      liquidations,
    });
  }

  /** The match so far, for replays: rebuilt by `replay`. */
  replay(): Replay {
    return { setup: structuredClone(this.#setup), configVersion: CONFIG_VERSION, log: structuredClone(this.log) };
  }
}

function newSide(id: SideId, portfolio: Portfolio, npc: SideState['npc'] | undefined): SideState {
  const p = structuredClone(portfolio);
  while (p.relics.length < 3) p.relics.push(null);
  return {
    id,
    portfolio: p,
    keepHp: 0,
    keepHpMax: 0,
    buildingsOwned: [],
    isNpc: npc !== undefined,
    ...(npc ? { npc } : {}),
    tradeDone: false,
    valueBeforeMarket: 0,
    liquidations: [],
    shutdownUsed: false,
    keepBonus: 0,
  };
}

/** Keep damage from a side's survivors: each unit's Siege value (plus a relic's, ×3 for Siege units), scaled. */
export function siegeDamage(survivors: readonly Squad[], extraSiege = 0): number {
  let total = 0;
  for (const s of survivors) {
    const u = UNIT_TYPES[s.unit];
    if (!u) continue;
    total += s.count * (u.siege + extraSiege) * (u.role === 'siege' ? BALANCE.keep.siegeRoleMult : 1);
  }
  return total * BALANCE.keep.siegeScale;
}

/** Plays a replay back: the same seed and commands give the same match. */
export function replay(r: Replay, resolve: BattleResolver = simulate): Match {
  if (r.configVersion !== CONFIG_VERSION) throw new Error(`replay is for rules ${r.configVersion}, these are ${CONFIG_VERSION}`);
  const m = new Match(r.setup, resolve);
  m.playOut((match) => {
    for (const c of r.log) if (c.round === match.state.round) match.command(c.side, c.cmd);
  });
  return m;
}

/** The state as JSON (bigints as "123n"): byte-identical for identical matches. */
export function serialize(state: MatchState): string {
  return JSON.stringify(state, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));
}

/**
 * The keep's damage state from its HP (spec: cracks at 75%, a breached outer
 * wall at 50%, a burning keep at 25%, collapse at 0): 0 whole … 4 collapsed.
 */
export function damageState(hp: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (hp <= 0) return 4;
  const f = hp / max;
  const [cracked, breached, burning] = BALANCE.keep.damageStates;
  return f <= burning ? 3 : f <= breached ? 2 : f <= cracked ? 1 : 0;
}

/** What a command would do, without doing it (the trade panel's preview, the NPCs' scoring). */
export interface CommandPreview {
  ok: boolean;
  reason?: string;
  /** Gas paid, in dollars. */
  gas: number;
  /** Net portfolio value before and after (fees, slippage and gas come off). */
  valueBefore: number;
  valueAfter: number;
  /** Units the army fields before and after. */
  unitsBefore: number;
  unitsAfter: number;
  keepMaxBefore: number;
  keepMaxAfter: number;
  keepHpAfter: number;
  /** The loans' health factors after (Infinity: no debt). */
  hfAfter: { lending: number; vault: number };
}

export function previewCommand(m: Match, side: SideId, cmd: Command): CommandPreview {
  const s = m.state;
  const real = m.side(side);
  const draft = structuredClone(real);
  const ctx = { catalog: m.catalog, prices: s.market.prices, unitValue: s.unitValue, round: s.round, gasMult: s.market.gasMult };
  const units = (x: SideState) => unitCount(buildArmy(x, ctx));
  const r = applyCommand(draft, cmd, ctx);
  return {
    ok: r.ok,
    ...(r.ok ? {} : { reason: r.reason }),
    gas: gasCost(ctx),
    valueBefore: netValue(real, s.market.prices),
    valueAfter: netValue(draft, s.market.prices),
    unitsBefore: units(real),
    unitsAfter: units(draft),
    keepMaxBefore: real.keepHpMax,
    keepMaxAfter: draft.keepHpMax,
    keepHpAfter: draft.keepHp,
    hfAfter: { lending: account(draft, 'lending', ctx).hf, vault: account(draft, 'vault', ctx).hf },
  };
}

/**
 * The most a command can take, in token units (bigint), for a side as it
 * stands: a holding for swap/stake/supply, a staked or supplied amount, the
 * room left under the LTV limit for a borrow, the debt for a repay.
 */
export function available(m: Match, side: SideId, kind: Command['t'], asset: AssetId, via: 'lending' | 'vault' = 'lending'): bigint {
  const s = m.state;
  const x = m.side(side);
  const ctx = { catalog: m.catalog, prices: s.market.prices };
  switch (kind) {
    case 'swap':
    case 'stake':
    case 'supply':
    case 'lpAdd': {
      const have = holding(x, asset);
      // gas comes out of the ETH first: "all" leaves it behind
      if (asset !== 'eth') return have;
      const gas = qtyFor(gasCost({ unitValue: s.unitValue, gasMult: s.market.gasMult }) * 1.001, s.market.prices.eth ?? 0);
      return have > gas ? have - gas : 0n;
    }
    case 'unstake':
    case 'restake':
      return holding(x, asset, 'staked', 'staking') + holding(x, asset);
    case 'withdraw':
      return holding(x, asset, 'supplied', via);
    case 'borrow': {
      const acc = account(x, via, ctx);
      const room = Math.max(0, acc.collateral * BALANCE.ledger.ltv - acc.debt);
      return qtyFor(room * 0.999, s.market.prices[asset] ?? 0);
    }
    case 'repay': {
      const debt = holding(x, asset, 'borrowed', via);
      const have = holding(x, asset);
      return debt < have ? debt : have;
    }
    default:
      return 0n;
  }
}

/**
 * The walls' volley (the user's call: "walls shoot back"): before attackers
 * hit a keep, its archers deal `wallVolley` HP per UNIT_VALUE of its
 * stablecoins to them, the most fragile first; at most `wallMaxShare` of the
 * attackers fall, so even a keep of nothing but walls is always hit.
 */
export function wallVolley(attackers: readonly Squad[], stableUnits: number): { left: Squad[]; felled: number } {
  const total = attackers.reduce((n, q) => n + q.count, 0);
  let budget = Math.max(0, stableUnits) * BALANCE.keep.wallVolley;
  let canFell = Math.floor(total * BALANCE.keep.wallMaxShare);
  const left = attackers.map((q) => ({ ...q }));
  const order = left.map((q, i) => ({ q, i, hp: UNIT_TYPES[q.unit]?.hp ?? 1 })).sort((x, y) => x.hp - y.hp || x.i - y.i);
  let felled = 0;
  for (const { q, hp } of order) {
    const n = Math.min(q.count, Math.floor(budget / hp), canFell);
    q.count -= n;
    budget -= n * hp;
    canFell -= n;
    felled += n;
    if (canFell <= 0 || budget < 1) break;
  }
  return { left: left.filter((q) => q.count > 0).map((q) => ({ ...q, stacks: [q.count] })), felled };
}

/** One battle of a match, as needed to show it again. */
export interface BattleRecord {
  round: number;
  run: BattleRun;
  armies: [Army, Army];
  /** Who held the buildings as it began. */
  owners: Record<string, SideId | null>;
  /** Keep HP shares before it (the castles' damage while it plays). */
  keeps: [number, number];
}

/** Every battle of a replayed match, in order (the same seed and commands play them again exactly). */
export function replayBattles(r: Replay): { match: Match; battles: BattleRecord[] } {
  if (r.configVersion !== CONFIG_VERSION) throw new Error(`replay is for rules ${r.configVersion}, these are ${CONFIG_VERSION}`);
  const m = new Match(r.setup);
  const battles: BattleRecord[] = [];
  let guard = 0;
  while (m.state.phase !== 'ended' && guard++ < 1000) {
    if (m.state.phase === 'trade') for (const c of r.log) if (c.round === m.state.round) m.command(c.side, c.cmd);
    const into = m.state.phase === 'trade' || (m.state.phase === 'market' && m.state.suddenDeath);
    const owners = m.battleCtx().owners;
    const keeps = m.state.sides.map((x) => x.keepHp / x.keepHpMax) as [number, number];
    m.advance();
    if (into && m.state.phase === 'battle' && m.run && m.armies) battles.push({ round: m.state.round, run: m.run, armies: m.armies, owners, keeps });
  }
  return { match: m, battles };
}

/** A replay as a file's text (bigints as "123n"), and back. */
export function encodeReplay(r: Replay): string {
  return JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));
}

export function decodeReplay(text: string): Replay {
  const r = JSON.parse(text, (_k, v: unknown) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as Replay;
  if (!r || typeof r !== 'object' || !r.setup || !Array.isArray(r.log)) throw new Error('not a replay file');
  return r;
}
