/**
 * Screen-space layers drawn over any view: floating journey labels, attention
 * markers, hero name tags, district names, night and storm. Each view supplies
 * a projector from tile space (plus height in tiles) to CSS pixels.
 */

import { TIER_COLORS, approxUsd, formatQty } from '../domain/tiers.js';
import type { District } from '../world/layout.js';
import { districtName } from '../assets/art.js';
import { TRANSFER_FLIGHT, type Agent, type Coin, type Effect, type Route, type Sim } from '../world/sim.js';
import { formatGwei, formatTransferUsd, heatColor, TOLL_COLORS, tollOf } from '../world/chain.js';
import { LOAN_COLORS, MOOD_COLORS } from '../domain/risk.js';

export type Project = (x: number, y: number, z?: number) => [number, number] | null;

const DISTRICT_LABELS: [District, number, number][] = [
  ['temple', 6, 3.2],
  ['alchemy', 18, 3.2],
  ['civic', 30, 3.2],
  ['wilds', 42, 3.2],
  ['counting', 6, 13.6],
  ['square', 20, 13.2],
  ['market', 41, 13.6],
  ['guild', 10, 20.6],
  ['harbour', 31, 28],
];

export function districtLabels(c: CanvasRenderingContext2D, project: Project): void {
  c.font = '600 11px "Trebuchet MS", system-ui, sans-serif';
  c.textAlign = 'center';
  for (const [d, x, y] of DISTRICT_LABELS) {
    const p = project(x, y);
    if (p === null) continue;
    c.fillStyle = 'rgba(40,30,20,0.55)';
    const name = districtName(d).toUpperCase();
    c.fillText(name, p[0] + 1, p[1] + 1);
    c.fillStyle = 'rgba(255,248,230,0.85)';
    c.fillText(name, p[0], p[1]);
  }
}

/** Unclaimed rewards (!), debt (IOU), and sleeping heroes (z). `tops` = screen top-centre per building id. */
export function markers(c: CanvasRenderingContext2D, sim: Sim, tops: Map<string, [number, number]>): void {
  const bounce = Math.sin(sim.elapsed * 4) * 2;
  const mark = (id: string, color: string, glyph: string, scale = 1, lift = 0): void => {
    const top = tops.get(id);
    if (top === undefined) return;
    const [sx, sy] = [top[0], top[1] - 10 + bounce - lift];
    c.font = `bold ${Math.round(11 * scale)}px system-ui, sans-serif`;
    const w = Math.max(14, c.measureText(glyph).width + 8 * scale);
    const h = 14 * scale;
    c.fillStyle = '#2b1d14';
    c.fillRect(sx - w / 2 - 1, sy - h / 2 - 2, w + 2, h + 2);
    c.fillStyle = color;
    c.fillRect(sx - w / 2, sy - h / 2 - 1, w, h);
    c.fillStyle = '#2b1d14';
    c.textAlign = 'center';
    c.fillText(glyph, sx, sy + 4 * scale - 1);
  };
  // loans: an estimated health factor, coloured from safe to near liquidation (flashing when critical)
  for (const [id, loan] of sim.loans) {
    if (loan.level === 'critical' && Math.floor(sim.elapsed * 2.5) % 2 === 0) continue;
    mark(id, LOAN_COLORS[loan.level], `⚖ ${loan.health >= 10 ? '10+' : loan.health.toFixed(1)}`, loan.level === 'safe' ? 1 : 1.15);
  }
  // harvests: the bigger the crop, the bigger the sign
  for (const [id, crop] of sim.harvests) {
    mark(id, TIER_COLORS[crop.tier] ?? '#ffd166', `! ${approxUsd(crop.usd).replace('~', '')}`, crop.size === 'lot' ? 1.4 : crop.size === 'some' ? 1.15 : 0.95, sim.loans.has(id) ? 20 : 0);
  }
  for (const hero of sim.guild.heroes) {
    if (hero.lastActiveAt === null) {
      const top = tops.get(`home:${hero.address}`);
      if (top) {
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.font = 'italic bold 12px system-ui, sans-serif';
        const z = (sim.elapsed % 3) / 3;
        c.globalAlpha = 1 - z;
        c.fillText('z', top[0] + 6 + z * 8, top[1] - z * 14);
        c.globalAlpha = 1;
      }
    }
  }
}

