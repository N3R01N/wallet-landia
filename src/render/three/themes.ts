/**
 * Themes for the sandbox: a bundle of how characters, buildings and
 * surroundings look (docs/RESEARCH_REALISM.md, "a theme is a bundle").
 *
 * The baseline theme is the current built-in "Hearth & Harvest" art. The
 * medieval, sci-fi and modern themes are planned bundles; they appear in the
 * picker with what they still need, so the sandbox shows the roadmap.
 */

import type * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import type { Tier } from '../../domain/tiers.js';
import type { BuildingSpec, BuiltBuilding } from './buildingFactory.js';
import { BuildingFactory } from './buildingFactory.js';
import { GrammarBuilder } from './grammar/builder.js';
import { MaterialLibrary, type MatKey } from './grammar/materials.js';
import { loadThemeBundles, type ThemeBundle } from '../../assets/themeBundles.js';
import type { LoadedPack } from '../../assets/registry.js';
import { medievalSurroundings, type Site, type Surroundings } from './grammar/surroundings.js';
import { Vegetation } from './grammar/vegetation.js';
import { buildCaravan, buildCourier, type Companion } from './grammar/companions.js';
import type { SkyId } from './environment.js';
import { spriteCharacters } from './spriteCharacters.js';

export type AnimState = 'idle' | 'walk' | 'run';

export interface CharacterLook {
  id: string;
  kind: 'hero' | 'villager';
  cls: HeroClass;
  tier: Tier;
  crest: string;
  seed: number;
}

/** One character in the sandbox, whatever it is made of (sprite, rigged glTF…). */
export interface SandboxCharacter {
  readonly object: THREE.Object3D;
  setState(state: AnimState): void;
  /** `speed` in tiles/s; `heading` is the walking direction in world radians (0 = +x). */
  update(dt: number, speed: number, heading: number, camera: THREE.Camera): void;
  dispose(): void;
}

export interface CharacterProvider {
  readonly label: string;
  create(look: CharacterLook): SandboxCharacter;
}

export interface GroundStyle {
  grass: string;
  road: string;
  path: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  /** ready: complete · partial: some parts real, the rest shown with the current art · planned: not started. */
  status: 'ready' | 'partial' | 'planned';
  /** Load the theme's assets before first use. */
  prepare?(): Promise<void>;
  /** What a planned theme still needs. */
  needs?: string[];
  defaultSky: SkyId;
  ground: GroundStyle;
  characters: CharacterProvider;
  building(spec: BuildingSpec): BuiltBuilding;
  /** Materials the theme dims or lights at night. */
  windowMaterial: THREE.MeshStandardMaterial;
  fireMaterial: THREE.MeshStandardMaterial;
  material(color: string): THREE.Material;
  /** A textured ground surface (its UVs are in metres); flat colours otherwise. */
  groundMaterial?(which: keyof GroundStyle | 'plaza'): THREE.Material;
  /** The courier and the caravans in 3D, in the theme's style (else sprites). */
  companions?: {
    courier(): Companion;
    caravan(tier: Tier, crest: string): Companion;
  };
  /** Terrain, vegetation, props and lamps around a site; the flat-colour meadow otherwise. */
  surroundings?(site: Site): Surroundings;
  /** How the toll board at the Chronicle Tower looks: a painted board, an LED panel, a hologram. */
  board?: BoardLook;
}

export type BoardLook = 'wood' | 'led' | 'holo';

function baseline(): Theme {
  const factory = new BuildingFactory();
  return {
    id: 'hearth',
    name: 'Hearth & Harvest (current)',
    description: 'The built-in look: low-poly buildings from the style table, pixel-art people as billboards.',
    status: 'ready',
    defaultSky: 'day',
    ground: { grass: '#78b856', road: '#c9a878', path: '#d6bb8a' },
    characters: spriteCharacters,
    building: (spec) => factory.build(spec),
    windowMaterial: factory.windowMat,
    fireMaterial: factory.fireMat,
    material: (c) => factory.mat(c),
  };
}

function planned(id: string, name: string, description: string, needs: string[]): Theme {
  const t = baseline();
  return { ...t, id, name, description, status: 'planned', needs };
}

/** A theme from a bundle (pack format 2): everything it looks like comes from its data. */
export function bundleTheme(b: ThemeBundle): Theme {
  const spec = b.spec;
  const factory = new BuildingFactory();
  const lib = new MaterialLibrary(spec.materials);
  const builder = new GrammarBuilder(lib, factory, spec.buildings);
  let veg: Vegetation | undefined;
  const ground: Record<'grass' | 'road' | 'plaza' | 'path', MatKey> = { grass: 'grass', road: 'cobbles', path: 'dirt', plaza: spec.ground?.road ?? 'cobbles', ...spec.ground };
  const base = baseline();
  const style = spec.surroundings?.style ?? spec.buildings?.style ?? 'medieval';
  const theme: Theme = {
    ...base,
    id: b.id,
    name: b.name,
    description: [b.description, `by ${b.author}`, b.license ? `(${b.license})` : ''].filter(Boolean).join(' '),
    status: spec.notes && spec.notes.length > 0 ? 'partial' : 'ready',
    defaultSky: spec.sky ?? 'day',
    building: (s) => builder.build(s),
    windowMaterial: lib.glass,
    fireMaterial: lib.fire,
    material: (c) => factory.mat(c),
    groundMaterial: (which) => lib.get(ground[which]),
    surroundings: (site) => medievalSurroundings(site, lib, (veg ??= new Vegetation(lib)), spec.surroundings),
    companions: {
      courier: () => buildCourier(style, lib),
      caravan: (tier, crest) => buildCaravan(style, tier, lib, crest),
    },
    board: style === 'modern' ? 'led' : style === 'scifi' ? 'holo' : 'wood',
  };
  if (spec.notes) theme.needs = spec.notes;
  const characters = spec.characters;
  if (characters) {
    theme.prepare = async () => {
      const { loadKit, riggedProvider } = await import('./rigged.js');
      const { buildVehicle } = await import('./grammar/vehicles.js');
      theme.characters = riggedProvider(await loadKit(characters, (kind, tint) => buildVehicle(kind, lib, tint)), `Rigged characters from the ${b.name} bundle`);
      delete theme.prepare; // once
    };
  }
  return theme;
}

/** Add the bundled (and imported) theme bundles after the baseline, before the planned ones. */
export async function loadThemes(imported: Iterable<LoadedPack> = []): Promise<void> {
  const bundles = await loadThemeBundles('/themes', imported);
  THEMES.splice(1, 0, ...bundles.map(bundleTheme));
}

export const THEMES: Theme[] = [
  baseline(),
  planned('scifi', 'Sci-fi (planned)', 'Panelled hab modules, neon, drones.', [
    'Sci-fi outfits on the same universal skeleton (or KayKit alternative)',
    'Quaternius Modular Sci-Fi MegaKit or panel grammar + metal/emissive PBR',
  ]),
  planned('modern', 'Modern (planned)', 'Brick, glass and asphalt; city clothes; bikes and cars as mounts.', [
    'Modern outfits on the universal skeleton',
    'Kenney Building/City kits or façade grammar + brick/concrete/glass PBR',
  ]),
];
