/**
 * Theme bundles (pack format 2): the `theme` block of a pack says how a whole
 * world looks — sky, materials by role, ground, building grammar parameters,
 * surroundings, and rigged characters with their mounts. Like the rest of a
 * pack it is data only: names, numbers, colours and relative file paths, all
 * validated; the code that turns it into a world is ours (docs/PACKS.md).
 *
 * A theme can `extend` another and override parts of it, so a variant needs
 * no copies of the parent's files.
 */

import { safePath } from './pack.js';

/** Surfaces the building grammar, terrain and props ask for. A theme gives each a material. */
export const MATERIAL_ROLES = [
  'plaster',
  'stone',
  'stoneDark',
  'timber',
  'planks',
  'roofTiles',
  'roofSlate',
  'thatch',
  'cobbles',
  'asphalt',
  'grass',
  'dirt',
  'cloth',
  'bark',
  'rock',
  'forestFloor',
  'glass',
  'fire',
  'iron',
  'gold',
] as const;
export type MaterialRole = (typeof MATERIAL_ROLES)[number];

export const SKY_IDS = ['day', 'sunset', 'night', 'overcast'] as const;
export const HERO_CLASSES = ['merchant', 'monk', 'paladin', 'bard', 'ranger', 'adventurer', 'sleeper'] as const;
export const MOUNT_TIERS = ['t2', 't3', 't4', 't5', 't6'] as const;
/** The building grammars and surroundings the game can build. */
export const STYLES = ['medieval', 'modern', 'scifi'] as const;
export type Style = (typeof STYLES)[number];
/** Vehicles built in code (no CC0 rigged vehicles exist); tinted and textured by the theme. */
export const VEHICLES = ['bicycle', 'scooter', 'motorbike', 'helicopter', 'jet', 'hoverboard', 'hoverbike', 'hoverbikeHeavy', 'skiff', 'starship'] as const;
export type VehicleKind = (typeof VEHICLES)[number];

export interface MaterialSpec {
  /** Texture files (relative paths in a manifest; URLs once resolved). */
  color?: string;
  normal?: string;
  roughness?: string;
  /** Another role's textures (and their size) to use, with this entry's tint on top. */
  use?: MaterialRole;
  /** Metres covered by one repeat of the textures. */
  size?: number;
  /** Multiplied into the colour; the whole colour when there are no textures. */
  tint?: string;
  roughnessValue?: number;
  metalness?: number;
}

export interface Pair<T = string> {
  male: T;
  female: T;
}

export interface MountSpec {
  /** An animal (or creature) model… */
  model?: string;
  /** …or a vehicle built in code. */
  vehicle?: VehicleKind;
  /** How the rider sits: astride (animals, bikes) or seated (cockpits). */
  pose?: 'straddle' | 'sit';
  /** Height in metres including the head (models; vehicles have their own size). */
  height: number;
  tint?: string;
  /** Clip names, first found wins ("Idle" matches "Armature|Idle"). */
  clips: { idle: string[]; walk: string[]; run: string[] };
  /** Natural speeds of the walk and run clips (m/s). */
  speeds?: { walk: number; run: number };
  /** The rider sits between two bones, at t along the way (0..1). */
  seat?: { from: string; to: string; t: number };
  /** Placeholder wings in this colour (until real creatures). */
  wings?: { color: string; span: number };
  /** Set when resolving: the model's file type (a blob: URL no longer shows it). */
  format?: 'fbx' | 'gltf';
}

export interface CharacterSpec {
  /** The bone naming and bind pose every part shares. */
  skeleton: 'ue5-universal';
  animations: string;
  clips: { idle: string; walk: string; run: string; sit: string };
  speeds: { walk: number; run: number };
  bodies: Pair;
  /** Keep only the body's head (outfits cover the rest) or the full body. */
  bodyParts: 'head' | 'full';
  /** `default` for heroes, `villager` for townsfolk, optionally per class. */
  outfits: Partial<Record<(typeof HERO_CLASSES)[number] | 'default' | 'villager', Pair>>;
  hair: Pair<string[]>;
  eyebrows?: Partial<Pair>;
  mounts: Partial<Record<(typeof MOUNT_TIERS)[number], MountSpec>>;
}

export interface BuildingStyle {
  style: Style;
  /** Plaster colour washes, picked per building. */
  washes?: string[];
  /** How strongly a protocol's brand colour tints its roof (0 = not at all). */
  brandRoofs?: number;
}