export function floatingText(c: CanvasRenderingContext2D, sim: Sim, project: Project, lift: number): void {
  c.textAlign = 'center';
  for (const e of sim.effects) {
    if (e.kind !== 'float' || e.text === undefined) continue;
    const k = e.age / e.ttl;
    const p = project(e.x, e.y, lift);
    if (p === null) continue;
    const y = p[1] - k * 26;
    const size = 11 + e.drama * 2;
    c.font = `bold ${size}px "Trebuchet MS", system-ui, sans-serif`;
    c.globalAlpha = Math.min(1, (1 - k) * 2);
    const w = c.measureText(e.text).width + 10;
    c.fillStyle = 'rgba(43,29,20,0.78)';
    c.fillRect(p[0] - w / 2, y - size, w, size + 6);
    c.fillStyle = e.color ?? TIER_COLORS[Math.min(6, e.drama * 2)] ?? '#fff';
    c.fillText(e.text, p[0], y);
    c.globalAlpha = 1;
  }
}

/** `headOf` gives the screen point above a hero's head, or null to skip. */
export function nameTags(c: CanvasRenderingContext2D, sim: Sim, headOf: (x: number, y: number, alt: number) => [number, number] | null): void {
  c.font = '600 10px system-ui, sans-serif';
  c.textAlign = 'center';
  for (const a of sim.agents) {
    if (a.kind !== 'hero' || !a.hero || a.inside) continue;
    const p = headOf(a.x, a.y, a.alt);
    if (p === null) continue;
    const label = `${a.hero.name} · ${approxUsd(a.hero.netWorth)}`;
    const w = c.measureText(label).width + 8;
    c.fillStyle = 'rgba(43,29,20,0.7)';
    c.fillRect(p[0] - w / 2, p[1] - 10, w, 13);
    c.fillStyle = TIER_COLORS[a.hero.tier] ?? '#fff';
    c.fillText(label, p[0], p[1]);
  }
}

/** `?hour=22` pins the clock, for validating night views by day; the sandbox sets it live. */
let HOUR_OVERRIDE: number | null = (() => {
  try {
    const h = new URLSearchParams(location.search).get('hour');
    return h === null ? null : Number(h);
  } catch {
    return null;
  }
})();

/** Pin the clock to an hour (0–24), or `null` for real local time. */
export function setHour(hour: number | null): void {
  HOUR_OVERRIDE = hour;
}

/** The hour the world is showing (pinned or real). */
export function currentHour(): number {
  const now = new Date();
  return HOUR_OVERRIDE ?? now.getHours() + now.getMinutes() / 60;
}

/** 0 at noon, 1 at midnight, with a gentle dusk. Real local time. */
export function nightFactor(): number {
  const now = new Date();
  const hour = HOUR_OVERRIDE ?? now.getHours() + now.getMinutes() / 60;
  return Math.max(0, Math.min(1, (Math.abs(hour - 13) - 5) / 3));
}

export function weather(c: CanvasRenderingContext2D, sim: Sim, w: number, h: number, tintNight: boolean): void {
  const night = nightFactor();
  if (tintNight && night > 0) {
    c.fillStyle = `rgba(20,24,70,${0.35 * night})`;
    c.fillRect(0, 0, w, h);
  }
  const g = sim.gloom;
  if (g > 0) {
    c.fillStyle = `rgba(30,30,40,${0.45 * g})`;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = `rgba(180,200,230,${0.5 * g})`;
    c.lineWidth = 1;
    const t = sim.elapsed;
    c.beginPath();
    for (let i = 0; i < 160; i++) {
      const x = (i * 97.3 + t * 40) % w;
      const y = (i * 53.1 + t * 600) % h;
      c.moveTo(x, y);
      c.lineTo(x - 3, y + 10);
    }
    c.stroke();
  }
}

const STOP_TEXT: Record<string, string> = { Toll: 'toll', Home: 'home', From: 'from' };

