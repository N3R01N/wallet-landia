import { expect, test } from '@playwright/test';

test('a medal is announced as the replay plays; the hero wears its title', async ({ page }) => {
  // the first medals in the captured wallets come ~640 s into the replay: start just before
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?at=625');
  await page.keyboard.press('t');
  await page.locator('.btn', { hasText: '8×' }).click();
  const toast = page.locator('.toast').first();
  await expect(toast).toBeVisible({ timeout: 90_000 });
  await expect(toast).toContainText('earned');
  await toast.click();

  // the hero's sheet: a medal case with that medal earned, teaching quests, a title to pick
  const sheet = page.locator('.inspector');
  await expect(sheet.locator('h3', { hasText: 'Medals' })).toBeVisible();
  await expect(sheet.locator('.medal.earned').first()).toBeVisible();
  const select = sheet.locator('select[aria-label="Hero title"]');
  const options = await select.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  const pick = options[options.length - 1]!;
  await select.selectOption(pick);
  await expect(page.locator('.inspector .hero-title')).toHaveText(pick);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { titles?: Record<string, string>; medals?: Record<string, object> });
  expect(Object.values(kept.titles ?? {})).toContain(pick);
  expect(Object.keys(kept.medals ?? {}).length).toBeGreaterThan(0);

  // a crest colour of the player's choosing, kept
  await page.locator('.inspector .swatch[title="Azure"]').click();
  await expect(page.locator('.inspector .swatch[title="Azure"]')).toHaveClass(/on/);
  const crests = await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { crests?: Record<string, string[]> }).crests ?? {});
  expect(Object.values(crests).map((c) => c[0])).toContain('#2a58b0');
  expect(errors).toEqual([]);
});

test('fog of war is opt in, kept, and hides buildings no hero has visited yet', async ({ page }) => {
  await page.goto('/?freeze');
  await page.keyboard.press('t');
  await page.locator('.btn', { hasText: 'Looks' }).click();
  const box = page.locator('input[aria-label="Fog of war"]');
  await expect(box).not.toBeChecked();
  await box.check();
  const kept = await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { fog?: boolean }).fog);
  expect(kept).toBe(true);
  await page.locator('.inspector .close').click();

  // at the start of the replay, the protocols' buildings are mist
  const world = (await page.locator('.world').boundingBox())!;
  let found = false;
  for (let gy = 0.15; gy <= 0.85 && !found; gy += 0.05) {
    for (let gx = 0.2; gx <= 0.85 && !found; gx += 0.03) {
      await page.mouse.move(world.x + world.width * gx, world.y + world.height * gy);
      found = (await page.locator('.tooltip').isVisible()) && (await page.locator('.tooltip').textContent())?.includes('Unexplored') === true;
    }
  }
  expect(found, 'no building answered as unexplored').toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.inspector h2')).toHaveText('Unexplored');
});
