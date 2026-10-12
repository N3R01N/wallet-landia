import { expect, test, type Page } from '@playwright/test';

// a player's own town (not the suggested one), in 3D
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: [{ name: 'wallet-landia-v4/prefs/v1', value: JSON.stringify({ view: '3d', quality: 'low', tourDone: true }) }] }] } });

type Stats = { geometries: number; textures: number; rebuilds: number; updates: number };
type Town = { stats(): Stats };
const stats = (page: Page): Promise<Stats> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.stats());
const frames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const saved = (page: Page): Promise<{ id: string; x: number; y: number; rot: number }[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { towns?: Record<string, { placed: { id: string; x: number; y: number; rot: number }[] }> }).towns?.ethereum?.placed ?? []));

/** Point at the ground: sweep the stage until the 3D view says the pointer is over this tile. */
async function pointAt(page: Page, tx: number, ty: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.stage-wrap').boundingBox())!;
  const hit = await page.evaluate(
    ([w, h, tx, ty]) => {
      const v = (window as unknown as { townView: { groundAt(x: number, y: number): { x: number; y: number } | null } }).townView;
      let best: [number, number, number] | null = null;
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          const g = v.groundAt(x, y);
          if (g === null) continue;
          const d = Math.hypot(g.x - tx, g.y - ty);
          if (best === null || d < best[2]) best = [x, y, d];
        }
      return best;
    },
    [box.width, box.height, tx, ty] as const,
  );
  expect(hit, 'that tile is not on screen').not.toBeNull();
  return { x: box.x + hit![0], y: box.y + hit![1] };
}

test('building in 3D changes the town in place: place, move, turn, store, without raising it again; memory stays flat', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { town3d?: Town }).town3d !== undefined, null, { timeout: 120_000 });
  await page.keyboard.press('b');
  const drawer = page.locator('.build-drawer');
  await expect(drawer).toBeVisible();
  await frames(page);
  const before = await stats(page);

  // place a home
  const card = drawer.locator('.build-card').first();
  await card.locator('.btn', { hasText: 'Build' }).click();
  const a = await pointAt(page, 18.5, 8.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  await frames(page);
  let s = await stats(page);
  expect(s.rebuilds).toBe(before.rebuilds);
  expect(s.updates).toBeGreaterThan(before.updates);

  // select it, turn it, move it, store it: still no rebuild
  const at = (await saved(page))[0]!;
  const mid = await pointAt(page, at.x + 1.5, at.y + 1.5);
  await page.mouse.click(mid.x, mid.y);
  await expect(drawer.locator('.build-selected')).toBeVisible();
  await page.keyboard.press('r');
  await expect.poll(async () => (await saved(page))[0]?.rot).toBe(1);
  await page.keyboard.press('m');
  const b = await pointAt(page, 30.5, 8.5);
  await page.mouse.move(b.x, b.y);
  await page.mouse.click(b.x, b.y);
  await expect.poll(async () => (await saved(page))[0]?.x).not.toBe(at.x);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await saved(page)).length).toBe(0);
  await frames(page);
  s = await stats(page);
  expect(s.rebuilds).toBe(before.rebuilds);

  // ten builds and stores: nothing piles up on the GPU
  const base = await stats(page);
  for (let i = 0; i < 10; i++) {
    await drawer.locator('.build-card').first().locator('.btn', { hasText: 'Build' }).click();
    await page.mouse.move(a.x + 2, a.y);
    await page.mouse.click(a.x, a.y);
    await expect.poll(async () => (await saved(page)).length).toBe(1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await saved(page)).length).toBe(0);
  }
  await frames(page);
  const after = await stats(page);
  expect(after.geometries, JSON.stringify({ base, after })).toBeLessThanOrEqual(base.geometries + 6);
  expect(after.textures, JSON.stringify({ base, after })).toBeLessThanOrEqual(base.textures + 12);
  // done: merged once again (one full build), then standing still
  await drawer.locator('.btn', { hasText: 'Done' }).click();
  await frames(page);
  expect((await stats(page)).rebuilds).toBeLessThanOrEqual(after.rebuilds + 1);
  expect(errors).toEqual([]);
});
