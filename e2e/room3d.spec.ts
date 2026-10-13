import { expect, test, type Page } from '@playwright/test';
import { DEMO_HERO, DEMO_HOLDINGS } from './roomFixture';

type Town3D = { hitTest(x: number, y: number): { kind: string; placed?: { kind: string; protocolId?: string } } | null };

/** A hero's home on screen (preferred: it holds the most), else a protocol, by the 3D renderer's own hit test. */
async function findHouse(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const stage = document.querySelector('.stage-wrap')?.getBoundingClientRect();
    const r = (window as unknown as { town3d?: Town3D }).town3d;
    if (!stage || !r) return null;
    for (let gy = 0.2; gy <= 0.85; gy += 0.03) {
      for (let gx = 0.2; gx <= 0.9; gx += 0.03) {
        const sx = stage.width * gx;
        const sy = stage.height * gy;
        const hit = r.hitTest(sx, sy);
        const p = hit?.placed;
        if (hit?.kind === 'building' && p?.kind === 'home') return { x: stage.left + sx, y: stage.top + sy };
      }
    }
    return null;
  });
}

test('a hero\'s home in 3D opens its room, built in the theme\'s materials', async ({ page }) => {
  await page.goto('/?theme=medieval&expose&hour=12&freeze');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 60_000 });
  let spot: { x: number; y: number } | null = null;
  await expect(async () => {
    spot = await findHouse(page);
    expect(spot, 'no house answered a hover').not.toBeNull();
  }).toPass({ timeout: 60_000 });
  await expect(async () => {
    await page.mouse.move(spot!.x, spot!.y);
    await page.mouse.click(spot!.x, spot!.y);
    await expect(page.getByRole('button', { name: 'Step inside' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Step inside' }).click();
  await expect(page.locator('.room-view canvas.room3d')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.locator('.room-view').screenshot({ path: test.info().outputPath('room3d.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.room-view')).toHaveCount(0);
});

test('the same demo house in 3D: the scale, the chest and the reward mound, in the medieval materials', async ({ page }) => {
  await page.goto('/?theme=medieval&expose&hour=12&freeze');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 60_000 });
  await page.evaluate(([h, hero]) => (window as unknown as { openInsideDemo: (s: unknown, hero: unknown) => void }).openInsideDemo(h, hero), [DEMO_HOLDINGS, DEMO_HERO]);
  await expect(page.locator('.room-view canvas.room3d')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  // hover across the room until a thing names itself
  const canvas = page.locator('.room-view canvas.room3d');
  const box = await canvas.boundingBox();
  let named = false;
  test.setTimeout(240_000); // (each move waits for a software-rendered frame)
  for (const gy of [0.3, 0.5, 0.7, 0.9]) {
    for (const gx of [0.15, 0.35, 0.55, 0.75, 0.9]) {
      if (named) break;
      await page.mouse.move(box!.x + box!.width * gx, box!.y + box!.height * gy);
      named = await page.locator('.room3d-tip').isVisible();
    }
  }
  expect(named, 'hovering a thing names it').toBe(true);
  // click it: the hero walks over and looks at it
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(4000);
  await page.locator('.room-view').screenshot({ path: test.info().outputPath('room3d-walk.png') });
  await page.waitForTimeout(200);
  await page.locator('.room-view').screenshot({ path: test.info().outputPath('room3d-demo.png') });
});
