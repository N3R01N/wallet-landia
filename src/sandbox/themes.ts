/**
 * Themes for the sandbox: a bundle of how characters, buildings and
 * surroundings look (docs/RESEARCH_REALISM.md, "a theme is a bundle").
 *
 * The baseline theme is the current built-in "Hearth & Harvest" art. The
 * medieval, sci-fi and modern themes are planned bundles; they appear in the
 * picker with what they still need, so the sandbox shows the roadmap.
 */

import type * as THREE from 'three';
import type { HeroClass } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import type { BuildingSpec, BuiltBuilding } from '../render/three/buildingFactory.js';
import { BuildingFactory } from '../render/three/buildingFactory.js';
import { MedievalBuilder } from '../render/three/grammar/medieval.js';
import { MaterialLibrary, TEX_SIZE, type MatKey } from '../render/three/grammar/materials.js';
import type { SkyId } from '../render/three/environment.js';
import { spriteCharacters } from './characters.js';

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
  /** A textured ground surface (material plus metres per texture repeat); flat colours otherwise. */
  groundMaterial?(which: keyof GroundStyle): { material: THREE.Material; size: number };
}

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

function medieval(): Theme {
  const factory = new BuildingFactory();
  const lib = new MaterialLibrary('/themes/medieval/materials');
  const builder = new MedievalBuilder(lib, factory);
  const GROUND: Record<keyof GroundStyle, MatKey> = { grass: 'grass', road: 'cobbles', path: 'dirt' };
  const theme: Theme = {
    ...baseline(),
    id: 'medieval',
    name: 'Medieval',
    description: 'Rigged CC0 people (Quaternius) in fantasy outfits on horses; grammar-built stone, timber and plaster buildings with CC0 PBR textures (ambientCG).',
    status: 'partial',
    needs: [
      'Terrain, props and vegetation per theme (Phase 5)',
      'Real griffin and dragon mounts (wings are placeholders); class gear (shield, staff, lute, bow)',
      'More outfits: the free kit has only Peasant and Ranger',
    ],
    ground: { grass: '#6f9a4a', road: '#9a8f80', path: '#8a7556' },
    building: (spec) => builder.build(spec),
    windowMaterial: lib.glass,
    fireMaterial: lib.fire,
    groundMaterial: (which) => ({ material: lib.get(GROUND[which]), size: TEX_SIZE[GROUND[which]] }),
    async prepare() {
      const { loadMedievalKit, riggedProvider } = await import('./rigged.js');
      theme.characters = riggedProvider(await loadMedievalKit());
      delete theme.prepare; // once
    },
  };
  return theme;
}

export const THEMES: Theme[] = [
  baseline(),
  medieval(),
  planned('scifi', 'Sci-fi (planned)', 'Panelled hab modules, neon, drones.', [
    'Sci-fi outfits on the same universal skeleton (or KayKit alternative)',
    'Quaternius Modular Sci-Fi MegaKit or panel grammar + metal/emissive PBR',
  ]),
  planned('modern', 'Modern (planned)', 'Brick, glass and asphalt; city clothes; bikes and cars as mounts.', [
    'Modern outfits on the universal skeleton',
    'Kenney Building/City kits or façade grammar + brick/concrete/glass PBR',
  ]),
];
