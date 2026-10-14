/**
 * The castle and town layout as plain data: where every castle piece, moat
 * tile, wall, wing, building, path tile and the courier's route go. Metres,
 * x to the right, z towards the viewer. The castle is at the back (negative z),
 * its gate faces the moat and the town (positive z). No WebGL here: the view
 * (castleView.ts) turns this plan into standins and animates it.
 */

import type { CastleWorld, WorldProtocol } from '../world/world.js';

export interface Placement {
  /** The asset name (manifest.ts). */
  name: string;
  x: number;
  z: number;
  /** Rotation about the vertical axis, radians. */
  rot?: number;
  /** A tier for tierable assets. */
  tier?: number;
  /** Key for things the view animates or colours (e.g. a path tile). */
  key?: string;
  /** Asset names to use, in order, when `name` has no model (a signature building's category building). */
  fallbacks?: string[];
  /** Decoration: left out (not shown as a standin) while the theme has no model for it. */
  optional?: boolean;
}

export interface BuildingPlacement extends Placement {
  protocol: WorldProtocol;
  /** Where a visitor stands: the model's `door` point, 2 m out from the centre on the front. */
  door: { x: number; z: number };
  /** Where the building's person comes out to: between the front wall and the door point. */
  npc: { x: number; z: number };
}

/** A point on the courier's way. A stop holds the courier there for a clip (docs/ASSET_SPEC.md §3.6). */
export interface Waypoint {
  x: number;
  z: number;
  stop?: 'toll' | 'hand-over';
}

export interface CastlePlan {
  water: Placement[];
  ground: Placement[];
  walls: Placement[];
  towers: Placement[];
  wings: Placement[];
  keep: Placement;
  gatehouse: Placement;
  /** The bridge's hinge, at the castle side of the moat. The deck runs towards the town. */
  bridge: Placement;
  tollbooth: Placement;
  barrier: Placement;
  tower: Placement;
  road: Placement[];
  /** Glow overlays, one per road tile. */
  lit: Placement[];
  buildings: BuildingPlacement[];
  /** The courier's way out to the first building (routeTo for any other). */
  courierRoute: Waypoint[];
  /** Woods, rocks and hills round the island and the town. */
  scenery: Placement[];
  /** Town props, the towers' flags, the moat's plants and animals: life, all optional. */
  decor: Placement[];
  /** The island (castle) and the town, for the camera. */
  island: { x0: number; x1: number; z0: number; z1: number };
  town: { x0: number; x1: number; z0: number; z1: number };
}

/** Outer moat rectangle and the island inside it. */
export const MOAT = { x0: -10, x1: 10, z0: -16, z1: 0 } as const;
export const ISLAND = { x0: -8, x1: 8, z0: -14, z1: -2 } as const;
export const TOWN = { x0: -10, x1: 10, z0: 0, z1: 22 } as const;
export const TOWER_AT = { x: 0, z: 12 } as const;

/** Slots for buildings, in the order they fill: beside the road, nearest the gate first. */
const BUILDING_SLOTS: { x: number; z: number; face: number }[] = [
  { x: -4, z: 7, face: Math.PI / 2 },
  { x: 4, z: 7, face: -Math.PI / 2 },
  { x: -4, z: 11, face: Math.PI / 2 },
  { x: 4, z: 11, face: -Math.PI / 2 },
  { x: -4, z: 15, face: Math.PI / 2 },
  { x: 4, z: 15, face: -Math.PI / 2 },
  { x: -8, z: 7, face: Math.PI / 2 },
  { x: 8, z: 7, face: -Math.PI / 2 },
  { x: -8, z: 11, face: Math.PI / 2 },
  { x: 8, z: 11, face: -Math.PI / 2 },
];

/** Wing slots on the island, beside the keep. Each is 4×3 m. */
const WING_SLOTS = [
  { x: -6, z: -4 },
  { x: 6, z: -4 },
  { x: -6, z: -9 },
  { x: 6, z: -9 },
  { x: -6, z: -12.5 },
  { x: 6, z: -12.5 },
];

/** Wing category per protocol category (bridge protocols shelter with the other wing). */
export const WING_FOR: Record<string, string> = {
  lending: 'lending',
  staking: 'staking',
  dex: 'dex',
  nft: 'nft',
  governance: 'governance',
  bridge: 'other',
  other: 'other',
};

