/**
 * PBR materials for the building grammar (CC0 ambientCG textures, see
 * public/themes/medieval/materials/CREDITS.md). Textures repeat in world
 * units: the mesh writer emits UVs in metres divided by each material's
 * texture size, so a stone is the same size on every wall.
 */

import * as THREE from 'three';

export type MatKey =
  | 'plaster'
  | 'stone'
  | 'stoneDark'
  | 'timber'
  | 'planks'
  | 'roofTiles'
  | 'roofSlate'
  | 'thatch'
  | 'cobbles'
  | 'grass'
  | 'dirt'
  | 'cloth'
  | 'glass'
  | 'fire'
  | 'iron'
  | 'gold';

/** Metres covered by one repeat of each texture. */
export const TEX_SIZE: Record<MatKey, number> = {
  plaster: 2.2,
  stone: 1.25,
  stoneDark: 1.25,
  timber: 1.2,
  planks: 1.4,
  roofTiles: 1.8,
  roofSlate: 1.4,
  thatch: 2.4,
  cobbles: 2.4,
  grass: 3,
  dirt: 3,
  cloth: 1.2,
  glass: 1,
  fire: 1,
  iron: 1,
  gold: 1,
};

const TEXTURED = new Set<MatKey>(['plaster', 'stone', 'stoneDark', 'timber', 'planks', 'roofTiles', 'roofSlate', 'thatch', 'cobbles', 'grass', 'dirt', 'cloth']);

export class MaterialLibrary {
  readonly #base: string;
  readonly #loader = new THREE.TextureLoader();
  readonly #textures = new Map<string, THREE.Texture>();
  readonly #mats = new Map<string, THREE.MeshStandardMaterial>();
  /** Shared with the renderer so night lights them (emissive). */
  readonly glass: THREE.MeshStandardMaterial;
  readonly fire: THREE.MeshStandardMaterial;

  constructor(base = '/themes/medieval/materials', glass?: THREE.MeshStandardMaterial, fire?: THREE.MeshStandardMaterial) {
    this.#base = base;
    this.glass = glass ?? new THREE.MeshStandardMaterial({ color: '#2c3a48', emissive: new THREE.Color('#ffc870'), emissiveIntensity: 0, roughness: 0.12, metalness: 0.3 });
    this.fire = fire ?? new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 1.4 });
  }

  #tex(key: MatKey, map: 'color' | 'normal' | 'roughness'): THREE.Texture {
    const id = `${key}/${map}`;
    let t = this.#textures.get(id);
    if (t === undefined) {
      t = this.#loader.load(`${this.#base}/${key}/${map}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
      this.#textures.set(id, t);
    }
    return t;
  }

  /** A material by key, optionally tinted (a brand colour on a roof, a wash on plaster). */
  get(key: MatKey, tint?: string): THREE.Material {
    if (key === 'glass') return this.glass;
    if (key === 'fire') return this.fire;
    const id = `${key}|${tint ?? ''}`;
    let m = this.#mats.get(id);
    if (m === undefined) {
      if (TEXTURED.has(key)) {
        m = new THREE.MeshStandardMaterial({
          map: this.#tex(key, 'color'),
          normalMap: this.#tex(key, 'normal'),
          roughnessMap: this.#tex(key, 'roughness'),
          roughness: 1,
          color: tint ? new THREE.Color(tint) : new THREE.Color('#ffffff'),
        });
      } else {
        m = new THREE.MeshStandardMaterial({
          color: key === 'gold' ? '#d8a830' : '#3a3a40',
          metalness: key === 'gold' ? 0.9 : 0.7,
          roughness: key === 'gold' ? 0.35 : 0.5,
        });
      }
      this.#mats.set(id, m);
    }
    return m;
  }
}
