/**
 * Siege units drawn by the hundred: one InstancedMesh per unit type
 * (docs/game/MAPPING.md, "baked animation, instanced"). At load, every clip of
 * the unit's rigged glTF is sampled at 30 fps into a float texture of bone
 * matrices (the mesh's bind matrices folded in); the vertex shader skins each
 * instance from its own row of that texture. The `Tint` material is the
 * team's colour, per instance.
 */

import * as THREE from 'three';
import type { Loaded } from '../../castle/assets/models.js';

const FPS = 30;

export interface ClipRows {
  /** First row in the bone texture, number of rows, seconds. */
  row: number;
  rows: number;
  duration: number;
}

/** A unit type's baked animation and its instanced mesh. */
export class UnitMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly clips: ReadonlyMap<string, ClipRows>;
  readonly #rows: THREE.InstancedBufferAttribute;
  readonly #team: THREE.InstancedBufferAttribute;
  readonly #texture: THREE.DataTexture;
  readonly #materials: THREE.Material[];
  /** The mesh's place in the model (it is skinned in the model's space, then placed). */
  readonly #local: THREE.Matrix4;
  readonly #scratch = new THREE.Matrix4();

  constructor(loaded: Loaded, capacity: number) {
    const root = loaded.scene.clone(true);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    let skinned: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    if (!skinned) throw new Error('a unit model needs one skinned mesh');
    const sk = skinned as THREE.SkinnedMesh;
    this.#local = sk.matrixWorld.clone();
    const bones = sk.skeleton.bones.length;

    // sample every clip: rows of bone matrices (bindMatrixInverse · bone · boneInverse · bindMatrix)
    const mixer = new THREE.AnimationMixer(root);
    const clipRows = new Map<string, ClipRows>();
    const data: number[] = [];
    let row = 0;
    const m = new THREE.Matrix4();
    const pushRow = () => {
      root.updateMatrixWorld(true);
      sk.skeleton.update();
      for (let b = 0; b < bones; b++) {
        m.fromArray(sk.skeleton.boneMatrices!, b * 16);
        m.premultiply(sk.bindMatrixInverse).multiply(sk.bindMatrix);
        // four texels of one matrix, column by column
        data.push(...m.elements);
      }
      row++;
    };
    // the rest pose first, for a model without the clip
    pushRow();
    for (const clip of loaded.clips) {
      const action = mixer.clipAction(clip);
      mixer.stopAllAction();
      action.play();
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
    this.#texture = new THREE.DataTexture(new Float32Array(data), bones * 4, row, THREE.RGBAFormat, THREE.FloatType);
    this.#texture.needsUpdate = true;

    const geometry = sk.geometry.clone();
    this.#rows = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.#rows.setUsage(THREE.DynamicDrawUsage);
    this.#team = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.#team.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRows', this.#rows);
    geometry.setAttribute('aTeam', this.#team);
    const source = Array.isArray(sk.material) ? sk.material : [sk.material];
    this.#materials = source.map((mat) => this.#bake(mat as THREE.MeshStandardMaterial));
    this.mesh = new THREE.InstancedMesh(geometry, this.#materials.length === 1 ? this.#materials[0]! : this.#materials, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // the instances spread over the whole field: never culled as one
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }

  #bake(source: THREE.MeshStandardMaterial): THREE.Material {
    const mat = source.clone();
    const tint = source.name === 'Tint';
    const texture = this.#texture;
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
    this.#scratch.makeRotationY(face);
    if (scale !== 1) this.#scratch.scale(new THREE.Vector3(scale, scale, scale));
    this.#scratch.setPosition(x, y, z);
    this.#scratch.multiply(this.#local);
    this.mesh.setMatrixAt(i, this.#scratch);
  }

  /** After a frame's `set`s: how many are drawn. */
  commit(count: number): void {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.#rows.needsUpdate = true;
    this.#team.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const m of this.#materials) m.dispose();
    this.#texture.dispose();
    this.mesh.removeFromParent();
  }
}
