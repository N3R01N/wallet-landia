/**
 * The app's icons as PNGs, drawn from the logo's SVGs in public/brand/ (and
 * public/favicon.svg). Run after changing one of them:
 *
 *   npm run brand
 *
 * Writes the installed app's icons (192, 512, maskable), the Apple touch
 * icon and the 32 px favicon for browsers without SVG favicons.
 */

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const pub = new URL('../public/', import.meta.url);
const svg = (path: string) => readFileSync(new URL(path, pub));

const ICONS: { from: string; to: string; size: number }[] = [
  { from: 'brand/mark.svg', to: 'brand/icon-192.png', size: 192 },
  { from: 'brand/mark.svg', to: 'brand/icon-512.png', size: 512 },
  { from: 'brand/icon-full.svg', to: 'brand/icon-maskable-512.png', size: 512 },
  { from: 'brand/icon-full.svg', to: 'brand/apple-touch-icon.png', size: 180 },
  { from: 'favicon.svg', to: 'favicon-32.png', size: 32 },
];

for (const { from, to, size } of ICONS) {
  await sharp(svg(from), { density: 72 * Math.ceil(size / 180) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(new URL(to, pub).pathname);
  console.log(`${to} (${size} px)`);
}
