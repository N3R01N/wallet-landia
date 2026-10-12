/**
 * The 2D layer over the 3D town: bell rings, coins and alarms, weather,
 * district labels, the route, markers, protocol logos on the signs, goods,
 * speech and name tags, each drawn in screen space at its 3D spot.
 */

import * as THREE from 'three';
import type { Placed } from '../../world/layout.js';
import type { Effect, Sim } from '../../world/sim.js';
import { bubbles, carriedGoods, districtLabels, floatingText, markers, nameTags, route, transfers, weather, type Project } from '../overlay.js';
import type { HitTarget } from '../view.js';
import type { TownScene } from './townScene.js';

export class Overlay3D {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: THREE.Camera;
  /**
   * Logo images for the overlay. Logo hosts often send no CORS headers, which
   * WebGL textures require; a 2D overlay canvas can draw them regardless.
   */
  #logos = new Map<string, HTMLImageElement>();
  /** Signs a building stands in front of (logo hidden); refreshed every few frames. */
  #hiddenSigns = new Set<string>();
  #raycaster = new THREE.Raycaster();
  // scratch: projection runs hundreds of times a frame
  #projected = new THREE.Vector3();
  #to = new THREE.Vector3();
  #dir = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera) {
    this.#canvas = canvas;
    this.#camera = camera;
  }

  /** Tile position and height to CSS px in the canvas, or null behind the camera. */
  project: Project = (x, y, z = 0) => {
    const v = this.#projected.set(x, z, y).project(this.#camera);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * this.#canvas.clientWidth, ((1 - v.y) / 2) * this.#canvas.clientHeight];
  };

  /** `distance`: the camera's from its target (tiles), which decides what is worth drawing. */
  draw(dpr: number, w: number, h: number, sim: Sim, town: TownScene, distance: number): void {
    const c = this.#canvas.getContext('2d');
    if (c === null) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const towerTop = town.tower?.top;
    for (const e of sim.effects) this.#effect(c, e, towerTop, distance);
    weather(c, sim, w, h, false);
    if (distance > 30) districtLabels(c, this.project);
    if (sim.route) route(c, sim.route, this.project, sim.elapsed);
    const tops = new Map<string, [number, number]>();
    for (const b of town.buildings) {
      const p = this.project(b.placed.x + b.placed.w / 2, b.placed.y + b.placed.h / 2, b.top + 0.3);
      if (p) tops.set(b.placed.id, p);
    }
    this.#signLogos(c, sim, town, distance);
    markers(c, sim, tops);
    // goods changing hands, and what people carry and say (sized with the zoom)
    const zoom = Math.max(0.55, Math.min(1.7, 34 / distance));
    transfers(c, sim, this.project, zoom);
    floatingText(c, sim, this.project, 2.6);
    if (distance < 45) {
      carriedGoods(c, sim, (x, y, alt) => this.project(x, y, 3.05 + alt), zoom);
      bubbles(c, sim, (x, y, alt) => this.project(x, y, 2.0 + alt), zoom);
    }
    if (distance < 55) nameTags(c, sim, (x, y, alt) => this.project(x, y, 2.6 + alt));
  }

  /**
   * Logos are drawn on the 2D overlay (their hosts send no CORS headers), so
   * the depth buffer cannot hide them. A ray from the camera to each sign,
   * every few frames, tells which ones another building stands in front of.
   */
  occludeSigns(town: TownScene): void {
    this.#hiddenSigns.clear();
    const origin = this.#camera.position;
    const groups = town.buildingGroups;
    for (const b of town.buildings) {
      const s = b.sign;
      if (s === undefined) continue;
      const dir = this.#dir.copy(this.#to.set(s.x, s.y, s.z)).sub(origin);
      const dist = dir.length();
      this.#raycaster.set(origin, dir.normalize());
      this.#raycaster.far = dist - 0.15;
      const hit = this.#raycaster.intersectObjects(groups, true)[0];
      if (hit && (hit.object.userData.target as HitTarget | undefined)?.kind === 'building' && (hit.object.userData.target as { placed: Placed }).placed.id !== b.placed.id) {
        this.#hiddenSigns.add(b.placed.id);
      }
    }
    this.#raycaster.far = Infinity;
  }

  /** Protocol logos over the sign boards, when the sign faces the camera. */
  #signLogos(c: CanvasRenderingContext2D, sim: Sim, town: TownScene, distance: number): void {
    if (distance > 75) return;
    c.imageSmoothingEnabled = true;
    for (const b of town.buildings) {
      const s = b.sign;
      if (s === undefined) continue;
      if (this.#camera.position.z - s.z < 0.5) continue; // seen from behind
      if (this.#hiddenSigns.has(b.placed.id)) continue; // another building is in the way
      if (sim.fogOver(b.placed) > 0.5) continue; // still in the fog of war
      let img = this.#logos.get(s.url);
      if (img === undefined) {
        img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = s.url;
        this.#logos.set(s.url, img);
      }
      if (!img.complete || img.naturalWidth === 0) continue;
      const a = this.project(s.x - 0.27, s.z, s.y + 0.27);
      const d = this.project(s.x + 0.27, s.z, s.y - 0.27);
      if (a === null || d === null) continue;
      const size = Math.max(Math.abs(d[0] - a[0]), Math.abs(d[1] - a[1]));
      if (size < 6) continue;
      c.drawImage(img, (a[0] + d[0]) / 2 - size / 2, (a[1] + d[1]) / 2 - size / 2, size, size);
    }
  }

  /** Bell rings, coins, smoke and alarms, drawn in screen space at their 3D spot. `towerTop`: the tower's roof (tiles). */
  #effect(c: CanvasRenderingContext2D, e: Effect, towerTop: number | undefined, distance: number): void {
    const k = e.age / e.ttl;
    const zoom = Math.max(0.5, Math.min(2.5, 50 / distance));
    switch (e.kind) {
      case 'ring': {
        const p = this.project(e.x, e.y, (towerTop ?? 6) - 1.6);
        if (!p) return;
        c.strokeStyle = `rgba(255,236,160,${(1 - k) * 0.9})`;
        c.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const r = (8 + (k + i * 0.15) * 70) * zoom;
          c.beginPath();
          c.ellipse(p[0], p[1], r, r * 0.45, 0, 0, Math.PI * 2);
          c.stroke();
        }
        return;
      }
      case 'coins':
      case 'sparkle': {
        const p = this.project(e.x, e.y, 0.8);
        if (!p) return;
        const n = 6 + e.drama * 6;
        c.globalAlpha = 1 - k;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = k * (20 + e.drama * 14) * zoom;
          c.fillStyle = e.color ?? (e.kind === 'sparkle' ? (i % 2 ? '#fff6c0' : '#a0e8ff') : '#f5c518');
          c.fillRect(p[0] + Math.cos(ang) * r - 2, p[1] - Math.sin(ang) * r * 0.6 - k * 20 - 2, 4, 4);
        }
        c.globalAlpha = 1;
        return;
      }
      case 'smoke': {
        const p = this.project(e.x, e.y, 0.8);
        if (!p) return;
        for (let i = 0; i < 5; i++) {
          c.fillStyle = `rgba(90,90,90,${0.5 * (1 - k)})`;
          c.beginPath();
          c.arc(p[0] + Math.sin(i * 2) * 8, p[1] - k * 30 - i * 4, (5 + k * 8) * zoom, 0, Math.PI * 2);
          c.fill();
        }
        return;
      }
      case 'key': {
        const p = this.project(e.x, e.y, 1.6 + k);
        if (!p) return;
        c.globalAlpha = 1 - k;
        c.fillStyle = e.color ?? '#ffd166';
        c.fillRect(p[0] - 8, p[1], 6, 6);
        c.fillRect(p[0] - 2, p[1] + 2, 10, 2);
        c.fillRect(p[0] + 6, p[1] + 2, 2, 4);
        c.globalAlpha = 1;
        return;
      }
      case 'alarm': {
        if (Math.floor(e.age * 6) % 2 !== 0) return;
        const p = this.project(e.x, e.y + 2, towerTop ?? 6);
        if (!p) return;
        c.strokeStyle = 'rgba(255,70,50,0.9)';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(p[0], p[1], (20 + e.drama * 10) * zoom, (9 + e.drama * 4) * zoom, 0, 0, Math.PI * 2);
        c.stroke();
        return;
      }
      default:
        return;
    }
  }
}
