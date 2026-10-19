/**
 * Ledger Wars' computer opponent: it plays by the same commands as the
 * player (World.command checks them all) and sees what a player sees. Every
 * second or so (by its difficulty) it:
 *
 *   - builds down its build order (an Exchange first: everything else needs
 *     swaps), placing each building in a ring round its hall;
 *   - puts spare ETH to work (staking, a pool) and takes income back out
 *     when it runs short of money to fight with;
 *   - keeps its production buildings training, leaning towards what beats
 *     the player's army (the counter triangle), swapping for the tokens;
 *   - raises its hall and barracks when it can afford to;
 *   - defends: anything of the player's near its buildings draws the army;
 *   - attacks in waves, each bigger than the last, at the player's hall.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { Role, UnitTypeId } from '../../game/core/types.js';
import { BUILDINGS, RULES, STABLES, TRAIN, type BuildingKind, type PlayerId, type TokenId } from '../data/rules.js';
import type { Command, World } from '../core/world.js';
import { positionValue } from '../core/economy.js';

const BUILD_ORDER: readonly BuildingKind[] = ['exchange', 'barracks', 'staking', 'archery', 'memepit', 'workshop', 'bridgeworks', 'barracks', 'archery', 'bridgeworks'];
/** What beats each role (Cavalry > Ranged > Melee > Cavalry; area beats swarms). */
const COUNTER: Partial<Record<Role, Role>> = { ranged: 'cavalry', melee: 'ranged', cavalry: 'melee', swarm: 'ranged' };

export type Difficulty = 'easy' | 'normal' | 'hard';

/** How each difficulty plays: how often it thinks, how much it puts to work, how deep it queues, its first wave, and whether it counter-picks. */
export const LEVELS: Readonly<Record<Difficulty, { think: number; invest: number; queue: number; wave: number; firstAttack: number; counter: boolean }>> = {
  easy: { think: 2.5, invest: 0.3, queue: 1, wave: 20, firstAttack: 480, counter: false },
  normal: { think: 1, invest: 0.5, queue: 2, wave: 14, firstAttack: 300, counter: true },
  hard: { think: 0.5, invest: 0.55, queue: 3, wave: 18, firstAttack: 330, counter: true },
};

export interface OpponentState {
  difficulty: Difficulty;
  /** Seconds to the next think. */
  clock: number;
  /** The army's current wave: its size to reach before it attacks, and whether it is out. */
  wave: number;
  attacking: boolean;
  /** Buildings of the order started so far. */
  built: number;
  /** Dollars it has put to work: only what its positions earn above this comes out to be spent. */
  principal: number;
  /** When it last started a building or an upgrade (s): after a while it saves for the next instead of training. */
  lastBuild: number;
}

export function newOpponent(difficulty: Difficulty = 'normal'): OpponentState {
  return { difficulty, clock: 0, wave: LEVELS[difficulty].wave, attacking: false, built: 0, principal: 0, lastBuild: 0 };
}

/** Called every tick; thinks once a second. */
export function opponentTick(w: World, me: PlayerId, s: OpponentState, dt: number): void {
  s.clock -= dt;
  if (s.clock > 0 || w.winner) return;
  s.clock = LEVELS[s.difficulty].think;
  const send = (cmd: Command) => w.command(me, cmd).ok;
  build(w, me, s, send);
  economy(w, me, s, send);
  upgrade(w, me, s, send);
  // saving for the next building: no training for now (but always some defence)
  const next = BUILD_ORDER[s.built];
  const why = next ? w.cantBuild(me, next) : 'done';
  const saving = !!next && (why === null || why.startsWith('needs $')) && w.time - s.lastBuild > 45 && w.units.filter((u) => u.owner === me && u.died < 0).length >= 6;
  if (!saving) train(w, me, s, send);
  command(w, me, s, send);
}

function build(w: World, me: PlayerId, s: OpponentState, send: (c: Command) => boolean): void {
  const p = w.players[me];
  if (p.ready) {
    const spot = spotFor(w, me, p.ready);
    if (spot) send({ t: 'place', x: spot.x, z: spot.z });
    return;
  }
  if (p.build) return;
  // a mission may keep some buildings from it
  while (BUILD_ORDER[s.built] && w.locked(me, BUILD_ORDER[s.built]!)) s.built++;
  // a building lost is rebuilt first
  const have = (k: BuildingKind) => w.buildings.filter((b) => b.owner === me && b.kind === k).length;
  const wanted = BUILD_ORDER.slice(0, s.built);
  const lost = wanted.find((k, i) => have(k) < wanted.slice(0, i + 1).filter((x) => x === k).length);
  const next = lost ?? BUILD_ORDER[s.built];
  if (!next) return;
  if (w.spendable(me) < BUILDINGS[next].cost) return;
  if (send({ t: 'build', kind: next })) {
    if (!lost) s.built++;
    s.lastBuild = w.time;
  }
}

