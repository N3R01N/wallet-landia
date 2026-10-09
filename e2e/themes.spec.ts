import { expect, test } from '@playwright/test';

/** Phase 7: a theme bundle draws the real town's 3D view, chosen in the Looks panel. */
test('the 3D town can be drawn with a theme bundle, and the choice is kept', async ({ page }) => {
  test.setTimeout(240_000); // the theme's characters and textures load in software WebGL
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/?quality=low&hour=12');
  await page.locator('.btn', { hasText: '3D' }).click();
  await expect(page.locator('.stage3d')).toBeVisible({ timeout: 30_000 });

  await page.locator('.btn', { hasText: 'Looks' }).click();
  const picker = page.locator('.inspector select[aria-label="World theme"]');
  await expect(picker.locator('option')).toContainText(['Built-in (Hearth & Harvest)', 'Medieval', 'Highland'], { timeout: 30_000 });
  await picker.selectOption('medieval');
  await expect(page.locator('.stage3d')).toHaveAttribute('data-theme', 'medieval');
  // rigged people replace the sprites once their files are in
  await expect(page.locator('.stage3d')).toHaveAttribute('data-people', 'rigged', { timeout: 90_000 });
  const shot = await page.locator('.stage3d').screenshot({ timeout: 90_000 });
  expect(shot.length).toBeGreaterThan(30_000);

  await page.reload();
  await expect(page.locator('.stage3d')).toHaveAttribute('data-theme', 'medieval', { timeout: 60_000 });

  // back to the built-in look
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await page.locator('.inspector select[aria-label="World theme"]').selectOption('');
  await expect(page.locator('.stage3d')).toHaveAttribute('data-theme', '');
  expect(errors).toEqual([]);
});

/** Rigged heroes stay hoverable and clickable (an invisible proxy stands in for the skinned meshes). */
test('a rigged hero in a themed town answers hover and click', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?theme=medieval&expose&hour=12');
  await page.locator('.btn', { hasText: '3D' }).click();
  await expect(page.locator('.stage3d')).toHaveAttribute('data-people', 'rigged', { timeout: 180_000 });
  const where = (): Promise<[number, number] | null> => page.evaluate(() => (window as unknown as { town3d: { heroOnScreen(): [number, number] | null } }).town3d.heroOnScreen());
  // once a hero is out on foot (or horseback), pause so it stands still for the pointer
  await expect.poll(where, { timeout: 60_000 }).not.toBeNull();
  // a performance budget for a themed town (merged buildings, people LOD, far woods without shadows)
  const stats = await page.evaluate(() => (window as unknown as { town3d: { stats(): { calls: number; triangles: number } } }).town3d.stats());
  expect(stats.calls).toBeLessThan(800);
  // smoke over the chimneys; people are rigged near the camera and sprites beyond (never both)
  // (a rebuild after packs load recreates people on the next frame: look for a moment)
  const observe = (): Promise<{ smoke: boolean; rigged: number; both: number }> => page.evaluate(() => {
    const town = (window as unknown as { town3d: { debugPeople(): { id: string; shown: boolean | null }[]; debugScene(): { traverse(f: (o: { name: string; visible: boolean; isSprite?: boolean; userData: { agent?: string } }) => void): void } } }).town3d;
    let smoke = false;
    const sprites = new Set<string>();
    town.debugScene().traverse((o) => {
      if (o.name === 'smoke') smoke = true;
      if (o.isSprite && o.visible && o.userData.agent) sprites.add(o.userData.agent);
    });
    const shown = town.debugPeople().filter((p) => p.shown === true);
    return { smoke, rigged: shown.length, both: shown.filter((p) => sprites.has(p.id)).length };
  });
  await expect.poll(async () => (await observe()).rigged, { timeout: 45_000 }).toBeGreaterThan(0); // slow frames under load: a few seconds each
  const look = await observe();
  expect(look.smoke).toBe(true);
  expect(look.both).toBe(0);
  expect(stats.triangles).toBeLessThan(1_200_000);
  // people beyond the nearest few are the theme's figures baked to sprites (smoothly filtered), not pixel art
  const impostors = (): Promise<number> =>
    page.evaluate(() => {
      let n = 0;
      (window as unknown as { town3d: { debugScene(): { traverse(f: (o: { visible: boolean; isSprite?: boolean; userData: { agent?: string }; material?: { map?: { magFilter: number } } }) => void): void } } }).town3d
        .debugScene()
        .traverse((o) => {
          if (o.isSprite && o.visible && o.userData.agent && o.material?.map?.magFilter === 1006) n++; // LinearFilter
        });
      return n;
    });
  await expect.poll(impostors, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(page.locator('.btn[title^="Play / pause"]')).toHaveText('▶');
  await page.waitForTimeout(1000);
  const at = await where();
  expect(at).not.toBeNull();
  const box = await page.locator('.stage3d canvas.overlay').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + at![0], box!.y + at![1]);
  await expect(page.locator('.tooltip')).toBeVisible({ timeout: 10_000 });
  await page.mouse.click(box!.x + at![0], box!.y + at![1]);
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector h2')).not.toBeEmpty();
});
