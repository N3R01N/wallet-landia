/**
 * The baseline character provider: today's pixel-art heroes and villagers as
 * billboards (the same art the town uses). A rigged-glTF provider will sit
 * beside it with the same interface.
 */

import * as THREE from 'three';
import { heroArt, villagerArt } from '../../assets/art.js';
import type { Sprite } from '../pixel.js';
import type { AnimState, CharacterLook, CharacterProvider, SandboxCharacter } from './themes.js';
import { SpriteMaterials } from './spriteMaterials.js';

const ART_PER_TILE = 16;
const SCALE = 1.35;

/** Billboards are unlit: their tint dims them with the light (night). The most recently used are kept. */
const materials = new SpriteMaterials();
const nightTint = new THREE.Color('#7f88b8');

export function setSpriteTint(night: number): void {
  materials.tint.setRGB(1, 1, 1).lerp(nightTint, night * 0.85);
  materials.retint();
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
    sp.material = materials.get(s.canvas, this.#flip);
    sp.scale.set((s.canvas.width / ART_PER_TILE) * SCALE, (s.canvas.height / ART_PER_TILE) * SCALE, 1);
    sp.center.set(this.#flip ? 1 - s.ax / s.canvas.width : s.ax / s.canvas.width, 1 - s.ay / s.canvas.height);
    sp.position.y = moving ? 0 : Math.abs(Math.sin(this.#phase * 2)) * 0.02;
  }

  dispose(): void {
    this.object.removeFromParent();
    // its own contact shadow (the sprite's materials are shared per art frame)
    this.#shadow.geometry.dispose();
    (this.#shadow.material as THREE.Material).dispose();
  }
}

export const spriteCharacters: CharacterProvider = {
  label: 'Pixel-art billboards (built-in)',
  create: (look) => new SpriteCharacter(look),
};