const WING_ORDER = ['lending', 'dex', 'staking', 'nft', 'governance', 'other'] as const;

/** Tower slots on the walls: the back wall, then the sides. */
const TOWER_SLOTS = [
  { x: -6, z: -14 },
  { x: -3, z: -14 },
  { x: 0, z: -14 },
  { x: 3, z: -14 },
  { x: 6, z: -14 },
  { x: -8, z: -8 },
  { x: 8, z: -8 },
  { x: -8, z: -4 },
  { x: 8, z: -4 },
];

export function planCastle(world: Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'> & Partial<Pick<CastleWorld, 'walletTiers'>>): CastlePlan {
  const tier = clampTier(world.tier);
  const cells = (x0: number, x1: number, z0: number, z1: number, inside: (x: number, z: number) => boolean) => {
    const out: { x: number; z: number }[] = [];
    for (let x = x0 + 1; x < x1; x += 2) for (let z = z0 + 1; z < z1; z += 2) if (!inside(x, z)) out.push({ x, z });
    return out;
  };
  const inIsland = (x: number, z: number) => x > ISLAND.x0 && x < ISLAND.x1 && z > ISLAND.z0 && z < ISLAND.z1;

  const water = cells(MOAT.x0, MOAT.x1, MOAT.z0, MOAT.z1, inIsland).map((c) => ({ name: 'moat.water', ...c }));
  // Ground under the island and the town; the moat ring is water.
  const ground = [
    ...cells(ISLAND.x0, ISLAND.x1, ISLAND.z0, ISLAND.z1, () => false),
    ...cells(TOWN.x0, TOWN.x1, TOWN.z0, TOWN.z1, () => false),
  ].map((c) => ({ name: 'town.ground', ...c }));

  // Walls on the island's back and sides; a corner piece at each corner.
  const walls: Placement[] = [];
  for (let x = ISLAND.x0 + 0.5; x < ISLAND.x1; x += 1) walls.push({ name: 'castle.wall.segment', x, z: ISLAND.z0 + 0.5 });
  for (let z = ISLAND.z0 + 0.5; z < ISLAND.z1; z += 1) {
    walls.push({ name: 'castle.wall.segment', x: ISLAND.x0 + 0.5, z, rot: Math.PI / 2 });
    walls.push({ name: 'castle.wall.segment', x: ISLAND.x1 - 0.5, z, rot: Math.PI / 2 });
  }
  walls.push({ name: 'castle.wall.corner', x: ISLAND.x0 + 0.5, z: ISLAND.z0 + 0.5 });
  walls.push({ name: 'castle.wall.corner', x: ISLAND.x1 - 0.5, z: ISLAND.z0 + 0.5 });

  // each wallet's tower at that wallet's own tier (the plain tower when the tier is not known)
  const towers: Placement[] = Array.from({ length: Math.min(world.wallets, TOWER_SLOTS.length) }, (_, i) => {
    const t = world.walletTiers?.[i];
    return t === undefined
      ? { name: 'castle.tower.wallet', ...TOWER_SLOTS[i]! }
      : { name: `castle.tower.wallet.t${clampTier(t)}`, tier: clampTier(t), fallbacks: ['castle.tower.wallet'], ...TOWER_SLOTS[i]! };
  });

  const usedCategories = new Set(world.protocols.map((p) => WING_FOR[p.category] ?? 'other'));
  const wings: Placement[] = WING_ORDER.filter((c) => usedCategories.has(c))
    .slice(0, WING_SLOTS.length)
    .map((cat, i) => ({ name: `castle.wing.${cat}`, ...WING_SLOTS[i]! }));

  const keep: Placement = { name: `castle.keep.t${tier}`, x: 0, z: -10, tier };

  const gatehouse: Placement = { name: 'castle.gatehouse', x: 0, z: -4 };
  const bridge: Placement = { name: 'bridge.drawbridge', x: 0, z: -2, key: 'bridge' };
  // The border post stands beside the road, its window towards it; the barrier's arm crosses the road from its post.
  const tollbooth: Placement = { name: 'castle.tollbooth', x: -2, z: TOLL_Z, rot: Math.PI / 2 };
  const barrier: Placement = { name: 'castle.tollbooth.barrier', x: BARRIER_POST_X, z: TOLL_Z, key: 'barrier' };
  const tower: Placement = { name: 'town.tower.chronicle', x: TOWER_AT.x, z: TOWER_AT.z };

  const road: Placement[] = [];
  const lit: Placement[] = [];
  // The main road: from the bridge's landing to the tower.
  for (let z = TOWN.z0 + 0.5; z <= TOWER_AT.z - 1.5; z += 1) road.push({ name: 'path.tile.straight', x: 0, z, key: 'road' });

  const buildings: BuildingPlacement[] = world.protocols.slice(0, BUILDING_SLOTS.length).map((protocol, i) => {
    const slot = BUILDING_SLOTS[i]!;
    const cat = protocol.category in WING_FOR ? protocol.category : 'other';
    const out = { x: Math.sin(slot.face), z: Math.cos(slot.face) }; // the building's front (+Z) in the world
    const category = `building.category.${cat}.t${clampTier(protocol.tier)}`;
    return {
      // a signature building when the protocol has one, else (and while its model is missing) its category's
      name: protocol.signature ? `building.protocol.${protocol.signature}` : category,
      ...(protocol.signature ? { fallbacks: [category] } : {}),
      x: slot.x,
      z: slot.z,
      rot: slot.face,
      tier: clampTier(protocol.tier),
      protocol,
      door: { x: round(slot.x + out.x * DOOR_OUT), z: round(slot.z + out.z * DOOR_OUT) },
      npc: { x: round(slot.x + out.x * NPC_OUT), z: round(slot.z + out.z * NPC_OUT) },
    };
  });

  // A side path from the main road to each door: straight across for the inner column, along the lane
  // between the rows and then up to the door for the outer one (the inner building stands in the way).
  const taken = new Set(road.map((t) => `${t.x},${t.z}`));
  const pave = (x: number, z: number, rot: number) => {
    if (taken.has(`${x},${z}`)) return;
    taken.add(`${x},${z}`);
    road.push({ name: 'path.tile.straight', x, z, rot, key: 'road' });
  };
  for (const b of buildings) {
    const way = doorWay(b);
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1]!;
      const c = way[i]!;
      const across = a.z === c.z;
      const steps = Math.round(Math.abs(across ? c.x - a.x : c.z - a.z));
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        pave(round(a.x + (c.x - a.x) * f), round(a.z + (c.z - a.z) * f), across ? Math.PI / 2 : 0);
      }
    }
  }
  // The lit overlay sits over every road and path tile; the view shows it while a courier is near.
  for (const t of road) lit.push({ name: 'path.tile.lit', x: t.x, z: t.z, rot: t.rot ?? 0, key: 'lit' });

  const courierRoute = routeTo(buildings[0] ?? null);

  return {
    water,
    ground,
    walls,
    towers,
    wings,
    keep,
    gatehouse,
    bridge,
    tollbooth,
    barrier,
    tower,
    road,
    lit,
    buildings,
    courierRoute,
    scenery: planScenery(),
    decor: planDecor(towers),
    island: { ...ISLAND },
    town: { ...TOWN },
  };
}

