import { expect, test } from './fixtures.js';

test('the asset gallery lists every asset, filters them, and shows a spec', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/assets.html');

  // every card is there; the design agent's files count as ready
  await expect(page.locator('.stats')).toContainText(/assets · \d+ required/);
  const cards = page.locator('.card');
  const total = await cards.count();
  expect(total).toBeGreaterThan(90);
  await expect(page.locator('.stats')).toContainText(/\d+ files in all/);
  await expect(page.locator('.pill.ready').first()).toBeVisible();
  // (standins show for any asset still without a file; once the theme is complete there are none)

  // filter: required only
  await page.locator('select[aria-label="Show"]').selectOption('required');
  await expect
    .poll(async () => page.locator('.card:visible').count())
    .toBeLessThan(total);

  // filter: one group
  await page.locator('select[aria-label="Show"]').selectOption('all');
  await page.locator('select[aria-label="Group"]').selectOption('bridge');
  await expect(page.locator('.card:visible')).toHaveCount(2); // bridge.drawbridge and bridge.chain

  // a card opens its spec
  await page.locator('.card[data-asset="bridge.drawbridge"]').click();
  const dialog = page.locator('dialog.detail');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2')).toHaveText('bridge.drawbridge');
  await expect(dialog).toContainText('lower, raise');
  await expect(dialog).toContainText('models/bridge/drawbridge.glb');
  await dialog.locator('button', { hasText: 'Close' }).click();
  await expect(dialog).toBeHidden();

  expect(errors).toEqual([]);
});
