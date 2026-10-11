import { expect, test } from '@playwright/test';

type Win = { townSim: { realm: string; guild: { journeys: { chainId: string }[] } } };

/** Phase 6: the Realm Map shows Ethereum and its provinces; an island takes you to that realm's town, and it is kept. */
test('the Realm Map leads to a province town, and back to the kingdom', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?expose');
  const realmBtn = page.locator('.realm-btn');
  await expect(realmBtn).toContainText('Ethereum', { timeout: 20_000 });
  await realmBtn.click();
  const map = page.locator('.realm-map');
  await expect(map).toBeVisible();
  for (const id of ['ethereum', 'base', 'arbitrum', 'optimism']) await expect(map.locator(`.realm-isle[data-realm="${id}"]`)).toBeVisible();
  await expect(map.locator('.realm-isle.here')).toHaveAttribute('data-realm', 'ethereum');
  await expect(map.locator('.realm-isle[data-realm="ethereum"]')).toContainText('kingdom');
  await expect(map.locator('.realm-isle[data-realm="base"]')).toContainText('L2 province');

  await map.locator('.realm-isle[data-realm="base"]').click();
  await expect(map).toBeHidden();
  await expect(realmBtn).toContainText('Base');
  const inBase = await page.evaluate(() => {
    const sim = (window as unknown as Win).townSim;
    return { realm: sim.realm, others: sim.guild.journeys.filter((j) => j.chainId !== 'base').length };
  });
  expect(inBase).toEqual({ realm: 'base', others: 0 });

  // kept across a reload
  await page.reload();
  await expect(page.locator('.realm-btn')).toContainText('Base', { timeout: 20_000 });

  // Escape closes the map; the kingdom is one click away
  await page.locator('.realm-btn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.realm-map')).toBeHidden();
  await page.locator('.realm-btn').click();
  await page.locator('.realm-isle[data-realm="ethereum"]').click();
  await expect(page.locator('.realm-btn')).toContainText('Ethereum');
  expect(await page.evaluate(() => (window as unknown as Win).townSim.realm)).toBe('ethereum');
  expect(errors).toEqual([]);
});

test('the Guild panel picks which provinces load with Ethereum', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.realm-btn')).toContainText('Ethereum', { timeout: 20_000 });
  await page.locator('.btn', { hasText: 'Guild' }).click();
  const box = page.locator('input[data-chain="optimism"]');
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.locator('.btn', { hasText: 'Load these realms' }).click();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { chains?: string[] }).chains)).toEqual(['ethereum', 'base', 'arbitrum']);
  await page.locator('.realm-btn').click();
  await expect(page.locator('.realm-isle[data-realm="base"]')).toBeVisible();
  await expect(page.locator('.realm-isle[data-realm="optimism"]')).toHaveCount(0);
});
