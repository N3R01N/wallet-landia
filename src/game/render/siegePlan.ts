/**
 * The town as the battlefield (docs/game/MAPPING.md): the player's castle at
 * one end, a mirrored enemy castle past the avenue's end, and three lanes: the
 * avenue (round the bell tower's plaza) and a road each side behind the plots.
 * Pure: from the town's plan, placements and the BattleSim's map.
 */

import type { CastlePlan, Placement, Rect } from '../../castle/scene/plan.js';
import { TOLL_Z } from '../../castle/scene/plan.js';
import type { BattleMap, LanePoint } from '../core/battle.js';

/** Grass between the town's end and the enemy's moat. */
const GAP = 14;
/** How far in front of each gate an army forms up (its front line). */
const FORM_UP = 12;

export interface SiegePlan {
  /** Mirror: a point of the player's castle → the enemy's (x, z) → (−x, mirror − z), turned half round. */
  mirror: number;
  /** The enemy castle's pieces (and its moat and island), as placements. */
  enemy: Placement[];
  /** The enemy's keep among them. */
  enemyKeep: Placement;
  /** The enemy castle's outline (its moat), and the whole field for the camera. */
  enemyMoat: Rect;
  field: Rect;
  map: BattleMap;
  /** Scenery and decor standing where the enemy castle goes, left out while the siege is on. */
  cleared: (p: Placement) => boolean;
}

export function siegePlan(plan: CastlePlan): SiegePlan {
  // z' = mirror − z: the moat's town side (z1) lands GAP past the town's end
  const mirror = plan.town.z1 + GAP + plan.moat.z1;
  const flip = (p: Placement): Placement => ({ ...p, x: -p.x, z: round(mirror - p.z), rot: (p.rot ?? 0) + Math.PI });
  const island = plan.island;
  const onIsland = (p: Placement) => p.z > island.z0 && p.z < island.z1 && p.x > island.x0 && p.x < island.x1;
  const enemyKeep = { ...flip(plan.keep), key: 'enemy-keep' };
  const enemy: Placement[] = [
    ...plan.water.map(flip),
    ...plan.ground.filter(onIsland).map(flip),
    ...plan.walls.map(flip),
    ...plan.wallets.map((w) => ({ ...flip(w), key: 'enemy' })),
    ...plan.wings.map(flip),
    enemyKeep,
    flip(plan.gatehouse),
    ...(plan.storehouse ? [flip(plan.storehouse)] : []),
    // the drawbridge lies down: the attackers come over it
    { ...flip(plan.bridge), key: 'enemy-bridge' },
  ].map((p) => (p.key === 'enemy-keep' || p.key === 'enemy-bridge' ? p : { ...p, key: p.key === 'enemy' ? 'enemy' : 'enemy-piece' }));

  const enemyMoat: Rect = { x0: plan.moat.x0, x1: plan.moat.x1, z0: round(mirror - plan.moat.z1), z1: round(mirror - plan.moat.z0) };
  const pad = 3;
  // the lanes: every plot's far side, plus room, is where the flank roads run
  const flankX = Math.max(8, ...plan.buildings.map((b) => Math.abs(b.x) + b.half + 1.5));
  const onFlank = (p: Placement) => p.z > plan.moat.z1 && p.z < enemyMoat.z0 && Math.abs(Math.abs(p.x) - flankX) < 2.5;
  const cleared = (p: Placement) =>
    (p.x > enemyMoat.x0 - pad && p.x < enemyMoat.x1 + pad && p.z > enemyMoat.z0 - pad && p.z < enemyMoat.z1 + pad) ||
    // trees and rocks standing in the flank roads
    (onFlank(p) && /^scenery\.(tree|rock)/.test(p.name));
  const gateA: LanePoint = { x: 0, z: TOLL_Z + 1 };
  const gateB: LanePoint = { x: 0, z: round(mirror - (TOLL_Z + 1)) };
  const zA = gateA.z + FORM_UP;
  const zB = gateB.z - FORM_UP;
  const av = plan.avenue;
  const turnIn = av.plazaStart - 1;
  const turnOut = av.plazaEnd + 1;
  // round the bell tower on the left, as the avenue goes
  const centre: LanePoint[] = [
    { x: 0, z: zA },
    { x: 0, z: turnIn },
    { x: -3, z: turnIn + 2 },
    { x: -3, z: turnOut - 2 },
    { x: 0, z: turnOut },
    { x: 0, z: zB },
  ].filter((p, i, all) => i === 0 || i === all.length - 1 || (p.z > zA && p.z < zB));
  const flank = (sign: number): LanePoint[] => [
    { x: sign * 4, z: zA },
    { x: sign * flankX, z: zA + 6 },
    { x: sign * flankX, z: zB - 6 },
    { x: sign * 4, z: zB },
  ];
  const map: BattleMap = { lanes: [flank(-1), centre, flank(1)], gates: { A: gateA, B: gateB } };
  const field: Rect = { x0: Math.min(plan.town.x0, enemyMoat.x0), x1: Math.max(plan.town.x1, enemyMoat.x1), z0: plan.moat.z0, z1: enemyMoat.z1 };
  return { mirror, enemy, enemyKeep, enemyMoat, field, map, cleared };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
