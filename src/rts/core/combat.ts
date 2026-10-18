/**
 * Ledger Wars' fighting, each tick before the walking: who fights whom and
 * how hard. A unit attacks what it is ordered to; on attack-move or standing
 * idle it takes on the nearest enemy that comes within sight (a taunter
 * first, units before buildings); an idle unit guards its spot, chasing no
 * further than its leash and then going back; a held unit only strikes what
 * comes within reach. Damage follows Siege's counter triangle and abilities
 * (core/quickBattle.ts damageMult, units.json); siege units smash buildings.
 * A wallet hall shoots arrows at whatever comes close.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import { damageMult } from '../../game/core/quickBattle.js';
import type { Rng } from '../../game/core/detmath.js';
import { BUILDINGS } from '../data/rules.js';
import type { Paths } from './path.js';
import { approach, radiusOf, type Unit } from './units.js';
import type { Building } from './world.js';

export const COMBAT = {
  /** Metres within which a unit notices an enemy, and how far an idle unit chases from its spot. */
  sight: 9,
  leash: 12,
  /** Seconds between strikes. */
  period: 1,
  /** Units' HP is the unit type's × this (fights last a few seconds, not one blow). */
  hpScale: 2,
  /** Against a building: this share of a unit's attack, plus this much per point of Siege. */
  buildingAtk: 0.5,
  buildingSiege: 4,
  /** A wallet hall's arrows: reach, damage a second, by level. */
  hallRange: 10,
  hallAtk: [6, 9, 12, 16] as readonly number[],
  /** Seconds a dead unit lies before it is gone. */
  corpse: 3,
} as const;

/** What happened in a fight, for the view. */
export type FightEvent =
  | { t: 'strike'; from: number; fromX: number; fromZ: number; toX: number; toZ: number; ranged: boolean; target: number; crit: boolean }
  | { t: 'hallShot'; from: number; target: number }
  | { t: 'death'; id: number }
  | { t: 'ability'; id: number; ability: string };

export interface FightWorld {
  units: Unit[];
  buildings: Building[];
  paths: Paths;
  rng: Rng;
  dt: number;
  emit(e: FightEvent): void;
}

type Target = { kind: 'unit'; u: Unit } | { kind: 'building'; b: Building };

const ranged = (u: Unit) => UNIT_TYPES[u.type]!.range > 1.5;
/** A unit's reach (metres, edge to edge). */
const reach = (u: Unit) => Math.max(0.6, UNIT_TYPES[u.type]!.range * 1.1);

/** The point of a target nearest (x, z), and how far that is. */
function nearest(t: Target, x: number, z: number): { x: number; z: number; d: number } {
  if (t.kind === 'unit') {
    const d = Math.hypot(t.u.x - x, t.u.z - z) - radiusOf(t.u.type);
    return { x: t.u.x, z: t.u.z, d };
  }
  const h = BUILDINGS[t.b.kind].footprint / 2;
  const px = Math.max(t.b.x - h, Math.min(t.b.x + h, x));
  const pz = Math.max(t.b.z - h, Math.min(t.b.z + h, z));
  return { x: px, z: pz, d: Math.hypot(px - x, pz - z) };
}


/** A grid of the living units, for finding who is near. */
class Near {
  readonly #cells = new Map<number, Unit[]>();
  constructor(units: readonly Unit[]) {
    for (const u of units) {
      if (u.died >= 0) continue;
      const k = Near.key(u.x, u.z);
      const l = this.#cells.get(k);
      if (l) l.push(u);
      else this.#cells.set(k, [u]);
    }
  }
  static key(x: number, z: number): number {
    return (Math.floor(z / 4) + 100) * 1000 + Math.floor(x / 4) + 100;
  }
  within(x: number, z: number, r: number): Unit[] {
    const out: Unit[] = [];
    const n = Math.ceil(r / 4);
    const cx = Math.floor(x / 4);
    const cz = Math.floor(z / 4);
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        const l = this.#cells.get((cz + dz + 100) * 1000 + cx + dx + 100);
        if (!l) continue;
        for (const u of l) if (Math.hypot(u.x - x, u.z - z) <= r) out.push(u);
      }
    }
    return out;
  }
}

/**
 * One tick of fighting. Returns the units that acted (struck or closed in):
 * they don't also walk their move this tick.
 */
