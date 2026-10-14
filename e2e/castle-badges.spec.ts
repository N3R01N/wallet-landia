import { expect, test } from '@playwright/test';

/** The Badges tab: the player's level and rank from all the guild's history, and every badge with the theme's art. */

test.use({ viewport: { width: 390, height: 844 } });

test('the player card, every medal (earned ones first), and a badge’s sheet', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/castle.html');
  await page.locator('.tab', { hasText: 'Badges' }).click();
  const tab = page.locator('.badges-tab');
  await expect(tab.locator('.player-card h2')).toContainText(/Level \d+ · /, { timeout: 30_000 });
  await expect(tab.locator('.xp-bar')).toBeVisible();
  // the castle's five badges (earned, or how far along), then the 22 medals
  await expect(tab.locator('h2', { hasText: 'Your castle' })).toBeVisible();
  await expect(tab.locator('.castle-badge')).toHaveCount(5);
  await expect(tab.locator('.badge-card')).toHaveCount(27);
  // the top bar follows the player
  await expect(page.locator('.topbar .rank')).toContainText(/Lv \d+ · /);
  // the pictures come from the theme, with its version
  const src = await tab.locator('.badge-card img').first().getAttribute('src');
  expect(src).toMatch(/\/themes\/medieval-castle\/art\/badge\/[a-z-]+\.svg\?v=\d+\.\d+\.\d+$/);

  for (const card of [tab.locator('.castle-badge').first(), tab.locator('.badge-card:not(.castle-badge)').first()]) {
    await card.click();
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.badge-sheet p').first()).not.toBeEmpty();
    await sheet.locator('.sheet-close').click();
  }

  expect(errors).toEqual([]);
});
