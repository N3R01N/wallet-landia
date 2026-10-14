import { expect, test } from '@playwright/test';

/** The first load: a small animation per phase (wallets, castle, welcome), in order, then out of the way. */

test('the loader shows each phase in turn, then gets out of the way', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const screen = page.locator('.loading-screen');
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute('aria-busy', 'true');
  await expect(screen).toHaveCount(0, { timeout: 30_000 }); // gone
  const seen = await page.evaluate(() => (window as unknown as { castleLoading: { seen: string[] } }).castleLoading.seen);
  expect(seen).toEqual(['wallets', 'castle', 'welcome']);
  // and the castle is there to use
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
});
