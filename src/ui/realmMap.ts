/**
 * The Realm Map (L0, Phase 6): Ethereum's kingdom in the middle of the sea,
 * its L2 provinces round it, each sized by what the guild keeps there; sea
 * lanes between them, with ships for the bridge crossings in the loaded
 * window. An island is a button: it takes you to that realm's town.
 *
 * The sea and islands are painted on a canvas (animated while open); the
 * islands' labels are real buttons over it, so they read crisply and work
 * with the keyboard. All names go through textContent.
 */

import { approxUsd } from '../domain/tiers.js';
import type { RealmSummary } from '../domain/realms.js';
import { makeRng, hashString } from '../util/rng.js';
import { el } from './dom.js';

interface Isle {
  s: RealmSummary;
  /** Centre and radius, as fractions of the sea's width and height (r of the smaller side). */
  x: number;
  y: number;
  r: number;
  shape: number[];
}

/** Where the islands lie: the kingdom in the middle, provinces round it (from the north-east, clockwise). */
function layout(sums: RealmSummary[]): Isle[] {
  const kingdom = sums.find((s) => s.realm.kind === 'kingdom');
  const provinces = sums.filter((s) => s !== kingdom);
  const most = Math.max(1, ...provinces.map((s) => s.usd));
  const isle = (s: RealmSummary, x: number, y: number, r: number): Isle => {
    const rng = makeRng(hashString(s.realm.id));
    return { s, x, y, r, shape: Array.from({ length: 14 }, () => 0.8 + rng() * 0.3) };
  };
  const out: Isle[] = [];
  if (kingdom) out.push(isle(kingdom, 0.5, 0.5, 0.17));
  provinces.forEach((s, i) => {
    const a = -Math.PI / 4 + (i / Math.max(1, provinces.length)) * Math.PI * 2;
    // bigger for what is kept there; a thin presence is still an island
    const r = 0.075 + 0.05 * Math.sqrt(s.usd / most);
    out.push(isle(s, 0.5 + Math.cos(a) * 0.33, 0.5 + Math.sin(a) * 0.3, r));
  });
  return out;
}

export interface RealmMapOptions {
  summaries: RealmSummary[];
  /** The realm on show (marked "you are here"). */
  current: string;
  onEnter: (realm: string) => void;
  onClose: () => void;
}

/** The map, ready to put over the stage; `dispose()` stops its animation. */
export function realmMap(o: RealmMapOptions): { element: HTMLElement; dispose: () => void } {
  const isles = layout(o.summaries);
  const canvas = el('canvas', { class: 'realm-sea-canvas', 'aria-hidden': 'true' });
  const sea = el('div', { class: 'realm-sea' }, canvas);
  for (const i of isles) {
    const s = i.s;
    const quiet = s.usd < 1 && s.journeys === 0;
    const facts = quiet ? 'uncharted: nothing here yet' : `${approxUsd(s.usd)} kept · ${s.journeys} quest${s.journeys === 1 ? '' : 's'}${s.crossings > 0 ? ` · ${s.crossings} ⛵` : ''}`;
    const btn = el(
      'button',
      { class: `realm-isle${s.realm.id === o.current ? ' here' : ''}${quiet ? ' quiet' : ''}`, 'data-realm': s.realm.id, title: s.realm.about },
      flag(s.realm.color),
      el('strong', {}, s.realm.name),
      el('span', { class: 'realm-kind' }, s.realm.kind === 'kingdom' ? 'kingdom' : 'L2 province'),
      el('span', { class: 'realm-facts' }, facts),
      s.realm.id === o.current ? el('span', { class: 'realm-here' }, 'you are here') : el('span', {}),
    );
    btn.style.left = `${i.x * 100}%`;
    btn.style.top = `${(i.y + i.r * 0.55) * 100}%`;
    btn.onclick = () => o.onEnter(s.realm.id);
    sea.append(btn);
  }
  const close = el('button', { class: 'btn close', 'aria-label': 'Close the map' }, '✕');
  close.onclick = () => o.onClose();
  const element = el(
    'div',
    { class: 'realm-map', role: 'dialog', 'aria-label': 'The Realm Map' },
    el('div', { class: 'realm-head' }, el('h2', {}, 'The Realm'), el('span', { class: 'muted' }, 'Ethereum and the L2 provinces that settle on it. Pick a town to visit.'), close),
    sea,
  );
  element.onkeydown = (e) => {
    if (e.key === 'Escape') o.onClose();
  };

  let raf = 0;
  const t0 = performance.now();
  const paint = (): void => {
    raf = requestAnimationFrame(paint);
    const w = sea.clientWidth;
    const h = sea.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    if (c === null) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSea(c, w, h, isles, (performance.now() - t0) / 1000);
  };
  paint();
  return { element, dispose: () => cancelAnimationFrame(raf) };
}

