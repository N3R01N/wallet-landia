import { expect, test, type Page } from '@playwright/test';

type Stats = { geometries: number; textures: number; agents: number };
type Town = { stats(): Stats; debugRebuild(): void };

/** `n` frames drawn: whatever the town holds is uploaded (and counted) by then. */
const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate((n) => new Promise<void>((r) => {
    let k = 0;
    const f = (): void => (++k >= n ? r() : void requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
const stats = (page: Page): Promise<Stats> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.stats());
const rebuild = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.debugRebuild());

/**
 * The town is rebuilt on every live update, realm switch and theme change.
 * Detaching the old one frees nothing on the GPU, so each rebuild must free
 * what it made: geometries and textures stay flat however often it happens.
 */
test('rebuilding the 3D town does not grow its GPU memory', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL: a frame can take half a second
  await page.goto('/?expose&freeze&quality=low&theme=');
  await page.locator('.btn', { hasText: '3D' }).click();
  await expect(page.locator('.stage3d')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { town3d?: Town }).town3d !== undefined, null, { timeout: 60_000 });
  // one rebuild first, so everything built lazily on the first one (caches) is in
  await rebuild(page);
  // People keep arriving for a while, each new sprite frame a texture of its own (cached, not
  // leaked). Measure once the town has settled: textures steady over two looks in a row.
  let last = await stats(page);
  for (let steady = 0, tries = 0; steady < 2 && tries < 30; tries++) {
    await frames(page, 6);
    const now = await stats(page);
    steady = now.textures - last.textures <= 1 ? steady + 1 : 0;
    last = now;
  }
  const before = last;
  expect(before.geometries).toBeGreaterThan(10);
  for (let i = 0; i < 10; i++) {
    await rebuild(page);
    await frames(page);
  }
  const after = await stats(page);
  // Each rebuild that leaked would add a whole town: dozens of geometries, and textures for the
  // ground, the toll and market boards, the lamps' glow and every emblem (40+ over ten rebuilds).
  // A little drift is people's sprite frames seen for the first time meanwhile.
  expect(after.geometries, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.geometries + 3);
  expect(after.textures, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.textures + 10);
});
