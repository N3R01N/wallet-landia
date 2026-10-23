/**
 * The castle asset manifest: every asset name the game asks for, with its
 * size, clips, attach points and the standin shown until the real model
 * exists. The spec is docs/ASSET_SPEC.md; this file is the same list as data,
 * so the gallery, the tests and the castle view all read one place.
 *
 * Names are a contract: a theme provides a file for each name, or the standin
 * is shown instead.
 */

export type AssetKind = 'model' | 'art' | 'fx';

export type StandinShape = 'box' | 'cylinder' | 'capsule' | 'sphere' | 'cone' | 'plane';

export interface Standin {
  shape: StandinShape;
  /** Hex colour. Tierable assets take their tier colour instead (see tierColor). */
  color: string;
  /**
   * Moves the standin so its origin matches the spec's pivot (e.g. the
   * drawbridge pivots at its hinge, so its deck starts at x = 0).
   */
  offset?: [number, number, number];
}

export interface AssetSpec {
  /** The contract name, e.g. `castle.keep.t0`. */
  name: string;
  kind: AssetKind;
  /** Required for the prototype (R in the spec); otherwise optional (O). */
  required: boolean;
  /** Metres for models (width, depth, height); pixels for art and fx ([w, h, 0]). */
  size: [number, number, number];
  clips?: readonly string[];
  attach?: readonly string[];
  standin: Standin;
  note: string;
  /** The value tier this asset belongs to, if it is tierable. */
  tier?: number;
}

