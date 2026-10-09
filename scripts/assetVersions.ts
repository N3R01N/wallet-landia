/**
 * Asset versions: players' devices keep theme, pack and sky files forever
 * (service worker + cache headers), keyed by the version in their URL
 * (`?v=`). So whenever those files change, their version must change too,
 * or players keep the old files.
 *
 * `asset-versions.json` records, for each theme, pack and the skies, the
 * version and a fingerprint of its files. `npm run check` fails if files
 * changed but the version did not (test/assetVersions.test.ts).
 *
 *   npm run assets:versions          check
 *   npm run assets:versions -- write  record the current versions and fingerprints (after bumping)
 * (the command line is scripts/asset-versions-cli.ts)
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCK = join(ROOT, 'asset-versions.json');

export interface Entry {
  version: string;
  hash: string;
  /** Where to bump the version. */
  where: string;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out.sort();
}

/** A fingerprint of a folder's files (names and contents), leaving out the given ones. */
function fingerprint(dir: string, skip: (rel: string) => boolean): string {
  const h = createHash('sha256');
  for (const f of files(dir)) {
    const rel = relative(dir, f).replaceAll('\\', '/');
    if (skip(rel)) continue;
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

/** The versions and fingerprints as the files are now. */
export function currentVersions(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const kind of ['themes', 'packs'] as const) {
    const base = join(ROOT, 'public', kind);
    for (const id of readdirSync(base)) {
      const dir = join(base, id);
      if (!statSync(dir).isDirectory()) continue;
      const pack = join(dir, 'pack.json');
      if (!existsSync(pack)) continue;
      const version = String((JSON.parse(readFileSync(pack, 'utf8')) as { version?: unknown }).version ?? '');
      // pack.json itself is fetched fresh each visit: only the files it points to are kept
      out[`${kind}/${id}`] = { version, hash: fingerprint(dir, (rel) => rel === 'pack.json' || rel.endsWith('.md')), where: `public/${kind}/${id}/pack.json → "version"` };
    }
  }
  const env = readFileSync(join(ROOT, 'src/render/three/environment.ts'), 'utf8');
  const sky = /const SKY_VERSION = (\d+);/.exec(env)?.[1] ?? '?';
  out.skies = { version: sky, hash: fingerprint(join(ROOT, 'public/env'), (rel) => rel.endsWith('.md')), where: 'src/render/three/environment.ts → SKY_VERSION' };
  return out;
}

export function recordedVersions(): Record<string, Entry> {
  return existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, 'utf8')) as Record<string, Entry>) : {};
}

/** What needs doing: files changed without a new version, or a new version not yet recorded. */
export function problems(now = currentVersions(), was = recordedVersions()): string[] {
  const out: string[] = [];
  for (const [key, e] of Object.entries(now)) {
    const old = was[key];
    if (old === undefined) out.push(`${key} is new: run \`npm run assets:versions -- write\` to record it.`);
    else if (old.hash !== e.hash && old.version === e.version) out.push(`${key}: its files changed but its version is still ${e.version}. Bump it (${e.where}), then run \`npm run assets:versions -- write\`. Otherwise players keep the old files.`);
    else if (old.hash !== e.hash || old.version !== e.version) out.push(`${key}: version ${old.version} → ${e.version} not recorded yet: run \`npm run assets:versions -- write\`.`);
  }
  for (const key of Object.keys(was)) if (!(key in now)) out.push(`${key} is gone: run \`npm run assets:versions -- write\`.`);
  return out;
}

export function writeVersions(): void {
  writeFileSync(LOCK, `${JSON.stringify(currentVersions(), null, 2)}\n`);
}