export interface SurroundingsStyle {
  /** Picks the props: rustic (medieval), urban (modern) or colony (sci-fi). */
  style: Style;
  /** Scale on the hills around the town. */
  relief?: number;
  /** Scale on how much of the land is wooded. */
  woods?: number;
  /** Mix of tree species (relative weights). */
  trees?: { oak?: number; birch?: number; fir?: number };
  grass?: { hue: number; sat: number; light: number };
  flowers?: number;
  lamps?: 'lantern' | 'post' | 'beacon';
}

export interface ThemeSpec {
  /** Id of a theme this one builds on. */
  extends?: string;
  sky?: (typeof SKY_IDS)[number];
  /** What the theme still lacks, shown in the sandbox. */
  notes?: string[];
  materials: Partial<Record<MaterialRole, MaterialSpec>>;
  ground?: Partial<Record<'grass' | 'road' | 'plaza' | 'path', MaterialRole>>;
  buildings?: BuildingStyle;
  surroundings?: SurroundingsStyle;
  characters?: CharacterSpec;
  /** With `extends`: only some character fields, laid over the parent's. */
  charactersPatch?: Partial<CharacterSpec>;
}

// --- validation ------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const name = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.|-]{1,60}$/.test(v) ? v : null);
const hex = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);

class Reader {
  constructor(readonly problems: string[]) {}

  /** Report keys we do not know, so typos are visible. */
  known(o: Obj, at: string, keys: string[]): void {
    for (const k of Object.keys(o)) if (!keys.includes(k)) this.problems.push(`${at}.${k} is not a theme field (ignored)`);
  }

  path(v: unknown, at: string, kind: 'image' | 'model' | 'animal'): string | null {
    if (v === undefined) return null;
    const p = safePath(v, kind);
    if (p === null) this.problems.push(`${at} must be a relative path to a ${kind === 'image' ? 'texture' : 'model'} inside the pack`);
    return p;
  }

  pair(v: unknown, at: string): Pair | null {
    if (!isObj(v)) return null;
    const male = this.path(v.male, `${at}.male`, 'model');
    const female = this.path(v.female, `${at}.female`, 'model');
    return male && female ? { male, female } : null;
  }
}

function material(r: Reader, v: unknown, at: string): MaterialSpec | null {
  if (!isObj(v)) {
    r.problems.push(`${at} must be an object`);
    return null;
  }
  r.known(v, at, ['color', 'normal', 'roughness', 'use', 'size', 'tint', 'roughnessValue', 'metalness']);
  const m: MaterialSpec = {};
  for (const map of ['color', 'normal', 'roughness'] as const) {
    const p = r.path(v[map], `${at}.${map}`, 'image');
    if (p) m[map] = p;
  }
  const use = oneOf(v.use, MATERIAL_ROLES);
  if (use) m.use = use;
  else if (v.use !== undefined) r.problems.push(`${at}.use must name a material role`);
  const size = num(v.size, 0.05, 50);
  if (size !== null) m.size = size;
  const tint = hex(v.tint);
  if (tint) m.tint = tint;
  else if (v.tint !== undefined) r.problems.push(`${at}.tint must be a colour like #a0522d`);
  const rough = num(v.roughnessValue, 0, 1);
  if (rough !== null) m.roughnessValue = rough;
  const metal = num(v.metalness, 0, 1);
  if (metal !== null) m.metalness = metal;
  return m;
}

function clipList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v];
  return list.map(name).filter((x): x is string => x !== null).slice(0, 6);
}

function mount(r: Reader, v: unknown, at: string): MountSpec | null {
  if (!isObj(v)) return null;
  r.known(v, at, ['model', 'vehicle', 'pose', 'height', 'tint', 'clips', 'speeds', 'seat', 'wings']);
  const vehicle = oneOf(v.vehicle, VEHICLES);
  if (v.vehicle !== undefined && !vehicle) r.problems.push(`${at}.vehicle must be one of ${VEHICLES.join(', ')}`);
  const model = vehicle ? null : r.path(v.model, `${at}.model`, 'animal');
  const height = num(v.height, 0.3, 12) ?? (vehicle ? 1 : null);
  if ((!model && !vehicle) || height === null) {
    r.problems.push(`${at} needs a model and a height (m), or a vehicle`);
    return null;
  }
  const c = isObj(v.clips) ? v.clips : {};
  const m: MountSpec = { height, clips: { idle: clipList(c.idle), walk: clipList(c.walk), run: clipList(c.run) } };
  if (model) m.model = model;
  if (vehicle) m.vehicle = vehicle;
  const pose = oneOf(v.pose, ['straddle', 'sit'] as const);
  if (pose) m.pose = pose;
  const tint = hex(v.tint);
  if (tint) m.tint = tint;
  if (isObj(v.speeds)) {
    const walk = num(v.speeds.walk, 0.1, 30);
    const run = num(v.speeds.run, 0.1, 60);
    if (walk !== null && run !== null) m.speeds = { walk, run };
  }
  if (isObj(v.seat)) {
    const from = name(v.seat.from);
    const to = name(v.seat.to);
    const t = num(v.seat.t, 0, 1);
    if (from && to && t !== null) m.seat = { from, to, t };
    else r.problems.push(`${at}.seat needs from, to (bone names) and t (0..1)`);
  }
  if (isObj(v.wings)) {
    const color = hex(v.wings.color);
    const span = num(v.wings.span, 0.1, 3);
    if (color && span !== null) m.wings = { color, span };
  }
  return m;
}

