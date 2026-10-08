/**
 * Download CC0 PBR materials from ambientCG and convert them for the web.
 *
 *   npm run assets:textures
 *
 * Each material keeps colour (≤ 1024 px), normal and roughness (≤ 512 px) as
 * WebP in public/themes/medieval/materials/<key>/. Downloads are cached in
 * assets-src/ambientcg/, so re-running is free.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { readZip, unzipEntry } from './lib/zip.js';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, 'assets-src/ambientcg');
const OUT = join(ROOT, 'public/themes/medieval/materials');

/** key → ambientCG asset id. The key is what the building grammar asks for. */
export const MATERIALS: Record<string, string> = {
  plaster: 'Plaster002',
  stone: 'Bricks100',
  stoneDark: 'Bricks089',
  timber: 'Wood066',
  planks: 'Planks023A',
  roofTiles: 'RoofingTiles013A',
  roofSlate: 'RoofingTiles001',
  thatch: 'ThatchedRoof001A',
  cobbles: 'PavingStones138',
  grass: 'Grass004',
  dirt: 'Ground103',
  cloth: 'Fabric061',
};

async function download(id: string): Promise<Buffer> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${id}_1K-JPG.zip`);
  if (existsSync(file)) return readZip(file).data;
  const res = await fetch(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

async function main(): Promise<void> {
  let total = 0;
  const credits: string[] = [];
  for (const [key, id] of Object.entries(MATERIALS)) {
    const zip = readZip(await download(id));
    const pick = (suffix: RegExp): Buffer | null => {
      const e = [...zip.entries.values()].find((x) => suffix.test(x.name));
      return e ? unzipEntry(zip, e) : null;
    };
    const maps: [string, RegExp, number][] = [
      ['color', /_Color\.jpg$/i, 1024],
      ['normal', /_NormalGL\.jpg$/i, 512],
      ['roughness', /_Roughness\.jpg$/i, 512],
    ];
    mkdirSync(join(OUT, key), { recursive: true });
    const sizes: string[] = [];
    for (const [name, re, px] of maps) {
      const src = pick(re);
      if (!src) throw new Error(`${id}: no ${name} map`);
      const out = await sharp(src).resize(px, px, { fit: 'inside' }).webp({ quality: name === 'color' ? 82 : 78 }).toBuffer();
      writeFileSync(join(OUT, key, `${name}.webp`), out);
      total += out.length;
      sizes.push(`${name} ${(out.length / 1024).toFixed(0)} KB`);
    }
    console.log(`${key.padEnd(10)} ${id.padEnd(18)} ${sizes.join(', ')}`);
    credits.push(`| \`${key}\` | [${id}](https://ambientcg.com/view?id=${id}) |`);
  }
  writeFileSync(
    join(OUT, 'CREDITS.md'),
    `# Materials\n\nPBR materials from [ambientCG](https://ambientcg.com), released under **CC0 1.0**. Colour ≤ 1024 px, normal and roughness ≤ 512 px, WebP.\n\n| Key | Source |\n|---|---|\n${credits.join('\n')}\n`,
  );
  console.log(`\ntotal ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
