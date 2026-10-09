/**
 * The Chronicle Tower's signs in 3D: the toll board by its door (painted
 * wood, an LED panel or a hologram, after the theme) and the beacon on its
 * top, a fire whose size and colour follow the toll. Units are tiles.
 */

import * as THREE from 'three';
import type { BoardLook } from './themes.js';

export interface BoardText {
  head: string;
  fee: string;
  sub: string;
  color: string;
}

const W = 512;
const H = 256;

export class TollBoard3D {
  readonly object = new THREE.Group();
  readonly #canvas = document.createElement('canvas');
  readonly #tex: THREE.CanvasTexture;
  readonly #look: BoardLook;
  #last = '';

  constructor(look: BoardLook) {
    this.#look = look;
    this.#canvas.width = W;
    this.#canvas.height = H;
    this.#tex = new THREE.CanvasTexture(this.#canvas);
    this.#tex.colorSpace = THREE.SRGBColorSpace;
    this.#tex.anisotropy = 4;
    const bw = 1.5;
    const bh = 0.75;
    const lift = 0.75;
    const face = new THREE.MeshStandardMaterial({
      map: this.#tex,
      roughness: look === 'wood' ? 0.8 : 0.3,
      // panels and holograms light themselves (readable at night); paint does not
      ...(look === 'wood' ? {} : { emissive: new THREE.Color('#ffffff'), emissiveMap: this.#tex, emissiveIntensity: look === 'holo' ? 1.1 : 0.9 }),
      transparent: look === 'holo',
      opacity: look === 'holo' ? 0.88 : 1,
      side: look === 'holo' ? THREE.DoubleSide : THREE.FrontSide,
    });
    const frameColor = look === 'wood' ? '#6b4226' : look === 'led' ? '#2a2d33' : '#9fb4c8';
    const frame = new THREE.MeshStandardMaterial({ color: frameColor, roughness: look === 'wood' ? 0.85 : 0.4, metalness: look === 'wood' ? 0 : 0.6 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), face);
    board.position.set(0, lift + bh / 2, 0.035);
    if (look !== 'holo') {
      const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.1, bh + 0.1, 0.06), frame);
      back.position.set(0, lift + bh / 2, 0);
      back.castShadow = true;
      this.object.add(back);
    }
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, lift + bh, 0.07), frame);
      post.position.set(side * (bw / 2 - 0.12), (lift + bh) / 2, -0.04);
      post.castShadow = true;
      this.object.add(post);
    }
    if (look === 'holo') {
      // the projector the hologram stands on
      const base = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.9, 0.08, 0.2), frame);
      base.position.set(0, lift - 0.04, 0);
      this.object.add(base);
    }
    this.object.add(board);
    this.object.name = 'toll-board';
  }

  /** Repaint the board when its text changed. */
  update(t: BoardText): void {
    const key = `${t.head}|${t.fee}|${t.sub}|${t.color}`;
    if (key === this.#last) return;
    this.#last = key;
    const c = this.#canvas.getContext('2d');
    if (c === null) return;
    const look = this.#look;
    c.clearRect(0, 0, W, H);
    if (look === 'wood') {
      // planks and a slate face, chalked
      c.fillStyle = '#8a5a34';
      c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < H; y += 32) c.fillRect(0, y, W, 2);
      c.fillStyle = '#2d2a27';
      c.fillRect(18, 18, W - 36, H - 36);
    } else if (look === 'led') {
      c.fillStyle = '#0b0d10';
      c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.04)';
      for (let x = 0; x < W; x += 6) c.fillRect(x, 0, 1, H);
    } else {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(60,200,255,0.35)');
      g.addColorStop(1, 'rgba(60,200,255,0.12)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(140,230,255,0.9)';
      c.lineWidth = 4;
      c.strokeRect(6, 6, W - 12, H - 12);
      c.fillStyle = 'rgba(140,230,255,0.08)';
      for (let y = 0; y < H; y += 8) c.fillRect(0, y, W, 2);
    }
    const ink = look === 'wood' ? '#efe6d2' : look === 'led' ? '#ffcf6a' : '#c8f4ff';
    const font = look === 'wood' ? '"Trebuchet MS", system-ui, sans-serif' : '"Consolas", "Menlo", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // each line at its size, or smaller if it would not fit the face
    const fit = (text: string, px: number, weight: string): void => {
      const max = W - 56;
      c.font = `${weight}${px}px ${font}`;
      const w = c.measureText(text).width;
      if (w > max) c.font = `${weight}${Math.floor((px * max) / w)}px ${font}`;
    };
    c.fillStyle = ink;
    fit(t.head, 34, 'bold ');
    c.fillText(t.head, W / 2, 52);
    c.fillStyle = t.color;
    if (look !== 'wood') {
      c.shadowColor = t.color;
      c.shadowBlur = 14;
    }
    fit(t.fee, 72, 'bold ');
    c.fillText(t.fee, W / 2, 124);
    c.shadowBlur = 0;
    c.fillStyle = ink;
    fit(t.sub, 30, '');
    c.fillText(t.sub, W / 2, 196);
    this.#tex.needsUpdate = true;
  }
}