export const TIER_NAMES = ['Dust', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;

/** The tier trim colours from docs/ASSET_SPEC.md §1.3. */
export const TIER_COLORS = ['#8a8a8a', '#e8e8e8', '#4caf50', '#3f7fd6', '#8e4bd1', '#e8843a', '#c9a24a'] as const;

export function tierColor(tier: number): string {
  return TIER_COLORS[Math.max(0, Math.min(TIER_COLORS.length - 1, tier))] ?? TIER_COLORS[0];
}

/** Folder and file name for a contract name: the first word is the folder, the rest is the file. */
export function assetFolder(name: string): string {
  return name.split('.')[0] ?? name;
}

export function assetStem(name: string): string {
  return name.slice(assetFolder(name).length + 1);
}

/** The path of an asset's file, relative to the theme folder. */
export function assetPath(spec: Pick<AssetSpec, 'name' | 'kind'>): string {
  const folder = assetFolder(spec.name);
  const stem = assetStem(spec.name);
  if (spec.kind === 'model') return `models/${folder}/${stem}.glb`;
  // 2D art: icons, badges and ranks are SVG; the fx sprites are PNG.
  if (spec.kind === 'fx') return `art/${folder}/${stem}.png`;
  return `art/${folder}/${stem}.svg`;
}

/** Tiers 0–6, with the given tiers required. Other tiers are optional. */
function tiered(
  base: string,
  required: readonly number[],
  build: (tier: number, name: string) => Omit<AssetSpec, 'name' | 'tier' | 'required'>,
): AssetSpec[] {
  return Array.from({ length: 7 }, (_, tier) => {
    const name = `${base}.t${tier}`;
    return { name, tier, required: required.includes(tier), ...build(tier, name) } as AssetSpec;
  });
}

// Models in the spec's order (§3). Sizes and clips are the spec's numbers.

/** Keep footprint (width = depth) and height by tier: the spec's sizes at t0 (4×4×5), t3 (6×6×10) and t6 (8×8×14). */
const KEEP_WIDTH = [4, 4.67, 5.33, 6, 6.67, 7.33, 8] as const;
const KEEP_HEIGHT = [5, 6.67, 8.33, 10, 11.33, 12.67, 14] as const;

const KEEP = tiered('castle.keep', [0, 3, 6], (t) => ({
  kind: 'model',
  size: [KEEP_WIDTH[t] ?? 4, KEEP_WIDTH[t] ?? 4, KEEP_HEIGHT[t] ?? 5],
  standin: { shape: 'box', color: tierColor(t) },
  note: 'The main keep. Gate arch on the front (+Z). Tier shows in the roof and trim.',
}));

/** The wallet halls by tier (docs/batches/17-wallet-halls.md): what each is and its height to the top (m). */
export const HALL_KIND = ['lean-to', 'cottage', 'townhouse', 'stone hall', 'tower house', 'great tower', 'palace spire'] as const;
const HALL_HEIGHT = [4.4, 5.4, 6.6, 7.6, 9, 10.5, 12] as const;

const WING_CATEGORIES = ['lending', 'staking', 'dex', 'nft', 'governance', 'other'] as const;

const CASTLE: AssetSpec[] = [
  ...KEEP,
  { name: 'castle.wall.segment', kind: 'model', required: true, size: [1, 0.3, 3], standin: { shape: 'box', color: '#a8a193' }, note: 'One metre of curtain wall, tileable along X.' },
  { name: 'castle.wall.corner', kind: 'model', required: true, size: [1, 1, 3], standin: { shape: 'box', color: '#a8a193' }, note: 'Corner piece meeting two segments.' },
  { name: 'castle.gatehouse', kind: 'model', required: true, size: [4, 4, 6], standin: { shape: 'box', color: '#6b675f' }, note: 'Gate tower over the drawbridge, arch on +Z.' },
  { name: 'castle.tower.wallet', kind: 'model', required: true, size: [1.6, 1.6, 3], standin: { shape: 'cylinder', color: '#a8a193' }, note: 'One round tower per wallet on the walls.' },
  ...tiered('castle.tower.wallet', [], (t) => ({
    kind: 'model',
    size: [1.6, 1.6, 3],
    standin: { shape: 'cylinder', color: tierColor(t) },
    note: 'Tier variant: roof and trim only.',
  })),
  ...WING_CATEGORIES.map(
    (cat): AssetSpec => ({
      name: `castle.wing.${cat}`,
      kind: 'model',
      required: true,
      size: [4, 3, 3],
      standin: { shape: 'box', color: '#8a7f6a' },
      note: `Wing for ${cat} protocols.`,
    }),
  ),
  // the v2 castle (castle layout 2, docs/batches/01-castle-core.md): one model each, tiers as `tier.N` parts
  { name: 'castle.keep', kind: 'model', required: false, size: [8, 5.5, 13], clips: ['idle', 'tap'], standin: { shape: 'box', color: '#8a8478' }, note: 'v2 keep against the back wall; tiers as tier.2/4/6 parts.' },
  { name: 'castle.hall.wallet', kind: 'model', required: false, size: [4, 4, 7], clips: ['idle', 'tap'], attach: ['door'], standin: { shape: 'box', color: '#a8a193' }, note: 'v2: a wallet’s hall built into the curtain wall; its crest on the Tint banners; tiers as tier.2/4/6 parts.' },
  // one hall per wealth tier, each its own building (docs/batches/17-wallet-halls.md); the same slot and wall line
  ...tiered('castle.hall.wallet', [], (t) => ({
    kind: 'model',
    size: [4, 4, HALL_HEIGHT[t]!],
    clips: ['idle', 'tap'],
    attach: ['door'],
    standin: { shape: 'box', color: tierColor(t) },
    note: `v2: a wallet's hall at tier ${t} (${HALL_KIND[t]}); crest on Tint, tier colour on Trim.`,
  })),
  { name: 'castle.storehouse', kind: 'model', required: true, size: [2, 2, 2], standin: { shape: 'box', color: '#b9925a' }, note: 'Crates and sacks. Holds tokens with no protocol.' },
  {
    name: 'castle.banner',
    kind: 'model',
    required: true,
    size: [1, 0.05, 1.5],
    clips: ['wave'],
    standin: { shape: 'box', color: '#8a3b32', offset: [0, 0.75, 0] },
    note: 'Guild banner. Tint on the front face. Pivot at the top centre.',
  },
  {
    name: 'castle.tollbooth',
    kind: 'model',
    required: true,
    size: [2, 2, 2.5],
    attach: ['sign'],
    standin: { shape: 'box', color: '#8a7f6a' },
    note: 'Border post between the drawbridge and the town. Pays the transaction fee.',
  },
  {
    name: 'castle.tollbooth.barrier',
    kind: 'model',
    required: true,
    size: [2, 0.1, 0.1],
    clips: ['lift', 'drop'],
    standin: { shape: 'box', color: '#e8e8e8', offset: [1, 0, 0] },
    note: 'Barrier arm. Pivots at its post (the end at the booth). Rest pose: down.',
  },
];

const MOAT_AND_BRIDGE: AssetSpec[] = [
  { name: 'moat.water', kind: 'model', required: true, size: [2, 2, 0.1], standin: { shape: 'box', color: '#2f6f8f' }, note: 'Flat water tile, tileable.' },
  { name: 'moat.edge', kind: 'model', required: true, size: [1, 0.3, 0.2], standin: { shape: 'box', color: '#6b675f' }, note: 'Stone lip, tileable along X.' },
  {
    name: 'bridge.drawbridge',
    kind: 'model',
    required: true,
    size: [3, 2, 0.2],
    clips: ['lower', 'raise'],
    attach: ['hinge'],
    // 3 m wide (x), 2 m long from the hinge towards the town (+z), as the delivered model
    standin: { shape: 'box', color: '#6b4a2b', offset: [0, 0, 1] },
    note: 'Deck of the bridge: 3 m wide, 2 m from the hinge towards the town (+Z). Pivots at its hinge. Rest pose: raised.',
  },
  { name: 'bridge.chain', kind: 'model', required: false, size: [0.1, 0.1, 1.5], standin: { shape: 'cylinder', color: '#8a8a8a' }, note: 'Raising chain for the drawbridge.' },
];

const TOWN: AssetSpec[] = [
  { name: 'town.ground', kind: 'model', required: true, size: [2, 2, 0.05], standin: { shape: 'box', color: '#5b7a4a' }, note: 'Town ground tile, tileable.' },
  {
    name: 'town.tower.chronicle',
    kind: 'model',
    required: true,
    size: [3, 3, 10],
    attach: ['hinge'],
    standin: { shape: 'cylinder', color: '#a8a193' },
    note: 'The Chronicle tower in the middle of the town. Rings on every block.',
  },
  {
    name: 'town.tower.bell',
    kind: 'model',
    required: true,
    size: [0.6, 0.6, 0.6],
    clips: ['ring'],
    standin: { shape: 'sphere', color: '#c9a24a' },
    note: 'The bell. Pivots at its yoke. Swings on ring.',
  },
  // batch 24 (docs/batches/24-wayfarers-gate.md): where things from outside the town come in
  {
    name: 'town.gate',
    kind: 'model',
    required: false,
    size: [6.4, 2.6, 8.7],
    attach: ['door', 'npc', 'sign'],
    clips: ['idle', 'open', 'close', 'tap'],
    standin: { shape: 'box', color: '#9a8c76' },
    note: "The Wayfarers' Gate across the avenue's far end, its front to the town; doors open outwards onto mist.",
  },
  { name: 'scenery.road.beyond', kind: 'model', required: false, size: [10, 12, 3], clips: ['idle'], standin: { shape: 'box', color: '#c9b48a' }, note: 'The road leaving town through the gate, into fog banks and haze.' },
  // batch 25 (docs/batches/25-ember-furnace.md): where burned goods go
  {
    name: 'town.furnace',
    kind: 'model',
    required: false,
    size: [5, 5, 8.4],
    attach: ['door', 'npc', 'mouth', 'sign'],
    clips: ['idle', 'roar', 'tap'],
    standin: { shape: 'cylinder', color: '#9a8c76' },
    note: 'The Ember Furnace: a bottle kiln, the goods thrown into its mouth. Class M, tier parts by what was burned.',
  },
  { name: 'path.tile.straight', kind: 'model', required: true, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'Path across.' },
  { name: 'path.tile.corner', kind: 'model', required: true, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'Path bend, 90°.' },
  { name: 'path.tile.junction', kind: 'model', required: true, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'Three-way path.' },
  // v2 path shapes (docs/batches/18-path-tiles.md): the game picks one per cell from its neighbours
  { name: 'path.tile.bend', kind: 'model', required: false, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'v2: a 90° turn, open to +z and +x.' },
  { name: 'path.tile.tee', kind: 'model', required: false, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'v2: a branch, open to +z, −z and +x.' },
  { name: 'path.tile.cross', kind: 'model', required: false, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'v2: a crossing, open on all four sides.' },
  { name: 'path.tile.end', kind: 'model', required: false, size: [1, 1, 0.02], standin: { shape: 'plane', color: '#c9b48a' }, note: 'v2: where a path ends, open to +z only.' },
  { name: 'path.tile.lit', kind: 'model', required: true, size: [1, 1, 0.01], standin: { shape: 'plane', color: '#ffd166' }, note: 'Glow overlay on any path tile.' },
];

const BUILDING_CATEGORIES: { cat: string; note: string }[] = [
  { cat: 'lending', note: 'Counting house, a small bank.' },
  { cat: 'dex', note: 'Market stall, then a trading hall.' },
  { cat: 'staking', note: 'Granary with thatch and sacks.' },
  { cat: 'nft', note: 'Gallery with tall windows.' },
  { cat: 'governance', note: 'Council hut, then a council hall.' },
  { cat: 'bridge', note: 'Harbour shed, then a harbour house.' },
  { cat: 'other', note: 'Plain shop.' },
];

const BUILDINGS: AssetSpec[] = BUILDING_CATEGORIES.flatMap(({ cat, note }) =>
  tiered(`building.category.${cat}`, [0, 3], (t) => ({
    kind: 'model',
    size: [2, 2, 2 + t * 0.5],
    attach: ['door', 'sign'],
    standin: { shape: 'box', color: tierColor(t) },
    note: `${note} Door on the front; the sign above it.`,
  })),
);

/** The size classes (docs/STYLEGUIDE_V2.md §3), by the footprint's side in metres. */
export const SIZE_CLASSES = [
  { id: 'xs', footprint: 2, height: [3, 4] },
  { id: 's', footprint: 3, height: [5, 7] },
  { id: 'm', footprint: 5, height: [8, 11] },
  { id: 'l', footprint: 8, height: [12, 16] },
  { id: 'xl', footprint: 12, height: [18, 24] },
] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number]['id'];

