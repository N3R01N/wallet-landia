/**
 * glTF models from packs (data only). Each model loads once; until it has, the
 * built-in mesh stands in, and the registry is notified when it arrives so the
 * town can rebuild with it.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assets, type LoadedPack } from '../../assets/registry.js';

const cache = new Map<string, THREE.Group | 'loading' | 'failed'>();

function loaderFor(pack: LoadedPack): GLTFLoader {
  const manager = new THREE.LoadingManager();
  // A .gltf may refer to sibling files (buffers, textures) by relative path.
  // Imported packs live at blob: URLs, so map those references back into the pack.
  manager.setURLModifier((url) => {
    for (const path of pack.files) if (url.endsWith(`/${path}`) || url === path) return pack.url(path);
    return url;
  });
  return new GLTFLoader(manager);
}

/** The model ready to clone, or null (still loading, failed, or none chosen). */
export function packModel(chain: readonly string[]): { scene: THREE.Group; scale: number } | null {
  const m = assets.model(chain);
  if (m === null) return null;
  const hit = cache.get(m.url);
  if (hit instanceof THREE.Group) return { scene: hit, scale: m.ref.scale ?? 1 };
  if (hit === undefined) {
    cache.set(m.url, 'loading');
    loaderFor(m.pack).load(
      m.url,
      (gltf) => {
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // glTF lets normals be omitted; compute them rather than render black.
          if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
        });
        cache.set(m.url, gltf.scene);
        assets.notify();
      },
      undefined,
      (error) => {
        console.warn('pack model failed to load', m.url, error);
        cache.set(m.url, 'failed');
      },
    );
  }
  return null;
}
