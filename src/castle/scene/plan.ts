/**
 * The castle and town layout as plain data: where every castle piece, moat
 * tile, wall, wing, building, path tile and the courier's route go. Metres,
 * x to the right, z towards the viewer. The castle is at the back (negative z),
 * its gate faces the moat and the town (positive z). No WebGL here: the view
 * (castleView.ts) turns this plan into models and animates it.
 *
 * Two castle layouts (the theme says which, `castleLayout`): 1, the first
 * themes' castle (wallet towers on the walls, category wings, the keep in the
 * middle); 2, the v2 castle (docs/batches/01-castle-core.md): each wallet a hall
 * built into the curtain wall, the first two flanking the gate, the keep against
 * the back wall, a storehouse in the courtyard, every piece meeting only plain
 * wall segments (no two buildings touch).
 *
 * The town is an avenue from the toll gate. Each protocol's building stands
 * beside it on a plot sized to the building (size.ts: big protocols are big
 * buildings), alternating left and right, its door at the avenue's edge. The
 * bell tower stands in a plaza halfway along; the avenue goes round it.
 */

import type { CastleWorld, WorldProtocol } from '../world/world.js';
import { sizeClassOf } from '../assets/manifest.js';
import type { WalletFocus } from '../world/halls.js';

export interface Placement {
  /** The asset name (manifest.ts). */
  name: string;
  x: number;
  z: number;
  /** Uniform scale (a protocol's building by its size; 1 when absent). */
  scale?: number;
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
  /** Its plot: the place in the avenue's order (build mode moves it). */
  slot: number;
  /** Its footprint's half width (metres): the 2 × 2 m model times its size, halved. */
  half: number;
  /** Where a visitor stands: the model's `door` point, at the avenue's edge. */
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

/** A wallet's place in the castle: its tower (layout 1) or hall (layout 2), and where a courier stops at it. */
export interface WalletPlacement extends Placement {
  door: { x: number; z: number };
  /** What the wallet mostly holds: its hall's dressing (`focus.<it>` parts). */
  focus?: WalletFocus;
}

export interface CastlePlan {
  /** Which castle layout (1: towers on the walls; 2: halls in the walls). */
  layout: CastleLayout;
  water: Placement[];
  ground: Placement[];
  walls: Placement[];
  /** Each wallet's tower (layout 1) or hall (layout 2), in the wallets' order. */
  wallets: WalletPlacement[];
  wings: Placement[];
  keep: Placement;
  gatehouse: Placement;
  /** Layout 2's storehouse in the courtyard. */
  storehouse: Placement | null;
  /** The bridge's hinge, at the castle side of the moat. The deck runs towards the town. */
  bridge: Placement;
  tollbooth: Placement;
  barrier: Placement;
  /** Where a courier stops to pay the toll. */
  tollStop: { x: number; z: number };
  tower: Placement;
  road: Placement[];
  /** Glow overlays, one per road tile. */
  lit: Placement[];
  buildings: BuildingPlacement[];
  /** Plots with no building (where one can be moved in build mode). */
  freeSlots: { slot: number; x: number; z: number; half: number }[];
  /** The avenue: the plaza it goes round (z range), and where it ends. */
  avenue: Avenue;
  /** The courier's way out to the first building (routeTo for any other). */
  courierRoute: Waypoint[];
  /** Woods, rocks and hills round the island and the town. */
  scenery: Placement[];
  /**
   * The Wayfarers' Gate across the avenue's far end, and the road on beyond it into the haze
   * (docs/batches/24-wayfarers-gate.md; layout 2): where things from outside the town come in.
   */
  gate: Placement | null;
  beyond: Placement | null;
  /** A path cell just past the road's last tile that the road runs on into (the road beyond): no end kerb there. */
  roadOut: { x: number; z: number } | null;
  /** Town props, the towers' flags, the moat's plants and animals: life, all optional. */
  decor: Placement[];
  /** The moat's outer edge, the island (castle) and the town, for the camera. */
  moat: Rect;
  island: Rect;
  town: { x0: number; x1: number; z0: number; z1: number };
}

export interface Avenue {
  /** The plaza with the bell tower: no buildings beside it; the avenue goes round the tower on the left. */
  plazaStart: number;
  plazaEnd: number;
  /** Where the avenue ends (past the last plot). */
  end: number;
  /** Where someone from outside the town is met: the Wayfarers' Gate's door (layout 2), else the avenue's end. */
  out?: number;
}

export type CastleLayout = 1 | 2;
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Outer moat rectangle and the island inside it (layout 1). */
export const MOAT = { x0: -10, x1: 10, z0: -16, z1: 0 } as const;
export const ISLAND = { x0: -8, x1: 8, z0: -14, z1: -2 } as const;
/**
 * Layout 2's: room for six halls along the walls and a courtyard (a 1 m grid, docs/batches/01-castle-core.md).
 * Both even metres deep and wide, so the 2 m water and ground tiles meet exactly at the island's edge.
 */
export const MOAT_V2 = { x0: -12, x1: 12, z0: -24, z1: 0 } as const;
export const ISLAND_V2 = { x0: -10, x1: 10, z0: -22, z1: -2 } as const;

/**
 * Layout 2's pieces (metres along the wall): corner towers 2 × 2; the gatehouse
 * 4 wide; halls 4 × 4; the keep 8 wide, 5.5 deep. A model's outer face is its
 * −Z side; `rot` turns it to its wall.
 */
const V2 = { corner: 2, gateHalf: 2, hall: 4, keepHalf: 4, keepDepth: 5.5, storehouse: { x: 0, z: -11 } } as const;
/** The courtyard's lanes (layout 2): along each side's hall doors, and across behind the front halls. */
const LANE_X = 4.5;
const LANE_Z = -7.5;
/** Where a hall's door point stands in the model (docs/batches/01-castle-core.md: 1 m in front of its door, left of the middle). */
const HALL_DOOR = { x: -0.55, z: 3 } as const;
/** Layout 2's hall slots: either side of the gate, then the side walls front to back; each door point turned with its hall. */
const HALL_SLOTS: readonly { x: number; z: number; rot: number; door: { x: number; z: number } }[] = [
  { x: -5, z: -4, rot: Math.PI },
  { x: 5, z: -4, rot: Math.PI },
  { x: -8, z: -9, rot: Math.PI / 2 },
  { x: 8, z: -9, rot: -Math.PI / 2 },
  { x: -8, z: -14, rot: Math.PI / 2 },
  { x: 8, z: -14, rot: -Math.PI / 2 },
].map((h) => ({
  ...h,
  // a model's local point turned by rot about the vertical axis (three.js: x' = x cos + z sin, z' = −x sin + z cos)
  door: {
    x: round(h.x + HALL_DOOR.x * Math.cos(h.rot) + HALL_DOOR.z * Math.sin(h.rot)),
    z: round(h.z - HALL_DOOR.x * Math.sin(h.rot) + HALL_DOOR.z * Math.cos(h.rot)),
  },
}));

/** How many plots the town has (one per building). */
export const SLOT_COUNT = 16;
/** The avenue's half width: every door stands at its edge. */
export const AVENUE_HALF = 1.5;
/** Where the first plots start (past the toll gate and the market at the town's front). */
const TOWN_START = 6;
/** Room between two plots along the avenue. */
const PLOT_GAP = 3;
/** The plaza's length along the avenue, and how far round the tower the avenue keeps. */
const PLAZA_LENGTH = 14;
/** How far left of the avenue the road goes round the tower: a whole metre, so its tiles line up with the avenue's. */
const TOWER_CLEAR = 3;

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

/**
 * Each protocol's plot: the ones the player arranged (build mode) where they
 * asked, if the plot is real and still free; the rest fill the free plots in
 * order, nearest the gate first. Protocols beyond the plots get none.
 */
export function assignSlots(protocolIds: readonly string[], wanted: Readonly<Record<string, number>> = {}): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  const ids = protocolIds.slice(0, SLOT_COUNT);
  for (const id of ids) {
    const w = wanted[id];
    if (typeof w === 'number' && Number.isInteger(w) && w >= 0 && w < SLOT_COUNT && !taken.has(w)) {
      out.set(id, w);
      taken.add(w);
    }
  }
  let next = 0;
  for (const id of ids) {
    if (out.has(id)) continue;
    while (taken.has(next)) next++;
    out.set(id, next);
    taken.add(next);
  }
  return out;
}

