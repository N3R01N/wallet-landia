/**
 * BattleSim: the deterministic auto-battle (spec: "Auto-battle resolution").
 * A fixed 20 Hz step on the town's ground plane, metres in world x/z. Side A
 * marches from its castle (low z) towards B's (high z) along three lanes;
 * squads fight the nearest enemy within the aggro radius, else keep marching,
 * and wait at the enemy gate for the Siege phase.
 *
 * Pure and headless (no DOM, no three.js, no clock): the same armies, map and
 * seed give the same battle. Runs in a Web Worker in the game, in Node in the
 * tests and the balance runner. The output is the result, an event stream and
 * position frames (10 Hz) for the renderer to interpolate and for replays.
 */

import { BALANCE } from '../config/balance.js';
import { UNIT_TYPES } from './catalog.js';
import { streamOf, type Rng } from './detmath.js';
import { damageMult } from './quickBattle.js';
import type { Army, BattleResult, Role, SideId, Squad, UnitType } from './types.js';

const BT = BALANCE.battle;
const DT = 1 / BT.tickHz;
const MAX_TICKS = BT.maxSeconds * BT.tickHz;

/**
 * Metres per second per Speed point. The town is about 110 m gate to gate and
 * a battle lasts at most 45 s, so the armies jog: speed 1.0 covers 3.2 m/s
 * (the walk clips are made for 1.6 m/s; the renderer plays them faster to match).
 */
export const METRES_PER_SPEED = 3.2;
/** The ground speed the units' walk clips are made for. */
export const WALK_CLIP_SPEED = 1.6;
const AGGRO = 6;
/** Reach in metres: a body's width, plus Range. */
const REACH_BASE = 0.8;
/** Bodies keep this far apart. */
const PERSONAL = 0.7;
/** Frames are kept every this many ticks (10 Hz). */
export const FRAME_EVERY = 2;

export interface LanePoint {
  x: number;
  z: number;
}

export interface BattleMap {
  /**
   * Left, centre, right: each a street from where A's army forms up (first
   * point, its front line) to where B's does (last point).
   */
  lanes: [LanePoint[], LanePoint[], LanePoint[]];
  /** Each side's gate: the enemy marches there after its lane and waits for the Siege phase. Absent: the lane's end. */
  gates?: { A: LanePoint; B: LanePoint };
}

/** A side's way along a lane: its own formation front first, the enemy's gate last. */
function pathsOf(map: BattleMap): Record<SideId, LanePoint[][]> {
  return {
    A: map.lanes.map((l) => [...l, ...(map.gates ? [map.gates.B] : [])]),
    B: map.lanes.map((l) => [...[...l].reverse(), ...(map.gates ? [map.gates.A] : [])]),
  };
}

/** A straight three-lane field (tests and the headless runner; the game builds one from the town). */
export function straightMap(length = 60, spread = 10): BattleMap {
  const lane = (x: number): LanePoint[] => [
    { x, z: 0 },
    { x, z: length },
  ];
  return { lanes: [lane(-spread), lane(0), lane(spread)] };
}

export type BattleEvent =
  | { t: 'spawn'; tick: number; id: number; side: SideId; squad: number; unit: string; mult: number }
  | { t: 'attack'; tick: number; id: number; target: number; damage: number; crit?: boolean }
  | { t: 'death'; tick: number; id: number }
  | { t: 'ability'; tick: number; id: number; ability: string }
  | { t: 'detonate'; tick: number; id: number; x: number; z: number }
  | { t: 'arrive'; tick: number; id: number };

export interface BattleRun extends BattleResult {
  events: BattleEvent[];
  /** Entities in spawn order: their side, squad, unit type and stack size. */
  entities: { side: SideId; squad: number; unit: string; mult: number }[];
  /**
   * Per frame (every FRAME_EVERY ticks), per entity, 4 floats: x, z, the
   * share of the stack's HP left (0 dead) and facing (radians).
   */
  frames: Float32Array;
  frameCount: number;
}

