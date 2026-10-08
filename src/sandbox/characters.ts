/**
 * The baseline character provider: today's pixel-art heroes and villagers as
 * billboards (the same art the town uses). A rigged-glTF provider will sit
 * beside it with the same interface.
 */

import * as THREE from 'three';
import { heroArt, villagerArt } from '../assets/art.js';
import type { Sprite } from '../render/pixel.js';
import type { AnimState, CharacterLook, CharacterProvider, SandboxCharacter } from './themes.js';

const ART_PER_TILE = 16;
const SCALE = 1.35;

const textures = new WeakMap<HTMLCanvasElement, [THREE.SpriteMaterial, THREE.SpriteMaterial]>();
/** Billboards are unlit; this tint dims them with the light (night, storm). */
const tint = new THREE.Color('#ffffff');
const allMaterials = new Set<THREE.SpriteMaterial>();

export function setSpriteTint(night: number): void {
  tint.setRGB(1, 1, 1).lerp(new THREE.Color('#7f88b8'), night * 0.85);
  for (const m of allMaterials) m.color.copy(tint);
}
function material(canvas: HTMLCanvasElement, flip: boolean): THREE.SpriteMaterial {
  let pair = textures.get(canvas);
  if (pair === undefined) {
    const mk = (f: boolean): THREE.SpriteMaterial => {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      if (f) {
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.x = -1;
      }
      const m = new THREE.SpriteMaterial({ map: t, alphaTest: 0.5, color: tint.clone() });
      allMaterials.add(m);
      return m;
    };
    pair = [mk(false), mk(true)];
    textures.set(canvas, pair);
  }
  return pair[flip ? 1 : 0];
}

class SpriteCharacter implements SandboxCharacter {
  readonly object = new THREE.Group();
  readonly #sprite = new THREE.Sprite();
  readonly #look: CharacterLook;
  #state: AnimState = 'idle';
  #phase = Math.random() * 10;
  #flip = false;
  #shadow: THREE.Mesh;

  constructor(look: CharacterLook) {
    this.#look = look;
    this.#shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false }));
    this.#shadow.position.y = 0.02;
    this.object.add(this.#sprite, this.#shadow);
  }

  setState(state: AnimState): void {
    this.#state = state;
  }

  #art(frame: number): Sprite {
    const l = this.#look;
    return l.kind === 'hero' ? heroArt({ address: l.id, cls: l.cls, tier: l.tier, crest: l.crest, skin: l.seed % 4, hair: (l.seed >> 3) % 6 }, frame, false) : villagerArt(l.seed, frame, false);
  }

  update(dt: number, speed: number, heading: number, camera: THREE.Camera): void {
    const moving = this.#state !== 'idle' && speed > 0.01;
    this.#phase += dt * (moving ? 3 + speed * 2.2 : 2);
    const frame = moving ? Math.floor(this.#phase) : 0;
    if (moving) {
      // face the walking direction as seen on screen
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
      this.#flip = dir.dot(right) < 0;
    }
    const s = this.#art(frame);
    const sp = this.#sprite;
    sp.material = material(s.canvas, this.#flip);
    sp.scale.set((s.canvas.width / ART_PER_TILE) * SCALE, (s.canvas.height / ART_PER_TILE) * SCALE, 1);
    sp.center.set(this.#flip ? 1 - s.ax / s.canvas.width : s.ax / s.canvas.width, 1 - s.ay / s.canvas.height);
    sp.position.y = moving ? 0 : Math.abs(Math.sin(this.#phase * 2)) * 0.02;
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}

export const spriteCharacters: CharacterProvider = {
  label: 'Pixel-art billboards (built-in)',
  create: (look) => new SpriteCharacter(look),
};
