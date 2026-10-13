import { expect, test, type Page } from '@playwright/test';

/** Sweep the town (top-down) until a hover names a home; returns its page position. */
async function findHome(page: Page): Promise<{ x: number; y: number } | null> {
  const box = await page.locator('.world').boundingBox();
  if (!box) return null;
  for (let gy = 0.25; gy <= 0.8; gy += 0.05) {
    for (let gx = 0.3; gx <= 0.85; gx += 0.04) {
      const x = box.x + box.width * gx;
      const y = box.y + box.height * gy;
      await page.mouse.move(x, y);
      if (await page.locator('.tooltip').isVisible()) {
        const text = (await page.locator('.tooltip').textContent()) ?? '';
        if (text.includes("'s home")) return { x, y };
      }
    }
  }
  return null;
}

test('a house opens its panel with its room in it', async ({ page }) => {
  await page.goto('/?freeze');
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  let spot: { x: number; y: number } | null = null;
  await expect(async () => {
    spot = await findHome(page);
    expect(spot, 'no home answered a hover').not.toBeNull();
  }).toPass({ timeout: 40_000 });
  // (under load a click can land a little off the house: hover and click again until its panel opens)
  await expect(async () => {
    await page.mouse.move(spot!.x, spot!.y);
    await page.mouse.click(spot!.x, spot!.y);
    await expect(page.getByRole('button', { name: 'Step inside' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Step inside' }).click();
  const view = page.locator('.room-view');
  await expect(view).toBeVisible();
  await expect(view.locator('.room-scene')).toBeVisible();
  await page.waitForTimeout(300);
  await view.screenshot({ path: test.info().outputPath('room-view.png') });
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
});