interface Ent {
  id: number;
  side: SideId;
  squad: number;
  u: UnitType;
  /** Stack size at spawn, and HP per unit. */
  mult: number;
  pool: number;
  poolMax: number;
  shield: number;
  x: number;
  z: number;
  face: number;
  lane: number;
  /** Next waypoint on the lane. */
  wp: number;
  /** Sideways place in the formation. */
  offset: number;
  target: number;
  cooldown: number;
  charged: boolean;
  detonates: boolean;
  arrived: boolean;
  /** ATK taken by a Ghost Lender's drain. */
  drained: number;
  /** Seconds since the unit's own timed ability last fired. */
  timer: number;
}

const alive = (e: Ent) => (e.pool <= 0 ? 0 : Math.ceil(e.pool / e.u.hp - 1e-9));

export interface BattleOptions {
  seed: string;
  round: number;
  map?: BattleMap;
}

/** Plays one battle between two armies. */
export function simulateBattle(armies: readonly [Army, Army], opts: BattleOptions): BattleRun {
  const map = opts.map ?? straightMap();
  const rng = streamOf(opts.seed, 'battle', opts.round);
  const ents: Ent[] = [];
  const events: BattleEvent[] = [];
  const paths = pathsOf(map);
  spawn(armies, paths, ents, events);

  const nEnt = ents.length;
  const maxFrames = Math.floor(MAX_TICKS / FRAME_EVERY) + 2;
  const frames = new Float32Array(maxFrames * nEnt * 4);
  let frameCount = 0;
  const writeFrame = () => {
    const base = frameCount * nEnt * 4;
    for (let i = 0; i < nEnt; i++) {
      const e = ents[i]!;
      frames[base + i * 4] = e.x;
      frames[base + i * 4 + 1] = e.z;
      frames[base + i * 4 + 2] = e.pool > 0 ? e.pool / e.poolMax : 0;
      frames[base + i * 4 + 3] = e.face;
    }
    frameCount++;
  };
  writeFrame();

  const grid = new Grid(AGGRO);
  let tick = 0;
  for (; tick < MAX_TICKS; tick++) {
    const live = ents.filter((e) => e.pool > 0);
    const a = live.filter((e) => e.side === 'A');
    const b = live.filter((e) => e.side === 'B');
    if (a.length === 0 || b.length === 0) break;
    // everyone still marching has reached the enemy gate: nothing more to fight
    if (live.every((e) => e.arrived)) break;
    grid.rebuild(live);

    // liquidated squads detonate at 3 s, among their own
    if (tick === 3 * BT.tickHz) {
      for (const e of live) {
        if (!e.detonates) continue;
        events.push({ t: 'detonate', tick, id: e.id, x: e.x, z: e.z });
        const blast = 3 * alive(e);
        for (const o of grid.near(e.x, e.z, 2.5)) if (o.side === e.side && o !== e && !o.detonates) hurt(o, blast / 4, null, tick, events);
        e.pool = 0;
        events.push({ t: 'death', tick, id: e.id });
      }
    }

    const atkMult = (side: SideId) => armies[side === 'A' ? 0 : 1].atkMult;
    for (const e of live) {
      if (e.pool <= 0) continue;
      // abilities that run on their own
      if (e.u.ability === 'heal-adjacent' && tick % BT.tickHz === 0) {
        for (const o of grid.near(e.x, e.z, 1.6)) if (o.side === e.side && o !== e && o.pool > 0) o.pool = Math.min(o.poolMax, o.pool + 2 * alive(e));
      }
      if (e.u.ability === 'swap-enemies') {
        e.timer += DT;
        if (e.timer >= 8) {
          e.timer = 0;
          const foes = grid.near(e.x, e.z, AGGRO).filter((o) => o.side !== e.side && o.pool > 0);
          if (foes.length >= 2) {
            const p = foes[Math.floor(rng() * foes.length)]!;
            const q = foes[Math.floor(rng() * foes.length)]!;
            if (p !== q) {
              [p.x, q.x] = [q.x, p.x];
              [p.z, q.z] = [q.z, p.z];
              events.push({ t: 'ability', tick, id: e.id, ability: 'swap-enemies' });
            }
          }
        }
      }

      const target = pickTarget(e, grid, ents);
      e.target = target?.id ?? -1;
      e.cooldown = Math.max(0, e.cooldown - DT);
      if (target) {
        const dx = target.x - e.x;
        const dz = target.z - e.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        e.face = facing(dx, dz, e.face);
        const reach = REACH_BASE + e.u.range;
        if (d > reach) step(e, dx / d, dz / d, d - reach);
        else if (e.cooldown <= 0) {
          e.cooldown = 1;
          strike(e, target, grid, rng, atkMult(e.side), tick, events);
        }
      } else if (!e.arrived) march(e, paths[e.side][e.lane]!, tick, events);
    }
    separate(live, grid);
    for (const e of live) if (e.pool <= 0 && !e.detonates) events.push({ t: 'death', tick, id: e.id });
    // a death leaves a stack's pool at 0 exactly once
    for (const e of live) if (e.pool <= 0) e.pool = -1;
    if ((tick + 1) % FRAME_EVERY === 0) writeFrame();
  }
  if (tick % FRAME_EVERY !== 0) writeFrame();

  const survivors: [Squad[], Squad[]] = [[], []];
  armies.forEach((army, ai) => {
    army.squads.forEach((sq, si) => {
      if (sq.detonates) return;
      const n = ents.filter((e) => e.side === army.side && e.squad === si && e.pool > 0).reduce((s, e) => s + alive(e), 0);
      if (n > 0) survivors[ai]!.push({ ...sq, count: n, stacks: [n] });
    });
  });
  return {
    survivors,
    seconds: tick * DT,
    events,
    entities: ents.map((e) => ({ side: e.side, squad: e.squad, unit: e.u.id, mult: e.mult })),
    frames: frames.slice(0, frameCount * nEnt * 4),
    frameCount,
  };
}