/** A soft round glow (for the beacon's halo). */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Beacon3D {
  readonly object = new THREE.Group();
  readonly #flame: THREE.Mesh;
  readonly #core: THREE.Mesh;
  readonly #halo: THREE.Sprite;
  readonly #flameMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.95 });
  readonly #haloMat: THREE.SpriteMaterial;

  constructor() {
    // an iron brazier to hold the fire
    const iron = new THREE.MeshStandardMaterial({ color: '#2c2a2a', roughness: 0.6, metalness: 0.7 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.2, 10, 1, true), iron);
    bowl.position.y = 0.1;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6), iron);
    stem.position.y = -0.1;
    this.#flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 10, 1, true), this.#flameMat);
    this.#flame.position.y = 0.48;
    this.#core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff6dc', toneMapped: false }));
    this.#core.position.y = 0.26;
    this.#haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.#halo = new THREE.Sprite(this.#haloMat);
    this.#halo.position.y = 0.4;
    this.object.add(bowl, stem, this.#flame, this.#core, this.#halo);
    this.object.name = 'tower-beacon';
  }

  /** `heat` 0..1 (cheap … dear), `rgb` its colour, `night` 0..1. */
  update(time: number, heat: number, rgb: [number, number, number], night: number): void {
    const flicker = 1 + Math.sin(time * 9.1) * 0.08 + Math.sin(time * 13.7 + 1) * 0.05;
    const size = (0.7 + heat * 1.3) * flicker;
    this.#flame.scale.set(size * 0.9, size, size * 0.9);
    this.#flame.position.y = 0.2 + 0.35 * size;
    this.#flame.rotation.y = time * 0.7;
    this.#flameMat.color.setRGB(rgb[0] * 1.6, rgb[1] * 1.6, rgb[2] * 1.6);
    this.#haloMat.color.setRGB(rgb[0], rgb[1], rgb[2]);
    this.#haloMat.opacity = 0.35 + night * 0.45;
    const halo = (1.4 + heat * 2.6) * (1 + night * 0.5) * flicker;
    this.#halo.scale.set(halo, halo, 1);
  }
}

/**
 * Rewards ready to claim, heaped by a building's door (tiles): a sack for a
 * little, crates and sacks for some, crates and a glittering heap of gold for
 * a lot.
 */
export function harvestPile(size: 'little' | 'some' | 'lot'): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a2a', roughness: 0.85 });
  const band = new THREE.MeshStandardMaterial({ color: '#5a3818', roughness: 0.8 });
  const burlap = new THREE.MeshStandardMaterial({ color: '#b08a52', roughness: 0.95 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.25, metalness: 0.9, emissive: new THREE.Color('#5a4000'), emissiveIntensity: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const sack = (x: number, z: number, s = 1): void => {
    add(new THREE.SphereGeometry(0.16 * s, 10, 8).scale(1, 1.15, 1), burlap, x, 0.16 * s, z);
    add(new THREE.CylinderGeometry(0.04 * s, 0.07 * s, 0.08 * s, 8), band, x, 0.36 * s, z);
  };
  const crate = (x: number, y: number, z: number, ry: number): void => {
    add(new THREE.BoxGeometry(0.34, 0.3, 0.34), wood, x, y + 0.15, z, ry);
    add(new THREE.BoxGeometry(0.36, 0.05, 0.36), band, x, y + 0.27, z, ry);
  };
  if (size === 'little') sack(0, 0);
  else if (size === 'some') {
    crate(-0.2, 0, 0, 0.2);
    crate(0.2, 0, 0.05, -0.15);
    sack(0, 0.3, 0.85);
    sack(0.05, -0.05, 0.8);
  } else {
    crate(-0.32, 0, -0.05, 0.25);
    crate(0.32, 0, -0.08, -0.2);
    crate(0, 0.3, -0.06, 0.05);
    // the heap of gold, coins spilling round it
    add(new THREE.ConeGeometry(0.3, 0.26, 14), goldMat, 0, 0.13, 0.32);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10), goldMat, Math.cos(a) * 0.38, 0.01, 0.32 + Math.sin(a) * 0.22, a);
    }
  }
  g.name = 'harvest';
  return g;
}