/** The wall-walk's height: the top of the 3 m curtain wall, where couriers pass between towers. */
export const WALL_WALK = 3;

/**
 * The walls as one line, a U from the left front corner round the back to the
 * right front corner; every tower stands on it. A point on the walls is a
 * distance along that line.
 */
const WALL_U = [
  { x: ISLAND.x0, z: ISLAND.z1 },
  { x: ISLAND.x0, z: ISLAND.z0 },
  { x: ISLAND.x1, z: ISLAND.z0 },
  { x: ISLAND.x1, z: ISLAND.z1 },
];

function alongWalls(p: { x: number; z: number }): number {
  let walked = 0;
  for (let i = 1; i < WALL_U.length; i++) {
    const a = WALL_U[i - 1]!;
    const b = WALL_U[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len);
    const cx = a.x + (b.x - a.x) * t;
    const cz = a.z + (b.z - a.z) * t;
    if (t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(p.x - cx, p.z - cz) < 1e-6) return walked + t * len;
    walked += len;
  }
  throw new Error(`(${p.x}, ${p.z}) is not on the walls`);
}

/**
 * A courier's way between two wallet towers, along the wall-walk (at
 * WALL_WALK height): goods passed inside the guild never leave the castle. The
 * route turns at the walls' corners; the last point is a stop to hand over.
 */
