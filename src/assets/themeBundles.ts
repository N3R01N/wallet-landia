/**
 * Theme bundles ready to use: the bundled ones (public/themes/index.json lists
 * their folders) and any imported pack with a `theme` block. Paths become
 * URLs, `extends` is resolved (the parent first), and materials that `use`
 * another role get that role's files.
 */

import { validatePack, type PackManifest } from './pack.js';
import type { LoadedPack } from './registry.js';
import { mergeTheme, resolveTheme, resolveUses, type ThemeSpec } from './theme.js';

export interface ThemeBundle {
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  license?: string;
  source: 'bundled' | 'imported';
  /** Fully resolved: URLs, parents merged in. */
  spec: ThemeSpec;
  /** Problems found while validating or resolving (shown, never fatal). */
  problems: string[];
}

interface Raw {
  manifest: PackManifest & { theme: ThemeSpec };
  source: ThemeBundle['source'];
  resolved: ThemeSpec;
  problems: string[];
}

/** Resolve a set of raw bundles against each other. Exported for tests. */
export function linkBundles(raws: Raw[]): ThemeBundle[] {
  const byId = new Map(raws.map((r) => [r.manifest.id, r]));
  const flat = (r: Raw, seen: string[]): ThemeSpec => {
    const parentId = r.resolved.extends;
    if (!parentId) return r.resolved;
    const parent = byId.get(parentId);
    if (!parent || seen.includes(parentId) || seen.length > 4) {
      r.problems.push(parent ? `theme.extends "${parentId}" makes a loop (ignored)` : `theme.extends "${parentId}": no such theme (ignored)`);
      const copy = { ...r.resolved };
      delete copy.extends;
      return copy;
    }
    return mergeTheme(flat(parent, [...seen, r.manifest.id]), r.resolved);
  };
  return raws.map((r) => {
    const spec = flat(r, [r.manifest.id]);
    spec.materials = resolveUses(spec.materials);
    if (spec.charactersPatch) {
      // merged into the parent's characters by now; without a parent it has nothing to patch
      if (!spec.characters) r.problems.push('theme.characters is incomplete and there are no parent characters to complete it (ignored)');
      delete spec.charactersPatch;
    }
    const b: ThemeBundle = { id: r.manifest.id, name: r.manifest.name, author: r.manifest.author, version: r.manifest.version, source: r.source, spec, problems: r.problems };
    if (r.manifest.description) b.description = r.manifest.description;
    if (r.manifest.license) b.license = r.manifest.license;
    return b;
  });
}

export function rawBundle(manifest: PackManifest, url: (path: string) => string, source: ThemeBundle['source'], problems: string[] = []): Raw | null {
  if (!manifest.theme) return null;
  return { manifest: manifest as Raw['manifest'], source, resolved: resolveTheme(manifest.theme, url), problems };
}

export async function loadThemeBundles(base = '/themes', imported: Iterable<LoadedPack> = []): Promise<ThemeBundle[]> {
  const raws: Raw[] = [];
  try {
    const res = await fetch(`${base}/index.json`);
    const ids = res.ok ? ((await res.json()) as unknown) : [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) continue;
      const r = await fetch(`${base}/${id}/pack.json`);
      if (!r.ok) continue;
      const { manifest, problems } = validatePack(await r.json());
      const raw = manifest ? rawBundle(manifest, (p) => `${base}/${id}/${p}`, 'bundled', problems) : null;
      if (raw) raws.push(raw);
      else console.warn(`theme ${id}:`, problems);
    }
  } catch (error) {
    console.warn('bundled themes unavailable', error);
  }
  for (const pack of imported) {
    if (raws.some((r) => r.manifest.id === pack.manifest.id)) continue;
    const raw = rawBundle(pack.manifest, (p) => pack.url(p), 'imported');
    if (raw) raws.push(raw);
  }
  const bundles = linkBundles(raws);
  for (const b of bundles) if (b.problems.length > 0) console.warn(`theme ${b.id}:`, b.problems);
  return bundles;
}
