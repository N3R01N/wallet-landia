import { expect, test } from '@playwright/test';

/** The look sandbox renders, and its controls change the real scene without errors. */
test('the look sandbox renders and its controls work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/sandbox.html?quality=low&cam=overview&hour=12');
  await expect(page.locator('.panel h1')).toHaveText('Look sandbox');
  await expect(page.locator('.perf')).toContainText('draw calls', { timeout: 30_000 });

  const state = (): Promise<{ anim: string; chars: number; sky: string | null; view: string }> =>
    page.evaluate(() => {
      const s = (window as unknown as { sandbox: { anim: string; view: string; env: { current: string | null }; scene: { traverse(f: (o: { isSprite?: boolean }) => void): void } } }).sandbox;
      let chars = 0;
      s.scene.traverse((o) => {
        if (o.isSprite) chars++;
      });
      return { anim: s.anim, chars, sky: s.env.current, view: s.view };
    });

  await page.locator('select[aria-label="Animation"]').selectOption('run');
  await page.locator('select[aria-label="View"]').selectOption('wireframe');
  await page.locator('select[aria-label="Sky"]').selectOption('sunset');
  await page.locator('select[aria-label="Hero tier"]').selectOption('6');
  await expect.poll(async () => (await state()).sky, { timeout: 30_000 }).toBe('sunset');
  const s = await state();
  expect(s.anim).toBe('run');
  expect(s.view).toBe('wireframe');
  expect(s.chars).toBeGreaterThanOrEqual(12); // 7 heroes + 5 villagers
  const shot = await page.locator('.world').screenshot({ timeout: 90_000 });
  expect(shot.length).toBeGreaterThan(30_000);
  expect(errors).toEqual([]);
});

test('the medieval theme loads rigged characters and mounts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/sandbox.html?theme=medieval&quality=low&anim=walk&tier=3&cam=closeup');
  await page.waitForFunction(() => (window as unknown as { sandbox?: { ready: boolean } }).sandbox?.ready === true, null, { timeout: 90_000 });
  const counts = await page.evaluate(() => {
    const s = (window as unknown as { sandbox: { scene: { traverse(f: (o: { isSkinnedMesh?: boolean; isSprite?: boolean }) => void): void } } }).sandbox;
    let skinned = 0;
    let sprites = 0;
    s.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned++;
      if (o.isSprite) sprites++;
    });
    return { skinned, sprites };
  });
  expect(counts.sprites).toBe(0); // no pixel billboards in this theme
  expect(counts.skinned).toBeGreaterThan(12 * 4); // body/outfit/hair parts for 12 people, plus horses
  await expect(page.locator('.note')).toContainText('Rigged CC0 characters');
  // buildings come from the grammar (one mesh per material, named by it) and their PBR textures load
  await page.waitForFunction(
    () => {
      type M = { name: string; material?: { map?: { image?: { width?: number } } } };
      const s = (window as unknown as { sandbox: { scene: { traverse(f: (o: M) => void): void } } }).sandbox;
      const textured: M[] = [];
      s.scene.traverse((o) => {
        if (['stone', 'plaster', 'roofTiles', 'timber', 'cobbles'].includes(o.name)) textured.push(o);
      });
      return textured.length > 40 && textured.every((o) => (o.material?.map?.image?.width ?? 0) > 0);
    },
    null,
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
});
