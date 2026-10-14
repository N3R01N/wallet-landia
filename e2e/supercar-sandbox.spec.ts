import { expect, test } from '@playwright/test';

/** The modern theme's tier-2 hero rides the bicycle: the look sandbox shows it, with no errors. */
test('the modern theme tier-6 hero drives a supercar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/sandbox.html?theme=modern&tier=6&cam=characters&quality=medium&hour=12&freeze');
  await expect(page.locator('.panel h1')).toHaveText('Look sandbox');
  await expect(page.locator('.perf')).toContainText('draw calls', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: test.info().outputPath('supercar-sandbox.png') });
  expect(errors).toEqual([]);
});
