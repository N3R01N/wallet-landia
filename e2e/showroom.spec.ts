import { expect, test } from './fixtures.js';

/** The showroom: every model the v2 theme has, in one scene, and its 2D art; nothing fails to load. */
test('the showroom lays out the theme’s models in rows and shows its 2D art', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/showroom.html?theme=medieval-castle-v2');
  await expect.poll(() => page.evaluate(() => (window as unknown as { showroom?: { count(): number } }).showroom?.count() ?? 0), { timeout: 200_000 }).toBeGreaterThan(50);
  await expect(page.locator('.showroom-label.group', { hasText: 'Castle' })).toHaveCount(1);
  await page.locator('select[aria-label="View"]').selectOption('2d');
  await expect(page.locator('.showroom-art img')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});
