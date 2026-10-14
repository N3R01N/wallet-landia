import { expect, test } from '@playwright/test';

/** The Guild tab: the player's key and wallets, shared with the town. */

test.use({ viewport: { width: 390, height: 844 } });

test('wallets are added and removed, nonsense is refused with a reason, and a bad key is not kept', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/castle.html');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const tab = page.locator('.guild-tab');
  await expect(tab.locator('.source')).not.toHaveText('Loading…');

  // nonsense: a reason, nothing added
  const input = tab.getByLabel('Wallet address or ENS name');
  await input.fill('not a wallet');
  await tab.locator('[data-section="wallets"] .btn', { hasText: 'Add' }).click();
  await expect(tab.locator('[data-section="wallets"]').locator('.form-msg')).toContainText('0x… address or an ENS name');

  // an address: listed, kept in the shared preferences, and removable
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  await input.fill(address);
  await tab.locator('[data-section="wallets"] .btn', { hasText: 'Add' }).click();
  await expect(page.locator('.guild-tab .wallet-row')).toContainText('0x1234…5678');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { owned?: string[] });
  expect(saved.owned).toContain(address);
  await page.locator('.guild-tab .wallet-row .btn').click();
  await expect(page.locator('.guild-tab .wallet-row')).toHaveCount(0);

  // a key with a stray character is refused, with the reason
  await page.locator('.guild-tab').getByLabel('Zerion API key').fill('zk_dev abc');
  await page.locator('.guild-tab [data-section="key"] .btn', { hasText: 'Save' }).click();
  await expect(page.locator('.guild-tab [data-section="key"]').locator('.form-msg')).not.toBeEmpty();
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => /key/i.test(k) && (localStorage.getItem(k) ?? '').includes('zk_dev abc')))).toBe(false);

  expect(errors).toEqual([]);
});

test('the history file and the Ethereum node: a refused node address says why, a good one is kept', async ({ page }) => {
  await page.goto('/castle.html');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const tab = page.locator('.guild-tab');
  await expect(tab.locator('h2', { hasText: 'Your history' })).toBeVisible();
  await expect(tab.locator('.btn', { hasText: 'Save to a file' })).toBeVisible();
  const node = tab.getByLabel('Ethereum node address');
  await node.fill('http://evil.example');
  await tab.locator('.btn', { hasText: 'Use' }).click();
  await expect(tab.locator('[data-section="node"]').locator('.form-msg')).toContainText('Use an https address');
  await tab.locator('.btn', { hasText: 'Default' }).click();
  await expect(tab.locator('[data-section="node"]').locator('.form-msg')).toContainText('free public node');
});
