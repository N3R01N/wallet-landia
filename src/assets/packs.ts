/**
 * Getting packs into the registry: bundled ones from /packs/ (same origin),
 * and ones the player imports as a folder from disk. Imported packs are kept
 * in IndexedDB and served from blob: URLs, so the page never needs to fetch
 * from arbitrary origins (the CSP stays tight).
 */

import { versioned } from './themeBundles.js';
import { openCache, type KV } from '../data/cache.js';
import { referencedFiles, validatePack, type PackManifest } from './pack.js';
import { assets, type LoadedPack } from './registry.js';

const STORABLE = /\.(png|webp|gif|jpe?g|svg|gltf|glb|bin|fbx)$/i;
const MAX_FILES = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const INDEX_KEY = 'packs:index';

interface StoredPack {
  manifest: PackManifest;
  files: Record<string, Blob>;
}

let kv: KV | null = null;
const store = async (): Promise<KV> => (kv ??= await openCache());

export async function loadBundledPacks(base = '/packs'): Promise<void> {
  let ids: unknown;
  try {
    // the lists name each pack's version: always re-checked (a 304 when unchanged), never stale
    const res = await fetch(`${base}/index.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    ids = await res.json();
  } catch (error) {
    console.warn('bundled packs unavailable', error);
    return;
  }
  if (!Array.isArray(ids)) return;
  // each pack on its own (in parallel): one broken pack.json never keeps the others out
  const wanted = ids.filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]+$/.test(id));
  const loaded = await Promise.allSettled(
    wanted.map(async (id) => {
      const r = await fetch(`${base}/${id}/pack.json`, { cache: 'no-cache' });
      if (!r.ok) return null;
      const { manifest, problems } = validatePack(await r.json());
      if (problems.length > 0) console.warn(`pack ${id}:`, problems);
      if (manifest === null) return null;
      return { manifest, source: 'bundled', files: referencedFiles(manifest), url: (p: string) => versioned(`${base}/${id}/${p}`, manifest.version) } satisfies LoadedPack;
    }),
  );
  // added in index.json's order, whatever order they arrived in
  loaded.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value) assets.add(r.value);
    } else console.warn(`pack ${wanted[i]} unavailable`, r.reason);
  });
}

/** The blob: URLs each imported pack holds, released when it is removed or replaced. */
const objectUrls = new Map<string, string[]>();

function revokeUrls(id: string): void {
  for (const u of objectUrls.get(id) ?? []) URL.revokeObjectURL(u);
  objectUrls.delete(id);
}

function fromStored(stored: StoredPack): LoadedPack {
  const urls = new Map<string, string>();
  for (const [path, blob] of Object.entries(stored.files)) urls.set(path, URL.createObjectURL(blob));
  revokeUrls(stored.manifest.id);
  objectUrls.set(stored.manifest.id, [...urls.values()]);
  return { manifest: stored.manifest, source: 'imported', files: [...urls.keys()], url: (p) => urls.get(p) ?? '' };
}

export async function loadImportedPacks(): Promise<void> {
  const db = await store();
  const ids = (await db.get<string[]>(INDEX_KEY)) ?? [];
  for (const id of ids) {
    const stored = await db.get<StoredPack>(`pack:${id}`);
    if (stored) assets.add(fromStored(stored));
  }
}

export interface ImportResult {
  ok: boolean;
  id?: string;
  problems: string[];
}

/**
 * Import a pack from a folder the player picked (`<input webkitdirectory>`).
 * The folder must contain pack.json; only image and model files are kept.
 */
export async function importPackFolder(list: FileList | File[]): Promise<ImportResult> {
  const files = [...list];
  const manifestFile = files
    .filter((f) => (f.webkitRelativePath || f.name).endsWith('pack.json'))
    .sort((a, b) => (a.webkitRelativePath || a.name).length - (b.webkitRelativePath || b.name).length)[0];
  if (!manifestFile) return { ok: false, problems: ['No pack.json in that folder.'] };
  if (files.length > MAX_FILES) return { ok: false, problems: [`Too many files (max ${MAX_FILES}).`] };
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES) return { ok: false, problems: [`Pack is too large (max ${MAX_BYTES / 1024 / 1024} MB).`] };

  let json: unknown;
  try {
    json = JSON.parse(await manifestFile.text());
  } catch {
    return { ok: false, problems: ['pack.json is not valid JSON.'] };
  }
  const { manifest, problems } = validatePack(json);
  if (manifest === null) return { ok: false, problems };

  const root = (manifestFile.webkitRelativePath || manifestFile.name).replace(/pack\.json$/, '');
  const stored: StoredPack = { manifest, files: {} };
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).slice(root.length);
    if (rel === 'pack.json' || !STORABLE.test(rel) || rel.split('/').includes('..')) continue;
    stored.files[rel] = f;
  }
  const missing = referencedFiles(manifest).filter((p) => stored.files[p] === undefined);
  if (missing.length > 0) return { ok: false, problems: [...problems, ...missing.map((m) => `missing file: ${m}`)] };

  const db = await store();
  const ids = new Set((await db.get<string[]>(INDEX_KEY)) ?? []);
  ids.add(manifest.id);
  await db.put(`pack:${manifest.id}`, stored);
  await db.put(INDEX_KEY, [...ids]);
  if (assets.packs.has(manifest.id)) assets.remove(manifest.id);
  assets.add(fromStored(stored));
  return { ok: true, id: manifest.id, problems };
}

export async function removeImportedPack(id: string): Promise<void> {
  const db = await store();
  const ids = ((await db.get<string[]>(INDEX_KEY)) ?? []).filter((x) => x !== id);
  await db.put(INDEX_KEY, ids);
  await db.put(`pack:${id}`, null);
  assets.remove(id);
  revokeUrls(id);
}