/** A free spot for a building: rings round the hall, the side away from the enemy first. */
export function spotFor(w: World, me: PlayerId, kind: BuildingKind): { x: number; z: number } | null {
  const hall = w.hallOf(me) ?? w.buildings.find((b) => b.owner === me);
  if (!hall) return null;
  const away = me === 'A' ? 1 : -1;
  for (let r = 8; r <= RULES.buildRadius; r += 2) {
    const n = Math.round(r * 1.5);
    for (let i = 0; i < n; i++) {
      // round from straight behind the hall, alternating sides
      const k = i % 2 === 0 ? i / 2 : -(i + 1) / 2;
      const a = Math.PI / 2 * away + (k / n) * Math.PI * 2;
      const at = w.snap(kind, hall.x + Math.cos(a) * r, hall.z + Math.sin(a) * r);
      if (w.cantPlace(me, kind, at.x, at.z) === null) return at;
    }
  }
  return null;
}

/**
 * The money: about half its worth working in positions early (a third later),
 * the rest to build and fight with. Dollars go into ETH and are staked, or
 * pooled with USDC; when the money to spend runs low, a part of the biggest
 * position comes back out (its earnings, not the whole of it).
 */
function economy(w: World, me: PlayerId, s: OpponentState, send: (c: Command) => boolean): void {
  const p = w.players[me];
  const price = w.market.prices;
  const ethUsd = p.tokens.eth * price.eth;
  const stableUsd = STABLES.reduce((s, t) => s + p.tokens[t] * price[t], 0);
  const spend = stableUsd + ethUsd;
  const invested = p.positions.reduce((s, x) => s + positionValue(w.econ, x), 0);
  // half its money to work at the start; afterwards it adds to it only when it has plenty
  const share = LEVELS[s.difficulty].invest;
  const gap = w.time < 120 ? (spend + invested) * share - invested : spend > 4000 ? spend * 0.3 : 0;
  const exchange = w.level(me, 'exchange') > 0;
  const staking = w.level(me, 'staking') > 0;
  if (gap > 300 && (exchange || staking)) {
    if (staking) {
      // ETH to stake: what is there, topped up from dollars
      if (ethUsd < gap && exchange && stableUsd > 300) send({ t: 'swap', from: 'usdc', to: 'eth', qty: Math.min(p.tokens.usdc, (gap - ethUsd) / price.usdc) });
      const eth = Math.min(w.players[me].tokens.eth, gap / price.eth);
      if (eth * price.eth > 100 && send({ t: 'stake', qty: eth })) s.principal += eth * price.eth;
    } else if (exchange && stableUsd > 600) {
      // no Staking House yet: a pool of ETH and USDC
      const half = Math.min(gap, stableUsd) / 2;
      if (ethUsd < half) send({ t: 'swap', from: 'usdc', to: 'eth', qty: (half - ethUsd) / price.usdc });
      const eth = Math.min(w.players[me].tokens.eth, half / price.eth);
      if (eth * price.eth > 100 && send({ t: 'lpAdd', a: 'eth', b: 'usdc', qty: eth })) s.principal += eth * price.eth * 2;
    }
  }
  // an ETH start: dollars to train with
  if (exchange && stableUsd < 300 && ethUsd > 600) send({ t: 'swap', from: 'eth', to: 'usdc', qty: p.tokens.eth * 0.4 });
  // the earnings come back out to be spent (from the biggest position), the principal stays at work
  // (30% of the earnings stays in: the principal grows, and the income with it)
  const earned = invested - s.principal;
  if (earned > 500) {
    const pos = [...p.positions].filter((x) => x.kind === 'staked' || x.kind === 'lp').sort((a, b) => positionValue(w.econ, b) - positionValue(w.econ, a))[0];
    if (pos) {
      const out = Math.min(1, (earned * 0.7) / positionValue(w.econ, pos));
      if (send(pos.kind === 'lp' ? { t: 'lpRemove', id: pos.id, share: out } : { t: 'unstake', id: pos.id, share: out })) s.principal += earned * 0.3;
    }
  }
  // a position lost in value (prices fell): the principal follows it down
  const now = w.players[me].positions.reduce((t, x) => t + positionValue(w.econ, x), 0);
  s.principal = Math.min(s.principal, now);
  // stETH back out of a stake is money once swapped
  if (exchange && p.tokens.steth * price.steth > 200) send({ t: 'swap', from: 'steth', to: 'usdc', qty: p.tokens.steth });
}

