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

test('the Chronicle Tower shows how busy the chain is: a beacon on top, a toll board, a queue at its door', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await page.locator('.btn', { hasText: '3D' }).click();
  await expect(page.locator('.stage3d')).toBeVisible({ timeout: 60_000 });
  const look = await page.waitForFunction(() => {
    const town = (window as unknown as { town3d?: { debugScene(): { getObjectByName(n: string): unknown }; debugPeople(): { kind: string; x: number; y: number }[] } }).town3d;
    if (!town) return null;
    const scene = town.debugScene();
    const beacon = scene.getObjectByName('tower-beacon') !== undefined;
    const board = scene.getObjectByName('toll-board') !== undefined;
    // townsfolk standing in line on the road below the tower door (x ≈ 24.5, y 18–26)
    const line = town.debugPeople().filter((p) => p.kind === 'villager' && Math.abs(p.x - 24.5) < 0.6 && p.y > 18 && p.y < 26).length;
    return beacon && board && line >= 2 ? { beacon, board, line } : null;
  }, null, { timeout: 60_000 });
  expect(await look.jsonValue()).toMatchObject({ beacon: true, board: true });
});

test('sound is off until turned on; then the town plays its sounds, and the choice is kept', async ({ page }) => {
  await page.goto('/?expose');
  await page.keyboard.press('t');
  const btn = page.locator('.btn.sound');
  await expect(btn).toHaveText('🔇');
  expect(await page.evaluate(() => (window as unknown as { soundscape: { state: string } }).soundscape.state)).toBe('none');
  await btn.click();
  await expect(btn).toHaveText('🔊');
  await expect.poll(() => page.evaluate(() => (window as unknown as { soundscape: { state: string } }).soundscape.state)).toBe('running');
  // the replay at speed: tolls and trades jingle
  await page.locator('.btn', { hasText: '8×' }).click();
  await expect
    .poll(() => page.evaluate(() => Object.values((window as unknown as { soundscape: { played: Record<string, number> } }).soundscape.played).reduce((s, n) => s + n, 0)), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const kept = await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { sound?: boolean }).sound);
  expect(kept).toBe(true);
  await page.keyboard.press('m');
  await expect(btn).toHaveText('🔇');
});

test('a first-visit tour explains the demo town and leads to the Guild panel; it can be skipped and shown again', async ({ page }) => {
  // automated browsers never get the tour unasked: ?tour forces it, as on a first visit
  await page.goto('/?tour&freeze');
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('demo town');
  await expect(card).toContainText('1 /');
  // forward to the Zerion key step: it opens the Guild panel and points at the key field
  for (let i = 0; i < 7; i++) await card.locator('.btn.primary').click();
  await expect(card.locator('h3')).toHaveText('1. A Zerion key');
  await expect(page.locator('.inspector h2').first()).toHaveText('⚙ Guild');
  await expect(card.locator('a[href="https://dashboard.zerion.io"]')).toBeVisible();
  await card.locator('.btn', { hasText: 'Back' }).click();
  await expect(card.locator('h3')).toHaveText('Make it yours');
  // skipping ends it, and it is remembered
  await card.locator('.tour-skip').click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { tourDone?: boolean }).tourDone)).toBe(true);
  // the ? button shows it again
  await page.locator('.btn[aria-label="Show the tour again"]').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('the value scale folds to its title, and stays folded', async ({ page }) => {
  await page.goto('/?freeze');
  const legend = page.locator('.legend');
  await expect(legend.locator('.legend-item').first()).toBeVisible();
  await legend.locator('h4').click();
  await expect(legend).toHaveClass(/collapsed/);
  await expect(legend.locator('.legend-item').first()).toBeHidden();
  await page.reload();
  await expect(page.locator('.legend')).toHaveClass(/collapsed/);
});
