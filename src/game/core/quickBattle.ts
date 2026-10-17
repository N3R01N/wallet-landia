/**
 * A stand-in battle for the headless core until the spatial BattleSim (M3):
 * squads fight in line, front to back, one exchange per second for at most 45
 * seconds, with the counter triangle and the siege penalty. Deterministic and
 * cheap: the balance runner can play thousands of matches with it.
 */

import { BALANCE } from '../config/balance.js';
import { UNIT_TYPES } from './catalog.js';
import type { Army, BattleResult, Role, Squad } from './types.js';

const BT = BALANCE.battle;

/** What a battle is played with besides the armies. */
export interface BattleCtx {
  seed: string;
  round: number;
  map?: import('./battle.js').BattleMap;
}

/** Plays a battle between two armies; returns what is left of each. */
export type BattleResolver = (armies: readonly [Army, Army], ctx: BattleCtx) => BattleResult;

/** Cavalry beats Ranged, Ranged beats Melee, Melee beats Cavalry. */
const BEATS: Partial<Record<Role, Role>> = { cavalry: 'ranged', ranged: 'melee', melee: 'cavalry' };

export function damageMult(attacker: Role, defender: Role, area = false): number {
  let m = 1;
  if (BEATS[attacker] === defender) m += BT.counterBonus;
  if (area && defender === 'swarm') m += BT.swarmAreaBonus;
  if (attacker === 'siege') m *= BT.siegeVsUnits;
  return m;
}

const AREA = new Set(['small-area', 'death-burst']);
/** Seconds into the battle at which liquidated squads detonate, and their damage per unit. */
const DETONATE_AT = 3;
const DETONATE_DAMAGE = 3;

interface Live {
  squad: Squad;
  hp: number;
  /** HP left in the whole squad. */
  pool: number;
}

const alive = (l: Live) => Math.ceil(l.pool / l.hp - 1e-9);

export const quickBattle: BattleResolver = (armies) => {
  const lines = armies.map((a) =>
    a.squads.map((s): Live => {
      const u = UNIT_TYPES[s.unit];
      const hp = u?.hp ?? 1;
      return { squad: s, hp, pool: hp * s.count };
    }),
  ) as [Live[], Live[]];
  let t = 0;
  for (; t < BT.maxSeconds; t++) {
    if (t === DETONATE_AT) {
      for (const line of lines) {
        for (const l of line) {
          if (!l.squad.detonates || l.pool <= 0) continue;
          const blast = alive(l) * DETONATE_DAMAGE;
          l.pool = 0;
          const victim = line.find((v) => v.pool > 0 && !v.squad.detonates);
          if (victim) victim.pool = Math.max(0, victim.pool - blast);
        }
      }
    }
    const a = lines[0].filter((l) => l.pool > 0);
    const b = lines[1].filter((l) => l.pool > 0);
    if (a.length === 0 || b.length === 0) break;
    const dmgToB = volley(a, b, armies[0].atkMult);
    const dmgToA = volley(b, a, armies[1].atkMult);
    soak(b, dmgToB);
    soak(a, dmgToA);
  }
  const survivors = lines.map((line) =>
    line.filter((l) => l.pool > 0 && !l.squad.detonates).map((l) => ({ ...l.squad, count: alive(l), stacks: [alive(l)] })),
  ) as [Squad[], Squad[]];
  return { survivors, seconds: t };
};

/** Each squad's damage this second, all aimed at the enemy's front squad. Returned in order, to spill over. */
function volley(from: Live[], to: Live[], atkMult: number): number[] {
  const front = to[0];
  if (!front) return [];
  const defRole = UNIT_TYPES[front.squad.unit]?.role ?? 'melee';
  return from.map((l) => {
    const u = UNIT_TYPES[l.squad.unit];
    if (!u) return 0;
    return alive(l) * u.atk * atkMult * damageMult(u.role, defRole, AREA.has(u.ability ?? ''));
  });
}

function soak(line: Live[], hits: number[]): void {
  let dmg = hits.reduce((s, h) => s + h, 0);
  for (const l of line) {
    if (dmg <= 0) break;
    const d = Math.min(l.pool, dmg);
    l.pool -= d;
    dmg -= d;
  }
}
