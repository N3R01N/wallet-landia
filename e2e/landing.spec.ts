import { expect, test } from './fixtures.js';

/**
 * The landing page (zenigard.cc; here /landing.html, with the app at /): its
 * links open the app, the demo and the famous castles. "Build my castle"
 * opens the app at #start, which takes a player without a key straight to
 * the key field in the Guild tab (and one with a key to the wallet field).
 */

test('the links go to the app: build my castle, the demo and each famous castle', async ({ page }) => {
  await page.goto('/landing.html');
  await expect(page.locator('.start-card').getByRole('link', { name: 'Build my castle' })).toHaveAttribute('href', '/#start');
  await expect(page.getByRole('link', { name: 'Walk around the demo castle →' })).toHaveAttribute('href', '/');
  await expect(page.locator('.famous-card').first()).toHaveAttribute('href', '/#famous=vitalik');
  await expect(page.locator('.famous-card')).toHaveCount(4);
});

test('build my castle: the app opens on the key field, then on the wallet field once a key is saved', async ({ page }) => {
  await page.goto('/landing.html');
  await page.locator('.start-card').getByRole('link', { name: 'Build my castle' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('.guild-tab')).toBeVisible();
  await expect(page.getByLabel('Zerion API key')).toBeFocused();
  // no tour over it
  await expect(page.locator('.tour-card')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('zenigard/zerion-key', 'zk_test_key'));
  await page.goto('/landing.html');
  await page.locator('.start-card').getByRole('link', { name: 'Build my castle' }).click();
  await expect(page.getByLabel('Wallet address or ENS name')).toBeFocused();
});

test('an old link to a castle on the front page goes on to the app', async ({ page }) => {
  await page.goto('/landing.html#famous=vitalik');
  await page.waitForURL((url) => url.pathname === '/' && url.hash === '#famous=vitalik');
});