export function fight(w: FightWorld): Set<number> {
  const acted = new Set<number>();
  const near = new Near(w.units);
  const byId = new Map(w.units.map((u) => [u.id, u]));
  const buildings = new Map(w.buildings.map((b) => [b.id, b]));
  const resolve = (id: number | null): Target | null => {
    if (id === null) return null;
    const u = byId.get(id);
    if (u) return u.died < 0 ? { kind: 'unit', u } : null;
    const b = buildings.get(id);
    return b && b.hp > 0 ? { kind: 'building', b } : null;
  };

  for (const u of w.units) {
    if (u.died >= 0) continue;
    u.cooldown = Math.max(0, u.cooldown - w.dt);
    u.struck += w.dt;
    u.drained = Math.max(0, u.drained - 0.05 * w.dt);
    abilitiesOnTheirOwn(u, near, w);

    // what to fight
    let t: Target | null = null;
    if (u.order.t === 'attack') {
      t = resolve(u.order.target);
      if (!t) u.order = { t: 'idle' };
    }
    if (!t && u.order.t === 'move' && !u.order.attack) {
      u.target = null;
      continue;
    }
    if (!t) {
      const kept = resolve(u.target);
      const r = u.order.t === 'hold' ? reach(u) + 0.5 : COMBAT.sight;
      t = kept && nearest(kept, u.x, u.z).d <= r + 1 ? kept : acquire(u, near, w.buildings, r);
    }
    // an idle unit chases no further than its leash from where it stood
    if (t && u.order.t === 'idle' && u.guard && Math.hypot(u.x - u.guard.x, u.z - u.guard.z) > COMBAT.leash) t = null;
    u.target = t ? (t.kind === 'unit' ? t.u.id : t.b.id) : null;
    if (!t) {
      u.charged = false;
      if (u.order.t === 'idle' && u.guard && Math.hypot(u.x - u.guard.x, u.z - u.guard.z) > 1) {
        approach(u, u.guard.x, u.guard.z, w.dt, w.paths);
        acted.add(u.id);
      }
      continue;
    }
    const p = nearest(t, u.x, u.z);
    if (p.d - radiusOf(u.type) > reach(u)) {
      if (u.order.t === 'hold') continue;
      // the way round obstacles: one field per building (its centre), or per patch of ground near a unit
      const goal = t.kind === 'building' ? { x: t.b.x, z: t.b.z } : { x: p.x, z: p.z };
      approach(u, p.x, p.z, w.dt, w.paths, goal);
      acted.add(u.id);
      continue;
    }
    // in reach: face it and strike when ready
    u.face = Math.atan2(p.x - u.x, p.z - u.z);
    acted.add(u.id);
    if (u.cooldown > 0) continue;
    u.cooldown = COMBAT.period;
    u.struck = 0;
    strike(u, t, near, w);
  }

  hallsShoot(w, near);

  // the dead fall
  for (const u of w.units) {
    if (u.died < 0 && u.hp <= 0) {
      u.died = 0;
      u.order = { t: 'idle' };
      u.target = null;
      w.emit({ t: 'death', id: u.id });
    }
  }
  return acted;
}

/** The enemy to take on within `r`: a taunter, else the nearest unit, else the nearest building. */
function acquire(u: Unit, near: Near, buildings: readonly Building[], r: number): Target | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  let taunt = false;
  for (const v of near.within(u.x, u.z, r)) {
    if (v.owner === u.owner) continue;
    const d = Math.hypot(v.x - u.x, v.z - u.z);
    const vt = UNIT_TYPES[v.type]!.ability === 'taunt';
    if ((vt && !taunt) || (vt === taunt && (d < bestD || (d === bestD && best !== null && v.id < best.id)))) {
      best = v;
      bestD = d;
      taunt = taunt || vt;
    }
  }
  if (best) return { kind: 'unit', u: best };
  let bb: Building | null = null;
  let bd = Infinity;
  for (const b of buildings) {
    if (b.owner === u.owner || b.hp <= 0) continue;
    const d = nearest({ kind: 'building', b }, u.x, u.z).d;
    if (d <= r && d < bd) {
      bd = d;
      bb = b;
    }
  }
  return bb ? { kind: 'building', b: bb } : null;
}