/**
 * Build mode's moves: the protocol goes to the plot; whoever was there takes
 * its old plot. Returns the whole arrangement (every protocol pinned), to keep.
 */
export function moveToSlot(current: ReadonlyMap<string, number>, protocolId: string, slot: number): Record<string, number> {
  const out = Object.fromEntries(current);
  const from = current.get(protocolId);
  if (from === undefined || slot < 0 || slot >= SLOT_COUNT) return out;
  const other = [...current].find(([, s]) => s === slot)?.[0];
  out[protocolId] = slot;
  if (other !== undefined && other !== protocolId) out[other] = from;
  return out;
}

export function planCastle(
  world: Pick<CastleWorld, 'wallets' | 'tier' | 'protocols'> & Partial<Pick<CastleWorld, 'walletTiers' | 'walletFocus'>>,
  arranged: Readonly<Record<string, number>> = {},
  layout: CastleLayout = 1,
): CastlePlan {
  const tier = clampTier(world.tier);
  const cells = (x0: number, x1: number, z0: number, z1: number, inside: (x: number, z: number) => boolean) => {
    const out: { x: number; z: number }[] = [];
    for (let x = x0 + 1; x < x1; x += 2) for (let z = z0 + 1; z < z1; z += 2) if (!inside(x, z)) out.push({ x, z });
    return out;
  };
  const moat: Rect = layout === 2 ? { ...MOAT_V2 } : { ...MOAT };
  const island: Rect = layout === 2 ? { ...ISLAND_V2 } : { ...ISLAND };
  const inIsland = (x: number, z: number) => x > island.x0 && x < island.x1 && z > island.z0 && z < island.z1;

  const water = cells(moat.x0, moat.x1, moat.z0, moat.z1, inIsland).map((c) => ({ name: 'moat.water', ...c }));
  const castle = layout === 2 ? castleV2(world, tier) : castleV1(world, tier);

  const bridge: Placement = { name: 'bridge.drawbridge', x: 0, z: -2, key: 'bridge' };
  // The border post stands beside the road, its window towards it; the barrier's arm crosses the road from its post.
  // (layout 2's booth holds the barrier's post: 0.14 m off its middle, so the booth stands that much further along)
  const tollbooth: Placement = { name: 'castle.tollbooth', x: -2, z: layout === 2 ? TOLL_Z + 0.14 : TOLL_Z, rot: Math.PI / 2 };
  const barrier: Placement = { name: 'castle.tollbooth.barrier', x: BARRIER_POST_X, z: TOLL_Z, key: 'barrier' };
  // The town: plots along the avenue, sized to their buildings, the plaza halfway.
  const slotOf = assignSlots(
    world.protocols.map((p) => p.id),
    arranged,
  );
  const inSlot = new Map<number, WorldProtocol>();
  for (const p of world.protocols.slice(0, SLOT_COUNT)) inSlot.set(slotOf.get(p.id)!, p);
  const plots = layPlots(Array.from({ length: SLOT_COUNT }, (_, i) => inSlot.get(i)?.size ?? 1));
  const avenue = plots.avenue;
  const tower: Placement = { name: 'town.tower.chronicle', x: 0, z: round((avenue.plazaStart + avenue.plazaEnd) / 2) };

  const buildings: BuildingPlacement[] = [];
  for (const [slot, protocol] of inSlot) {
    const plot = plots.list[slot]!;
    const cat = protocol.category in WING_FOR ? protocol.category : 'other';
    // its category's building: the v2 one of its size class (tiers as parts), else the first themes' tier model
    const byTier = `building.category.${cat}.t${clampTier(protocol.tier)}`;
    const byClass = `building.category.${cat}.${sizeClassOf(2 * plot.half)}`;
    buildings.push({
      // the town's own place (the furnace), a signature building when the protocol has one, else (and while
      // its model is missing) its category's
      name: protocol.place?.model ?? (protocol.signature ? `building.protocol.${protocol.signature}` : byClass),
      fallbacks: protocol.place || protocol.signature ? [byClass, byTier] : [byTier],
      x: plot.x,
      z: plot.z,
      rot: plot.face,
      scale: round(protocol.size),
      tier: clampTier(protocol.tier),
      protocol,
      slot,
      half: plot.half,
      // the door's step on the path grid's row nearest the plot's middle (cells are 1 m, centred on half metres)
      door: { x: Math.sign(plot.x) * AVENUE_HALF, z: pathRow(plot.z) },
      npc: { x: round(Math.sign(plot.x) * (AVENUE_HALF + plot.half * (1 - NPC_IN))), z: pathRow(plot.z) },
    });
  }
  // nearest the gate first (couriers, the chronicle and the tests read them in this order)
  buildings.sort((a, b) => world.protocols.indexOf(a.protocol) - world.protocols.indexOf(b.protocol));

  // the Wayfarers' Gate (layout 2) across the avenue's far end, its front (+Z) to the town: its passage on
  // whole metres, so the road's tiles run through it edge to edge into the road beyond
  const gate: Placement | null = layout === 2 ? { name: 'town.gate', x: 0, z: Math.ceil(avenue.end) + GATE_DOOR, rot: Math.PI, key: 'gate', optional: true } : null;
  if (gate) avenue.out = gate.z - GATE_DOOR;
  const beyond: Placement | null = gate ? { name: 'scenery.road.beyond', x: 0, z: gate.z + GATE_BACK, rot: Math.PI, optional: true } : null;

  const town = {
    x0: Math.min(-12, ...plots.list.map((p) => p.x - p.half - 3)),
    x1: Math.max(12, ...plots.list.map((p) => p.x + p.half + 3)),
    z0: 0,
    z1: gate ? gate.z + GATE_BACK + ROAD_BEYOND : avenue.end + 3,
  };

  // Paving: the avenue (round the tower), a step from it to each door; cobbles under the avenue's band and the plaza.
  const road: Placement[] = [];
  const lit: Placement[] = [];
  const taken = new Set<string>();
  const pave = (x: number, z: number, rot: number) => {
    const key = `${round(x)},${round(z)}`;
    if (taken.has(key)) return;
    taken.add(key);
    road.push({ name: 'path.tile.straight', x: round(x), z: round(z), rot, key: 'road' });
  };
  // all on one grid: x on whole metres, z on half metres, so every turn and branch meets its neighbour edge to edge
  const [turnIn, turnOut] = plazaRows(avenue);
  for (let z = 0.5; z <= turnIn; z += 1) pave(0, z, 0);
  for (let x = -1; x >= -TOWER_CLEAR; x -= 1) pave(x, turnIn, Math.PI / 2);
  for (let z = turnIn + 1; z < turnOut; z += 1) pave(-TOWER_CLEAR, z, 0);
  for (let x = -1; x >= -TOWER_CLEAR; x -= 1) pave(x, turnOut, Math.PI / 2);
  // (through the gate's passage to the road beyond, when there is a gate)
  for (let z = turnOut; z < (gate ? gate.z + GATE_BACK : avenue.end); z += 1) pave(0, z, 0);
  for (const b of buildings) pave(Math.sign(b.door.x), b.door.z, Math.PI / 2);
  // The lit overlay sits over every road and path tile; the view shows it while a courier is near.
  for (const t of road) lit.push({ name: 'path.tile.lit', x: t.x, z: t.z, rot: t.rot ?? 0, key: 'lit' });

  // cobbles: the island, the avenue's band, the plaza, and every plot from the avenue to its far side
  // (a big building stands on paving, not on the grass), each 2 m cell once
  const even = (v: number, up: boolean) => (up ? Math.ceil(v / 2) : Math.floor(v / 2)) * 2;
  const plotCells = buildings.flatMap((b) => {
    const reach = b.half + 0.5;
    const outer = Math.abs(b.x) + reach;
    return cells(b.x < 0 ? -even(outer, true) : 4, b.x < 0 ? -4 : even(outer, true), even(b.z - reach, false), even(b.z + reach, true), () => false);
  });
  const seenCell = new Set<string>();
  const ground = [
    ...cells(island.x0, island.x1, island.z0, island.z1, () => false),
    // (to the gate's back, never under the road beyond's own cobbles)
    ...cells(-4, 4, 0, gate ? Math.floor((gate.z + GATE_BACK) / 2) * 2 : Math.ceil(avenue.end / 2) * 2, () => false),
    ...cells(-10, 10, Math.floor(avenue.plazaStart / 2) * 2, Math.ceil(avenue.plazaEnd / 2) * 2, (x) => Math.abs(x) < 4),
    ...plotCells,
  ]
    .filter((c) => {
      const k = `${c.x},${c.z}`;
      if (seenCell.has(k)) return false;
      seenCell.add(k);
      return true;
    })
    .map((c) => ({ name: 'town.ground', ...c }));

  const courierRoute = routeTo(avenue, buildings[0] ?? null);

  return {
    layout,
    water,
    ground,
    ...castle,
    bridge,
    tollbooth,
    barrier,
    tollStop: { ...TOLL_STOP },
    tower,
    road,
    lit,
    buildings,
    freeSlots: plots.list.map((p, slot) => ({ slot, x: p.x, z: p.z, half: p.half })).filter((p) => !inSlot.has(p.slot)),
    avenue,
    courierRoute,
    scenery: planScenery(town, moat),
    gate,
    beyond,
    roadOut: gate ? { x: 0, z: gate.z + GATE_BACK + 0.5 } : null,
    decor: planDecor(layout === 1 ? castle.wallets : [], tower, avenue, town, buildings.map((b) => b.door.z), moat),
    moat,
    island,
    town,
  };
}