function upgrade(w: World, me: PlayerId, s: OpponentState, send: (c: Command) => boolean): void {
  if (w.time < 150) return;
  const hall = w.hallOf(me);
  const mine = w.buildings.filter((b) => b.owner === me && !b.upgrading);
  const spare = w.spendable(me);
  // the hall up a level every few minutes (it unlocks the Workshop, then the Bridge Works)
  if (hall && !hall.upgrading && hall.level < 3 && w.time > hall.level * 180 && spare > BUILDINGS.hall.upgrade[hall.level - 1]! + 300 && send({ t: 'upgrade', id: hall.id })) s.lastBuild = w.time;
  for (const b of mine) {
    if (b.kind !== 'barracks' && b.kind !== 'archery' && b.kind !== 'staking' && b.kind !== 'bridgeworks') continue;
    if (b.level >= 2 || !hall || hall.level < 2) continue;
    if (spare > BUILDINGS[b.kind].upgrade[0]! + 600) send({ t: 'upgrade', id: b.id });
  }
}

/** Each idle production building trains what fits the army: counters to the enemy's main role, from the units it can pay for. */
function train(w: World, me: PlayerId, s: OpponentState, send: (c: Command) => boolean): void {
  const level = LEVELS[s.difficulty];
  const enemy = me === 'A' ? 'B' : 'A';
  const roles = new Map<Role, number>();
  for (const u of w.units) if (u.owner === enemy && u.died < 0) roles.set(UNIT_TYPES[u.type]!.role, (roles.get(UNIT_TYPES[u.type]!.role) ?? 0) + 1);
  const main = [...roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const wanted = main && level.counter ? COUNTER[main] : undefined;
  const p = w.players[me];
  for (const b of w.buildings) {
    if (b.owner !== me || b.queue.length >= level.queue) continue;
    const options = TRAIN.filter((t) => t.at === b.kind && b.level >= t.level && !w.unitLocked(me, t.unit));
    if (options.length === 0) continue;
    // the best of what this building trains: the counter first, then the strongest
    const ranked = [...options].sort((x, y) => score(y.unit, wanted) - score(x.unit, wanted));
    for (const t of ranked) {
      if (w.cantTrain(me, b, t.unit) === null) {
        send({ t: 'train', id: b.id, unit: t.unit });
        break;
      }
      // short of its token: swap some in (for up to three), if it can pay for one
      const one = w.unitCost(t) * w.market.prices[t.token] * 1.05;
      if (p.tokens[t.token] * w.market.prices[t.token] < one && w.level(me, 'exchange') > 0) {
        const from: TokenId = t.token !== 'usdc' && p.tokens.usdc * w.market.prices.usdc > one ? 'usdc' : t.token !== 'eth' ? 'eth' : 'usdc';
        const usd = Math.min(one * 3, p.tokens[from] * w.market.prices[from] * 0.95);
        if (usd >= one) send({ t: 'swap', from, to: t.token, qty: usd / w.market.prices[from] });
        if (w.cantTrain(me, b, t.unit) === null) {
          send({ t: 'train', id: b.id, unit: t.unit });
          break;
        }
      }
    }
  }
}

const score = (unit: UnitTypeId, wanted: Role | undefined) => {
  const u = UNIT_TYPES[unit]!;
  return (u.role === wanted ? 100 : 0) + u.costMult * 10 + u.hp / 10;
};

/** Defence first; then the waves. */
function command(w: World, me: PlayerId, s: OpponentState, send: (c: Command) => boolean): void {
  const enemy = me === 'A' ? 'B' : 'A';
  const army = w.units.filter((u) => u.owner === me && u.died < 0);
  const home = w.hallOf(me);
  const ids = (us: typeof army) => us.map((u) => u.id);
  // rally in front of the base
  for (const b of w.buildings) if (b.owner === me && !b.rally && TRAIN.some((t) => t.at === b.kind) && home) send({ t: 'rally', id: b.id, x: home.x * 0.8, z: home.z * 0.8 });
  // anything of theirs near our buildings: everyone there
  const intruder = w.units.find((u) => u.owner === enemy && u.died < 0 && w.buildings.some((b) => b.owner === me && Math.hypot(b.x - u.x, b.z - u.z) < 22));
  if (intruder && !s.attacking) {
    const idle = army.filter((u) => u.target === null);
    if (idle.length) send({ t: 'order', units: ids(idle), kind: 'attackMove', x: intruder.x, z: intruder.z });
    return;
  }
  if (!s.attacking && army.length >= s.wave && w.time > LEVELS[s.difficulty].firstAttack) {
    s.attacking = true;
    s.wave += 6;
  }
  const target = w.hallOf(enemy);
  if (s.attacking && target) {
    if (army.length <= Math.max(2, s.wave / 6)) {
      s.attacking = false;
      if (home) send({ t: 'order', units: ids(army), kind: 'move', x: home.x * 0.8, z: home.z * 0.8 });
      return;
    }
    const idle = army.filter((u) => u.order.t === 'idle' && u.target === null);
    if (idle.length) send({ t: 'order', units: ids(idle), kind: 'attackMove', x: target.x, z: target.z });
  }
}
