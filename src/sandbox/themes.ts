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
  status: 'ready' | 'planned';
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

export const THEMES: Theme[] = [
  baseline(),
  planned('medieval', 'Medieval (planned)', 'Timber and stone town, fantasy outfits, horses.', [
    'Quaternius Universal Base Characters + Universal Animation Library + Modular Outfits (Fantasy)',
    'Quaternius LowPoly Animated Animals (horse, donkey)',
    'Building grammar v2 with PBR stone/timber/plaster (ambientCG)',
  ]),
  planned('scifi', 'Sci-fi (planned)', 'Panelled hab modules, neon, drones.', [
    'Sci-fi outfits on the same universal skeleton (or KayKit alternative)',
    'Quaternius Modular Sci-Fi MegaKit or panel grammar + metal/emissive PBR',
  ]),
  planned('modern', 'Modern (planned)', 'Brick, glass and asphalt; city clothes; bikes and cars as mounts.', [
    'Modern outfits on the universal skeleton',
    'Kenney Building/City kits or façade grammar + brick/concrete/glass PBR',
  ]),
];