type CastlePieces = Pick<CastlePlan, 'walls' | 'wallets' | 'wings' | 'keep' | 'gatehouse' | 'storehouse'>;

/** Layout 1: walls on the island's back and sides, a tower per wallet on them, a wing per category, the keep in the middle. */
function castleV1(world: Pick<CastleWorld, 'wallets' | 'protocols'> & Partial<Pick<CastleWorld, 'walletTiers' | 'walletFocus'>>, tier: number): CastlePieces {
  const walls: Placement[] = [];
  for (let x = ISLAND.x0 + 0.5; x < ISLAND.x1; x += 1) walls.push({ name: 'castle.wall.segment', x, z: ISLAND.z0 + 0.5 });
  for (let z = ISLAND.z0 + 0.5; z < ISLAND.z1; z += 1) {
    walls.push({ name: 'castle.wall.segment', x: ISLAND.x0 + 0.5, z, rot: Math.PI / 2 });
    walls.push({ name: 'castle.wall.segment', x: ISLAND.x1 - 0.5, z, rot: Math.PI / 2 });
  }
  walls.push({ name: 'castle.wall.corner', x: ISLAND.x0 + 0.5, z: ISLAND.z0 + 0.5 });
  walls.push({ name: 'castle.wall.corner', x: ISLAND.x1 - 0.5, z: ISLAND.z0 + 0.5 });

  // each wallet's tower at that wallet's own tier (the plain tower when the tier is not known)
  const wallets: WalletPlacement[] = Array.from({ length: Math.min(world.wallets, TOWER_SLOTS.length) }, (_, i) => {
    const t = world.walletTiers?.[i];
    const slot = TOWER_SLOTS[i]!;
    return t === undefined
      ? { name: 'castle.tower.wallet', ...slot, door: { ...slot } }
      : { name: `castle.tower.wallet.t${clampTier(t)}`, tier: clampTier(t), fallbacks: ['castle.tower.wallet'], ...slot, door: { ...slot } };
  });

  const usedCategories = new Set(world.protocols.map((p) => WING_FOR[p.category] ?? 'other'));
  const wings: Placement[] = WING_ORDER.filter((c) => usedCategories.has(c))
    .slice(0, WING_SLOTS.length)
    .map((cat, i) => ({ name: `castle.wing.${cat}`, ...WING_SLOTS[i]! }));

  return {
    walls,
    wallets,
    wings,
    keep: { name: `castle.keep.t${tier}`, x: 0, z: -10, tier },
    gatehouse: { name: 'castle.gatehouse', x: 0, z: -4 },
    storehouse: null,
  };
}

