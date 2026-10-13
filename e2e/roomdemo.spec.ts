import { expect, test } from '@playwright/test';
import { DEMO_HERO, DEMO_HOLDINGS } from './roomFixture';

test('the inside of a house shows every kind of thing, animated', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.evaluate(([h, hero]) => (window as unknown as { openInsideDemo: (s: unknown, hero: unknown) => void }).openInsideDemo(h, hero), [DEMO_HOLDINGS, DEMO_HERO]);
  await expect(page.locator('.room-view canvas.room-canvas')).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('.room-view').screenshot({ path: test.info().outputPath('room2d-demo.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.room-view')).toHaveCount(0);
});
