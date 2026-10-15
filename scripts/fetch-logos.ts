/**
 * Each protocol family's logo, from DefiLlama, for the logo plates on the
 * town's buildings (docs/STYLEGUIDE_V2.md §8.1). Run with `npm run tvl` now
 * and then (after it, so the families match):
 *
 *   npm run logos              (keeps the logos already downloaded)
 *   npm run logos -- --refresh (fetches every one again)
 *
 * Writes the pictures into the first theme's `logos/` folder and their names
 * into src/castle/world/logos.json, for every protocol family DefiLlama lists
 * on Ethereum (whatever its value: a wallet may hold a small one). Sizes come
 * from DefiLlama's resizer: 256 px for the big families (L and XL plates), 128
 * px for the rest. The game never asks DefiLlama itself: the logos ship with
 * it. A changed or new logo changes the theme's files: bump its version
 * (CLAUDE.md).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { protocolFamily } from '../src/castle/assets/manifest.js';

interface LlamaProtocol {
  slug?: string;
  logo?: string | null;
  parentProtocol?: string | null;
  chains?: string[];
  chainTvls?: Record<string, number>;
}

const DIR = new URL('../public/themes/medieval-castle/logos/', import.meta.url);
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** Bigger pictures are left out (a plate shows them at a few hundred pixels at most). */
const MAX_BYTES = 60_000;
/** Families worth this much on Ethereum get big plates (L, XL): their logo at 256 px, the rest at 128. */
const BIG_USD = 300_000_000;

/** DefiLlama's icon server limits how fast it is asked: a pause between requests, and waits on a 429. */
async function politeFetch(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 250 : 5000 * attempt));
    try {
      const r = await fetch(url);
      if (r.status !== 429) return r;
    } catch {
      // a network hiccup: try again
    }
  }
  return null;
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const tvl = (JSON.parse(readFileSync(new URL('../src/castle/world/tvl.json', import.meta.url), 'utf8')) as { tvl: Record<string, number> }).tvl;
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error(`DefiLlama answered ${res.status}`);
  // each family's logo: its biggest member's on Ethereum
  const best = new Map<string, { usd: number; logo: string }>();
  for (const p of (await res.json()) as LlamaProtocol[]) {
    if (!p.slug || !p.logo) continue;
    if (!(p.chains ?? []).includes('Ethereum') && !((p.chainTvls?.Ethereum ?? 0) > 0)) continue;
    const key = protocolFamily(p.parentProtocol ? p.parentProtocol.replace(/^parent#/, '') : p.slug);
    const usd = p.chainTvls?.Ethereum ?? 0;
    if ((best.get(key)?.usd ?? -1) < usd) best.set(key, { usd, logo: p.logo });
  }
  mkdirSync(DIR, { recursive: true });
  const files: Record<string, string> = {};
  let skipped = 0;
  for (const [family, { logo }] of [...best].sort((a, b) => a[0].localeCompare(b[0]))) {
    const px = (tvl[family] ?? 0) >= BIG_USD ? 256 : 128;
    // DefiLlama's icon server resizes on request
    const src = logo.includes('?') ? logo : `${logo}?w=${px}&h=${px}`;
    const name0 = family.replace(/[^a-z0-9.-]/g, '_');
    const had = Object.values(TYPES).map((e) => `${name0}.${e}`).find((f) => existsSync(new URL(f, DIR)));
    if (had && !refresh) {
      files[family] = had;
      continue;
    }
    const r = await politeFetch(src);
    const ext = r ? TYPES[(r.headers.get('content-type') ?? '').split(';')[0]!.trim()] : undefined;
    const body = r ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (!r || !r.ok || !ext || body.length > MAX_BYTES) {
      // keep the one we had, if any
      if (had) files[family] = had;
      else skipped++;
      continue;
    }
    const name = `${name0}.${ext}`;
    writeFileSync(new URL(name, DIR), body);
    files[family] = name;
  }
  // logos no family uses any more
  for (const f of readdirSync(DIR)) if (!Object.values(files).includes(f)) rmSync(new URL(f, DIR));
  const out = { source: 'DefiLlama (api.llama.fi/protocols), each family’s logo', updated: new Date().toISOString().slice(0, 10), files };
  writeFileSync(new URL('../src/castle/world/logos.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
  console.log(`${Object.keys(files).length} logos written (${skipped} skipped: missing, unknown type or too big)`);
}

void main();