/**
 * Layout 2: a curtain wall round the island's edge with a corner tower at each
 * corner; the gatehouse in the front wall; a hall per wallet in the walls (up
 * to six); the keep against the back wall; plain 1 m segments wherever no piece
 * stands, so pieces meet only segments. Tiers show through the models' tier
 * parts: the keep's the guild's, each hall its wallet's.
 */
function castleV2(world: Pick<CastleWorld, 'wallets'> & Partial<Pick<CastleWorld, 'walletTiers' | 'walletFocus'>>, tier: number): CastlePieces {
  const I = ISLAND_V2;
  const c = V2.corner;
  const wallets: WalletPlacement[] = HALL_SLOTS.slice(0, Math.max(0, world.wallets)).map((slot, i) => {
    const t = clampTier(world.walletTiers?.[i] ?? 0);
    // its tier's own hall (docs/batches/17-wallet-halls.md), else the one hall with tier parts
    const focus = world.walletFocus?.[i];
    return { name: `castle.hall.wallet.t${t}`, fallbacks: ['castle.hall.wallet', `castle.tower.wallet.t${t}`, 'castle.tower.wallet'], x: slot.x, z: slot.z, rot: slot.rot, tier: t, door: { ...slot.door }, ...(focus ? { focus } : {}) };
  });
  // What stands in each wall, as spans along it: the gatehouse, the keep, the halls in use.
  const front: [number, number][] = [[-V2.gateHalf, V2.gateHalf]];
  const back: [number, number][] = [[-V2.keepHalf, V2.keepHalf]];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (const h of wallets) {
    const span: [number, number] = h.rot === Math.PI ? [h.x - V2.hall / 2, h.x + V2.hall / 2] : [h.z - V2.hall / 2, h.z + V2.hall / 2];
    (h.rot === Math.PI ? front : h.x < 0 ? left : right).push(span);
  }
  const free = (spans: [number, number][], at: number) => !spans.some(([a, b]) => at > a && at < b);
  const walls: Placement[] = [];
  for (let x = I.x0 + c + 0.5; x < I.x1 - c; x += 1) {
    if (free(front, x)) walls.push({ name: 'castle.wall.segment', x, z: I.z1 - 0.5, rot: Math.PI });
    if (free(back, x)) walls.push({ name: 'castle.wall.segment', x, z: I.z0 + 0.5 });
  }
  for (let z = I.z0 + c + 0.5; z < I.z1 - c; z += 1) {
    if (free(left, z)) walls.push({ name: 'castle.wall.segment', x: I.x0 + 0.5, z, rot: Math.PI / 2 });
    if (free(right, z)) walls.push({ name: 'castle.wall.segment', x: I.x1 - 0.5, z, rot: -Math.PI / 2 });
  }
  // corner towers, their outer faces outwards
  walls.push(
    { name: 'castle.wall.corner', x: I.x0 + c / 2, z: I.z0 + c / 2 },
    { name: 'castle.wall.corner', x: I.x1 - c / 2, z: I.z0 + c / 2, rot: -Math.PI / 2 },
    { name: 'castle.wall.corner', x: I.x0 + c / 2, z: I.z1 - c / 2, rot: Math.PI / 2 },
    { name: 'castle.wall.corner', x: I.x1 - c / 2, z: I.z1 - c / 2, rot: Math.PI },
  );
  return {
    walls: walls.map((w) => ({ ...w, x: round(w.x), z: round(w.z) })),
    wallets,
    wings: [],
    keep: { name: 'castle.keep', fallbacks: [`castle.keep.t${tier}`], x: 0, z: round(I.z0 + V2.keepDepth / 2), tier },
    gatehouse: { name: 'castle.gatehouse', x: 0, z: round(I.z1 - 1.75) },
    storehouse: { name: 'castle.storehouse', ...V2.storehouse },
  };
}

