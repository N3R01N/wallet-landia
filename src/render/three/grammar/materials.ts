/**
 * PBR materials by role (stone, plaster, timber…), as a theme bundle defines
 * them (src/assets/theme.ts). Geometry carries UVs in metres; each texture
 * repeats once per its material's `size`, so a stone is the same size on
 * every wall, whatever theme draws it.
 *
 * A role without textures is a flat colour; a role the theme does not define
 * at all falls back to a plain colour, so nothing ever goes missing.
 */

import * as THREE from 'three';
import type { MaterialRole, MaterialSpec } from '../../../assets/theme.js';

export type MatKey = MaterialRole;

/** Flat colours for roles a theme leaves out (and for untextured roles without a tint). */
const FALLBACK: Record<MatKey, string> = {
  plaster: '#e8dcc4',
  stone: '#9a9284',
  stoneDark: '#6a645c',
  timber: '#5a3c26',
  planks: '#8a6a48',
  roofTiles: '#a0522d',
  roofSlate: '#4a4e58',
  thatch: '#c8a860',
  cobbles: '#8a8478',
  grass: '#5a8a3a',
  dirt: '#7a6248',
  cloth: '#c8b8a0',
  bark: '#4a3a2c',
  rock: '#6a6862',
  forestFloor: '#5a5a32',
  glass: '#2c3a48',
  fire: '#ff8a2a',
  iron: '#3a3a40',
  gold: '#d8a830',
};

const DEFAULT_SIZE = 2;

export class MaterialLibrary {
  readonly #specs: Partial<Record<MatKey, MaterialSpec>>;
  readonly #loader = new THREE.TextureLoader();
  readonly #textures = new Map<string, THREE.Texture>();
  readonly #mats = new Map<string, THREE.MeshStandardMaterial>();
  /** Shared so night can light them (emissive). */
  readonly glass: THREE.MeshStandardMaterial;
  readonly fire: THREE.MeshStandardMaterial;

  /** `specs` hold URLs (a resolved theme). */
  constructor(specs: Partial<Record<MatKey, MaterialSpec>>) {
    this.#specs = specs;
    this.glass = new THREE.MeshStandardMaterial({ color: specs.glass?.tint ?? FALLBACK.glass, emissive: new THREE.Color('#ffc870'), emissiveIntensity: 0, roughness: 0.12, metalness: 0.3 });
    this.fire = new THREE.MeshStandardMaterial({ color: specs.fire?.tint ?? FALLBACK.fire, emissive: new THREE.Color(specs.fire?.tint ?? '#ff7a1a'), emissiveIntensity: 1.4 });
  }

  /** Metres covered by one repeat of a role's textures. */
  size(key: MatKey): number {
    return this.#specs[key]?.size ?? DEFAULT_SIZE;
  }

  /**
   * One of a role's texture maps, repeating per metre of UV. Roles without that
   * map get a 1×1 stand-in (their flat colour, or a neutral normal).
   */
  tex(key: MatKey, map: 'color' | 'normal' | 'roughness'): THREE.Texture {
    const url = this.#specs[key]?.[map];
    const id = url ?? `solid:${key}/${map}`;
    let t = this.#textures.get(id);
    if (t === undefined) {
      if (url) t = this.#loader.load(url);
      else {
        const c = new THREE.Color(map === 'color' ? (this.#specs[key]?.tint ?? FALLBACK[key]) : map === 'normal' ? '#8080ff' : '#e0e0e0');
        if (map === 'color') c.convertLinearToSRGB();
        t = new THREE.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1);
        t.needsUpdate = true;
      }
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.repeat.setScalar(1 / this.size(key));
      if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
      this.#textures.set(id, t);
    }
    return t;
  }

  /** Does the theme give this role real textures? */
  textured(key: MatKey): boolean {
    return this.#specs[key]?.color !== undefined;
  }

  /** A material by role, optionally tinted (a brand colour on a roof, a wash on plaster). */
  get(key: MatKey, tint?: string): THREE.Material {
    if (key === 'glass') return this.glass;
    if (key === 'fire') return this.fire;
    const id = `${key}|${tint ?? ''}`;
    let m = this.#mats.get(id);
    if (m === undefined) {
      const spec = this.#specs[key];
      const colour = new THREE.Color(tint ?? '#ffffff');
      if (this.textured(key)) {
        if (spec?.tint) colour.multiply(new THREE.Color(spec.tint));
        m = new THREE.MeshStandardMaterial({
          map: this.tex(key, 'color'),
          normalMap: spec?.normal ? this.tex(key, 'normal') : null,
          roughnessMap: spec?.roughness ? this.tex(key, 'roughness') : null,
          roughness: spec?.roughnessValue ?? 1,
          metalness: spec?.metalness ?? 0,
          color: colour,
        });
      } else {
        const base = new THREE.Color(spec?.tint ?? FALLBACK[key]);
        if (tint) base.multiply(colour);
        const metal = key === 'iron' || key === 'gold';
        m = new THREE.MeshStandardMaterial({
          color: base,
          metalness: spec?.metalness ?? (key === 'gold' ? 0.9 : metal ? 0.7 : 0),
          roughness: spec?.roughnessValue ?? (key === 'gold' ? 0.35 : metal ? 0.5 : 0.9),
        });
      }
      this.#mats.set(id, m);
    }
    return m;
  }
}
