/**
 * The player's land, staked out: a post every two tiles along its edge, with
 * a gold cap, where the ground is open (not on a street, the water or a
 * building). Two instanced meshes; laid again only when the land or the town
 * changes. None once the land is the whole map.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W, type TownPlan } from '../../world/layout.js';
import { stakePoints } from '../stakes.js';
import type { LandRect } from '../view.js';

export class LandStakes {
  readonly group = new THREE.Group();
  #key = '';
  readonly #postGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.6, 6);
  readonly #capGeo = new THREE.BoxGeometry(0.14, 0.1, 0.14);
  readonly #postMat = new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.9 });
  readonly #capMat = new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5, emissive: '#5a4300', emissiveIntensity: 0.4 });
  #posts: THREE.InstancedMesh | null = null;
  #caps: THREE.InstancedMesh | null = null;

  constructor() {
    this.group.name = 'land-stakes';
  }

  update(land: LandRect | null, plan: TownPlan): void {
    const full = land === null || (land.x0 <= 0 && land.y0 <= 0 && land.x1 >= MAP_W && land.y1 >= MAP_H);
    // (a new plan is a new object: the town changed)
    const key = full ? 'none' : `${land.x0},${land.y0},${land.x1},${land.y1}`;
    if (key === this.#key && this.#planRef === plan) return;
    this.#key = key;
    this.#planRef = plan;
    this.#clear();
    if (full) return;
    const pts = stakePoints(land, plan);
    if (pts.length === 0) return;
    this.#posts = new THREE.InstancedMesh(this.#postGeo, this.#postMat, pts.length);
    this.#caps = new THREE.InstancedMesh(this.#capGeo, this.#capMat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.3, z);
      this.#posts!.setMatrixAt(i, m);
      m.makeTranslation(x, 0.62, z);
      this.#caps!.setMatrixAt(i, m);
    });
    for (const mesh of [this.#posts, this.#caps]) {
      mesh.castShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  #planRef: TownPlan | null = null;

  #clear(): void {
    for (const mesh of [this.#posts, this.#caps]) {
      if (mesh === null) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.#posts = null;
    this.#caps = null;
  }

  dispose(): void {
    this.#clear();
    this.#postGeo.dispose();
    this.#capGeo.dispose();
    this.#postMat.dispose();
    this.#capMat.dispose();
  }
}
