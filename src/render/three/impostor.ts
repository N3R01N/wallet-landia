/**
 * Impostors for themed people beyond the nearest few: each look (a hero's
 * class, mount and crest; a villager's outfit) photographed once from four
 * sides (front, right, back, left) standing and in two walking poses, and
 * drawn as camera-facing sprites. They cost what a pixel sprite costs, but
 * look like the theme's own people, so a town never mixes the two styles.
 *
 * Shots are taken in a small studio of its own (its own WebGL context, like
 * the portraits), a look at a time as people come into view.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SandboxCharacter } from './themes.js';

/** Pixels per cell: tall enough to read at a distance, small enough to bake quickly. */
const CW = 80;
const CH = 120;
/** The angle the shots are taken from (radians above the horizon): the town camera's usual tilt. */
const ELEVATION = 0.55;

export interface ImpostorFrame {
  canvas: HTMLCanvasElement;
}

export interface Impostor {
  /** [side][pose]: side 0 front, 1 right, 2 back, 3 left; pose 0 standing, 1–2 walking. */
  frames: ImpostorFrame[][];
  /** World size of a cell (tiles), and where the feet are (fraction of the height from the bottom). */
  width: number;
  height: number;
  foot: number;
}

export class ImpostorStudio {
  readonly #gl: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  readonly #done = new Map<string, Impostor>();
  readonly #queue: { key: string; make: () => SandboxCharacter }[] = [];
  readonly #waiting = new Set<string>();

  constructor() {
    this.#gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.#gl.setSize(CW, CH, false);
    this.#gl.outputColorSpace = THREE.SRGBColorSpace;
    this.#gl.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.#gl);
    this.#scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const sun = new THREE.DirectionalLight('#fff1d6', 2.0);
    sun.position.set(2, 4, 3);
    this.#scene.add(sun, new THREE.HemisphereLight('#cfe8ff', '#5a7a3a', 0.8));
  }

  /** The impostor for a look, or null while it waits its turn to be photographed. */
  get(key: string, make: () => SandboxCharacter): Impostor | null {
    const hit = this.#done.get(key);
    if (hit) return hit;
    if (!this.#waiting.has(key)) {
      this.#waiting.add(key);
      this.#queue.push({ key, make });
    }
    return null;
  }

  /** Photograph the next waiting look (call once a frame, so it never stalls the town). */
  bakeNext(): void {
    const job = this.#queue.shift();
    if (!job) return;
    this.#waiting.delete(job.key);
    try {
      this.#done.set(job.key, this.#bake(job.make()));
    } catch (error) {
      console.warn('impostor', error);
    }
  }

  #bake(char: SandboxCharacter): Impostor {
    const obj = char.object;
    this.#scene.add(obj);
    obj.position.set(0, 0, 0);
    obj.rotation.y = 0;
    // size the shot from the walking pose (a mount's stride is the widest)
    char.setState('walk');
    char.update(0.01, 1, Math.PI / 2, this.#camera);
    obj.rotation.y = 0;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true);
    const size = box.getSize(new THREE.Vector3());
    const reach = Math.max(size.x, size.z) * 0.5 + 0.05;
    const height = size.y + 0.1;
    // an orthographic view from the town camera's tilt: the frame must hold
    // the figure's height (foreshortened) plus its depth (tilted into view)
    const viewH = height * Math.cos(ELEVATION) + reach * 2 * Math.sin(ELEVATION);
    const viewW = Math.max(reach * 2, (viewH * CW) / CH);
    const fullH = (viewW * CH) / CW;
    const cam = this.#camera;
    cam.left = -viewW / 2;
    cam.right = viewW / 2;
    cam.top = fullH / 2;
    cam.bottom = -fullH / 2;
    cam.updateProjectionMatrix();
    const centreY = box.min.y + height * 0.5;
    cam.position.set(0, centreY + Math.sin(ELEVATION) * 10, Math.cos(ELEVATION) * 10);
    cam.lookAt(0, centreY, 0);
    // where the feet (y = 0) land on the picture, from the bottom
    const feet = new THREE.Vector3(0, 0, 0).project(cam);
    const foot = (feet.y + 1) / 2;

    const frames: ImpostorFrame[][] = [];
    const shoot = (): HTMLCanvasElement => {
      this.#gl.setClearColor(0x000000, 0);
      this.#gl.render(this.#scene, cam);
      const c = document.createElement('canvas');
      c.width = CW;
      c.height = CH;
      c.getContext('2d')!.drawImage(this.#gl.domElement, 0, 0);
      return c;
    };
    for (let side = 0; side < 4; side++) {
      const row: ImpostorFrame[] = [];
      // standing
      char.setState('idle');
      char.update(0.01, 0, 0, cam);
      obj.rotation.y = (side * Math.PI) / 2;
      obj.updateMatrixWorld(true);
      row.push({ canvas: shoot() });
      // two walking poses, half a stride apart
      char.setState('walk');
      for (let pose = 0; pose < 2; pose++) {
        char.update(pose === 0 ? 0.05 : 0.33, 1.2, Math.PI / 2, cam);
        obj.rotation.y = (side * Math.PI) / 2;
        obj.updateMatrixWorld(true);
        row.push({ canvas: shoot() });
      }
      frames.push(row);
    }
    obj.removeFromParent();
    char.dispose();
    // world size of a cell: the ortho frame, un-tilted back to upright
    return { frames, width: viewW, height: fullH, foot };
  }
}

/**
 * Which side of a person the camera sees: 0 front, 1 right, 2 back, 3 left
 * (`yaw` the model's facing, models face +z at 0; `toCam` from the person to the camera, x/z).
 */
export function sideSeen(yaw: number, toCamX: number, toCamZ: number): number {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const angle = Math.atan2(fx * toCamZ - fz * toCamX, fx * toCamX + fz * toCamZ);
  return ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
}
