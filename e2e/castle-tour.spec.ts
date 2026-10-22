import { expect, test } from './fixtures.js';
import { TEST_RENDERING } from '../playwright.config.js';

/** The first-visit tour: shows once, walks through the castle into the Guild tab, can be skipped and shown again. */

// the tour not yet seen, but the test rendering all the same (at high quality the tour took over a minute)
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: TEST_RENDERING }] }, viewport: { width: 390, height: 844 } });

test('a first visit gets the tour; it ends in the Guild tab; it does not come back, but the ? button shows it again', async ({ page }) => {
  test.setTimeout(150_000); // the v2 town loads two scenes in software WebGL here
  await page.goto('/');
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator('h3')).toHaveText('Welcome to your castle');
  // walk to the end
  for (let i = 0; i < 10 && (await card.isVisible()); i++) await card.locator('.btn', { hasText: /Next|Got it/ }).click();
  await expect(card).toBeHidden();
  await expect(page.locator('.tab', { hasText: 'Guild' })).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page.locator('.castle-view[data-ready="true"]').or(page.locator('.guild-tab'))).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(card).toBeHidden();

  await page.locator('.tour-btn').click();
  await expect(card).toBeVisible();
  await card.locator('.tour-skip').click();
  await expect(card).toBeHidden();
});
