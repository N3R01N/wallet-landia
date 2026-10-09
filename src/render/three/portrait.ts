/**
 * Portraits of themed heroes for the character sheet and the Guild panel: a
 * hero's rigged character photographed head and shoulders, in a little
 * studio of its own (its own small WebGL context, so the town's renderer and
 * its post-processing are left alone). Shots are kept per look.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SandboxCharacter } from './themes.js';

const W = 264;
const H = 240;

export class PortraitStudio {
  readonly #gl: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(28, W / H, 0.05, 20);
  readonly #shots = new Map<string, string>();

  constructor() {
    this.#gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.#gl.setSize(W, H, false);
    this.#gl.outputColorSpace = THREE.SRGBColorSpace;
    this.#gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.#gl.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.#gl);
    this.#scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight('#a8c8ff', 1.2);
    rim.position.set(-2, 1.5, -2);
    this.#scene.add(key, rim, new THREE.HemisphereLight('#dfe8ff', '#5a4630', 0.6));
  }

  /**
   * Photograph a character (head and shoulders, facing the camera) and return
   * the picture as a data URL. `key` names the look, so a repeat costs nothing.
   */
  shoot(key: string, make: () => SandboxCharacter): string {
    const hit = this.#shots.get(key);
    if (hit) return hit;
    const char = make();
    const obj = char.object;
    this.#scene.add(obj);
    obj.position.set(0, 0, 0);
    obj.rotation.y = 0;
    // settle into the idle pose
    char.setState('idle');
    for (let i = 0; i < 4; i++) char.update(0.1, 0, 0, this.#camera);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true);
    const h = Math.max(0.2, box.max.y - box.min.y);
    const head = box.min.y + h * 0.84;
    // frame the upper third of the figure, a little from the side
    const dist = h * 1.25;
    this.#camera.position.set(dist * 0.3, head + h * 0.02, dist);
    this.#camera.lookAt(0, head - h * 0.06, 0);
    this.#gl.setClearColor(0x000000, 0);
    this.#gl.render(this.#scene, this.#camera);
    const url = this.#gl.domElement.toDataURL('image/png');
    obj.removeFromParent();
    char.dispose();
    this.#shots.set(key, url);
    return url;
  }
}