export function routeAlongWalls(from: { x: number; z: number }, to: { x: number; z: number }): Waypoint[] {
  const a = alongWalls(from);
  const b = alongWalls(to);
  const corners: Waypoint[] = [];
  let walked = 0;
  for (let i = 1; i < WALL_U.length - 1; i++) {
    walked += Math.hypot(WALL_U[i]!.x - WALL_U[i - 1]!.x, WALL_U[i]!.z - WALL_U[i - 1]!.z);
    if (walked > Math.min(a, b) && walked < Math.max(a, b)) corners.push({ ...WALL_U[i]! });
  }
  if (b < a) corners.reverse();
  return [{ x: from.x, z: from.z }, ...corners, { x: to.x, z: to.z, stop: 'hand-over' }];
}

/**
 * The town's props and life, the same every time: lanterns along the road, a
 * well with benches on the square past the tower, stalls and a cart at the
 * town's front, crates and barrels by them, flowers at the border post, a fence
 * along the moat's edge; a flag on each wallet tower; lilies, reeds and ducks on
 * the moat; chickens, a cat and a dog about town, a horse by the gate. Kept
 * clear of the road, the paths and the buildings' plots (plan tests check).
 */
function planDecor(towers: readonly Placement[]): Placement[] {
  const d = (name: string, x: number, z: number, rot = 0): Placement => ({ name, x, z, rot, optional: true, key: 'decor' });
  const out: Placement[] = [];
  // lanterns either side of the road, from past the border post to the tower
  for (const z of [5.5, 8]) for (const x of [-0.9, 0.9]) out.push(d('prop.lamp', x, z)); // between the side paths (z 7, 9)
  // the square past the tower
  out.push(d('prop.well', 0, TOWER_AT.z + 3.5), d('prop.bench', -1.6, TOWER_AT.z + 4.6), d('prop.bench', 1.6, TOWER_AT.z + 4.6));
  // the town's front, either side of the road
  out.push(d('prop.market.stall', -6.5, 3, Math.PI / 2), d('prop.market.stall', 6, 3, -Math.PI / 2), d('prop.cart', 3.5, 4.2, 0.4));
  out.push(d('prop.crate', -8.2, 2.2), d('prop.barrel', -8.3, 3.4), d('prop.crate', 8, 2), d('prop.barrel', 8.4, 3.1), d('prop.barrel', 7.7, 4.2));
  out.push(d('prop.flowers', -2.2, 4.3), d('prop.flowers', 2.2, 1.2));
  // a fence along the moat's edge, gaps left for the road
  for (let x = TOWN.x0 + 0.5; x < TOWN.x1; x += 1) if (Math.abs(x) > 1.5) out.push(d('prop.fence.segment', x, TOWN.z0 + 0.4));
  // a flag on each wallet tower (the tower is 3 m tall)
  for (const t of towers) out.push({ ...d('castle.flag', t.x, t.z), key: 'flag' });
  // the moat: lilies and ducks on the water, reeds at its edges
  out.push(d('moat.lily', -9, -6), d('moat.lily', 9, -11), d('moat.lily', 4, -15), d('moat.lily', -6, -1));
  out.push(d('moat.reeds', -9.6, -12), d('moat.reeds', 9.6, -3), d('moat.reeds', -3, -15.6), d('moat.reeds', 7, -0.4));
  out.push(d('animal.duck', -9, -9, 1.2), d('animal.duck', 6.5, -1, -0.5), d('animal.duck', 0, -15, 2.5));
  // about town
  out.push(d('animal.chicken', 5.2, 5, 0.8), d('animal.chicken', 6.6, 5.4, 2.4), d('animal.chicken', -5.4, 5.2, 4));
  out.push(d('animal.cat', -1.8, TOWER_AT.z + 5.5, 1.1), d('animal.dog', 2.8, 2.2, -1.2), d('animal.horse', -5, 0.9, Math.PI / 2));
  return out;
}

/** The courier's start: inside the gate. */
export const GATE_AT = { x: 0, z: ISLAND.z1 - 1 } as const;
/** Where errands to or from outside the town end: the road's far end, by the tower. */
export const TOWN_END = { x: 0, z: TOWER_AT.z - 2 } as const;

/**
 * The way from the main road to a building's door: across for the inner column;
 * for the outer column along the lane between the rows (the inner building is
 * in the way), then to the door.
 */
