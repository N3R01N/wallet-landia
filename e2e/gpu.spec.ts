import { expect, test, type Page } from '@playwright/test';

type Stats = { geometries: number; textures: number; agents: number };
type Town = { stats(): Stats; debugRebuild(): void; debugRefresh(): void; debugScene(): { getObjectByName(n: string): { uuid: string } | undefined } };

/** `n` frames drawn: whatever the town holds is uploaded (and counted) by then. */
const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate((n) => new Promise<void>((r) => {
    let k = 0;
    const f = (): void => (++k >= n ? r() : void requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
const stats = (page: Page): Promise<Stats> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.stats());
const rebuild = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.debugRebuild());
const refresh = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.debugRefresh());
/** The merged buildings mesh: the same one while the town stands. */
const buildingsId = (page: Page): Promise<string | undefined> => page.evaluate(() => (window as unknown as { town3d: Town }).town3d.debugScene().getObjectByName('buildings')?.uuid);

/** Open the 3D town, rebuild once (caches built lazily on the first one are in), and wait until it settles. */
async function settled(page: Page): Promise<Stats> {
  await page.goto('/?expose&freeze&quality=low&theme=');
  await page.locator('.view-select').selectOption('3d');
  await expect(page.locator('.stage3d')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { town3d?: Town }).town3d !== undefined, null, { timeout: 60_000 });
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
  return last;
}

/**
 * The town is rebuilt on every live update, realm switch and theme change.
 * Detaching the old one frees nothing on the GPU, so each rebuild must free
 * what it made: geometries and textures stay flat however often it happens.
 */
/**
 * Textures that people arriving meanwhile may bring (their sprite frames, a few each): villagers keep
 * coming even with ?freeze, so the allowance follows how many came, far below what a leak adds.
 */
const spriteSlack = (before: { agents: number }, after: { agents: number }): number => 10 + 3 * Math.max(0, after.agents - before.agents);

test('rebuilding the 3D town does not grow its GPU memory', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL: a frame can take half a second
  const before = await settled(page);
  expect(before.geometries).toBeGreaterThan(10);
  for (let i = 0; i < 10; i++) {
    await rebuild(page);
    await frames(page);
  }
  const after = await stats(page);
  // Each rebuild that leaked would add a whole town: dozens of geometries, and textures for the
  // ground, the toll and market boards, the lamps' glow and every emblem (~40 a rebuild, 400+ over ten).
  // Some drift is people's sprite frames seen for the first time meanwhile (see spriteSlack).
  expect(after.geometries, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.geometries + 3);
  expect(after.textures, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.textures + spriteSlack(before, after));
});

/**
 * Most live updates bring the same town: it stays standing (the same merged buildings), and
 * only what the sim holds (people, harvest piles) is redone, freeing what it replaces.
 */
test('a live update with the same town keeps it and frees what it redoes', async ({ page }) => {
  test.setTimeout(180_000);
  const before = await settled(page);
  const town = await buildingsId(page);
  expect(town).toBeDefined();
  for (let i = 0; i < 10; i++) {
    await refresh(page);
    await frames(page);
  }
  expect(await buildingsId(page)).toBe(town);
  const after = await stats(page);
  expect(after.geometries, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.geometries + 3);
  expect(after.textures, JSON.stringify({ before, after })).toBeLessThanOrEqual(before.textures + spriteSlack(before, after));
});
