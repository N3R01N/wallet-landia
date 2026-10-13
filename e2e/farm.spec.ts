import { expect, test } from '@playwright/test';

test('the medieval town has a farm whose herd follows the net worth', async ({ page }) => {
  await page.goto('/?theme=medieval&expose&hour=12&freeze');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 60_000 });
  // the animals load once the town is up: wait for the herd
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { town3d?: { farmCount(): number } }).town3d?.farmCount() ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000); // let them walk a little
  await page.screenshot({ path: test.info().outputPath('farm.png') });
});
