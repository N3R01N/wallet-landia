import { expect, test } from './fixtures.js';

/** Rendering quality: high has the sun's shadows and the environment light; ?quality pins it. */

test('the high quality loads with shadows and the environment light; low without', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?quality=high');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.castle-view')).toHaveAttribute('data-quality', 'high');
  await page.goto('/?quality=low');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.castle-view')).toHaveAttribute('data-quality', 'low');
});