/**
 * Characters: complete, or (`partial`, for a theme that extends another) only
 * the fields given, to lay over the parent's.
 */
function characters(r: Reader, v: unknown, partial: boolean): Partial<CharacterSpec> | null {
  const at = 'theme.characters';
  if (!isObj(v)) return null;
  r.known(v, at, ['skeleton', 'animations', 'clips', 'speeds', 'bodies', 'bodyParts', 'outfits', 'hair', 'eyebrows', 'mounts']);
  if (v.skeleton !== undefined && v.skeleton !== 'ue5-universal') r.problems.push(`${at}.skeleton must be "ue5-universal" (the only rig the game animates so far)`);
  const animations = r.path(v.animations, `${at}.animations`, 'model');
  const bodies = v.bodies === undefined ? null : r.pair(v.bodies, `${at}.bodies`);
  const c = isObj(v.clips) ? v.clips : {};
  const clips = { idle: name(c.idle), walk: name(c.walk), run: name(c.run), sit: name(c.sit) };
  const complete = v.skeleton === 'ue5-universal' && animations && bodies && clips.idle && clips.walk && clips.run && clips.sit;
  if (!complete && !partial) {
    r.problems.push(`${at} needs skeleton, animations, bodies (male/female) and clips (idle, walk, run, sit); characters ignored`);
    return null;
  }
  const spec: Partial<CharacterSpec> = {};
  if (v.skeleton === 'ue5-universal') spec.skeleton = 'ue5-universal';
  if (animations) spec.animations = animations;
  if (clips.idle && clips.walk && clips.run && clips.sit) spec.clips = { idle: clips.idle, walk: clips.walk, run: clips.run, sit: clips.sit };
  if (isObj(v.speeds) || !partial) {
    const s = isObj(v.speeds) ? v.speeds : {};
    spec.speeds = { walk: num(s.walk, 0.1, 10) ?? 1.25, run: num(s.run, 0.1, 20) ?? 3 };
  }
  if (bodies) spec.bodies = bodies;
  if (v.bodyParts !== undefined || !partial) spec.bodyParts = v.bodyParts === 'full' ? 'full' : 'head';
  if (v.outfits !== undefined || !partial) spec.outfits = {};
  if (v.hair !== undefined || !partial) spec.hair = { male: [], female: [] };
  if (v.mounts !== undefined || !partial) spec.mounts = {};
  if (isObj(v.outfits) && spec.outfits) {
    for (const [k, p] of Object.entries(v.outfits)) {
      const key = oneOf(k, [...HERO_CLASSES, 'default', 'villager'] as const);
      const pair = key ? r.pair(p, `${at}.outfits.${k}`) : null;
      if (key && pair) spec.outfits[key] = pair;
      else r.problems.push(`${at}.outfits.${k} ignored (a class, "default" or "villager", with male and female models)`);
    }
  }
  if (isObj(v.hair) && spec.hair) {
    for (const sex of ['male', 'female'] as const) {
      const list = Array.isArray(v.hair[sex]) ? (v.hair[sex] as unknown[]) : [];
      spec.hair[sex] = list.map((p, i) => r.path(p, `${at}.hair.${sex}[${i}]`, 'model')).filter((p): p is string => p !== null).slice(0, 12);
    }
  }
  if (isObj(v.eyebrows)) {
    const e: Partial<Pair> = {};
    for (const sex of ['male', 'female'] as const) {
      const p = r.path(v.eyebrows[sex], `${at}.eyebrows.${sex}`, 'model');
      if (p) e[sex] = p;
    }
    spec.eyebrows = e;
  }
  if (isObj(v.mounts) && spec.mounts) {
    for (const [k, m] of Object.entries(v.mounts)) {
      const tier = oneOf(k, MOUNT_TIERS);
      const spec2 = tier ? mount(r, m, `${at}.mounts.${k}`) : null;
      if (tier && spec2) spec.mounts[tier] = spec2;
      else if (!tier) r.problems.push(`${at}.mounts.${k} ignored (tiers are t2 … t6)`);
    }
  }
  return spec;
}

