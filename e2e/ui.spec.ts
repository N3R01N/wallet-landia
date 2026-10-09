import { expect, test } from '@playwright/test';

test('a loading veil until the town is ready; heroes are listed in the Guild tab, renamed, and remembered', async ({ page }) => {
  await page.goto('/?freeze');
  await page.keyboard.press('t');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });

  // the Guild tab lists the town's heroes, each opening its character sheet
  await page.locator('.btn', { hasText: 'Guild' }).click();
  const cards = page.locator('.hero-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator('.portrait')).toBeVisible();
  const address = await cards.first().getAttribute('data-hero');
  await cards.first().locator('.btn', { hasText: 'Character sheet' }).click();
  await expect(page.locator('.inspector .hero-name')).toBeVisible();

  // rename in the sheet
  await page.locator('.inspector .rename').click();
  await page.locator('.inspector input[aria-label="Hero name"]').fill('Sir Testalot');
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector .hero-name')).toHaveText('Sir Testalot');

  // fold the quest log
  await page.locator('.questlog h4').click();
  await expect(page.locator('.questlog')).toHaveClass(/collapsed/);

  // both survive a reload
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.questlog')).toHaveClass(/collapsed/);
  await page.locator('.btn', { hasText: 'Guild' }).click();
  await expect(page.locator(`.hero-card[data-hero="${address}"] .hero-name`)).toHaveText('Sir Testalot');

  // an empty name goes back to the one the town gave
  await page.locator(`.hero-card[data-hero="${address}"] .rename`).click();
  await page.locator('.inspector input[aria-label="Hero name"]').fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator(`.hero-card[data-hero="${address}"] .hero-name`)).not.toHaveText('Sir Testalot');
});