/** A footprint's size class: the nearest class (in log terms: 2.6 m is still XS, 2.8 m S). */
export function sizeClassOf(footprint: number): SizeClass {
  let best: SizeClass = 'xs';
  let gap = Infinity;
  for (const c of SIZE_CLASSES) {
    const g = Math.abs(Math.log(footprint / c.footprint));
    if (g < gap) {
      gap = g;
      best = c.id;
    }
  }
  return best;
}

/** v2: one category building per size class, its tiers as `tier.N` parts (docs/STYLEGUIDE_V2.md §7). */
const BUILDINGS_V2: AssetSpec[] = BUILDING_CATEGORIES.flatMap(({ cat, note }) =>
  SIZE_CLASSES.map(
    (c): AssetSpec => ({
      name: `building.category.${cat}.${c.id}`,
      kind: 'model',
      required: false,
      size: [c.footprint, c.footprint, c.height[1]],
      clips: ['idle', 'tap'],
      attach: ['door', 'sign'],
      standin: { shape: 'box', color: '#a8a193' },
      note: `${note} Size class ${c.id.toUpperCase()}; tiers as tier.2/4/6 parts.`,
    }),
  ),
);

const DORMANT: AssetSpec = {
  name: 'building.dormant',
  kind: 'model',
  required: false,
  size: [1, 1, 0.5],
  standin: { shape: 'box', color: '#d9d4c8' },
  note: 'Cobweb overlay for dormant buildings.',
};

const PEOPLE: AssetSpec[] = [
  {
    name: 'courier.base',
    kind: 'model',
    required: true,
    size: [0.6, 0.4, 1.7],
    clips: ['idle', 'walk', 'hand-over', 'toll'],
    standin: { shape: 'capsule', color: '#f5f2ea', offset: [0, 0.85, 0] },
    note: 'The transaction figure: a traveller with a satchel.',
  },
  ...tiered('courier.cargo', [0, 3, 6], (t) => ({
    kind: 'model',
    size: [0.4, 0.4, 0.4],
    standin: { shape: 'box', color: tierColor(t) },
    note: 'Cargo: a pouch, a sack, then a chest.',
  })),
  {
    name: 'person.npc.base',
    kind: 'model',
    required: true,
    size: [0.6, 0.4, 1.7],
    clips: ['idle', 'emerge', 'receive', 'return'],
    standin: { shape: 'capsule', color: '#8a6a4a', offset: [0, 0.85, 0] },
    note: 'A townsperson at a building door.',
  },
  ...['lending', 'dex', 'staking', 'nft', 'governance', 'bridge', 'other'].map(
    (cat): AssetSpec => ({
      name: `person.npc.${cat}`,
      kind: 'model',
      required: false,
      size: [0.6, 0.4, 1.7],
      clips: ['idle', 'emerge', 'receive', 'return'],
      standin: { shape: 'capsule', color: '#8a6a4a', offset: [0, 0.85, 0] },
      note: `Townsperson for ${cat} buildings.`,
    }),
  ),
  {
    name: 'person.npc.stranger',
    kind: 'model',
    required: false,
    size: [0.6, 0.4, 1.75],
    clips: ['idle', 'emerge', 'give', 'receive', 'return', 'tap'],
    standin: { shape: 'capsule', color: '#4b3f6b', offset: [0, 0.85, 0] },
    note: "The hooded wayfarer at the Wayfarers' Gate: props prop.sack, prop.chest, prop.lantern; Tint by what came from outside.",
  },
  {
    name: 'person.npc.furnace',
    kind: 'model',
    required: false,
    size: [0.6, 0.4, 1.75],
    clips: ['idle', 'emerge', 'receive', 'cast', 'return', 'tap'],
    standin: { shape: 'capsule', color: '#8a6a4a', offset: [0, 0.85, 0] },
    note: 'The stoker at the Ember Furnace: takes the goods with tongs and casts them into the fire.',
  },
  {
    name: 'person.guard',
    kind: 'model',
    required: false,
    size: [0.6, 0.4, 1.7],
    clips: ['idle', 'walk'],
    standin: { shape: 'capsule', color: '#7a7a80', offset: [0, 0.85, 0] },
    note: 'Guard at the drawbridge.',
  },
];

const FX: AssetSpec[] = [
  { name: 'fx.bell.ring', kind: 'fx', required: true, size: [256, 256, 0], standin: { shape: 'sphere', color: '#ffd166' }, note: 'Ring wave around the tower.' },
  { name: 'fx.dust', kind: 'fx', required: true, size: [128, 128, 0], standin: { shape: 'sphere', color: '#d9cdb0' }, note: 'Dust puff on arrival.' },
  { name: 'fx.coins', kind: 'fx', required: true, size: [128, 128, 0], standin: { shape: 'sphere', color: '#c9a24a' }, note: 'Coins for tolls and exchanges.' },
  { name: 'fx.splash', kind: 'fx', required: false, size: [128, 128, 0], standin: { shape: 'sphere', color: '#9fd3e8' }, note: 'Moat splash at the drawbridge.' },
  { name: 'fx.cobweb', kind: 'fx', required: false, size: [256, 256, 0], standin: { shape: 'sphere', color: '#e6e1d6' }, note: 'Cobweb overlay.' },
];

