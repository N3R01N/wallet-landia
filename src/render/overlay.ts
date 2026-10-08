/**
 * Screen-space layers drawn over any view: floating journey labels, attention
 * markers, hero name tags, district names, night and storm. Each view supplies
 * a projector from tile space (plus height in tiles) to CSS pixels.
 */

import { TIER_COLORS, approxUsd } from '../domain/tiers.js';
import { DISTRICT_NAMES, type District } from '../world/layout.js';
import type { Sim } from '../world/sim.js';

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
    c.fillText(DISTRICT_NAMES[d].toUpperCase(), p[0] + 1, p[1] + 1);
    c.fillStyle = 'rgba(255,248,230,0.85)';
    c.fillText(DISTRICT_NAMES[d].toUpperCase(), p[0], p[1]);
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
export function nameTags(c: CanvasRenderingContext2D, sim: Sim, headOf: (x: number, y: number, flying: boolean) => [number, number] | null): void {
  c.font = '600 10px system-ui, sans-serif';
  c.textAlign = 'center';
  for (const a of sim.agents) {
    if (a.kind !== 'hero' || !a.hero) continue;
    const p = headOf(a.x, a.y, a.flying && a.path.length > 0);
    if (p === null) continue;
    const label = `${a.hero.name} · ${approxUsd(a.hero.netWorth)}`;
    const w = c.measureText(label).width + 8;
    c.fillStyle = 'rgba(43,29,20,0.7)';
    c.fillRect(p[0] - w / 2, p[1] - 10, w, 13);
    c.fillStyle = TIER_COLORS[a.hero.tier] ?? '#fff';
    c.fillText(label, p[0], p[1]);
  }
}

/** 0 at noon, 1 at midnight, with a gentle dusk. Real local time. */
export function nightFactor(): number {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
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