// ---------- spawning ----------

/** Rows from the front: Melee, then Ranged and Support, Siege at the back; cavalry on the flanks. */
const ROW: Record<Role, number> = { melee: 0, swarm: 0, cavalry: 1, ranged: 2, support: 2, siege: 3 };

function spawn(armies: readonly [Army, Army], paths: Record<SideId, LanePoint[][]>, ents: Ent[], events: BattleEvent[]): void {
  for (const army of armies) {
    // lanes round-robin by role: cavalry on the flanks, siege in the centre
    let flank = 0;
    let rr = 0;
    const slots = new Map<string, number>();
    army.squads.forEach((sq, si) => {
      const u = UNIT_TYPES[sq.unit];
      if (!u) return;
      const lane = u.role === 'siege' ? 1 : u.role === 'cavalry' ? (flank++ % 2 === 0 ? 0 : 2) : [1, 0, 2][rr++ % 3]!;
      for (const mult of sq.stacks.length > 0 ? sq.stacks : [sq.count]) {
        const row = ROW[u.role];
        const key = `${lane}|${row}`;
        const n = slots.get(key) ?? 0;
        slots.set(key, n + 1);
        // each role band seven abreast, the bands one behind the other from the front line
        const col = n % 7;
        const rank = Math.floor(n / 7);
        const offset = (col - 3) * 1.0;
        const back = row * 3 + rank * 1.0;
        const pts = paths[army.side][lane]!;
        const start = pts[0]!;
        const next = pts[1] ?? start;
        const { dx, dz } = unit(next.x - start.x, next.z - start.z);
        const id = ents.length;
        const hpMax = u.hp * mult;
        const e: Ent = {
          id,
          side: army.side,
          squad: si,
          u,
          mult,
          pool: hpMax,
          poolMax: hpMax,
          shield: u.ability === 'start-shield' ? 10 * mult : 0,
          x: start.x - dx * back + -dz * offset,
          z: start.z - dz * back + dx * offset,
          face: Math.atan2(dx, dz),
          lane,
          wp: 1,
          offset,
          target: -1,
          cooldown: 0,
          charged: false,
          detonates: sq.detonates === true,
          arrived: false,
          drained: 0,
          timer: 0,
        };
        ents.push(e);
        events.push({ t: 'spawn', tick: 0, id, side: army.side, squad: si, unit: u.id, mult });
      }
    });
  }
}