/**
 * Siege of the Ledger's models (docs/batches/19-siege-units-pilot.md, 20-siege-dressing.md):
 * one rigged unit per unit type (src/game/data/units.json), and the capture markers.
 */
export const UNIT_MODELS = [
  'titan.bitcoin', 'paladin.eth', 'paladin.staked', 'lancer.lido', 'archer.oracle', 'mage.swap', 'lender.ghost', 'warden.vault',
  'rider.name', 'pack.shiba', 'swarm.frog', 'knight', 'mage.battle', 'archer.scout', 'swarm.goblin', 'golem.stone', 'construct', 'militia',
] as const;
export const UNIT_CLIPS = ['idle', 'walk', 'attack', 'hit', 'death', 'cheer'] as const;

const SIEGE: AssetSpec[] = [
  ...UNIT_MODELS.map(
    (id): AssetSpec => ({
      name: `unit.${id}`,
      kind: 'model',
      required: false,
      size: id.startsWith('titan') || id.startsWith('golem') ? [1.6, 1.2, 3.5] : id.startsWith('swarm') || id.startsWith('pack') ? [0.6, 0.8, 0.9] : [0.7, 0.5, 1.75],
      clips: UNIT_CLIPS,
      standin: { shape: 'capsule', color: '#8a7a6a', offset: [0, 0.85, 0] },
      note: 'A siege unit, drawn instanced by the hundred: everything skinned, clips in place, Tint = team colour.',
    }),
  ),
  // batch 23 (docs/batches/23-siege-vfx.md): the battle's effects
  { name: 'fx.hit.spark', kind: 'model', required: false, size: [0.5, 0.5, 0.5], clips: ['pop'], standin: { shape: 'sphere', color: '#fff2a8' }, note: 'A melee hit; ends invisible.' },
  { name: 'fx.arrow', kind: 'model', required: false, size: [0.05, 0.8, 0.05], standin: { shape: 'box', color: '#7a5233' }, note: 'An arrow in flight (+Z).' },
  { name: 'fx.bolt', kind: 'model', required: false, size: [0.4, 1, 0.4], clips: ['idle'], standin: { shape: 'sphere', color: '#f2d27a' }, note: 'A spell bolt in flight.' },
  { name: 'fx.puff', kind: 'model', required: false, size: [0.8, 0.8, 0.8], clips: ['pop'], standin: { shape: 'sphere', color: '#e6e3dc' }, note: 'A pop of puffs; ends invisible.' },
  { name: 'fx.detonation', kind: 'model', required: false, size: [5, 5, 3], clips: ['pop'], standin: { shape: 'sphere', color: '#f0a020' }, note: 'A liquidated squad blowing up; ends invisible.' },
  { name: 'fx.siege.impact', kind: 'model', required: false, size: [3, 3, 3], clips: ['pop'], standin: { shape: 'sphere', color: '#c9bba0' }, note: 'Survivors hitting a keep wall; ends invisible.' },
  { name: 'fx.lightning', kind: 'model', required: false, size: [2, 2, 12], clips: ['pop'], standin: { shape: 'cylinder', color: '#cfe6ff' }, note: 'The Slashing strike; ends invisible.' },
  { name: 'fx.capture.ring', kind: 'model', required: false, size: [2, 2, 0.02], standin: { shape: 'cylinder', color: '#d9a93a' }, note: 'Capture progress ring round a battlefield building: 24 segments seg.00…seg.23.' },
  { name: 'prop.banner.owner', kind: 'model', required: false, size: [0.8, 0.2, 3.2], clips: ['idle', 'tap'], standin: { shape: 'box', color: '#b84a32' }, note: 'The owner’s banner beside a captured building.' },
];

const ICONS = ['castle', 'town', 'badges', 'guild', 'bell', 'gas', 'close', 'settings', 'map'];
const BADGES = [
  'first-steps', 'barter', 'fountain', 'blessed', 'vault', 'borrower', 'paid', 'survived', 'keys', 'patron', 'seafarer',
  'harvest', 'favour', 'founder', 'council', 'generous', 'explorer', 'expedition', 'veteran', 'scarred', 'steward', 'hoard',
];
const NEW_BADGES = ['castle-builder', 'gatehouse-lord', 'gilded', 'full-moat', 'bridge-keeper'];
const RANKS = ['wanderer', 'squire', 'knight', 'captain', 'lord', 'legend'];

const UI: AssetSpec[] = [
  ...ICONS.map(
    (n): AssetSpec => ({ name: `ui.icon.${n}`, kind: 'art', required: true, size: [64, 64, 0], standin: { shape: 'box', color: '#c9a24a' }, note: `Icon: ${n}.` }),
  ),
  ...[0, 1, 2, 3, 4, 5, 6].map(
    (t): AssetSpec => ({ name: `ui.frame.t${t}`, kind: 'art', required: false, size: [256, 64, 0], standin: { shape: 'box', color: tierColor(t) }, tier: t, note: 'Bottom sheet frame in the tier colour.' }),
  ),
];

const BADGE_ART: AssetSpec[] = [...BADGES, ...NEW_BADGES].map(
  (id): AssetSpec => ({
    name: `badge.${id}`,
    kind: 'art',
    required: true,
    size: [128, 128, 0],
    standin: { shape: 'cylinder', color: '#c9a24a' },
    note: NEW_BADGES.includes(id) ? 'Proposed castle badge (not yet in the game).' : 'Medal in src/domain/feats.ts.',
  }),
);

const RANK_ART: AssetSpec[] = RANKS.map(
  (id): AssetSpec => ({ name: `rank.${id}`, kind: 'art', required: true, size: [128, 128, 0], standin: { shape: 'cylinder', color: '#8a7f6a' }, note: 'Rank shield.' }),
);

