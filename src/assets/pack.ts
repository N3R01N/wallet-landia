/**
 * The pack format: data only (JSON + images + glTF models), never code, so a
 * pack cannot do anything but look different. Everything is validated before
 * use; anything unexpected is dropped with a reason rather than trusted.
 */

import { slotInfo, type SlotForm } from './catalog.js';

export const PACK_FORMAT = 'wallet-landia-pack/1';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An image in art pixels (16 per tile). `ax, ay` is the point that stands on the ground. */
export interface SpriteRef {
  src: string;
  ax: number;
  ay: number;
  /** A horizontal strip of animation frames (walk cycle). Default 1. */
  frames?: number;
  /** Where a protocol logo goes on a building sprite. */
  sign?: Rect;
}

/** A glTF/GLB model. Units are tiles; origin at the footprint centre on the ground; +z faces the street. */
export interface ModelRef {
  src: string;
  scale?: number;
}

export interface SlotEntry {
  sprite?: SpriteRef;
  top?: SpriteRef;
  iso?: SpriteRef;
  model?: ModelRef;
  word?: string;
}

export interface PackManifest {
  format: typeof PACK_FORMAT;
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  license?: string;
  slots: Record<string, SlotEntry>;
}

export interface Validated {
  manifest: PackManifest | null;
  problems: string[];
}

const IMAGE = /\.(png|webp|gif|jpe?g|svg)$/i;
const MODEL = /\.(gltf|glb)$/i;

/** Relative paths inside the pack only: no schemes, no absolute paths, no `..`. */
export function safePath(p: unknown, kind: 'image' | 'model'): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('/') || p.startsWith('\\') || p.includes('\\')) return null;
  if (p.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return (kind === 'image' ? IMAGE : MODEL).test(p) ? p : null;
}

const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null);

function spriteRef(v: unknown): SpriteRef | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const src = safePath(o.src, 'image');
  const ax = num(o.ax, -512, 1024);
  const ay = num(o.ay, -512, 1024);
  if (src === null || ax === null || ay === null) return null;
  const ref: SpriteRef = { src, ax, ay };
  const frames = num(o.frames, 1, 16);
  if (frames !== null) ref.frames = Math.floor(frames);
  if (typeof o.sign === 'object' && o.sign !== null) {
    const r = o.sign as Record<string, unknown>;
    const x = num(r.x, 0, 1024);
    const y = num(r.y, 0, 1024);
    const w = num(r.w, 1, 256);
    const h = num(r.h, 1, 256);
    if (x !== null && y !== null && w !== null && h !== null) ref.sign = { x, y, w, h };
  }
  return ref;
}

export function validatePack(input: unknown): Validated {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null) return { manifest: null, problems: ['pack.json is not an object'] };
  const o = input as Record<string, unknown>;
  if (o.format !== PACK_FORMAT) problems.push(`format must be "${PACK_FORMAT}"`);
  const id = typeof o.id === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(o.id) ? o.id : null;
  if (id === null) problems.push('id must be 2–40 chars of a-z, 0-9 and -');
  if (id === 'default') problems.push('id "default" is reserved');
  const name = text(o.name, 60);
  const author = text(o.author, 60);
  const version = text(o.version, 20);
  if (!name) problems.push('name is required (≤ 60 chars)');
  if (!author) problems.push('author is required (≤ 60 chars)');
  if (!version) problems.push('version is required');
  if (problems.length > 0 || id === null || !name || !author || !version) return { manifest: null, problems };

  const slots: Record<string, SlotEntry> = {};
  const rawSlots = typeof o.slots === 'object' && o.slots !== null ? (o.slots as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawSlots)) {
    const info = slotInfo(key);
    if (info === undefined) {
      problems.push(`unknown slot "${key}" ignored`);
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const entry: SlotEntry = {};
    const allow = (f: SlotForm): boolean => info.forms.includes(f);
    for (const form of ['sprite', 'top', 'iso'] as const) {
      if (v[form] === undefined) continue;
      const ref = allow(form) ? spriteRef(v[form]) : null;
      if (ref) entry[form] = ref;
      else problems.push(`${key}.${form} is not valid here`);
    }
    if (v.model !== undefined) {
      const m = v.model as Record<string, unknown> | null;
      const src = allow('model') && m ? safePath(m.src, 'model') : null;
      if (src) {
        const model: ModelRef = { src };
        const scale = m ? num(m.scale, 0.01, 100) : null;
        if (scale !== null) model.scale = scale;
        entry.model = model;
      } else problems.push(`${key}.model is not valid here`);
    }
    if (v.word !== undefined) {
      const w = allow('word') ? text(v.word, 40) : null;
      if (w) entry.word = w;
      else problems.push(`${key}.word must be text ≤ 40 chars`);
    }
    if (Object.keys(entry).length > 0) slots[key] = entry;
  }
  const manifest: PackManifest = { format: PACK_FORMAT, id, name, author, version, slots };
  const description = text(o.description, 300);
  const license = text(o.license, 60);
  if (description) manifest.description = description;
  if (license) manifest.license = license;
  return { manifest, problems };
}

/** Every file a manifest refers to (for importing a folder). */
export function referencedFiles(m: PackManifest): string[] {
  const out = new Set<string>();
  for (const e of Object.values(m.slots)) {
    for (const r of [e.sprite, e.top, e.iso]) if (r) out.add(r.src);
    if (e.model) out.add(e.model.src);
  }
  return [...out];
}