function doorWay(b: BuildingPlacement): { x: number; z: number }[] {
  const side = Math.sign(b.door.x) || 1;
  // Past the tower: leave the road before it and go round it by the side lane.
  if (b.door.z > TOWER_AT.z - TOWER_CLEAR && Math.abs(b.door.x) <= 3) {
    const before = TOWER_AT.z - TOWER_CLEAR - 1;
    const way = [{ x: 0, z: before }, { x: side * TOWER_CLEAR, z: before }, { x: side * TOWER_CLEAR, z: b.door.z }];
    if (b.door.x !== side * TOWER_CLEAR) way.push(b.door);
    return way;
  }
  if (Math.abs(b.door.x) <= 3) return [{ x: 0, z: b.door.z }, b.door];
  // the lane between the rows, on the gate's side of the tower
  const lane = b.z + LANE_OFFSET < TOWER_AT.z - TOWER_CLEAR ? b.z + LANE_OFFSET : b.z - LANE_OFFSET;
  return [{ x: 0, z: lane }, { x: b.door.x, z: lane }, b.door];
}

/**
 * A courier's way out from the gate: over the bridge, a stop at the barrier for
 * the toll, along the road, then to the building's door (a stop there to hand
 * over the goods), or to the town's far end for someone outside the town.
 */
export function routeTo(building: BuildingPlacement | null): Waypoint[] {
  const start: Waypoint[] = [{ ...GATE_AT }, { x: 0, z: TOLL_Z - 0.7, stop: 'toll' }];
  if (!building) return [...start, { ...TOWN_END }];
  const way = doorWay(building);
  return [...start, ...way.slice(0, -1).map((p) => ({ x: p.x, z: p.z })), { x: building.door.x, z: building.door.z, stop: 'hand-over' }];
}

/**
 * Scenery round the edges, the same every time: hills behind the castle, a band
 * of oaks and pines down both sides, rocks between them. Nothing on the moat or
 * in the town. Positions jitter by a fixed hash so the woods do not look planted.
 */
function planScenery(): Placement[] {
  const out: Placement[] = [
    { name: 'scenery.hill', x: -16, z: -28 },
    { name: 'scenery.hill', x: 6, z: -30, rot: 1.1 },
    { name: 'scenery.hill', x: 22, z: -20, rot: 2.3 },
  ];
  const jitter = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1; // 0…1, fixed per index
  let i = 0;
  for (const side of [-1, 1]) {
    for (let z = MOAT.z0 - 2; z <= TOWN.z1; z += 2.5) {
      for (const lane of [0, 1]) {
        i++;
        const x = side * (MOAT.x1 + 2 + lane * 2.5 + jitter(i) * 1.2);
        out.push({ name: jitter(i + 7) < 0.55 ? 'scenery.tree.oak' : 'scenery.tree.pine', x: round(x), z: round(z + jitter(i + 3) * 1.5), rot: round(jitter(i + 5) * Math.PI * 2) });
      }
      if (jitter(i + 11) < 0.3) out.push({ name: `scenery.rock.${1 + Math.floor(jitter(i + 13) * 3)}`, x: round(side * (MOAT.x1 + 1)), z: round(z + 1), rot: round(jitter(i + 17) * 6) });
    }
  }
  // Behind the castle, between the hills.
  for (let x = MOAT.x0; x <= MOAT.x1; x += 3) {
    i++;
    out.push({ name: jitter(i) < 0.5 ? 'scenery.tree.pine' : 'scenery.tree.oak', x: round(x + jitter(i + 2)), z: round(MOAT.z0 - 2.5 - jitter(i + 4) * 2), rot: round(jitter(i + 6) * 6) });
  }
  return out;
}

/** The toll line: the booth beside the road, the barrier across it. */
export const TOLL_Z = 2.5;
/** The barrier's post, left of the road; its 2 m arm reaches across. */
export const BARRIER_POST_X = -1.1;
/** The `door` point of every building model, from its centre along its front. */
const DOOR_OUT = 2;
/** Where a building's person stands to meet a visitor. */
const NPC_OUT = 1.3;
/** The lane between two rows of buildings, from a row's centre. */
const LANE_OFFSET = 2;
/** How far from the tower's centre a way round it keeps (the tower is about 3 m across). */
const TOWER_CLEAR = 2;

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clampTier(t: number): number {
  return Math.max(0, Math.min(6, Math.round(t)));
}
