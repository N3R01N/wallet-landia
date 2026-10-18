/**
 * The minimap: the whole field small, in the corner. The land (water and
 * rock darker), the buildings and units in their sides' colours, a flash
 * where you are under attack, and the view's outline. A click moves the
 * view there; a right click sends the selected units.
 */

import { TEAM_COLORS } from '../../game/render/battleView.js';
import { BUILDINGS, type PlayerId } from '../data/rules.js';
import type { World } from '../core/world.js';

const SIZE = 168;

export class Minimap {
  readonly element: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #ground: HTMLCanvasElement;
  readonly #world: World;
  #pings: { x: number; z: number; age: number }[] = [];

  constructor(world: World, opts: { onLook: (x: number, z: number) => void; onSend: (x: number, z: number) => void }) {
    this.#world = world;
    this.element = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE, className: 'rts-minimap' });
    this.element.setAttribute('aria-label', 'Map of the field: click to look there, right-click to send the selected units');
    this.#ctx = this.element.getContext('2d')!;
    this.#ground = this.#paintGround();
    const at = (e: MouseEvent) => {
      const r = this.element.getBoundingClientRect();
      const size = world.map.size;
      return { x: ((e.clientX - r.left) / r.width - 0.5) * size, z: ((e.clientY - r.top) / r.height - 0.5) * size };
    };
    let held = false;
    this.element.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        held = true;
        const p = at(e);
        opts.onLook(p.x, p.z);
      } else if (e.button === 2) {
        const p = at(e);
        opts.onSend(p.x, p.z);
      }
    });
    this.element.addEventListener('pointermove', (e) => {
      if (!held) return;
      const p = at(e);
      opts.onLook(p.x, p.z);
    });
    window.addEventListener('pointerup', () => (held = false));
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** A flash where something of yours is attacked. */
  ping(x: number, z: number): void {
    if (this.#pings.some((p) => Math.hypot(p.x - x, p.z - z) < 12 && p.age < 1.5)) return;
    this.#pings.push({ x, z, age: 0 });
  }

  /** Draws it all; `view` is the view's outline on the ground (four corners, or null). */
  draw(me: PlayerId, view: { x: number; z: number }[] | null, dt: number): void {
    const c = this.#ctx;
    const w = this.#world;
    const k = SIZE / w.map.size;
    const px = (x: number) => (x + w.map.size / 2) * k;
    c.drawImage(this.#ground, 0, 0);
    for (const b of w.buildings) {
      const f = BUILDINGS[b.kind].footprint * k;
      c.fillStyle = TEAM_COLORS[b.owner];
      c.fillRect(px(b.x) - f / 2, px(b.z) - f / 2, f, f);
      c.strokeStyle = b.owner === me ? '#f3ead6' : '#2a2118';
      c.strokeRect(px(b.x) - f / 2, px(b.z) - f / 2, f, f);
    }
    for (const u of w.units) {
      if (u.died >= 0) continue;
      c.fillStyle = u.owner === me ? '#9fd0ff' : '#ff8a70';
      c.fillRect(px(u.x) - 1, px(u.z) - 1, 2.4, 2.4);
    }
    this.#pings = this.#pings.filter((p) => (p.age += dt) < 2);
    for (const p of this.#pings) {
      c.strokeStyle = `rgba(255, 70, 50, ${1 - p.age / 2})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(px(p.x), px(p.z), 4 + p.age * 8, 0, Math.PI * 2);
      c.stroke();
    }
    if (view) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1;
      c.beginPath();
      view.forEach((p, i) => (i === 0 ? c.moveTo(px(p.x), px(p.z)) : c.lineTo(px(p.x), px(p.z))));
      c.closePath();
      c.stroke();
    }
  }

  #paintGround(): HTMLCanvasElement {
    const w = this.#world;
    const g = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const c = g.getContext('2d')!;
    const img = c.createImageData(SIZE, SIZE);
    const n = w.map.size;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cx = Math.floor((x / SIZE) * n);
        const cz = Math.floor((y / SIZE) * n);
        const blocked = w.map.blocked[cz * n + cx] === 1;
        const wz = cz - n / 2 + 0.5;
        const river = blocked && Math.abs(wz) <= w.map.river.half;
        const [r, gr, b] = river ? [70, 140, 190] : blocked ? [70, 95, 55] : [120, 168, 74];
        const i = (y * SIZE + x) * 4;
        img.data.set([r, gr, b, 255], i);
      }
    }
    c.putImageData(img, 0, 0);
    return g;
  }
}