function unit(dx: number, dz: number): { dx: number; dz: number } {
  const d = Math.sqrt(dx * dx + dz * dz);
  return d > 0 ? { dx: dx / d, dz: dz / d } : { dx: 0, dz: 1 };
}

// ---------- moving ----------

function step(e: Ent, ux: number, uz: number, max: number): void {
  const d = Math.min(max, e.u.speed * METRES_PER_SPEED * DT);
  e.x += ux * d;
  e.z += uz * d;
}

/** Along its lane towards the enemy gate, keeping its place in the formation. */
function march(e: Ent, pts: readonly LanePoint[], tick: number, events: BattleEvent[]): void {
  const wp = pts[e.wp];
  if (!wp) {
    e.arrived = true;
    events.push({ t: 'arrive', tick, id: e.id });
    return;
  }
  const prev = pts[e.wp - 1] ?? wp;
  const { dx, dz } = unit(wp.x - prev.x, wp.z - prev.z);
  // the formation's place beside the lane point (closing in on the gate itself)
  const spread = e.wp === pts.length - 1 ? 0.5 : 1;
  const tx = wp.x - dz * e.offset * spread;
  const tz = wp.z + dx * e.offset * spread;
  const ddx = tx - e.x;
  const ddz = tz - e.z;
  const d = Math.sqrt(ddx * ddx + ddz * ddz);
  if (d < 1) {
    e.wp++;
    if (e.wp >= pts.length) {
      e.arrived = true;
      events.push({ t: 'arrive', tick, id: e.id });
    }
    return;
  }
  e.face = facing(ddx, ddz, e.face);
  step(e, ddx / d, ddz / d, d);
}

function facing(dx: number, dz: number, prev: number): number {
  return dx === 0 && dz === 0 ? prev : Math.atan2(dx, dz);
}

/** Bodies push apart (only from their own side's and the enemy's that stand too close). */
function separate(live: Ent[], grid: Grid): void {
  for (const e of live) {
    if (e.pool <= 0) continue;
    for (const o of grid.near(e.x, e.z, PERSONAL)) {
      if (o.id <= e.id || o.pool <= 0) continue;
      const dx = o.x - e.x;
      const dz = o.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PERSONAL * PERSONAL) continue;
      const d = Math.sqrt(d2);
      const push = (PERSONAL - d) / 2;
      const ux = d > 1e-6 ? dx / d : ((e.id + o.id) % 2 === 0 ? 1 : -1);
      const uz = d > 1e-6 ? dz / d : 0;
      e.x -= ux * push;
      e.z -= uz * push;
      o.x += ux * push;
      o.z += uz * push;
    }
  }
}

// ---------- fighting ----------

function pickTarget(e: Ent, grid: Grid, ents: Ent[]): Ent | null {
  // taunt overrides
  let best: Ent | null = null;
  let bestD = Infinity;
  let taunted = false;
  for (const o of grid.near(e.x, e.z, AGGRO)) {
    if (o.side === e.side || o.pool <= 0) continue;
    const dx = o.x - e.x;
    const dz = o.z - e.z;
    const d = dx * dx + dz * dz;
    if (d > AGGRO * AGGRO) continue;
    const taunts = o.u.ability === 'taunt';
    if (taunts && !taunted) {
      taunted = true;
      best = o;
      bestD = d;
      continue;
    }
    if (taunted && !taunts) continue;
    if (d < bestD || (d === bestD && best !== null && o.id < best.id)) {
      best = o;
      bestD = d;
    }
  }
  // keep a target that is still in reach (no flip-flopping between two at the same distance)
  const kept = e.target >= 0 ? ents[e.target] : undefined;
  if (kept && kept.pool > 0 && !taunted) {
    const dx = kept.x - e.x;
    const dz = kept.z - e.z;
    if (dx * dx + dz * dz <= (REACH_BASE + e.u.range) ** 2) return kept;
  }
  return best;
}

