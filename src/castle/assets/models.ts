/**
 * Loads a theme's .glb models by asset name, and hands out an instance of
 * each: the real model when its file exists, the standin when it does not.
 * One load per name, however often it is placed.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assetPath, findAsset, tierFallbacks, type AssetSpec } from './manifest.js';
import { themeFileUrl, type CastleTheme } from './theme.js';
import { buildStandin } from './standin.js';

export interface Loaded {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export class ModelLibrary {
  readonly #theme: Promise<CastleTheme>;
  readonly #loader = new GLTFLoader();
  readonly #cache = new Map<string, Promise<Loaded | null>>();

  /** The theme to load from; its version goes on every file's URL. */
  constructor(theme: Promise<CastleTheme> | CastleTheme) {
    this.#theme = Promise.resolve(theme);
  }

  /** The model for a name, or null when its file is missing or broken (the standin is used then). */
  load(name: string): Promise<Loaded | null> {
    const cached = this.#cache.get(name);
    if (cached) return cached;
    const promise = this.#loadNearest(name);
    this.#cache.set(name, promise);
    return promise;
  }

  /** The file for the name, or for the nearest tier that has one (docs/ASSET_SPEC.md §2). */
  async #loadNearest(name: string): Promise<Loaded | null> {
    for (const candidate of tierFallbacks(name)) {
      const loaded = await this.#loadOne(candidate);
      if (loaded) return loaded;
    }
    return null;
  }

  #loadOne(name: string): Promise<Loaded | null> {
    const spec = findAsset(name);
    if (!spec || spec.kind !== 'model') return Promise.resolve(null);
    return this.#theme
      .then((theme) => this.#loader.loadAsync(themeFileUrl(theme, assetPath(spec))))
      .then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }))
      .catch(() => null);
  }

  /**
   * Frees every loaded model's geometry, materials and textures. Instances share
   * these, so call it only when nothing placed from this library is shown.
   */
  async dispose(): Promise<void> {
    const loaded = await Promise.all(this.#cache.values());
    this.#cache.clear();
    for (const l of loaded) if (l) disposeTree(l.scene);
  }

  /** A new object for a placed asset: a copy of the model, or the standin. Call `load` first. */
  instance(spec: AssetSpec, loaded: Loaded | null): THREE.Object3D {
    if (!loaded) return buildStandin(spec);
    // SkeletonUtils keeps a skinned person bound to its own copy of the skeleton
    // (a plain clone would share the original's bones).
    const obj = cloneSkinned(loaded.scene);
    obj.name = spec.name;
    return obj;
  }
}

/** Disposes the geometry, materials and textures under an object (each once). */
export function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
    m.dispose();
  }
}
