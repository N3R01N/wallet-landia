/**
 * Getting packs into the registry: bundled ones from /packs/ (same origin),
 * and ones the player imports as a folder from disk. Imported packs are kept
 * in IndexedDB and served from blob: URLs, so the page never needs to fetch
 * from arbitrary origins (the CSP stays tight).
 */

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
  try {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) return;
    const ids = (await res.json()) as unknown;
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) continue;
      const r = await fetch(`${base}/${id}/pack.json`);
      if (!r.ok) continue;
      const { manifest, problems } = validatePack(await r.json());
      if (problems.length > 0) console.warn(`pack ${id}:`, problems);
      if (manifest === null) continue;
      assets.add({ manifest, source: 'bundled', files: referencedFiles(manifest), url: (p) => `${base}/${id}/${p}` });
    }
  } catch (error) {
    console.warn('bundled packs unavailable', error);
  }
}

function fromStored(stored: StoredPack): LoadedPack {
  const urls = new Map<string, string>();
  for (const [path, blob] of Object.entries(stored.files)) urls.set(path, URL.createObjectURL(blob));
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
}