const AREA = new Set(['small-area', 'death-burst']);

function strike(e: Ent, target: Ent, grid: Grid, rng: Rng, atkMult: number, tick: number, events: BattleEvent[]): void {
  const n = alive(e);
  let atk = e.u.atk * (1 - e.drained);
  if (e.u.ability === 'pack-bonus') {
    const pack = grid.near(e.x, e.z, 3).filter((o) => o.side === e.side && o.pool > 0).reduce((s, o) => s + alive(o), 0);
    atk += Math.floor(pack / 10);
  }
  // a Construct nearby: +10% ATK
  const buffed = grid.builders.has(e.side) && grid.near(e.x, e.z, 3).some((o) => o.side === e.side && o.pool > 0 && o.u.ability === 'buff-atk' && o !== e);
  let dmg = n * atk * atkMult * (buffed ? 1.1 : 1) * damageMult(e.u.role, target.u.role, AREA.has(e.u.ability ?? ''));
  if (e.u.ability === 'charge' && !e.charged) {
    e.charged = true;
    dmg *= 2;
  }
  let crit = false;
  if (e.u.ability === 'reveal-crit' && rng() < 0.25) {
    crit = true;
    dmg *= 2;
  }
  if (e.u.ability === 'drain-atk') target.drained = Math.max(target.drained, 0.2);
  events.push({ t: 'attack', tick, id: e.id, target: target.id, damage: round2(dmg), ...(crit ? { crit } : {}) });
  hurt(target, dmg, e, tick, events);
  if (e.u.ability === 'small-area') {
    for (const o of grid.near(target.x, target.z, 1.5)) if (o.side === target.side && o !== target && o.pool > 0) hurt(o, dmg * 0.5, e, tick, events);
  }
}

function hurt(target: Ent, dmg: number, from: Ent | null, tick: number, events: BattleEvent[]): void {
  if (target.pool <= 0) return;
  let d = dmg;
  if (target.u.ability === 'hardened') d *= 0.7;
  if (target.shield > 0) {
    const s = Math.min(target.shield, d);
    target.shield -= s;
    d -= s;
  }
  target.pool -= d;
  // a frog bursts as it dies: 3 area damage to the enemies round it
  if (target.pool <= 0 && target.u.ability === 'death-burst' && from) {
    from.pool -= 3 * target.mult;
    events.push({ t: 'ability', tick, id: target.id, ability: 'death-burst' });
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** A uniform grid over the plane (the spatial hash). */
class Grid {
  readonly #cell: number;
  readonly #cells = new Map<number, Ent[]>();
  readonly #out: Ent[] = [];

  constructor(cell: number) {
    this.#cell = cell;
  }

  #key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  /** Sides with a Construct on the field (its buff is looked up only then). */
  readonly builders = new Set<SideId>();

  rebuild(ents: readonly Ent[]): void {
    this.#cells.clear();
    this.builders.clear();
    for (const e of ents) {
      if (e.u.ability === 'buff-atk') this.builders.add(e.side);
      const k = this.#key(Math.floor(e.x / this.#cell), Math.floor(e.z / this.#cell));
      const c = this.#cells.get(k);
      if (c) c.push(e);
      else this.#cells.set(k, [e]);
    }
  }

  /**
   * Everything in the cells round a point within r (r ≤ the cell size). The
   * order is fixed by the cells' order and, within a cell, the ids' (the
   * grid is rebuilt in id order), so it is the same every run. The array is
   * reused: don't hold on to it across calls.
   */
  near(x: number, z: number, r: number): Ent[] {
    const out = this.#out;
    out.length = 0;
    const cx0 = Math.floor((x - r) / this.#cell);
    const cx1 = Math.floor((x + r) / this.#cell);
    const cz0 = Math.floor((z - r) / this.#cell);
    const cz1 = Math.floor((z + r) / this.#cell);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) for (const e of this.#cells.get(this.#key(cx, cz)) ?? []) out.push(e);
    return out;
  }
}

