/**
 * Thumbnails for the asset gallery: one small offscreen WebGL renderer that
 * frames any object from an iso angle and returns it as a PNG data URL.
 */

import * as THREE from 'three';

const SIZE = 192;

export class Thumbnailer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);

  constructor() {
    const canvas = document.createElement('canvas');
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.#renderer.setPixelRatio(1);
    this.#renderer.setSize(SIZE, SIZE, false);
  }

  /** Renders the object (not modified) framed from an iso angle. */
  render(object: THREE.Object3D): string {
    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const clone = object.clone(true);
    scene.add(clone);

    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const dist = radius * 2.6;
    this.#camera.position.set(center.x + dist * 0.7, center.y + dist * 0.6, center.z + dist * 0.9);
    this.#camera.lookAt(center);
    this.#renderer.render(scene, this.#camera);
    const url = this.#renderer.domElement.toDataURL('image/png');
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    return url;
  }

  dispose(): void {
    this.#renderer.dispose();
  }
}
