import { expect, test } from '@playwright/test';

/** The look sandbox shows every tier's hero and mount at once, in a row, with no errors. */
test('the look sandbox shows every tier\'s mount at once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/sandbox.html?theme=modern&mounts=all&cam=mounts&quality=medium&hour=12&freeze');
  await expect(page.locator('.panel h1')).toHaveText('Look sandbox');
  await expect(page.locator('.perf')).toContainText('draw calls', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: test.info().outputPath('mounts-sandbox.png') });
  expect(errors).toEqual([]);
});