const SCENERY: AssetSpec[] = [
  { name: 'scenery.tree.oak', kind: 'model', required: false, size: [2, 2, 5], standin: { shape: 'cone', color: '#5b7a4a' }, note: 'Oak around the island.' },
  { name: 'scenery.tree.pine', kind: 'model', required: false, size: [1.5, 1.5, 5], standin: { shape: 'cone', color: '#3f5f3a' }, note: 'Pine around the island.' },
  ...[1, 2, 3].map(
    (n): AssetSpec => ({ name: `scenery.rock.${n}`, kind: 'model', required: false, size: [1, 1, 0.6], standin: { shape: 'box', color: '#8a8a80' }, note: 'Rock.' }),
  ),
  { name: 'scenery.hill', kind: 'model', required: false, size: [20, 20, 4], standin: { shape: 'cone', color: '#6b8a4a' }, note: 'Backdrop hill.' },
  // batch 14 (docs/batches/14-world-and-sky.md): the world around the town, and the clouds
  ...(['1', '2', '3'] as const).map((n): AssetSpec => ({ name: `scenery.mountain.${n}`, kind: 'model', required: false, size: [55, 55, 28], standin: { shape: 'cone', color: '#7d8a8f' }, note: 'Backdrop mountain.' })),
  { name: 'scenery.forest.patch', kind: 'model', required: false, size: [12, 12, 7], clips: ['idle'], standin: { shape: 'cone', color: '#4a6a3a' }, note: 'A clump of forest as one mesh.' },
  { name: 'scenery.field.wheat', kind: 'model', required: false, size: [10, 8, 0.8], clips: ['idle'], standin: { shape: 'box', color: '#d9b45a' }, note: 'Wheat field.' },
  { name: 'scenery.field.crops', kind: 'model', required: false, size: [10, 8, 0.6], standin: { shape: 'box', color: '#7a8a4a' }, note: 'Vegetable field.' },
  { name: 'scenery.farmhouse', kind: 'model', required: false, size: [6, 5, 6], clips: ['idle'], standin: { shape: 'box', color: '#b9925a' }, note: 'Farmstead.' },
  { name: 'scenery.windmill', kind: 'model', required: false, size: [5, 5, 11], clips: ['idle'], standin: { shape: 'cylinder', color: '#d8cdb8' }, note: 'Windmill; its sails turn.' },
  { name: 'scenery.river.straight', kind: 'model', required: false, size: [6, 6, 0.3], clips: ['idle'], standin: { shape: 'plane', color: '#3c8fb5' }, note: 'River tile.' },
  { name: 'scenery.river.bend', kind: 'model', required: false, size: [6, 6, 0.3], clips: ['idle'], standin: { shape: 'plane', color: '#3c8fb5' }, note: 'River bend tile.' },
  { name: 'scenery.bridge.stone', kind: 'model', required: false, size: [4, 8, 3], standin: { shape: 'box', color: '#a8a193' }, note: 'Stone bridge over the river.' },
  { name: 'scenery.ruin', kind: 'model', required: false, size: [6, 6, 8], standin: { shape: 'cylinder', color: '#8a8478' }, note: 'Old ruined watchtower.' },
  { name: 'scenery.camp', kind: 'model', required: false, size: [5, 5, 3], clips: ['idle'], standin: { shape: 'cone', color: '#b9925a' }, note: 'Travellers’ camp.' },
  { name: 'scenery.meadow', kind: 'model', required: false, size: [8, 8, 0.4], clips: ['idle'], standin: { shape: 'plane', color: '#8fb35a' }, note: 'Wild flowers.' },
  { name: 'scenery.lake', kind: 'model', required: false, size: [16, 12, 0.3], clips: ['idle'], standin: { shape: 'plane', color: '#3c8fb5' }, note: 'Small lake.' },
  ...(['1', '2', '3', 'rain'] as const).map((n): AssetSpec => ({ name: `scenery.cloud.${n}`, kind: 'model', required: false, size: [12, 6, 4], standin: { shape: 'sphere', color: '#ffffff' }, note: 'Cloud floating over the scene.' })),
];

/** Signature buildings by protocol family (docs/ASSET_SPEC.md §3.10): one model each, no tiers. */
export const SIGNATURE_PROTOCOLS: Record<string, string> = {
  aave: 'lending',
  compound: 'lending',
  maker: 'lending',
  uniswap: 'dex',
  curve: 'dex',
  lido: 'staking',
  'rocket-pool': 'staking',
  eigenlayer: 'staking',
  opensea: 'nft',
  ens: 'governance',
  // second wave (docs/ASSET_SPEC.md §3.12)
  morpho: 'lending',
  spark: 'lending',
  fluid: 'lending',
  gondi: 'lending',
  pendle: 'staking',
  yearn: 'staking',
  balancer: 'dex',
  sushiswap: 'dex',
  '1inch': 'dex',
  cow: 'dex',
  blur: 'nft',
  across: 'bridge',
  // third wave (docs/ASSET_SPEC.md §3.15)
  ethena: 'staking',
  convex: 'staking',
  frax: 'lending',
  euler: 'lending',
  stargate: 'bridge',
  zora: 'nft',
  safe: 'governance',
  paraswap: 'dex',
  kyber: 'dex',
  lifi: 'bridge',
};

const SIGNATURES: AssetSpec[] = Object.entries(SIGNATURE_PROTOCOLS).map(
  ([id, cat]): AssetSpec => ({
    name: `building.protocol.${id}`,
    kind: 'model',
    required: false,
    size: [2, 2, 4],
    attach: ['door', 'sign'],
    standin: { shape: 'box', color: '#b08a5a' },
    note: `Signature building for ${id} (${cat}). Falls back to the ${cat} category building.`,
  }),
);

const PROPS: AssetSpec[] = [
  { name: 'prop.lamp', kind: 'model', required: false, size: [0.3, 0.3, 2.4], standin: { shape: 'cylinder', color: '#3d3a40' }, note: 'Lantern post; the lantern glows at night.' },
  { name: 'prop.well', kind: 'model', required: false, size: [1.4, 1.4, 2], standin: { shape: 'cylinder', color: '#a8a193' }, note: 'Stone well with a roof.' },
  { name: 'prop.barrel', kind: 'model', required: false, size: [0.6, 0.6, 0.9], standin: { shape: 'cylinder', color: '#6b4a2b' }, note: 'Barrel.' },
  { name: 'prop.crate', kind: 'model', required: false, size: [0.7, 0.7, 0.7], standin: { shape: 'box', color: '#8a6a4a' }, note: 'Crate.' },
  { name: 'prop.cart', kind: 'model', required: false, size: [1.2, 2.2, 1.2], standin: { shape: 'box', color: '#6b4a2b' }, note: 'Hand cart, front +Z.' },
  { name: 'prop.fence.segment', kind: 'model', required: false, size: [1, 0.1, 0.9], standin: { shape: 'box', color: '#6b4a2b' }, note: 'Wooden fence, 1 m along X.' },
  { name: 'prop.bench', kind: 'model', required: false, size: [1.4, 0.5, 0.8], standin: { shape: 'box', color: '#6b4a2b' }, note: 'Bench.' },
  { name: 'prop.flowers', kind: 'model', required: false, size: [0.8, 0.4, 0.5], standin: { shape: 'box', color: '#5b7a4a' }, note: 'Flower box.' },
  { name: 'prop.market.stall', kind: 'model', required: false, size: [2, 1.5, 2.2], standin: { shape: 'box', color: '#8a3b32' }, note: 'Market stall with a Tint awning.' },
];

