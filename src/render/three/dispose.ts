/**
 * Freeing a rebuilt town's GPU resources. Detaching a mesh frees nothing:
 * three.js keeps its geometry buffers, programs and textures until they are
 * disposed, so every rebuild (each live update) would add a town's worth.
 *
 * Caches that outlive a build (factory and theme materials, their textures,
 * plant prototypes) mark what they hand out with `keep`, and are skipped.
 * Disposing something still in use is safe in three.js (it is uploaded again
 * when next drawn), so a missed mark costs a re-upload, not a broken town.
 */

import * as THREE from 'three';

const kept = new WeakSet<object>();

/** Mark a long-lived geometry, material or texture (and a material's textures) so `disposeTree` leaves it. */
export function keep<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(r: T): T {
  kept.add(r);
  if ((r as THREE.Material).isMaterial) for (const t of texturesOf(r as THREE.Material)) kept.add(t);
  return r;
}

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) out.push(v as THREE.Texture);
  const uniforms = (m as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) if ((u?.value as THREE.Texture | null)?.isTexture) out.push(u.value as THREE.Texture);
  return out;
}

/**
 * Dispose what a subtree owns: geometries, materials (and their depth stand-ins)
 * and their textures, instanced buffers, bone textures. `born` (optional): only resources
 * created from then on (ids from `resourceMark`), so anything older is left.
 */
export function disposeTree(root: THREE.Object3D, born?: ResourceMark): void {
  const done = new Set<object>();
  const free = (r: { dispose(): void } | null | undefined, from: number | undefined): void => {
    if (!r || done.has(r) || kept.has(r) || (from !== undefined && idOf(r) < from)) return;
    done.add(r);
    r.dispose();
  };
  const freeMat = (m: THREE.Material | null | undefined): void => {
    if (!m || done.has(m) || kept.has(m) || (born && idOf(m) < born.material)) return;
    for (const t of texturesOf(m)) free(t, born?.texture);
    free(m, born?.material);
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { customDepthMaterial?: THREE.Material; customDistanceMaterial?: THREE.Material };
    // (every sprite shares one quad)
    if (mesh.geometry && !(o as THREE.Sprite).isSprite) free(mesh.geometry, born?.geometry);
    const mats = mesh.material;
    if (Array.isArray(mats)) for (const m of mats) freeMat(m);
    else freeMat(mats);
    freeMat(mesh.customDepthMaterial);
    freeMat(mesh.customDistanceMaterial);
    // instance matrices and colours live on the GPU with the mesh, not its geometry
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    // a skeleton's bone texture (each cloned character has its own skeleton)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton?.dispose();
  });
}

/** three.js numbers geometries, materials and textures in order (Material's `id` is missing from its types). */
const idOf = (r: object): number => (r as { id: number }).id;

/** The next ids three.js will hand out, so a build can tell what it created. */
export interface ResourceMark {
  geometry: number;
  material: number;
  texture: number;
}

export function resourceMark(): ResourceMark {
  // ids count up from a counter per kind; a throwaway of each reads it
  return { geometry: new THREE.BufferGeometry().id, material: idOf(new THREE.Material()), texture: new THREE.Texture().id };
}
