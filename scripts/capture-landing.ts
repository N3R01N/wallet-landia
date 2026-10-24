/**
 * The landing page's pictures: the castle and town from the running app, and
 * each famous castle, as WebP in public/landing/ (plus the hero as a JPEG for
 * link previews). Start the dev server first, then:
 *
 *   npx vite --port 5199 &
 *   npm run landing:pictures
 *
 * Takes a few minutes: each scene loads its models and settles before its
 * picture is taken. Pictures are of the 3D view only (no buttons or panels).
 */

import { chromium, type Page } from 'playwright';
import sharp from 'sharp';

const BASE = process.env.BASE_URL ?? 'http://localhost:5199';
const OUT = new URL('../public/landing/', import.meta.url).pathname;

interface Shot {
  name: string;
  hash: string;
  /** Mouse-wheel steps out (positive) from the opening view, then a drag (px) to pan. */
  zoom: number;
  pan: [number, number];
  width: number;
}

const SHOTS: Shot[] = [
  { name: 'hero-castle', hash: '', zoom: 0, pan: [0, 0], width: 1600 },
  { name: 'hero-town', hash: '', zoom: 4, pan: [500, -250], width: 1600 },
  { name: 'famous-vitalik', hash: '#famous=vitalik', zoom: 1, pan: [0, 0], width: 720 },
  { name: 'famous-ens-dao', hash: '#famous=ens-dao', zoom: 1, pan: [0, 0], width: 720 },
  { name: 'famous-xcopy', hash: '#famous=xcopy', zoom: 1, pan: [0, 0], width: 720 },
  { name: 'famous-poly-exploiter', hash: '#famous=poly-exploiter', zoom: 3, pan: [400, -200], width: 720 },
];

async function shoot(page: Page, shot: Shot): Promise<void> {
  await page.goto(`${BASE}/?hour=10.5&market=up&notour${shot.hash}`);
  await page.locator('.castle-view[data-ready="true"]').waitFor({ timeout: 180_000 });
  await page.locator('.loading-screen').waitFor({ state: 'detached', timeout: 30_000 });
  // the view's own buttons stay out of the picture
  await page.addStyleTag({ content: '.castle-view button, .castle-view .btn, .story-strip, .timeline { visibility: hidden !important; }' });
  const box = (await page.locator('.castle-view canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < shot.zoom; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
  }
  if (shot.pan[0] !== 0 || shot.pan[1] !== 0) {
    await page.mouse.down();
    await page.mouse.move(cx + shot.pan[0], cy + shot.pan[1], { steps: 20 });
    await page.mouse.up();
  }
  // models streamed in, couriers out on the road
  await page.waitForTimeout(12_000);
  const png = await page.locator('.castle-view canvas').first().screenshot();
  await sharp(png).resize({ width: shot.width }).webp({ quality: 82 }).toFile(`${OUT}${shot.name}.webp`);
  if (shot.name === 'hero-castle') await sharp(png).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 84 }).toFile(`${OUT}og.jpg`);
  console.log(`${shot.name}.webp`);
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await context.addInitScript(() => localStorage.setItem('zenigard/castle/tour-seen', '1'));
const page = await context.newPage();
for (const shot of SHOTS) await shoot(page, shot);
await browser.close();