function isComplete(c: Partial<CharacterSpec>): c is CharacterSpec {
  return c.skeleton !== undefined && c.animations !== undefined && c.clips !== undefined && c.speeds !== undefined && c.bodies !== undefined && c.bodyParts !== undefined && c.outfits !== undefined && c.hair !== undefined && c.mounts !== undefined;
}

/** Validate a pack's `theme` block. Anything doubtful is dropped with a reason. */
export function validateTheme(input: unknown, problems: string[]): ThemeSpec | null {
  if (!isObj(input)) {
    problems.push('theme must be an object');
    return null;
  }
  const r = new Reader(problems);
  r.known(input, 'theme', ['extends', 'sky', 'notes', 'materials', 'ground', 'buildings', 'surroundings', 'characters']);
  const spec: ThemeSpec = { materials: {} };
  if (input.extends !== undefined) {
    if (typeof input.extends === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(input.extends)) spec.extends = input.extends;
    else problems.push('theme.extends must be a theme id');
  }
  const sky = oneOf(input.sky, SKY_IDS);
  if (sky) spec.sky = sky;
  else if (input.sky !== undefined) problems.push(`theme.sky must be one of ${SKY_IDS.join(', ')}`);
  if (Array.isArray(input.notes)) spec.notes = input.notes.filter((n): n is string => typeof n === 'string' && n.length <= 160).slice(0, 8);
  if (isObj(input.materials)) {
    for (const [k, v] of Object.entries(input.materials)) {
      const role = oneOf(k, MATERIAL_ROLES);
      if (!role) {
        problems.push(`theme.materials.${k}: unknown material role (ignored)`);
        continue;
      }
      const m = material(r, v, `theme.materials.${k}`);
      if (m) spec.materials[role] = m;
    }
  }
  if (isObj(input.ground)) {
    const g: NonNullable<ThemeSpec['ground']> = {};
    for (const k of ['grass', 'road', 'plaza', 'path'] as const) {
      const role = oneOf(input.ground[k], MATERIAL_ROLES);
      if (role) g[k] = role;
      else if (input.ground[k] !== undefined) problems.push(`theme.ground.${k} must name a material role`);
    }
    spec.ground = g;
  }
  if (isObj(input.buildings)) {
    const b = input.buildings;
    r.known(b, 'theme.buildings', ['style', 'washes', 'brandRoofs']);
    const bStyle = oneOf(b.style, STYLES);
    if (!bStyle) problems.push(`theme.buildings.style must be one of ${STYLES.join(', ')}`);
    else {
      const style: BuildingStyle = { style: bStyle };
      if (Array.isArray(b.washes)) {
        const washes = b.washes.map(hex).filter((x): x is string => x !== null).slice(0, 12);
        if (washes.length > 0) style.washes = washes;
      }
      const brand = num(b.brandRoofs, 0, 1);
      if (brand !== null) style.brandRoofs = brand;
      spec.buildings = style;
    }
  }
  if (isObj(input.surroundings)) {
    const s = input.surroundings;
    r.known(s, 'theme.surroundings', ['style', 'relief', 'woods', 'trees', 'grass', 'flowers', 'lamps']);
    const sStyle = oneOf(s.style, STYLES);
    if (!sStyle) problems.push(`theme.surroundings.style must be one of ${STYLES.join(', ')}`);
    else {
      const style: SurroundingsStyle = { style: sStyle };
      const relief = num(s.relief, 0, 3);
      if (relief !== null) style.relief = relief;
      const woods = num(s.woods, 0, 2);
      if (woods !== null) style.woods = woods;
      if (isObj(s.trees)) {
        const t: NonNullable<SurroundingsStyle['trees']> = {};
        for (const k of ['oak', 'birch', 'fir'] as const) {
          const w = num(s.trees[k], 0, 100);
          if (w !== null) t[k] = w;
        }
        style.trees = t;
      }
      if (isObj(s.grass)) {
        const hue = num(s.grass.hue, 0, 1);
        const sat = num(s.grass.sat, 0, 1);
        const light = num(s.grass.light, 0, 1);
        if (hue !== null && sat !== null && light !== null) style.grass = { hue, sat, light };
      }
      const flowers = num(s.flowers, 0, 3000);
      if (flowers !== null) style.flowers = Math.round(flowers);
      const lamps = oneOf(s.lamps, ['lantern', 'post', 'beacon'] as const);
      if (lamps) style.lamps = lamps;
      spec.surroundings = style;
    }
  }
  if (input.characters !== undefined) {
    const c = characters(r, input.characters, spec.extends !== undefined);
    if (c && isComplete(c)) spec.characters = c;
    else if (c) spec.charactersPatch = c;
  }
  return spec;
}