/**
 * Brand colours by protocol family, for the buildings' `Tint` material (a roof,
 * a sail, a sign plate). Approximations of each protocol's own colour; a
 * protocol not listed keeps the model's colour.
 */
export const BRAND_COLORS: Record<string, string> = {
  aave: '#b6509e',
  compound: '#00d395',
  maker: '#1aab9b',
  uniswap: '#ff007a',
  curve: '#3a6bd6',
  lido: '#00a3ff',
  'rocket-pool': '#ff6e30',
  eigenlayer: '#3a2ea0',
  opensea: '#2081e2',
  ens: '#5298ff',
  // the town's own places: the Ember Furnace's banner and its stoker's apron band, ember red
  'place:furnace': '#c2452d',
  morpho: '#2470ff',
  spark: '#f5a742',
  fluid: '#3f7bff',
  gondi: '#c9d94a',
  pendle: '#17c3b2',
  yearn: '#0657f9',
  balancer: '#3b3b3b',
  sushiswap: '#fa52a0',
  '1inch': '#2f4f87',
  cow: '#0f3d8c',
  blur: '#ff8700',
  across: '#4ed6b8',
  ethena: '#2c2c2c',
  convex: '#3a3cb3',
  frax: '#2b2b2b',
  euler: '#e2554b',
  stargate: '#9e9e9e',
  zora: '#5b5bf5',
  safe: '#12ff80',
  paraswap: '#2a6ef0',
  kyber: '#31cb9e',
  lifi: '#f7c2ff',
};

/** A protocol's brand colour (by its Zerion id), if known. */
export function brandColor(id: string): string | null {
  return BRAND_COLORS[protocolFamily(id)] ?? null;
}