/** A Quest Replay route: a marching dashed line with numbered stops. */
export function route(c: CanvasRenderingContext2D, r: Route, project: Project, elapsed: number): void {
  const pts = r.points.map((p) => project(p.x, p.y, 0.05));
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const path = (): void => {
    c.beginPath();
    let started = false;
    for (const p of pts) {
      if (p === null) {
        started = false;
        continue;
      }
      if (!started) c.moveTo(p[0], p[1]);
      else c.lineTo(p[0], p[1]);
      started = true;
    }
  };
  path();
  c.strokeStyle = 'rgba(43,29,20,0.55)';
  c.lineWidth = 7;
  c.stroke();
  path();
  c.strokeStyle = '#ffd166';
  c.lineWidth = 3;
  c.setLineDash([10, 8]);
  c.lineDashOffset = -elapsed * 30;
  c.stroke();
  c.setLineDash([]);
  for (const stop of r.stops) {
    const p = project(stop.at.x, stop.at.y, 0.05);
    if (p === null) continue;
    c.fillStyle = '#2b1d14';
    c.beginPath();
    c.arc(p[0], p[1], 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = stop.label === 'Toll' ? '#ffb347' : stop.label === 'Home' || stop.label === 'From' ? '#9ad1ff' : '#ffd166';
    c.beginPath();
    c.arc(p[0], p[1], 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2b1d14';
    c.font = 'bold 11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(String(stop.n), p[0], p[1] + 4);
    const text = STOP_TEXT[stop.label] ?? stop.label;
    c.font = '600 10px system-ui, sans-serif';
    const w = c.measureText(text).width + 8;
    c.fillStyle = 'rgba(43,29,20,0.75)';
    c.fillRect(p[0] + 12, p[1] - 7, w, 14);
    c.fillStyle = '#fff6dc';
    c.textAlign = 'left';
    c.fillText(text, p[0] + 16, p[1] + 4);
  }
  c.restore();
}

// --- the Chronicle Tower: toll board and beacon -------------------------------------

/** The three lines on the toll board: a heading, the base fee with its trend, and a plain transfer's cost. */
export function tollLines(sim: Sim): { head: string; fee: string; sub: string; color: string } {
  const toll = tollOf(sim.chain, sim.ethUsd);
  if (toll.gwei === null) return { head: 'TOLL', fee: '…', sub: 'listening for the bell', color: '#d8d0c0' };
  const arrow = toll.trend > 0 ? ' ▲' : toll.trend < 0 ? ' ▼' : ' ▶';
  return {
    head: 'TOLL',
    fee: `${formatGwei(toll.gwei)} gwei${arrow}`,
    sub: toll.transferUsd !== null ? `a transfer ≈ ${formatTransferUsd(toll.transferUsd)}` : `${Math.round(sim.chain.busy * 100)}% full`,
    color: TOLL_COLORS[toll.level],
  };
}

/**
 * The toll board by the tower door, drawn over the 2D views at `at` (screen
 * px, the board's foot), `size` 1 at the default zoom.
 */
export function tollBoard(c: CanvasRenderingContext2D, sim: Sim, at: [number, number] | null, size: number): void {
  if (at === null || size < 0.45) return;
  board(c, at, size, tollLines(sim));
}

/** A slate board on two posts, its foot at `at` (screen px). */
function board(c: CanvasRenderingContext2D, at: [number, number], size: number, { head, fee, sub, color }: { head: string; fee: string; sub: string; color: string }): void {
  c.font = `bold ${Math.round(14 * size)}px "Trebuchet MS", system-ui, sans-serif`;
  const w = Math.max(92 * size, c.measureText(fee).width + 16 * size);
  const h = 46 * size;
  const x = Math.round(at[0] - w / 2);
  const y = Math.round(at[1] - h - 12 * size);
  // posts
  c.fillStyle = '#4a2e18';
  c.fillRect(x + 8 * size, y + h - 2, 4 * size, 14 * size);
  c.fillRect(x + w - 12 * size, y + h - 2, 4 * size, 14 * size);
  // board: wood frame, slate face
  c.fillStyle = '#6b4226';
  c.fillRect(x - 3 * size, y - 3 * size, w + 6 * size, h + 6 * size);
  c.fillStyle = '#2b2622';
  c.fillRect(x, y, w, h);
  c.textAlign = 'center';
  c.fillStyle = '#d8c8a8';
  c.font = `bold ${Math.round(7.5 * size)}px "Trebuchet MS", system-ui, sans-serif`;
  c.fillText(head, x + w / 2, y + 10 * size);
  c.fillStyle = color;
  c.font = `bold ${Math.round(14 * size)}px "Trebuchet MS", system-ui, sans-serif`;
  c.fillText(fee, x + w / 2, y + 26 * size);
  c.fillStyle = '#e8e0cc';
  c.font = `${Math.round(8.5 * size)}px "Trebuchet MS", system-ui, sans-serif`;
  c.fillText(sub, x + w / 2, y + 39 * size);
}

/** The beacon on the tower's top: a fire whose size and colour follow the toll (green cheap … red dear). */
export function towerBeacon(c: CanvasRenderingContext2D, sim: Sim, top: [number, number] | undefined, size: number): void {
  if (top === undefined) return;
  const toll = tollOf(sim.chain, sim.ethUsd);
  const [r, g, b] = heatColor(toll.heat).map((v) => Math.round(v * 255)) as [number, number, number];
  const t = sim.elapsed;
  const flicker = 1 + Math.sin(t * 9.1) * 0.06 + Math.sin(t * 13.7) * 0.04;
  const radius = (15 + toll.heat * 24) * size * flicker;
  const [x, y] = [top[0], top[1] - 6 * size];
  const glow = c.createRadialGradient(x, y, 0, x, y, radius * 2.2);
  glow.addColorStop(0, `rgba(${r},${g},${b},${0.7 + nightFactor() * 0.25})`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = glow;
  c.beginPath();
  c.arc(x, y, radius * 2.2, 0, Math.PI * 2);
  c.fill();
  // the flame: a teardrop, white-hot at its heart
  const fh = radius * 1.3;
  c.fillStyle = `rgb(${r},${g},${b})`;
  c.beginPath();
  c.moveTo(x, y - fh);
  c.quadraticCurveTo(x + fh * 0.55, y - fh * 0.1, x, y + fh * 0.35);
  c.quadraticCurveTo(x - fh * 0.55, y - fh * 0.1, x, y - fh);
  c.fill();
  c.fillStyle = 'rgba(255,248,220,0.9)';
  c.beginPath();
  c.ellipse(x, y + fh * 0.05, fh * 0.16, fh * 0.28, 0, 0, Math.PI * 2);
  c.fill();
}

/** The market board's lines: ETH now, and how it moved since the player's last visit. */
export function marketLines(sim: Sim): { head: string; fee: string; sub: string; color: string } | null {
  const now = sim.ethUsd;
  if (now === null) return null;
  const price = `$${Math.round(now).toLocaleString('en-US')}`;
  const m = sim.priceMove;
  if (m === null) return { head: 'ETH', fee: price, sub: 'first visit: changes show next time', color: '#e8dcc0' };
  const arrow = m.pct > 0.05 ? '▲' : m.pct < -0.05 ? '▼' : '▶';
  const days = (Date.now() - m.since) / 86_400_000;
  const ago = days >= 2 ? `${Math.round(days)} days ago` : days >= 1 ? 'a day ago' : `${Math.max(1, Math.round(days * 24))} h ago`;
  return { head: 'ETH SINCE LAST VISIT', fee: `${price} ${arrow}${Math.abs(m.pct).toFixed(1)}%`, sub: `was $${Math.round(m.thenUsd).toLocaleString('en-US')}, ${ago}`, color: MOOD_COLORS[m.mood] };
}

/** The market board in the town square (2D views). */
export function marketBoard(c: CanvasRenderingContext2D, sim: Sim, at: [number, number] | null, size: number): void {
  const lines = marketLines(sim);
  if (at === null || lines === null || size < 0.45) return;
  board(c, at, size, lines);
}

// --- goods changing hands ------------------------------------------------------

/** Token logos and NFT pictures for coins (their hosts send no CORS headers, so the overlay draws them). */
const coinImages = new Map<string, HTMLImageElement>();

function coinImage(url: string): HTMLImageElement | null {
  let img = coinImages.get(url);
  if (img === undefined) {
    img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.src = url;
    coinImages.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * One coin: the token's logo in a gold rim, or its letters stamped on gold;
 * an NFT is its picture in a little frame. `spin` turns it (0..1 a half turn).
 */
function drawCoin(c: CanvasRenderingContext2D, coin: Coin, x: number, y: number, r: number, spin: number, rim = '#f5c518'): void {
  const squash = Math.max(0.18, Math.abs(Math.cos(spin * Math.PI)));
  c.save();
  c.translate(x, y);
  c.scale(squash, 1);
  const img = coin.icon ? coinImage(coin.icon) : null;
  if (coin.nft) {
    c.fillStyle = '#e8d7a8';
    c.fillRect(-r, -r, 2 * r, 2 * r);
    c.strokeStyle = '#5a3d1e';
    c.lineWidth = 1.5;
    c.strokeRect(-r, -r, 2 * r, 2 * r);
    if (img) c.drawImage(img, -r + 2, -r + 2, 2 * r - 4, 2 * r - 4);
    c.restore();
    return;
  }
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fillStyle = rim;
  c.fill();
  c.lineWidth = Math.max(1, r * 0.14);
  c.strokeStyle = 'rgba(110,70,10,0.9)';
  c.stroke();
  if (img && squash > 0.45) {
    c.save();
    c.beginPath();
    c.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#fff';
    c.fill();
    c.drawImage(img, -r * 0.76, -r * 0.76, r * 1.52, r * 1.52);
    c.restore();
  } else if (coin.symbol !== '' && squash > 0.45 && r >= 6) {
    c.fillStyle = 'rgba(90,55,5,0.95)';
    c.font = `bold ${Math.round(r * (coin.symbol.length > 3 ? 0.62 : 0.8))}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(coin.symbol.slice(0, 4), 0, r * 0.05);
    c.textBaseline = 'alphabetic';
  } else {
    // a shine
    c.fillStyle = 'rgba(255,250,210,0.8)';
    c.fillRect(-r * 0.45, -r * 0.45, r * 0.3, r * 0.3);
  }
  c.restore();
}

/** "−0.42 ETH · −1 Pudgy" style: what changed hands, at a glance. */
function amounts(coins: Coin[], sign: string): string {
  return coins
    .filter((k) => k.symbol !== '')
    .slice(0, 2)
    .map((k) => (k.nft ? `${sign}${k.symbol.slice(0, 16)}` : `${sign}${formatQty(k.quantity)} ${k.symbol.slice(0, 8)}`))
    .join(' · ');
}

/** How high (tiles) someone holds things: on foot, or up in the saddle. */
function handHeight(a: Agent): number {
  return a.alt + (a.kind === 'hero' && a.hero && a.hero.tier >= 2 ? 1.5 : a.kind === 'raven' ? 0.4 : 0.9);
}

/**
 * Coins in flight between a hand and a door: tossed in an arc, spinning, a few
 * after each other (more for bigger moves), landing on whoever they are for as
 * they walk. The amount shows where they leave (handed over) or land (received).
 */
export function transfers(c: CanvasRenderingContext2D, sim: Sim, project: Project, zoom: number): void {
  for (const e of sim.effects) {
    if (e.kind !== 'transfer' || !e.coins || !e.to) continue;
    const t = e.age - (e.delay ?? 0);
    if (t < 0) continue;
    const src = e.fromAgent !== undefined ? sim.findAgent(e.fromAgent) : undefined;
    const dst = e.toAgent !== undefined ? sim.findAgent(e.toAgent) : undefined;
    const fromH = src ? handHeight(src) : 0.9;
    const to = dst && !dst.inside ? { x: dst.x, y: dst.y, h: handHeight(dst) } : { x: e.to.x, y: e.to.y, h: 0.9 };
    const n = Math.min(8, 2 + e.drama * 2);
    const r = (6 + e.drama) * zoom;
    const rim = e.color === '#ff5e5e' ? '#d9a441' : '#f5c518';
    let landed = false;
    for (let i = 0; i < n; i++) {
      const k = (t - i * 0.07) / TRANSFER_FLIGHT;
      if (k < 0) continue;
      if (k > 1) {
        if (i === n - 1) landed = true;
        continue;
      }
      const ease = k * k * (3 - 2 * k);
      const arc = Math.sin(Math.PI * k) * (0.9 + e.drama * 0.2);
      const spread = ((i % 3) - 1) * 0.08;
      const p = project(e.x + (to.x - e.x) * ease + spread, e.y + (to.y - e.y) * ease, fromH + (to.h - fromH) * ease + arc);
      if (p === null) continue;
      drawCoin(c, e.coins[i % e.coins.length]!, p[0], p[1], r, k * 2.5 + i * 0.3, rim);
    }
    // a glint where they land
    const after = t - TRANSFER_FLIGHT - (n - 1) * 0.07;
    if (landed && after < 0.3) {
      const p = project(to.x, to.y, to.h);
      if (p) {
        c.strokeStyle = `rgba(255,236,150,${1 - after / 0.3})`;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p[0], p[1], (6 + after * 40) * zoom, 0, Math.PI * 2);
        c.stroke();
      }
    }
    // (over a person, above their name tag)
    const at = e.dir === 'out' ? to : { x: e.x, y: e.y, h: fromH };
    const overPerson = e.dir === 'out' ? dst !== undefined && !dst.inside : src !== undefined;
    label(c, e, t, { ...at, h: at.h + (overPerson ? 1.9 : 0.5) }, project, zoom);
  }
}

function label(c: CanvasRenderingContext2D, e: Effect, t: number, at: { x: number; y: number; h: number }, project: Project, zoom: number): void {
  const text = amounts(e.coins ?? [], e.dir === 'out' ? '+' : '−');
  if (text === '' || zoom < 0.7) return;
  // received: shown as they land; handed over: as they leave
  const start = e.dir === 'out' ? TRANSFER_FLIGHT * 0.8 : 0;
  const k = (t - start) / 1.3;
  if (k < 0 || k > 1) return;
  const p = project(at.x, at.y, at.h + k * 0.6);
  if (p === null) return;
  const size = Math.round(10 + e.drama);
  c.font = `bold ${size}px "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center';
  c.globalAlpha = Math.min(1, (1 - k) * 2.5);
  const w = c.measureText(text).width + 8;
  c.fillStyle = 'rgba(43,29,20,0.72)';
  c.fillRect(p[0] - w / 2, p[1] - size, w, size + 5);
  c.fillStyle = e.color === '#ff5e5e' ? '#ff9a8a' : e.dir === 'out' ? '#b9f5a0' : '#ffd29a';
  c.fillText(text, p[0], p[1]);
  c.globalAlpha = 1;
}

/** What someone carries, as coins bobbing over their head (heroes, couriers, bailiffs with their loot). */
export function carriedGoods(c: CanvasRenderingContext2D, sim: Sim, headOf: (x: number, y: number, alt: number) => [number, number] | null, zoom: number): void {
  for (const a of sim.agents) {
    if (a.goods.length === 0 || a.inside || a.acting !== null || a.kind === 'villager') continue;
    // just over a raven's back; over a rider's head (mounted, they sit higher)
    const p = headOf(a.x, a.y, a.alt + (a.kind === 'raven' ? -1.6 : a.kind === 'hero' && a.hero && a.hero.tier >= 2 ? 0.6 : 0));
    if (p === null) continue;
    const r = 6.5 * zoom;
    const bob = Math.sin(sim.elapsed * 3 + a.phase) * 2;
    const n = Math.min(3, a.goods.length);
    for (let i = n - 1; i >= 0; i--) drawCoin(c, a.goods[i]!, p[0] + (i - (n - 1) / 2) * r * 1.3, p[1] + bob, r, Math.sin(sim.elapsed * 1.5 + i) * 0.25, a.kind === 'bailiff' ? '#d9a441' : '#f5c518');
  }
}

/** Speech bubbles over people chatting; the two take turns. */
export function bubbles(c: CanvasRenderingContext2D, sim: Sim, headOf: (x: number, y: number, alt: number) => [number, number] | null, zoom: number): void {
  for (const e of sim.effects) {
    if (e.kind !== 'bubble' || e.fromAgent === undefined) continue;
    const t = e.age - (e.delay ?? 0);
    if (t < 0 || t % 2 > 1.2) continue;
    const a = sim.findAgent(e.fromAgent);
    if (!a || a.inside) continue;
    const p = headOf(a.x, a.y, a.alt);
    if (p === null) continue;
    const s = 9 * zoom;
    const x = p[0] + s * 0.8;
    const y = p[1] - s * 0.4;
    c.fillStyle = 'rgba(255,252,240,0.95)';
    c.strokeStyle = 'rgba(60,40,25,0.8)';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(x, y, s * 1.25, s * 0.95, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(x - s * 0.6, y + s * 0.6);
    c.lineTo(x - s * 1.1, y + s * 1.4);
    c.lineTo(x - s * 0.15, y + s * 0.85);
    c.fill();
    c.fillStyle = '#3c2819';
    c.font = `bold ${Math.round(s * 1.1)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(e.text ?? '…', x, y + 1);
    c.textBaseline = 'alphabetic';
  }
}