// --- files, URLs and inheritance ----------------------------------------------------

/** Every path in a spec, with a function to rewrite it (for listing and resolving). */
function eachPath(spec: ThemeSpec, f: (p: string) => string): void {
  for (const m of Object.values(spec.materials)) for (const k of ['color', 'normal', 'roughness'] as const) if (m[k]) m[k] = f(m[k]);
  for (const c of [spec.characters, spec.charactersPatch]) {
    if (!c) continue;
    if (c.animations) c.animations = f(c.animations);
    if (c.bodies) c.bodies = { male: f(c.bodies.male), female: f(c.bodies.female) };
    for (const [k, p] of Object.entries(c.outfits ?? {})) c.outfits![k as keyof CharacterSpec['outfits']] = { male: f(p.male), female: f(p.female) };
    if (c.hair) c.hair = { male: c.hair.male.map(f), female: c.hair.female.map(f) };
    if (c.eyebrows) for (const sex of ['male', 'female'] as const) if (c.eyebrows[sex]) c.eyebrows[sex] = f(c.eyebrows[sex]);
    for (const m of Object.values(c.mounts ?? {})) if (m.model) m.model = f(m.model);
  }
}

export function themeFiles(spec: ThemeSpec): string[] {
  const out = new Set<string>();
  eachPath(structuredClone(spec), (p) => {
    out.add(p);
    return p;
  });
  return [...out];
}

/** The spec with every relative path turned into a URL by the pack's resolver. */
export function resolveTheme(spec: ThemeSpec, url: (path: string) => string): ThemeSpec {
  const copy = structuredClone(spec);
  for (const c of [copy.characters, copy.charactersPatch]) for (const m of Object.values(c?.mounts ?? {})) if (m.model) m.format = /\.fbx$/i.test(m.model) ? 'fbx' : 'gltf';
  eachPath(copy, url);
  return copy;
}

/**
 * A theme on top of its parent (both resolved): materials and the other
 * blocks override field by field; characters are replaced as a whole.
 */
export function mergeTheme(parent: ThemeSpec, child: ThemeSpec): ThemeSpec {
  const out: ThemeSpec = structuredClone(parent);
  delete out.extends;
  if (child.sky) out.sky = child.sky;
  if (child.notes) out.notes = child.notes;
  // per role, per field: a variant can retint the parent's stone with just { "tint": … }
  for (const [role, m] of Object.entries(child.materials) as [MaterialRole, MaterialSpec][]) out.materials[role] = { ...out.materials[role], ...structuredClone(m) };
  if (child.ground) out.ground = { ...out.ground, ...child.ground };
  if (child.buildings) out.buildings = { ...out.buildings, ...child.buildings };
  if (child.surroundings) out.surroundings = { ...out.surroundings, ...child.surroundings };
  if (child.characters) out.characters = structuredClone(child.characters);
  else if (child.charactersPatch && out.characters) {
    // a variant changes some character fields; mounts per tier
    const patch = structuredClone(child.charactersPatch);
    out.characters = {
      ...out.characters,
      ...patch,
      outfits: patch.outfits ?? out.characters.outfits, // a new wardrobe replaces the old one ({} = none)
      mounts: { ...out.characters.mounts, ...patch.mounts },
    };
  }
  return out;
}

/** Material entries that reuse another role get that role's files (one level, no cycles). */
export function resolveUses(materials: ThemeSpec['materials']): ThemeSpec['materials'] {
  const out: ThemeSpec['materials'] = {};
  for (const [role, m] of Object.entries(materials) as [MaterialRole, MaterialSpec][]) {
    const base = m.use ? materials[m.use] : undefined;
    if (base && !base.use) {
      const merged: MaterialSpec = { ...base, ...m };
      delete merged.use;
      // the used role's files win, with their size (its textures are the point of `use`)
      for (const k of ['color', 'normal', 'roughness'] as const) {
        if (base[k]) merged[k] = base[k];
        else delete merged[k];
      }
      if (base.size !== undefined) merged.size = base.size;
      out[role] = merged;
    } else {
      const copy = { ...m };
      delete copy.use;
      out[role] = copy;
    }
  }
  return out;
}