/** Batch 6: life in town and on the moat, the wallet towers' flags, failure and celebration effects, app icons (docs/ASSET_SPEC.md §3.13). */
const LIFE: AssetSpec[] = [
  { name: 'animal.chicken', kind: 'model', required: false, size: [0.3, 0.4, 0.4], clips: ['idle', 'walk'], standin: { shape: 'sphere', color: '#f5f2ea' }, note: 'Chicken, pecking about.' },
  { name: 'animal.cat', kind: 'model', required: false, size: [0.25, 0.6, 0.35], clips: ['idle', 'walk', 'sit'], standin: { shape: 'capsule', color: '#3d3a40' }, note: 'Cat.' },
  { name: 'animal.dog', kind: 'model', required: false, size: [0.35, 0.8, 0.6], clips: ['idle', 'walk'], standin: { shape: 'capsule', color: '#8a6a4a' }, note: 'Dog.' },
  { name: 'animal.duck', kind: 'model', required: false, size: [0.3, 0.45, 0.3], clips: ['idle', 'swim'], standin: { shape: 'sphere', color: '#c9b48a' }, note: 'Duck on the moat; waterline at y = 0.' },
  { name: 'animal.horse', kind: 'model', required: false, size: [0.6, 2.2, 1.7], clips: ['idle', 'walk'], standin: { shape: 'capsule', color: '#6b4a2b' }, note: 'Horse in the paddock.' },
  // batch 16 (docs/batches/16-exchange.md): goods changing hands
  { name: 'fx.coin', kind: 'model', required: false, size: [0.22, 0.05, 0.22], standin: { shape: 'cylinder', color: '#f2c14e' }, note: 'A flying coin: Logo faces (the token), Trim rim (silver for stablecoins).' },
  { name: 'fx.nft.frame', kind: 'model', required: false, size: [0.5, 0.06, 0.6], standin: { shape: 'box', color: '#d9a93a' }, note: 'A carried NFT picture: Picture face (the NFT), origin at the handle grip.' },
  { name: 'fx.sparkle.burst', kind: 'model', required: false, size: [0.6, 0.6, 0.6], clips: ['pop'], standin: { shape: 'sphere', color: '#ffe08a' }, note: 'Stars burst where goods land; ends invisible.' },
  // batch 27 (docs/batches/27-tokens.md): tokens you can tell apart in flight
  { name: 'fx.eth', kind: 'model', required: false, size: [0.14, 0.14, 0.24], standin: { shape: 'sphere', color: '#627eea' }, note: 'ETH (and its wrappers) in flight: the 3D ETH diamond over its chevron, all Tint (the token colour).' },
  { name: 'fx.banknote', kind: 'model', required: false, size: [0.3, 0.04, 0.15], clips: ['flutter'], standin: { shape: 'box', color: '#2775ca' }, note: 'A stablecoin in flight: a folded note in Tint (the brand colour), the token icon on its Logo seal; flutter loops.' },
  { name: 'fx.ingot', kind: 'model', required: false, size: [0.2, 0.09, 0.06], standin: { shape: 'box', color: '#e8b440' }, note: 'Bitcoin (wrapped) in flight: a gold ingot (Trim), the token icon stamped on its Logo plate.' },
  // batch 28 (docs/batches/28-living-world.md): the town's occasions (scene/festive.ts)
  { name: 'prop.bunting', kind: 'model', required: false, size: [6, 0.2, 3.2], clips: ['idle'], standin: { shape: 'box', color: '#c9a24a' }, note: 'Pennants on a string between two poles (span along X), Tint and white; across the avenue for a rising market.' },
  { name: 'prop.lantern.festival', kind: 'model', required: false, size: [0.4, 0.4, 0.4], clips: ['idle'], standin: { shape: 'sphere', color: '#e07a5f' }, note: 'A paper lantern (Tint over a Glow heart), origin at its top: it hangs from the bunting.' },
  { name: 'fx.firework', kind: 'model', required: false, size: [4, 4, 4], clips: ['pop'], standin: { shape: 'sphere', color: '#ffd45a' }, note: 'A firework over the keep; origin at the burst, Glow tinted by the game; ends invisible.' },
  { name: 'prop.pumpkin', kind: 'model', required: false, size: [0.5, 0.5, 0.5], clips: ['idle'], standin: { shape: 'sphere', color: '#e8843a' }, note: 'A carved pumpkin by a door in late October; a Glow candle inside.' },
  { name: 'prop.snow', kind: 'model', required: false, size: [8, 8, 0.6], standin: { shape: 'cylinder', color: '#f5f7fa' }, note: 'Snow caps, nodes snow.s / snow.m / snow.l (3, 5, 8 m): on roofs (a building’s `snow` points, else its top) and the ground in December.' },
  { name: 'fx.snowfall', kind: 'model', required: false, size: [12, 12, 8], clips: ['idle'], standin: { shape: 'box', color: '#f5f7fa' }, note: 'Falling snow, a seamless loop; tiled over the view in December.' },
  { name: 'prop.crate.airdrop', kind: 'model', required: false, size: [0.8, 0.8, 0.8], clips: ['idle', 'open'], standin: { shape: 'box', color: '#8a6a4a' }, note: 'An airdrop’s crate at the Wayfarers’ Gate (Tint ribbon and parachute); `open` ends open.' },
  { name: 'fx.burn', kind: 'model', required: false, size: [1.2, 1.2, 2], clips: ['pop'], standin: { shape: 'sphere', color: '#f08a2a' }, note: 'Goods burned in the furnace: flame, embers and ash out of its mouth; ends invisible.' },
  // batch 28 (docs/batches/28-living-world.md): the castle grows with you
  { name: 'fx.scaffold', kind: 'model', required: false, size: [1, 1, 1], clips: ['rise', 'fall'], standin: { shape: 'box', color: '#a07a4c' }, note: 'Timber scaffolding round a piece that grew a tier (the game scales it to the piece); rise builds it up, fall takes it down to nothing.' },
  { name: 'fx.ribbon', kind: 'model', required: false, size: [2.4, 0.3, 1.6], clips: ['cut'], standin: { shape: 'plane', color: '#c0392b' }, note: 'A ribbon in Tint across two gilded posts, cut when a piece grew a tier; ends at scale 0.' },
  // batch 28 (docs/batches/28-living-world.md): secrets and rare moments (docs/ENGAGEMENT.md, track C)
  { name: 'person.npc.wanderer', kind: 'model', required: false, size: [0.6, 0.4, 1.75], clips: ['idle', 'tap', 'emerge'], standin: { shape: 'capsule', color: '#5a4a3a', offset: [0, 0.85, 0] }, note: 'The old wanderer by the ruin (a secret): shows for a guild whose first transaction is over five years old.' },
  { name: 'prop.monument', kind: 'model', required: false, size: [1.2, 1.2, 2.2], clips: ['idle', 'tap'], standin: { shape: 'box', color: '#9a9284' }, note: 'A monument on the plaza for a moment of Ethereum’s history the guild took part in: Logo plaque, Tint banner.' },
  { name: 'fx.shooting.star', kind: 'model', required: false, size: [0.5, 8, 0.5], clips: ['pop'], standin: { shape: 'sphere', color: '#fff2b0' }, note: 'A shooting star across the sky when a followed wallet moves: the star leads along +Z, its tail along −Z; ends invisible.' },
  // batch 30 (docs/batches/30-the-hack.md): a famous castle's story, the robbed building and the messages
  { name: 'fx.blast', kind: 'model', required: false, size: [4, 4, 4], clips: ['pop'], standin: { shape: 'sphere', color: '#f08a2a' }, note: 'A building is robbed: flash, fireball turning to smoke, shockwave ring, debris; ends invisible.' },
  { name: 'fx.fire', kind: 'model', required: false, size: [1, 1, 1.4], clips: ['idle'], standin: { shape: 'cone', color: '#f08a2a' }, note: 'Flames on a roof, a seamless loop; set on a ruin file’s fire.N points.' },
  { name: 'fx.smoke.column', kind: 'model', required: false, size: [2, 2, 6], clips: ['idle'], standin: { shape: 'cylinder', color: '#5a5a5a' }, note: 'A leaning column of dark smoke, a seamless loop; set on a ruin file’s smoke point.' },
  { name: 'prop.rubble', kind: 'model', required: false, size: [2.2, 2.2, 0.6], standin: { shape: 'box', color: '#7a6a5a' }, note: 'Rubble heaps, nodes rubble.s / rubble.m / rubble.l, at a robbed building’s foot.' },
  { name: 'fx.scorch', kind: 'model', required: false, size: [3, 3, 0.02], standin: { shape: 'cylinder', color: '#2a2622' }, note: 'A soot mark on the ground under a robbed building.' },
  { name: 'fx.ice', kind: 'model', required: false, size: [0.32, 0.32, 0.2], standin: { shape: 'box', color: '#cfe6ff' }, note: 'A block of ice with a coin in it: tokens their issuer froze.' },
  { name: 'prop.notice.board', kind: 'model', required: false, size: [2, 0.6, 2.2], clips: ['idle', 'pin'], standin: { shape: 'box', color: '#8a6a4a' }, note: 'The notice board at the gate: note.0–note.7 (scale 0 at rest) pinned as a famous castle’s messages arrive; pin taps a note on.' },
  // batch 15 (docs/batches/15-life.md)
  { name: 'person.tollkeeper', kind: 'model', required: false, size: [0.6, 0.4, 1.75], clips: ['idle', 'toll', 'tap', 'refuse'], standin: { shape: 'capsule', color: '#8a6a4a', offset: [0, 0.85, 0] }, note: 'The toll keeper at the booth.' },
  { name: 'animal.bird', kind: 'model', required: false, size: [0.35, 0.3, 0.15], clips: ['fly', 'glide', 'idle'], standin: { shape: 'sphere', color: '#f5f2ea' }, note: 'A bird; flocks over the town.' },
  { name: 'animal.crow', kind: 'model', required: false, size: [0.4, 0.3, 0.15], clips: ['fly', 'glide', 'idle'], standin: { shape: 'sphere', color: '#3d3a40' }, note: 'A crow.' },
  { name: 'animal.sheep', kind: 'model', required: false, size: [0.5, 1, 0.8], clips: ['idle', 'walk', 'tap'], standin: { shape: 'sphere', color: '#f5f2ea' }, note: 'Sheep.' },
  { name: 'animal.cow', kind: 'model', required: false, size: [0.7, 1.9, 1.4], clips: ['idle', 'walk', 'tap'], standin: { shape: 'capsule', color: '#8a6a4a' }, note: 'Cow.' },
  { name: 'animal.deer', kind: 'model', required: false, size: [0.4, 1.4, 1.5], clips: ['idle', 'walk', 'run'], standin: { shape: 'capsule', color: '#a07a4c' }, note: 'Deer at the forest edge.' },
  { name: 'animal.fish', kind: 'model', required: false, size: [0.1, 0.4, 0.15], clips: ['jump'], standin: { shape: 'sphere', color: '#e8843a' }, note: 'A fish jumping in the moat.' },
  { name: 'animal.butterfly', kind: 'model', required: false, size: [0.12, 0.1, 0.05], clips: ['fly'], standin: { shape: 'sphere', color: '#e8843a' }, note: 'A butterfly.' },
  { name: 'castle.flag', kind: 'model', required: false, size: [0.6, 0.02, 1.6], clips: ['wave'], standin: { shape: 'cylinder', color: '#8a3b32' }, note: 'Flag on top of a wallet tower, in the wallet’s crest colour (Tint).' },
  { name: 'moat.lily', kind: 'model', required: false, size: [0.5, 0.5, 0.05], standin: { shape: 'plane', color: '#5b7a4a' }, note: 'Lily pads with a flower.' },
  { name: 'moat.reeds', kind: 'model', required: false, size: [0.6, 0.4, 0.9], standin: { shape: 'cone', color: '#5b7a4a' }, note: 'Reeds at the moat’s edge.' },
  { name: 'fx.refused', kind: 'fx', required: false, size: [256, 256, 0], standin: { shape: 'sphere', color: '#b0473a' }, note: 'Red seal: a failed transaction, turned back at the barrier.' },
  { name: 'town.harbour.quay', kind: 'model', required: false, size: [6, 3, 0.6], standin: { shape: 'box', color: '#a8a193' }, note: 'Stone quay on the water: where crossings to other chains leave.' },
  { name: 'town.harbour.ship', kind: 'model', required: false, size: [1.6, 4, 4.5], clips: ['idle', 'sail'], standin: { shape: 'box', color: '#6b4a2b' }, note: 'A cog with a Tint sail in the realm’s colour; waterline at y = 0.' },
  { name: 'town.harbour.crane', kind: 'model', required: false, size: [1.5, 1.5, 4], clips: ['idle'], standin: { shape: 'cylinder', color: '#6b4a2b' }, note: 'Treadwheel crane on the quay.' },
  { name: 'town.harbour.buoy', kind: 'model', required: false, size: [0.4, 0.4, 0.8], clips: ['idle'], standin: { shape: 'cone', color: '#8a3b32' }, note: 'Channel buoy with a Tint band.' },
  { name: 'fx.rain', kind: 'fx', required: false, size: [256, 256, 0], standin: { shape: 'sphere', color: '#9fb4c8' }, note: 'Rain streaks, tileable vertically: a grey market.' },
  { name: 'fx.sparkle', kind: 'fx', required: false, size: [128, 128, 0], standin: { shape: 'sphere', color: '#e7c46b' }, note: 'Gold sparkles: a badge just earned.' },
  { name: 'app.icon.512', kind: 'fx', required: false, size: [512, 512, 0], standin: { shape: 'box', color: '#2b2a33' }, note: 'App icon, 512 px.' },
  { name: 'app.icon.192', kind: 'fx', required: false, size: [192, 192, 0], standin: { shape: 'box', color: '#2b2a33' }, note: 'App icon, 192 px.' },
  { name: 'app.icon.maskable', kind: 'fx', required: false, size: [512, 512, 0], standin: { shape: 'box', color: '#2b2a33' }, note: 'Maskable app icon: art in the central 80%.' },
];

