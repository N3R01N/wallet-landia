/**
 * Screen-space layers drawn over any view: floating journey labels, attention
 * markers, hero name tags, district names, night and storm. Each view supplies
 * a projector from tile space (plus height in tiles) to CSS pixels.
 */

import { TIER_COLORS, approxUsd } from '../domain/tiers.js';
import type { District } from '../world/layout.js';
import { districtName } from '../assets/art.js';
import type { Route, Sim } from '../world/sim.js';
import { formatGwei, formatTransferUsd, heatColor, TOLL_COLORS, tollOf } from '../world/chain.js';

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
  const mark = (id: string, color: string, glyph: string): void => {
    const top = tops.get(id);
    if (top === undefined) return;
    const [sx, sy] = [top[0], top[1] - 10 + bounce];
    c.font = 'bold 11px system-ui, sans-serif';
    const w = Math.max(14, c.measureText(glyph).width + 8);
    c.fillStyle = '#2b1d14';
    c.fillRect(sx - w / 2 - 1, sy - 9, w + 2, 16);
    c.fillStyle = color;
    c.fillRect(sx - w / 2, sy - 8, w, 14);
    c.fillStyle = '#2b1d14';
    c.textAlign = 'center';
    c.fillText(glyph, sx, sy + 3);
  };
  const seen = new Set<string>();
  for (const hero of sim.guild.heroes) {
    for (const stash of hero.stashes) {
      const id = `b:${stash.protocolId}`;
      if (seen.has(id)) continue;
      if (stash.hasRewards) mark(id, '#ffd166', '!');
      else if (stash.hasDebt) mark(id, '#ff9a8a', 'IOU');
      else continue;
      seen.add(id);
    }
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
    if (a.kind !== 'hero' || !a.hero) continue;
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
  const { head, fee, sub, color } = tollLines(sim);
  const w = 92 * size;
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
  c.font = `bold ${Math.round(8 * size)}px "Trebuchet MS", system-ui, sans-serif`;
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
