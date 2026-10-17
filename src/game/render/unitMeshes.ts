/**
 * Siege units drawn by the hundred: one instanced draw per unit type and
 * material (docs/game/MAPPING.md, "baked animation, instanced"). At load,
 * every clip of the unit's rigged glTF is sampled at 30 fps into a float
 * texture of bone matrices (each part's bind matrices folded in); the vertex
 * shader skins each instance from its own row of that texture. The `Tint`
 * material is the team's colour, per instance.
 *
 * A glTF mesh with two materials loads as two skinned meshes on one skeleton
 * (one per primitive): each becomes a part, an InstancedMesh of its own; the
 * parts share the per-instance attributes (clip rows, team colour).
 */

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Loaded } from '../../castle/assets/models.js';

const FPS = 30;

export interface ClipRows {
  /** First row in the bone texture, number of rows, seconds. */
  row: number;
  rows: number;
  duration: number;
}

interface Part {
  mesh: THREE.InstancedMesh;
  texture: THREE.DataTexture;
  materials: THREE.Material[];
  /** The part's place in the model (it is skinned in the model's space, then placed). */
  local: THREE.Matrix4;
}

/** A unit type's baked animation and its instanced parts. */
export class UnitMesh {
  /** Everything to add to the scene. */
  readonly mesh = new THREE.Group();
  readonly clips: ReadonlyMap<string, ClipRows>;
  readonly #rows: THREE.InstancedBufferAttribute;
  readonly #team: THREE.InstancedBufferAttribute;
  readonly #parts: Part[] = [];
  readonly #scratch = new THREE.Matrix4();
  readonly #scale = new THREE.Vector3();

  constructor(loaded: Loaded, capacity: number) {
    // SkeletonUtils: the copy's skins bound to the copy's own bones (a plain clone keeps the original's)
    const root = cloneSkinned(loaded.scene);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    const skinned: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    if (skinned.length === 0) throw new Error('a unit model needs a skinned mesh');

    // sample every clip: per part, rows of bone matrices (bindMatrixInverse · bone · boneInverse · bindMatrix)
    const mixer = new THREE.AnimationMixer(root);
    const clipRows = new Map<string, ClipRows>();
    const data: number[][] = skinned.map(() => []);
    let row = 0;
    const m = new THREE.Matrix4();
    const pushRow = () => {
      root.updateMatrixWorld(true);
      skinned.forEach((sk, i) => {
        sk.skeleton.update();
        const bones = sk.skeleton.bones.length;
        for (let b = 0; b < bones; b++) {
          m.fromArray(sk.skeleton.boneMatrices!, b * 16);
          m.premultiply(sk.bindMatrixInverse).multiply(sk.bindMatrix);
          // four texels of one matrix, column by column
          data[i]!.push(...m.elements);
        }
      });
      row++;
    };
    // the rest pose first, for a model without the clip
    pushRow();
    for (const clip of loaded.clips) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      const n = Math.max(2, Math.ceil(clip.duration * FPS) + 1);
      clipRows.set(clip.name, { row, rows: n, duration: clip.duration });
      for (let f = 0; f < n; f++) {
        mixer.setTime(Math.min(clip.duration, f / FPS));
        pushRow();
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    this.clips = clipRows;

    this.#rows = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.#rows.setUsage(THREE.DynamicDrawUsage);
    this.#team = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.#team.setUsage(THREE.DynamicDrawUsage);
    skinned.forEach((sk, i) => {
      const texture = new THREE.DataTexture(new Float32Array(data[i]!), sk.skeleton.bones.length * 4, row, THREE.RGBAFormat, THREE.FloatType);
      texture.needsUpdate = true;
      const geometry = sk.geometry.clone();
      geometry.setAttribute('aRows', this.#rows);
      geometry.setAttribute('aTeam', this.#team);
      const source = Array.isArray(sk.material) ? sk.material : [sk.material];
      const materials = source.map((mat) => bake(mat as THREE.MeshStandardMaterial, texture));
      const mesh = new THREE.InstancedMesh(geometry, materials.length === 1 ? materials[0]! : materials, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      // the instances spread over the whole field: never culled as one
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.mesh.add(mesh);
      this.#parts.push({ mesh, texture, materials, local: sk.matrixWorld.clone() });
    });
  }

  /**
   * Places instance i: where it stands, which way it faces, its clip and the
   * time in it (looped or held at the end), and its team colour.
   */
  set(i: number, x: number, z: number, face: number, clip: string, time: number, loop: boolean, team: THREE.Color, y = 0, scale = 1): void {
    const c = this.clips.get(clip);
    let rowA = 0;
    let rowB = 0;
    let blend = 0;
    if (c) {
      const t = loop ? ((time % c.duration) + c.duration) % c.duration : Math.min(time, c.duration);
      const f = t * FPS;
      const f0 = Math.min(c.rows - 1, Math.floor(f));
      rowA = c.row + f0;
      rowB = c.row + Math.min(c.rows - 1, f0 + 1);
      blend = f - f0;
    }
    this.#rows.setXYZ(i, rowA, rowB, blend);
    this.#team.setXYZ(i, team.r, team.g, team.b);
    for (const p of this.#parts) {
      this.#scratch.makeRotationY(face);
      if (scale !== 1) this.#scratch.scale(this.#scale.set(scale, scale, scale));
      this.#scratch.setPosition(x, y, z);
      this.#scratch.multiply(p.local);
      p.mesh.setMatrixAt(i, this.#scratch);
    }
  }

  /** After a frame's `set`s: how many are drawn. */
  commit(count: number): void {
    for (const p of this.#parts) {
      p.mesh.count = count;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    this.#rows.needsUpdate = true;
    this.#team.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.#parts) {
      p.mesh.geometry.dispose();
      for (const m of p.materials) m.dispose();
      p.texture.dispose();
    }
    this.mesh.removeFromParent();
  }
}

/** A material skinned from the bone texture, the team colour on Tint. */
function bake(source: THREE.MeshStandardMaterial, texture: THREE.DataTexture): THREE.Material {
  const mat = source.clone();
  const tint = source.name === 'Tint';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2D uBones;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 aRows;
attribute vec3 aTeam;
varying vec3 vTeam;
mat4 boneAt(float i, float r) {
  int x = int(i) * 4;
  int y = int(r);
  return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0), texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0));
}
mat4 boneOf(float i) {
  return boneAt(i, aRows.x) * (1.0 - aRows.z) + boneAt(i, aRows.y) * aRows.z;
}`,
      )
      .replace(
        '#include <skinbase_vertex>',
        `mat4 skinM = skinWeight.x * boneOf(skinIndex.x) + skinWeight.y * boneOf(skinIndex.y) + skinWeight.z * boneOf(skinIndex.z) + skinWeight.w * boneOf(skinIndex.w);
vTeam = aTeam;`,
      )
      .replace('#include <skinnormal_vertex>', 'objectNormal = normalize((skinM * vec4(objectNormal, 0.0)).xyz);')
      .replace('#include <skinning_vertex>', 'transformed = (skinM * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTeam;')
      .replace('#include <color_fragment>', tint ? '#include <color_fragment>\ndiffuseColor.rgb *= vTeam;' : '#include <color_fragment>');
  };
  mat.customProgramCacheKey = () => `siege-unit-${tint ? 'tint' : 'body'}`;
  return mat;
}
