/**
 * One renderer, two projections. Top-down and isometric draw the same Sim
 * state; only the tile→art mapping, depth order and building sprites differ.
 */

import type { HeroClass } from '../domain/model.js';
import { MAP_H, MAP_W, type Placed, type Pt } from '../world/layout.js';
import type { Agent, Effect, Sim } from '../world/sim.js';
import { crestColors, hashString } from '../util/rng.js';
import { brandColor, ISO_H, ISO_W } from './buildings.js';
import { buildingArt, caravanArt, heroArt, npcArt, propArt, villagerArt } from '../assets/art.js';
import { bakeIsoGround, bakeTopGround, scatterProps, type Ground, type Prop } from './ground.js';
import type { Sprite } from './pixel.js';
import { districtLabels, floatingText, markers, nameTags, route, weather } from './overlay.js';
import type { HitTarget, WorldView } from './view.js';

export type { HitTarget } from './view.js';
export type Projection = 'top' | 'iso';

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  target: HitTarget;
}

interface Drawable {
  depth: number;
  draw: () => void;
}

const TOP_T = 16;
/** Art pixels per tile of height, for flyers in the 2D views. */
const ALT_PX = 7;

/** The 2D renderer: one class, two projections (top-down and isometric). */
export class Renderer implements WorldView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  get element(): HTMLElement {
    return this.canvas;
  }
  view: Projection = 'top';
  scale = 2;
  ox = 0;
  oy = 0;
  hover: HitTarget | null = null;
  selected: HitTarget | null = null;
  classOf: (address: string) => HeroClass = () => 'adventurer';

  #sim: Sim;
  #grounds = new Map<Projection, Ground>();
  #props: Prop[];
  #hits: Hit[] = [];
  #logos = new Map<string, HTMLImageElement>();
  #dpr = 1;
  /** Screen position of each building's top-centre this frame, for markers. */
  #tops = new Map<string, [number, number]>();
  #guildColor: string;

  constructor(canvas: HTMLCanvasElement, sim: Sim) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
    this.#sim = sim;
    this.#props = scatterProps(sim.plan);
    const first = sim.guild.heroes[0];
    this.#guildColor = first ? crestColors(first.address)[0] : '#c0392b';
  }

  setSim(sim: Sim): void {
    this.#sim = sim;
    this.#grounds.clear();
    this.#props = scatterProps(sim.plan);
  }

  // --- projection ------------------------------------------------------------

  toArt(x: number, y: number): [number, number] {
    return this.view === 'top' ? [x * TOP_T, y * TOP_T] : [(x - y) * ISO_W, (x + y) * ISO_H];
  }

  toScreen(x: number, y: number): [number, number] {
    const [ax, ay] = this.toArt(x, y);
    return [ax * this.scale + this.ox, ay * this.scale + this.oy];
  }

  #depth(x: number, y: number): number {
    return this.view === 'top' ? y : x + y;
  }

  fit(): void {
    const corners: Pt[] = [{ x: 0, y: 0 }, { x: MAP_W, y: 0 }, { x: 0, y: MAP_H }, { x: MAP_W, y: MAP_H }];
    const pts = corners.map((p) => this.toArt(p.x, p.y));
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1])) - 40;
    const maxY = Math.max(...pts.map((p) => p[1]));
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.scale = Math.max(0.5, Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.96);
    this.ox = (w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oy = (h - (maxY - minY) * this.scale) / 2 - minY * this.scale;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.max(0.6, Math.min(8, this.scale * factor));
    const f = next / this.scale;
    this.ox = sx - (sx - this.ox) * f;
    this.oy = sy - (sy - this.oy) * f;
    this.scale = next;
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }

  rotate(): void {
    // fixed projections do not orbit
  }

  /** Centre the camera on a tile position. */
  focus(x: number, y: number): void {
    const [ax, ay] = this.toArt(x, y);
    this.ox = this.canvas.clientWidth / 2 - ax * this.scale;
    this.oy = this.canvas.clientHeight / 2 - ay * this.scale;
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    for (let i = this.#hits.length - 1; i >= 0; i--) {
      const h = this.#hits[i];
      if (h && sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h.target;
    }
    return null;
  }

  // --- frame -----------------------------------------------------------------

  draw(): void {
    const c = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr) || this.#dpr !== dpr) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.#dpr = dpr;
    }
    const sim = this.#sim;
    const shake = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 6 : 0;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = this.view === 'top' ? '#4f8a46' : '#26402e';
    c.fillRect(0, 0, w, h);

    c.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, (this.ox + shake) * dpr, this.oy * dpr);
    const ground = this.#ground();
    c.drawImage(ground.canvas, ground.x, ground.y);
    this.#water(c);

    this.#hits = [];
    const items: Drawable[] = [];
    for (const b of sim.plan.buildings) items.push(this.#buildingDrawable(b));
    for (const p of this.#props) {
      const s = propArt(p.kind);
      items.push({ depth: this.#depth(p.x, p.y) - 0.3, draw: () => this.#blit(s, p.x, p.y) });
    }
    for (const a of sim.agents) items.push(...this.#agentDrawables(a));
    items.sort((p, q) => p.depth - q.depth);
    for (const d of items) d.draw();

    for (const e of sim.effects) this.#effect(c, e);

    // screen space from here
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    weather(c, sim, w, h, true);
    const project = (x: number, y: number): [number, number] => this.toScreen(x, y);
    if (this.scale <= 3) districtLabels(c, project);
    if (sim.route) route(c, sim.route, project, sim.elapsed);
    markers(c, sim, this.#tops);
    floatingText(c, sim, (x, y) => {
      const p = this.toScreen(x, y);
      return [p[0], p[1] - 30];
    }, 0);
    if (this.scale >= 1.4) {
      nameTags(c, sim, (x, y, alt) => {
        const [sx, sy] = this.toScreen(x, y);
        return [sx, sy - 40 * this.scale * 0.5 - alt * ALT_PX * this.scale - 6];
      });
    }
  }

  #ground(): Ground {
    let g = this.#grounds.get(this.view);
    if (g === undefined) {
      g = this.view === 'top' ? bakeTopGround(this.#sim.plan) : bakeIsoGround(this.#sim.plan);
      this.#grounds.set(this.view, g);
    }
    return g;
  }

  /** A little shimmer on the harbour water. */
  #water(c: CanvasRenderingContext2D): void {
    const t = this.#sim.elapsed;
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 18; i++) {
      const x = 37 + ((i * 5.3) % 10) + Math.sin(t * 0.7 + i) * 0.3;
      const y = 29.5 + ((i * 3.7) % 6);
      const [ax, ay] = this.toArt(x, y);
      if ((Math.floor(t * 1.5 + i) % 3) !== 0) c.fillRect(ax, ay, 4, 1);
    }
  }

  #blit(s: Sprite, x: number, y: number, flip = false, lift = 0): [number, number] {
    const [ax, ay] = this.toArt(x, y);
    const left = Math.round(ax - s.ax);
    const top = Math.round(ay - s.ay - lift);
    if (flip) {
      this.ctx.save();
      this.ctx.translate(Math.round(ax), 0);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(s.canvas, Math.round(-s.ax), top);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(s.canvas, left, top);
    }
    return [left, top];
  }

  #buildingSprite(b: Placed): Sprite {
    const sim = this.#sim;
    const protocol = b.protocolId !== undefined ? sim.guild.protocols.get(b.protocolId) : undefined;
    const roof = protocol ? brandColor(protocol.id) : '#a0522d';
    const hero = b.heroAddress !== undefined ? sim.guild.heroes.find((x) => x.address === b.heroAddress) : undefined;
    const tier = hero?.tier ?? 0;
    const variant = b.kind === 'guildhall' ? this.#guildColor : hero ? this.#guildColor : '';
    return buildingArt(this.view, b.kind, b.w, b.h, roof, tier, variant);
  }

  #buildingDrawable(b: Placed): Drawable {
    const depth = this.view === 'top' ? b.y + b.h - 0.05 : b.x + b.w / 2 + b.y + b.h / 2;
    return {
      depth,
      draw: () => {
        const s = this.#buildingSprite(b);
        const anchor = this.view === 'top' ? { x: b.x, y: b.y + b.h } : { x: b.x, y: b.y };
        const [left, top] = this.#blit(s, anchor.x, anchor.y);
        const protocol = b.protocolId !== undefined ? this.#sim.guild.protocols.get(b.protocolId) : undefined;
        if (s.sign && protocol?.iconUrl) {
          const img = this.#logo(protocol.iconUrl);
          if (img.complete && img.naturalWidth > 0) {
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.drawImage(img, left + s.sign.x + 0.5, top + s.sign.y + 0.5, s.sign.w - 1, s.sign.h - 1);
            this.ctx.imageSmoothingEnabled = false;
          }
        }
        // recently visited buildings glow for a moment
        const visited = b.protocolId !== undefined ? this.#sim.lastVisit.get(b.protocolId) : undefined;
        if (visited !== undefined && this.#sim.elapsed - visited < 2) {
          this.ctx.globalAlpha = 0.45 * (1 - (this.#sim.elapsed - visited) / 2);
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.drawImage(s.canvas, left, top);
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.globalAlpha = 1;
        }
        const isHover = this.#isTarget(this.hover, b) || this.#isTarget(this.selected, b);
        if (isHover) {
          this.ctx.strokeStyle = '#fff3b0';
          this.ctx.lineWidth = 1 / this.scale + 0.5;
          this.ctx.strokeRect(left + 0.5, top + 0.5, s.canvas.width - 1, s.canvas.height - 1);
        }
        this.#hits.push({
          x: left * this.scale + this.ox,
          y: top * this.scale + this.oy,
          w: s.canvas.width * this.scale,
          h: s.canvas.height * this.scale,
          target: { kind: 'building', placed: b },
        });
        // sprites carry headroom above the roof; skip most of it
        const headroom = this.view === 'iso' ? 18 : 6;
        this.#tops.set(b.id, [(left + s.canvas.width / 2) * this.scale + this.ox, (top + headroom) * this.scale + this.oy]);
      },
    };
  }

  #isTarget(t: HitTarget | null, b: Placed): boolean {
    return t !== null && t.kind === 'building' && t.placed.id === b.id;
  }

  #logo(url: string): HTMLImageElement {
    let img = this.#logos.get(url);
    if (img === undefined) {
      img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      this.#logos.set(url, img);
    }
    return img;
  }

  #agentDrawables(a: Agent): Drawable[] {
    const out: Drawable[] = [];
    const moving = a.path.length > 0;
    const frame = moving ? Math.floor(a.phase) : 0;
    const bob = moving ? 0 : Math.sin(a.phase * 2) * 0.4;
    const flip = a.facing < 0;
    // Height comes from the simulation (flyers cruise above the roofs).
    const airborne = a.alt > 0.05;
    const lift = a.alt * ALT_PX + (airborne ? Math.sin(a.phase) * 2 : 0);
    if (airborne) {
      // a shadow on the ground beneath the flyer, smaller the higher it is
      const r = Math.max(2, 7 - a.alt * 0.5);
      out.push({
        depth: this.#depth(a.x, a.y) - 0.02,
        draw: () => {
          const [gx, gy] = this.toArt(a.x, a.y);
          this.ctx.fillStyle = 'rgba(30,20,10,0.22)';
          this.ctx.beginPath();
          this.ctx.ellipse(gx, gy, r, r * 0.4, 0, 0, Math.PI * 2);
          this.ctx.fill();
        },
      });
    }

    // the caravan follows on the trail, one or two steps behind
    if (a.carrying !== null && a.carrying > 0 && a.kind === 'hero') {
      const back = a.trail[a.flying ? 6 : 9];
      const cs = caravanArt(a.carrying, frame);
      if (back && cs) out.push({ depth: this.#depth(back.x, back.y), draw: () => this.#blit(cs, back.x, back.y, flip, lift * 0.6) });
    }

    out.push({
      depth: this.#depth(a.x, a.y) + 0.01,
      draw: () => {
        let s: Sprite;
        if (a.kind === 'hero' && a.hero) {
          const h = hashString(a.hero.address);
          s = heroArt(
            { address: a.hero.address, cls: this.classOf(a.hero.address), tier: a.hero.tier, crest: crestColors(a.hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 },
            frame,
            !airborne,
          );
        } else if (a.kind === 'villager') {
          s = villagerArt(hashString(a.id), frame, true);
        } else {
          s = npcArt(a.kind === 'raven' ? 'raven' : a.kind === 'herald' ? 'herald' : 'bailiff', frame);
        }
        const [left, top] = this.#blit(s, a.x, a.y, flip, lift + bob);
        if (a.kind === 'hero' && a.hero) {
          // the guild banner over owned heroes
          const [ax, ay] = this.toArt(a.x, a.y);
          const fy = ay - s.ay - lift - 4;
          this.ctx.fillStyle = '#5e3a1e';
          this.ctx.fillRect(Math.round(ax) + 7, Math.round(fy) + 4, 1, 12);
          this.ctx.fillStyle = this.#guildColor;
          this.ctx.fillRect(Math.round(ax) + 8, Math.round(fy) + 4, 5, 4);
          const isSel = this.selected?.kind === 'hero' && this.selected.address === a.hero.address;
          const isHov = this.hover?.kind === 'hero' && this.hover.address === a.hero.address;
          if (isSel || isHov) {
            this.ctx.strokeStyle = '#fff3b0';
            this.ctx.lineWidth = 0.75;
            this.ctx.beginPath();
            this.ctx.ellipse(ax, ay, 9, 3.5, 0, 0, Math.PI * 2);
            this.ctx.stroke();
          }
          this.#hits.push({
            x: left * this.scale + this.ox,
            y: top * this.scale + this.oy,
            w: s.canvas.width * this.scale,
            h: s.canvas.height * this.scale,
            target: { kind: 'hero', address: a.hero.address },
          });
        }
      },
    });
    return out;
  }

  // --- effects ---------------------------------------------------------------

  #effect(c: CanvasRenderingContext2D, e: Effect): void {
    const k = e.age / e.ttl;
    const [x, y] = this.toArt(e.x, e.y);
    switch (e.kind) {
      case 'ring': {
        // the Chronicle bell: rings spread from the top of the tower
        const topY = y - (this.view === 'top' ? 64 : 80);
        c.strokeStyle = `rgba(255,236,160,${(1 - k) * 0.9})`;
        c.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const r = 6 + (k + i * 0.15) * 40;
          c.beginPath();
          c.ellipse(x, topY, r, r * 0.5, 0, 0, Math.PI * 2);
          c.stroke();
        }
        break;
      }
      case 'coins':
      case 'sparkle': {
        const n = 6 + e.drama * 6;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = k * (10 + e.drama * 8);
          const px = x + Math.cos(ang) * r;
          const py = y - 8 - Math.sin(ang) * r * 0.6 - k * 10;
          c.fillStyle = e.color ?? (e.kind === 'sparkle' ? (i % 2 ? '#fff6c0' : '#a0e8ff') : '#f5c518');
          c.globalAlpha = 1 - k;
          c.fillRect(px - 1, py - 1, 2, 2);
        }
        c.globalAlpha = 1;
        break;
      }
      case 'smoke':
        for (let i = 0; i < 5; i++) {
          c.fillStyle = `rgba(90,90,90,${0.5 * (1 - k)})`;
          c.beginPath();
          c.arc(x + Math.sin(i * 2) * 5, y - 8 - k * 14 - i * 2, 3 + k * 4, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'key': {
        const ky = y - 14 - k * 10;
        c.globalAlpha = 1 - k;
        c.fillStyle = e.color ?? '#ffd166';
        c.fillRect(x - 4, ky, 3, 3);
        c.fillRect(x - 1, ky + 1, 5, 1);
        c.fillRect(x + 3, ky + 1, 1, 2);
        c.globalAlpha = 1;
        break;
      }
      case 'alarm': {
        const on = Math.floor(e.age * 6) % 2 === 0;
        if (on) {
          c.strokeStyle = 'rgba(255,70,50,0.9)';
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(x, y - 70, 14 + e.drama * 6, 7 + e.drama * 3, 0, 0, Math.PI * 2);
          c.stroke();
        }
        break;
      }
      case 'storm':
      case 'float':
        break;
    }
  }
}
