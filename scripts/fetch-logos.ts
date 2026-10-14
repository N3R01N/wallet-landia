/**
 * Each protocol family's logo, from DefiLlama, for the logo plates on the
 * town's buildings (docs/STYLEGUIDE_V2.md §8.1). Run with `npm run tvl` now
 * and then (after it, so the families match):
 *
 *   npm run logos
 *
 * Writes the pictures into the art theme's `logos/` folder and their names
 * into src/castle/world/logos.json, for every family in tvl.json. The game
 * never asks DefiLlama itself: the logos ship with it. A changed or new logo
 * changes the theme's files: bump its version (CLAUDE.md).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { protocolFamily } from '../src/castle/assets/manifest.js';

interface LlamaProtocol {
  slug?: string;
  logo?: string | null;
  parentProtocol?: string | null;
  chainTvls?: Record<string, number>;
}

const DIR = new URL('../public/themes/medieval-castle/logos/', import.meta.url);
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** Bigger pictures are left out (a plate shows them at a few hundred pixels at most). */
const MAX_BYTES = 120_000;

async function main(): Promise<void> {
  const families = Object.keys((JSON.parse(readFileSync(new URL('../src/castle/world/tvl.json', import.meta.url), 'utf8')) as { tvl: Record<string, number> }).tvl);
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error(`DefiLlama answered ${res.status}`);
  // each family's logo: its biggest member's on Ethereum
  const best = new Map<string, { usd: number; logo: string }>();
  for (const p of (await res.json()) as LlamaProtocol[]) {
    if (!p.slug || !p.logo) continue;
    const key = protocolFamily(p.parentProtocol ? p.parentProtocol.replace(/^parent#/, '') : p.slug);
    const usd = p.chainTvls?.Ethereum ?? 0;
    if ((best.get(key)?.usd ?? -1) < usd) best.set(key, { usd, logo: p.logo });
  }
  mkdirSync(DIR, { recursive: true });
  const files: Record<string, string> = {};
  let skipped = 0;
  for (const family of families) {
    const src = best.get(family)?.logo;
    if (!src) continue;
    const r = await fetch(src);
    const ext = TYPES[(r.headers.get('content-type') ?? '').split(';')[0]!.trim()];
    const body = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !ext || body.length > MAX_BYTES) {
      skipped++;
      continue;
    }
    const name = `${family.replace(/[^a-z0-9.-]/g, '_')}.${ext}`;
    writeFileSync(new URL(name, DIR), body);
    files[family] = name;
  }
  const out = { source: 'DefiLlama (api.llama.fi/protocols), each family’s logo', updated: new Date().toISOString().slice(0, 10), files };
  writeFileSync(new URL('../src/castle/world/logos.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
  console.log(`${Object.keys(files).length} logos written (${skipped} skipped: missing, unknown type or too big)`);
}

void main();
