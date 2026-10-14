/**
 * Standins: the coloured shapes shown until a theme's model exists. Each one
 * is built from its spec's size, shape and pivot, so it sits where the real
 * model will. Origin at the base centre, 1 unit = 1 m, front on +Z.
 */

import * as THREE from 'three';
import type { AssetSpec } from './manifest.js';

/** Builds the standin for one asset. The origin is on the ground at the footprint's centre, before the spec's offset. */
export function buildStandin(spec: AssetSpec): THREE.Group {
  const [w, d, h] = spec.size;
  const { shape, color, offset } = spec.standin;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(geometryFor(shape, w, d, h), material);
  // Upright shapes stand on y = 0; the plane lies on the ground; the sphere sits on it.
  mesh.position.y = shape === 'plane' ? 0 : shape === 'sphere' ? w / 2 : h / 2;
  if (offset) mesh.position.add(new THREE.Vector3(...offset));
  mesh.name = spec.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = spec.name;
  group.add(mesh);
  return group;
}

function geometryFor(shape: AssetSpec['standin']['shape'], w: number, d: number, h: number): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(w, h, d);
    case 'cylinder':
      return new THREE.CylinderGeometry(w / 2, w / 2, h, 16);
    case 'capsule': {
      const r = Math.min(w, d) / 2;
      return new THREE.CapsuleGeometry(r, Math.max(0, h - 2 * r), 4, 8);
    }
    case 'sphere':
      return new THREE.SphereGeometry(w / 2, 16, 12);
    case 'cone':
      return new THREE.ConeGeometry(w / 2, h, 16);
    case 'plane': {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      return g;
    }
  }
}
