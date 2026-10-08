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