/**
 * A courier's way between two wallets inside the castle, and how high it runs:
 * along the wall-walk between towers (layout 1), or across the courtyard
 * between halls' doors (layout 2: along the lanes, round the storehouse).
 */
export function routeBetweenWallets(plan: Pick<CastlePlan, 'layout' | 'wallets'>, from: number, to: number): { route: Waypoint[]; height: number } | null {
  const a = plan.wallets[from];
  const b = plan.wallets[to];
  if (!a || !b) return null;
  if (plan.layout === 1) return { route: routeAlongWalls(a, b), height: WALL_WALK };
  // onto its side's lane (a front hall's door is in front of the cross lane: onto that)
  const lane = (d: { x: number; z: number }) => ({ x: Math.sign(d.x) * LANE_X, z: Math.min(d.z, LANE_Z) });
  const la = lane(a.door);
  const lb = lane(b.door);
  const across: Waypoint[] = Math.sign(la.x) === Math.sign(lb.x) ? [] : [{ x: la.x, z: LANE_Z }, { x: lb.x, z: LANE_Z }];
  const route: Waypoint[] = [{ ...a.door }, la, ...across, lb, { ...b.door, stop: 'hand-over' }];
  // no standing still: drop a point that repeats the one before
  return { route: route.filter((p, i) => i === 0 || p.x !== route[i - 1]!.x || p.z !== route[i - 1]!.z), height: 0 };
}

/**
 * A wallet's way to the gate across the courtyard (layout 2): from its hall's
 * door onto its side's lane, along the cross lane to the middle, and out under
 * the gatehouse. Couriers set out from their wallet's door and come home to it,
 * in sight, not in the gate's tunnel. Empty for layout 1 or a wallet without a hall.
 */