/** The realm's banner colour as a little flag (set through the CSSOM, which the CSP allows). */
function flag(color: string): HTMLElement {
  const f = el('span', { class: 'realm-flag' });
  f.style.background = color;
  return f;
}

function drawSea(c: CanvasRenderingContext2D, w: number, h: number, isles: Isle[], t: number): void {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, '#3b7aa0');
  g.addColorStop(1, '#1b3f58');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // little waves, drifting
  c.strokeStyle = 'rgba(220,240,255,0.18)';
  c.lineWidth = 1.5;
  for (let i = 0; i < 60; i++) {
    const x = ((i * 137.5 + t * 6) % (w + 40)) - 20;
    const y = (i * 71.3) % h;
    c.beginPath();
    c.arc(x, y, 6, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
  }
  const unit = Math.min(w, h);
  const at = (i: Isle): [number, number] => [i.x * w, i.y * h];
  const kingdom = isles.find((i) => i.s.realm.kind === 'kingdom');
  // sea lanes from the kingdom, a ship on each that saw crossings
  if (kingdom) {
    const [kx, ky] = at(kingdom);
    for (const i of isles) {
      if (i === kingdom) continue;
      const [px, py] = at(i);
      c.setLineDash([6, 7]);
      c.strokeStyle = i.s.crossings > 0 ? 'rgba(255,240,200,0.7)' : 'rgba(255,240,200,0.25)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(kx, ky);
      c.lineTo(px, py);
      c.stroke();
      c.setLineDash([]);
      if (i.s.crossings > 0) {
        const k = 0.25 + ((t * 0.06 + i.x) % 1) * 0.5;
        ship(c, kx + (px - kx) * k, ky + (py - ky) * k + Math.sin(t * 2 + i.y * 9) * 2, unit * 0.035, px < kx);
      }
    }
  }
  for (const i of isles) island(c, i, at(i), unit, t);
}

function island(c: CanvasRenderingContext2D, i: Isle, [x, y]: [number, number], unit: number, t: number): void {
  const r = i.r * unit;
  const quiet = i.s.usd < 1 && i.s.journeys === 0;
  const ring = (scale: number): void => {
    c.beginPath();
    i.shape.forEach((k, n) => {
      const a = (n / i.shape.length) * Math.PI * 2;
      const px = x + Math.cos(a) * r * k * scale;
      const py = y + Math.sin(a) * r * k * scale * 0.72;
      if (n === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    });
    c.closePath();
  };
  // shallows, beach, land
  c.fillStyle = 'rgba(160,220,230,0.35)';
  ring(1.18);
  c.fill();
  c.fillStyle = '#e8d39a';
  ring(1);
  c.fill();
  c.fillStyle = quiet ? '#7d8f6a' : '#5f9e4a';
  ring(0.84);
  c.fill();
  // the realm's seat: a castle for the kingdom, a tower for a province, its banner flying
  const s = r * 0.32;
  c.fillStyle = quiet ? '#9a948a' : '#d8cdb8';
  if (i.s.realm.kind === 'kingdom') {
    c.fillRect(x - s, y - s * 0.9, s * 2, s * 1.1);
    for (const dx of [-1, 1]) c.fillRect(x + dx * s - s * 0.3, y - s * 1.4, s * 0.6, s * 1.6);
    c.fillRect(x - s * 0.3, y - s * 1.7, s * 0.6, s * 1.9);
  } else {
    c.fillRect(x - s * 0.35, y - s * 1.4, s * 0.7, s * 1.6);
  }
  c.fillStyle = '#5a4030';
  c.fillRect(x - s * 0.12, y - s * 0.25, s * 0.24, s * 0.45);
  const top = y - s * (i.s.realm.kind === 'kingdom' ? 1.7 : 1.4);
  c.strokeStyle = '#4a3020';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x, top);
  c.lineTo(x, top - s * 0.9);
  c.stroke();
  c.fillStyle = i.s.realm.color;
  const wave = Math.sin(t * 3 + i.x * 10) * s * 0.08;
  c.beginPath();
  c.moveTo(x, top - s * 0.9);
  c.lineTo(x + s * 0.7, top - s * 0.75 + wave);
  c.lineTo(x, top - s * 0.55);
  c.closePath();
  c.fill();
}

function ship(c: CanvasRenderingContext2D, x: number, y: number, size: number, flip: boolean): void {
  c.save();
  c.translate(x, y);
  if (flip) c.scale(-1, 1);
  c.fillStyle = '#6b4226';
  c.beginPath();
  c.moveTo(-size, 0);
  c.lineTo(size, 0);
  c.lineTo(size * 0.7, size * 0.4);
  c.lineTo(-size * 0.7, size * 0.4);
  c.closePath();
  c.fill();
  c.fillStyle = '#f6e7c1';
  c.beginPath();
  c.moveTo(0, -size * 1.2);
  c.lineTo(size * 0.8, -size * 0.1);
  c.lineTo(0, -size * 0.1);
  c.closePath();
  c.fill();
  c.restore();
}