/** Zerion's ids for the same protocol under another name. */
const PROTOCOL_ALIASES: Record<string, string> = { seaport: 'opensea', seadrop: 'opensea', 'cow-protocol': 'cow', 'cow-swap': 'cow', sky: 'maker', 'li-fi': 'lifi', 'gnosis-safe': 'safe', 'kyberswap': 'kyber', 'convex-finance': 'convex', 'frax-finance': 'frax', 'curve-finance': 'curve', 'curve-dex': 'curve', 'compound-finance': 'compound', 'ether.fi': 'etherfi', 'rocketpool': 'rocket-pool', eigencloud: 'eigenlayer', tokemak: 'autofinance' };

/**
 * The protocol family a Zerion dApp id belongs to, for its signature building:
 * the version suffix goes (`aave-v3` → `aave`), and known aliases map to one name.
 */
export function protocolFamily(id: string): string {
  const base = id.toLowerCase().replace(/-v\d+$/, '');
  return PROTOCOL_ALIASES[base] ?? base;
}

/** Every asset the castle view asks for, in the spec's order. */
export const ASSETS: readonly AssetSpec[] = [
  ...CASTLE,
  ...MOAT_AND_BRIDGE,
  ...TOWN,
  ...BUILDINGS,
  ...BUILDINGS_V2,
  ...SIGNATURES,
  DORMANT,
  ...PEOPLE,
  ...FX,
  ...UI,
  ...BADGE_ART,
  ...RANK_ART,
  ...SCENERY,
  ...PROPS,
  ...LIFE,
  ...SIEGE,
];

/**
 * Names to try for an asset, nearest first: the name itself, then for a tiered
 * name (`….t2`) the other tiers by distance, lower before higher at equal
 * distance. A theme that made only t0, t3 and t6 still shows a model for t2.
 */
export function tierFallbacks(name: string): string[] {
  const m = /^(.*)\.t(\d)$/.exec(name);
  if (!m) return [name];
  const stem = m[1]!;
  const tier = Number(m[2]);
  const out = [name];
  for (let d = 1; d <= 6; d++) {
    for (const t of [tier - d, tier + d]) if (t >= 0 && t <= 6) out.push(`${stem}.t${t}`);
  }
  return out;
}

export function findAsset(name: string): AssetSpec | undefined {
  const own = ASSETS.find((a) => a.name === name);
  if (own) return own;
  if (name.endsWith(RUIN)) {
    // a robbed building's damage (docs/batches/30-the-hack.md): `<asset>.ruin`, laid on it like the snow
    const base = ASSETS.find((a) => a.name === name.slice(0, -RUIN.length));
    return base?.kind === 'model' ? { name, kind: 'model', required: false, size: base.size, standin: base.standin, note: `The damage on ${base.name} when it is robbed.` } : undefined;
  }
  if (!name.endsWith(SNOW)) return undefined;
  // a piece's winter snow (docs/batches/29-winter.md): `<asset>.snow`, its own file beside the asset's, laid on it in December
  const base = ASSETS.find((a) => a.name === name.slice(0, -SNOW.length));
  return base?.kind === 'model' ? { name, kind: 'model', required: false, size: base.size, standin: base.standin, note: `The snow on ${base.name}'s roofs in winter.` } : undefined;
}

/** The suffix of a piece's winter snow file. */
export const SNOW = '.snow';
/** The suffix of a robbed building's damage file. */
export const RUIN = '.ruin';

/** The theme's folder under public/, where the design agent's files go (docs/ASSET_SPEC.md §1.9). */
export const THEME_DIR = 'themes/medieval-castle-v2';