export function routeFromHome(plan: Pick<CastlePlan, 'layout' | 'wallets'>, wallet: number): Waypoint[] {
  const hall = plan.wallets[wallet];
  if (plan.layout !== 2 || !hall) return [];
  const side = Math.sign(hall.door.x) * LANE_X;
  const lane = { x: side, z: Math.min(hall.door.z, LANE_Z) };
  const route: Waypoint[] = [{ ...hall.door }, lane, { x: side, z: LANE_Z }, { x: 0, z: LANE_Z }, { ...GATE_AT }];
  return route.filter((p, i) => i === 0 || p.x !== route[i - 1]!.x || p.z !== route[i - 1]!.z);
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
 * The plots along the avenue, in slot order: even slots on the left, odd on the
 * right, each plot as deep as its building (2 m × size) plus a gap; the plaza
 * halfway along (no plots beside it). A building's front wall faces the
 * avenue and its door point (2 m × size out from its centre) lands at the
 * avenue's edge.
 */
export function layPlots(sizes: readonly number[]): { list: { x: number; z: number; face: number; half: number }[]; avenue: Avenue } {
  const halves = sizes.map((s) => s);
  // how long each side would be without the plaza, to put the plaza halfway
  const length = [0, 1].map((side) => halves.filter((_, i) => i % 2 === side).reduce((t, h) => t + 2 * h + PLOT_GAP, 0));
  // on a whole metre, so the avenue's 1 m tiles meet it exactly
  const plazaStart = Math.round(TOWN_START + Math.max(...length) / 2);
  const plazaEnd = plazaStart + PLAZA_LENGTH;
  const cursor = [TOWN_START, TOWN_START];
  const list = halves.map((half, i) => {
    const side = i % 2; // 0 left, 1 right
    const depth = 2 * half;
    if (cursor[side]! < plazaEnd && cursor[side]! + depth > plazaStart) cursor[side] = plazaEnd + PLOT_GAP;
    const z = round(cursor[side]! + half);
    cursor[side] = cursor[side]! + depth + PLOT_GAP;
    const sign = side === 0 ? -1 : 1;
    // the door point is 2 × half out from the centre: the centre stands that far from the avenue's edge
    return { x: round(sign * (AVENUE_HALF + 2 * half)), z, face: sign < 0 ? Math.PI / 2 : -Math.PI / 2, half };
  });
  return { list, avenue: { plazaStart, plazaEnd, end: round(Math.max(plazaEnd + 2, ...cursor)) } };
}

/** The courier's start: inside the gate. */
export const GATE_AT = { x: 0, z: ISLAND.z1 - 1 } as const;

/** The path grid's row (a half metre) nearest z. */
export function pathRow(z: number): number {
  return Math.floor(z) + 0.5;
}

/** The rows where the road turns off the avenue round the tower, and back onto it: the last before the plaza, the first after. */
function plazaRows(avenue: Avenue): [number, number] {
  return [pathRow(avenue.plazaStart - 0.5), pathRow(avenue.plazaEnd + 0.5)];
}

/** Which way a path tile opens: towards −z, +x, +z, −x (its neighbours on the grid). */
export type Openings = { n: boolean; e: boolean; s: boolean; w: boolean };

/**
 * A path cell's tile from its neighbours (docs/batches/18-path-tiles.md):
 * straight, bend, tee, cross or end, and how it turns. Each shape is modelled
 * opening towards +z (straight: +z and −z; bend: +z and +x; tee: +z, −z and
 * +x; end: +z only); `rot` turns it about y as three.js does (+z towards +x).
 * `straightRot` is how a plain straight tile lies there instead, along the
 * busier axis, until the theme has the shape. Pure.
 */
export function pathShape(o: Openings): { shape: 'straight' | 'bend' | 'tee' | 'cross' | 'end'; rot: number; straightRot: number } {
  // directions as unit steps; a model's +z opening turned by rot points (sin rot, cos rot)
  const dirs = [o.s && [0, 1], o.e && [1, 0], o.n && [0, -1], o.w && [-1, 0]].filter((d): d is number[] => !!d);
  const alongZ = o.n || o.s;
  const alongX = o.e || o.w;
  const straightRot = alongX && !alongZ ? Math.PI / 2 : 0;
  const turned = (base: number[][], rot: number) => base.map(([x, z]) => [Math.round(x! * Math.cos(rot) + z! * Math.sin(rot)), Math.round(-x! * Math.sin(rot) + z! * Math.cos(rot))]);
  const same = (a: number[][], b: number[][]) => a.length === b.length && a.every(([x, z]) => b.some(([x2, z2]) => x === x2 && z === z2));
  const fit = (shape: 'straight' | 'bend' | 'tee' | 'end', base: number[][]) => {
    for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (same(turned(base, rot), dirs)) return { shape, rot, straightRot };
    return null;
  };
  if (dirs.length === 4) return { shape: 'cross', rot: 0, straightRot };
  return (
    fit('straight', [[0, 1], [0, -1]]) ??
    fit('tee', [[0, 1], [0, -1], [1, 0]]) ??
    fit('bend', [[0, 1], [1, 0]]) ??
    fit('end', [[0, 1]]) ?? { shape: 'straight', rot: straightRot, straightRot }
  );
}

/**
 * A courier's way out from the gate: over the bridge, a stop at the barrier for
 * the toll, up the avenue (round the tower past the plaza), then one step to
 * the building's door (a stop there to hand over the goods); for someone outside
 * the town, to the plaza's near side.
 */
export function routeTo(avenue: Avenue, building: BuildingPlacement | null): Waypoint[] {
  const start: Waypoint[] = [{ ...GATE_AT }, { ...TOLL_STOP, stop: 'toll' }];
  // someone outside the town (a protocol without a building, another person): up the avenue and out at its far end
  const [turnIn, turnOut] = plazaRows(avenue);
  const roundTower: Waypoint[] = [
    { x: 0, z: turnIn },
    { x: -TOWER_CLEAR, z: turnIn },
    { x: -TOWER_CLEAR, z: turnOut },
    { x: 0, z: turnOut },
  ];
  if (!building) return [...start, ...roundTower, { x: 0, z: avenue.out ?? avenue.end, stop: 'hand-over' }];
  const z = building.door.z;
  return [...start, ...(z > avenue.plazaEnd ? roundTower : []), { x: 0, z }, { x: building.door.x, z, stop: 'hand-over' }];
}

/**
 * The town's props and life, the same every time: lanterns along the avenue, a
 * well and benches on the plaza, stalls and a cart at the town's front, crates
 * and barrels by them, flowers at the border post, a fence along the moat's
 * edge; a flag on each wallet tower; lilies, reeds and ducks on the moat;
 * chickens, a cat and a dog about town, a horse by the gate. Kept clear of the
 * paths and the buildings' plots (plan tests check).
 */
function planDecor(towers: readonly Placement[], tower: Placement, avenue: Avenue, town: { x0: number; x1: number }, doors: readonly number[], moat: Rect): Placement[] {
  const d = (name: string, x: number, z: number, rot = 0): Placement => ({ name, x, z, rot, optional: true, key: 'decor' });
  const out: Placement[] = [];
  // lanterns either side of the avenue, every 6 m, never on a door's step or in the plaza
  for (let z = 5; z < avenue.end - 1; z += 6) {
    if (z > avenue.plazaStart - 1 && z < avenue.plazaEnd + 1) continue;
    if (doors.some((d) => Math.abs(d - z) < 1.5)) continue; // a door's step
    for (const x of [-0.95, 0.95]) out.push(d('prop.lamp', x, z));
  }
  // the plaza: the well and benches on the side the avenue does not take
  out.push(d('prop.well', 4, tower.z), d('prop.bench', 4, tower.z - 3, Math.PI / 2), d('prop.bench', 4, tower.z + 3, Math.PI / 2));
  // the town's front, either side of the avenue
  out.push(d('prop.market.stall', -6.5, 3, Math.PI / 2), d('prop.market.stall', 6, 3, -Math.PI / 2), d('prop.cart', 3.5, 4.2, 0.4));
  out.push(d('prop.crate', -8.2, 2.2), d('prop.barrel', -8.3, 3.4), d('prop.crate', 8, 2), d('prop.barrel', 8.4, 3.1), d('prop.barrel', 7.7, 4.2));
  out.push(d('prop.flowers', -2.2, 4.3), d('prop.flowers', 2.2, 1.2));
  // a fence along the moat's edge, gaps left for the avenue
  for (let x = Math.ceil(town.x0) + 0.5; x < town.x1; x += 1) if (Math.abs(x) > 1.5) out.push(d('prop.fence.segment', x, 0.4));
  // a flag on each wallet tower (the tower is 3 m tall)
  for (const t of towers) out.push({ ...d('castle.flag', t.x, t.z), key: 'flag' });
  // the moat: lilies and ducks on the water, reeds at its edges
  out.push(d('moat.lily', moat.x0 + 1, -6), d('moat.lily', moat.x1 - 1, -11), d('moat.lily', 4, moat.z0 + 1), d('moat.lily', -6, -1));
  out.push(d('moat.reeds', moat.x0 + 0.4, -12), d('moat.reeds', moat.x1 - 0.4, -3), d('moat.reeds', -3, moat.z0 + 0.4), d('moat.reeds', 7, -0.4));
  out.push(d('animal.duck', moat.x0 + 1, -9, 1.2), d('animal.duck', 6.5, -1, -0.5), d('animal.duck', 0, moat.z0 + 1, 2.5));
  // about town
  out.push(d('animal.chicken', 5.2, 5, 0.8), d('animal.chicken', 6.6, 5.4, 2.4), d('animal.chicken', -5.4, 5.2, 4));
  out.push(d('animal.cat', 5.5, tower.z + 1, 1.1), d('animal.dog', 2.8, 2.2, -1.2), d('animal.horse', -5, 0.9, Math.PI / 2));
  return out;
}

/**
 * Scenery round the edges, the same every time: hills behind the castle, a band
 * of oaks and pines down both sides, rocks between them. Nothing on the moat or
 * in the town. Positions jitter by a fixed hash so the woods do not look planted.
 */
function planScenery(town: { x0: number; x1: number; z1: number }, MOAT: Rect): Placement[] {
  const out: Placement[] = [
    { name: 'scenery.hill', x: -16, z: -28 },
    { name: 'scenery.hill', x: 6, z: -30, rot: 1.1 },
    { name: 'scenery.hill', x: 22, z: -20, rot: 2.3 },
  ];
  const jitter = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1; // 0…1, fixed per index
  let i = 0;
  for (const side of [-1, 1]) {
    for (let z = MOAT.z0 - 2; z <= town.z1; z += 2.5) {
      // beside the castle the woods come close; beside the town they stand past its widest plot
      // (a tree may stand up to 1.5 m further along than its row: a row that reaches into the town counts as the town's)
      const edge = z + 2 < 0 ? MOAT.x1 : Math.max(MOAT.x1, side < 0 ? -town.x0 : town.x1);
      for (const lane of [0, 1]) {
        i++;
        const x = side * (edge + 2 + lane * 2.5 + jitter(i) * 1.2);
        out.push({ name: jitter(i + 7) < 0.55 ? 'scenery.tree.oak' : 'scenery.tree.pine', x: round(x), z: round(z + jitter(i + 3) * 1.5), rot: round(jitter(i + 5) * Math.PI * 2) });
      }
      if (jitter(i + 11) < 0.3) out.push({ name: `scenery.rock.${1 + Math.floor(jitter(i + 13) * 3)}`, x: round(side * (edge + 1)), z: round(z + 1), rot: round(jitter(i + 17) * 6) });
    }
  }
  // Behind the castle, between the hills.
  for (let x = MOAT.x0; x <= MOAT.x1; x += 3) {
    i++;
    out.push({ name: jitter(i) < 0.5 ? 'scenery.tree.pine' : 'scenery.tree.oak', x: round(x + jitter(i + 2)), z: round(MOAT.z0 - 2.5 - jitter(i + 4) * 2), rot: round(jitter(i + 6) * 6) });
  }
  out.push(...planWorld(town, MOAT, jitter));
  return out;
}

/**
 * The world beyond the woods (docs/batches/14-world-and-sky.md), shown as its
 * models arrive (optional: no standins): mountains behind the castle; to the
 * west farmland (fields, a farmstead, a windmill) and a travellers' camp; to the
 * east a river running down to a lake, a stone bridge where the road leaves
 * town; forest patches and meadows between; a ruin on the castle's flank.
 */
function planWorld(town: { x0: number; x1: number; z1: number }, MOAT: Rect, jitter: (i: number) => number): Placement[] {
  const o = (name: string, x: number, z: number, rot = 0): Placement => ({ name, x: round(x), z: round(z), rot: round(rot), optional: true });
  const out: Placement[] = [];
  const west = Math.min(MOAT.x0, town.x0) - 9;
  const east = Math.max(MOAT.x1, town.x1) + 9;
  const north = MOAT.z0 - 8;
  const south = town.z1;
  // mountains: a ridge behind the castle and its shoulders
  [-95, -50, -5, 40, 85].forEach((x, k) => out.push(o(`scenery.mountain.${(k % 3) + 1}`, x + jitter(300 + k) * 12, north - 55 - jitter(310 + k) * 25, jitter(320 + k) * 6)));
  out.push(o('scenery.mountain.2', west - 60, north + 10, 1.2), o('scenery.mountain.3', east + 60, north + 5, 2.4));
  // the castle's flanks: a ruin on the east, forest on the west
  out.push(o('scenery.ruin', east + 6, north + 2, 0.6));
  out.push(o('scenery.forest.patch', west - 4, north + 4, 0.3), o('scenery.forest.patch', west - 16, north - 6, 1.9));
  // west: farmland down the town's side, the windmill on a rise, the camp at the forest's edge
  for (let z = 4, k = 0; z < south - 6; z += 14, k++) {
    out.push(o(k % 2 ? 'scenery.field.crops' : 'scenery.field.wheat', west - 8, z + 4, k % 2 ? 0 : Math.PI / 2));
    if (k % 2 === 0) out.push(o('scenery.meadow', west - 20, z + 7, jitter(330 + k) * 6));
  }
  out.push(o('scenery.farmhouse', west - 21, 12, Math.PI / 2), o('scenery.windmill', west - 22, 28, 0.4));
  out.push(o('scenery.camp', west - 8, south + 6, 0.8));
  out.push(o('scenery.forest.patch', west - 34, 0, 0.9), o('scenery.forest.patch', west - 34, south * 0.5, 2.1), o('scenery.forest.patch', west - 30, south - 2, 1.4));
  // east: the river from the hills down past the town into a lake, a bridge where the road leaves town
  const river = east + 14;
  for (let z = north - 12; z < south + 6; z += 6) out.push(o('scenery.river.straight', river, z + 3, 0));
  out.push(o('scenery.lake', river + 2, south + 16, 0));
  out.push(o('scenery.bridge.stone', river, Math.round((south * 0.5) / 6) * 6 + 3, Math.PI / 2));
  out.push(o('scenery.forest.patch', river + 16, 6, 0.4), o('scenery.forest.patch', river + 18, south * 0.6, 2.6), o('scenery.meadow', river + 9, south - 8, 1.1));
  // beyond the town's far end
  out.push(o('scenery.forest.patch', -14, south + 18, 1.0), o('scenery.forest.patch', 14, south + 20, 2.2), o('scenery.meadow', 0, south + 12, 0));
  return out;
}

/** The Wayfarers' Gate: its door empty this far in front of its middle (towards the town), the road beyond starting this far behind it, and that road's length. */
const GATE_DOOR = 2;
const GATE_BACK = 2;
const ROAD_BEYOND = 12;

/** The toll line: the booth beside the road, the barrier across it. */
export const TOLL_Z = 2.5;
/** Where a courier stops at the barrier to pay. */
export const TOLL_STOP = { x: 0, z: TOLL_Z - 0.7 } as const;
/** The barrier's post, left of the road; its 2 m arm reaches across. */
export const BARRIER_POST_X = -1.1;
/** Where a building's person stands to meet a visitor: this share of the way from the door point back to the front wall… */
const NPC_IN = 0.35;

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clampTier(t: number): number {
  return Math.max(0, Math.min(6, Math.round(t)));
}
