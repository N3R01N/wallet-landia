/**
 * Pixel-art plumbing. Every sprite in the default pack ("Hearth & Harvest") is
 * drawn in code at low resolution, cached once, and scaled up with smoothing
 * off. Slots resolve to these sprites; another pack could resolve to images.
 */

export type Ctx = CanvasRenderingContext2D;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Anchor in sprite pixels: the point that sits on the world position. */
  ax: number;
  ay: number;
  /** Where a protocol logo goes, in sprite pixels. */
  sign?: { x: number; y: number; w: number; h: number };
}

const cache = new Map<string, Sprite>();

export function sprite(
  key: string,
  w: number,
  h: number,
  ax: number,
  ay: number,
  draw: (c: Ctx) => { sign?: Sprite['sign'] } | void,
): Sprite {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const c = canvas.getContext('2d');
  if (c === null) throw new Error('2d canvas unavailable');
  c.imageSmoothingEnabled = false;
  const extra = draw(c);
  const s: Sprite = { canvas, ax, ay };
  if (extra && extra.sign) s.sign = extra.sign;
  cache.set(key, s);
  return s;
}

export function px(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function poly(c: Ctx, pts: readonly (readonly [number, number])[], fill: string, stroke?: string): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke !== undefined) {
    c.strokeStyle = stroke;
    c.lineWidth = 1;
    c.stroke();
  }
}

/** Shift a hex/hsl colour lighter (+) or darker (-) via an overlay. */
export function shade(color: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m === null || m[1] === undefined) return color;
  const n = parseInt(m[1], 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v + amount * (amount > 0 ? 255 - v : v))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function hsl2hex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** A warm, slightly desaturated Stardew-ish palette. */
export const P = {
  outline: '#2b1d14',
  skin: ['#f2c9a0', '#d9a066', '#a86b3c', '#7a4a28'],
  hair: ['#3b2a1a', '#7a4a1e', '#d8b25a', '#a33a1e', '#e8e0d0', '#1e1e28'],
  wood: '#8a5a32',
  woodDark: '#5e3a1e',
  woodLight: '#b07a46',
  stone: '#b8b0a0',
  stoneDark: '#8a8274',
  stoneLight: '#d8d0c0',
  plaster: '#efe2c4',
  plasterDark: '#cdbd98',
  thatch: '#d8b45a',
  slate: '#5a6478',
  gold: '#f5c518',
  goldDark: '#b8860b',
  silver: '#d0d6de',
  silverDark: '#8e98a6',
  red: '#c0392b',
  redDark: '#7f2318',
  green: '#5fbf4a',
  greenDark: '#3a7d2c',
  blue: '#4a8fe0',
  purple: '#8e5bd0',
  white: '#fbf7ec',
  glass: '#8fc6e8',
  glassLit: '#ffd77a',
  shadow: 'rgba(30,20,10,0.28)',
} as const;