function strike(u: Unit, t: Target, near: Near, w: FightWorld): void {
  const type = UNIT_TYPES[u.type]!;
  const ab = type.ability;
  let atk = type.atk * (1 - u.drained);
  const friends = near.within(u.x, u.z, 3).filter((v) => v.owner === u.owner && v !== u);
  if (ab === 'pack-bonus') atk += Math.min(2, Math.floor(friends.length / 10));
  if (friends.some((v) => UNIT_TYPES[v.type]!.ability === 'buff-atk')) atk *= 1.1;
  let crit = false;
  if (ab === 'charge' && !u.charged) {
    u.charged = true;
    atk *= 2;
    w.emit({ t: 'ability', id: u.id, ability: 'charge' });
  }
  if (ab === 'reveal-crit' && w.rng() < 0.25) {
    crit = true;
    atk *= 2;
  }
  const p = nearest(t, u.x, u.z);
  w.emit({ t: 'strike', from: u.id, fromX: u.x, fromZ: u.z, toX: p.x, toZ: p.z, ranged: ranged(u), target: t.kind === 'unit' ? t.u.id : t.b.id, crit });
  if (t.kind === 'building') {
    t.b.hp -= atk * COMBAT.buildingAtk + type.siege * COMBAT.buildingSiege;
    return;
  }
  const area = ab === 'small-area';
  const dmg = atk * damageMult(type.role, UNIT_TYPES[t.u.type]!.role, area);
  hurt(t.u, dmg, u, w);
  if (ab === 'drain-atk') t.u.drained = 0.2;
  if (area) for (const v of near.within(t.u.x, t.u.z, 1.5)) if (v.owner === t.u.owner && v !== t.u) hurt(v, dmg * 0.5, u, w);
}

function hurt(v: Unit, dmg: number, from: Unit | null, w: FightWorld): void {
  if (v.died >= 0 || v.hp <= 0) return;
  let d = dmg;
  if (UNIT_TYPES[v.type]!.ability === 'hardened') d *= 0.7;
  if (v.shield > 0) {
    const s = Math.min(v.shield, d);
    v.shield -= s;
    d -= s;
  }
  v.hp -= d;
  // a frog bursts as it dies, hurting whoever killed it
  if (v.hp <= 0 && UNIT_TYPES[v.type]!.ability === 'death-burst' && from && from.died < 0) {
    from.hp -= 3;
    w.emit({ t: 'ability', id: v.id, ability: 'death-burst' });
  }
}

/** Abilities that work by themselves: the Paladin's healing, the Swap Mage's swap. */
function abilitiesOnTheirOwn(u: Unit, near: Near, w: FightWorld): void {
  const ab = UNIT_TYPES[u.type]!.ability;
  if (ab === 'heal-adjacent') {
    for (const v of near.within(u.x, u.z, 2)) if (v.owner === u.owner && v !== u && v.hp < v.maxHp) v.hp = Math.min(v.maxHp, v.hp + w.dt);
  }
  if (ab === 'swap-enemies') {
    u.timer += w.dt;
    if (u.timer < 8) return;
    const foes = near.within(u.x, u.z, COMBAT.sight).filter((v) => v.owner !== u.owner);
    if (foes.length < 2) return;
    u.timer = 0;
    const a = foes[Math.floor(w.rng() * foes.length)]!;
    const b = foes[Math.floor(w.rng() * foes.length)]!;
    if (a === b) return;
    [a.x, b.x] = [b.x, a.x];
    [a.z, b.z] = [b.z, a.z];
    w.emit({ t: 'ability', id: u.id, ability: 'swap-enemies' });
  }
}

/** Each wallet hall shoots the nearest enemy unit within reach, once a second. */
function hallsShoot(w: FightWorld, near: Near): void {
  for (const b of w.buildings) {
    if (b.kind !== 'hall' || b.hp <= 0) continue;
    b.shot = (b.shot ?? 0) - w.dt;
    if (b.shot > 0) continue;
    const foes = near.within(b.x, b.z, COMBAT.hallRange + BUILDINGS.hall.footprint / 2).filter((v) => v.owner !== b.owner);
    if (foes.length === 0) continue;
    foes.sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z) || p.id - q.id);
    const v = foes[0]!;
    b.shot = 1;
    hurt(v, COMBAT.hallAtk[Math.min(b.level, 4) - 1]!, null, w);
    w.emit({ t: 'hallShot', from: b.id, target: v.id });
  }
}

