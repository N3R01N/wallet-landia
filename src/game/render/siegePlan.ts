/**
 * The town as the battlefield (docs/game/MAPPING.md): the player's castle at
 * one end, a mirrored enemy castle past the avenue's end, and three lanes: the
 * avenue (round the bell tower's plaza) and a road each side behind the plots.
 * Pure: from the town's plan, placements and the BattleSim's map.
 */

import type { CastlePlan, Placement, Rect } from '../../castle/scene/plan.js';
import { TOLL_Z } from '../../castle/scene/plan.js';
import type { BattleMap, CapturePoint, LanePoint } from '../core/battle.js';
import type { BuildingKind } from '../core/depth.js';

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
  const lanes: BattleMap['lanes'] = [flank(-1), centre, flank(1)];
  const map: BattleMap = { lanes, gates: { A: gateA, B: gateB }, points: battlePoints(plan, lanes, zA, zB) };
  const field: Rect = { x0: Math.min(plan.town.x0, enemyMoat.x0), x1: Math.max(plan.town.x1, enemyMoat.x1), z0: plan.moat.z0, z1: enemyMoat.z1 };
  return { mirror, enemy, enemyKeep, enemyMoat, field, map, cleared };
}

/** A building's kind on the battlefield, from what it is in the town. */
function kindOf(b: CastlePlan['buildings'][number]): BuildingKind | null {
  if (/maker|sky/.test(b.protocol.id)) return 'vault';
  if (b.protocol.category === 'lending') return 'bank';
  if (b.protocol.category === 'dex') return 'exchange';
  if (b.protocol.category === 'staking') return 'temple';
  return null;
}

/**
 * The battlefield buildings (spec: "3–5 neutral protocol buildings"): the
 * bell tower on the plaza as the Oracle Tower, then the town's first Bank,
 * Exchange, Temple and Vault; fill from the rest when fewer than three. Each
 * is held at the nearest point of the nearest lane, between the two armies.
 */
export function battlePoints(plan: CastlePlan, lanes: BattleMap['lanes'], zA: number, zB: number): CapturePoint[] {
  const out: CapturePoint[] = [];
  const nearest = (x: number, z: number) => {
    let best = { lane: 1, x, z, d: Infinity };
    lanes.forEach((pts, lane) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        const px = a.x + dx * t;
        const pz = a.z + dz * t;
        const d = Math.hypot(px - x, pz - z);
        if (d < best.d) best = { lane, x: px, z: pz, d };
      }
    });
    return best;
  };
  const add = (id: string, kind: BuildingKind, x: number, z: number) => {
    const n = nearest(x, z);
    // between the armies' front lines: a building by the gate is held a little up the street
    out.push({ id, kind, x: round(n.x), z: round(Math.max(zA + 3, Math.min(zB - 3, n.z))), lane: n.lane });
  };
  add('tower', 'oracle', plan.tower.x, plan.tower.z);
  const kinds = new Set<BuildingKind>();
  const rest: CastlePlan['buildings'] = [];
  for (const b of plan.buildings) {
    const kind = kindOf(b);
    if (kind && !kinds.has(kind)) {
      kinds.add(kind);
      add(b.protocol.id, kind, b.x, b.z);
    } else rest.push(b);
  }
  // fewer than three: the next buildings stand in as Banks and Exchanges
  for (const b of rest) {
    if (out.length >= 3) break;
    add(b.protocol.id, kindOf(b) ?? (out.length % 2 ? 'exchange' : 'bank'), b.x, b.z);
  }
  return out.slice(0, 5);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
