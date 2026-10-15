import { expect, test } from '@playwright/test';
import { sceneState, tapBuilding, tapCourier, tapPerson } from './castleHelpers.js';

/** The castle and the town in 3D, from the session's wallets (captured or demo): couriers' errands play out, the view zooms, a building can be tapped. */

test.use({ viewport: { width: 1280, height: 800 } });

test('the guild’s transactions play as errands: the drawbridge lowers, the barrier lifts, couriers reach the town; the wheel zooms', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();

  // the bridge starts raised (−90°) and lowers as the courier sets out
  await expect.poll(async () => (await sceneState(page)).bridgeAngle, { timeout: 20_000 }).toBeGreaterThan(-0.2);
  // the barrier lifts once the toll is paid
  await expect.poll(async () => (await sceneState(page)).barrierAngle, { timeout: 20_000 }).toBeGreaterThan(1.2);
  // the courier gets into the town
  await expect.poll(async () => (await sceneState(page)).courier?.z ?? -99, { timeout: 20_000 }).toBeGreaterThan(5);

  const before = (await sceneState(page)).zoom;
  const box = (await page.locator('.castle-view canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await sceneState(page)).zoom).toBeGreaterThan(before);

  // a block rings the bell
  await page.evaluate(() => (window as unknown as { castleView: { ringBell(): void } }).castleView.ringBell());
  expect((await sceneState(page)).ringing).toBe(true);

  expect(errors).toEqual([]);
});

test('the town tab: tapping a building opens its sheet', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Town' }).click();
  const name = await tapBuilding(page, 1);
  await expect(page.locator('.sheet .sheet-title')).toHaveText(name);
});

test('a building’s sheet says what the guild keeps there; a courier’s sheet is its transaction, with an explorer link', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Town' }).click();
  await tapBuilding(page);
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.holdings li, p.muted').first()).toBeVisible();
  await sheet.locator('.sheet-close').click();

  await tapCourier(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.facts')).toContainText('Toll (fee)');
  await expect(sheet.locator('a.explorer')).toHaveAttribute('href', /^https:\/\/[a-z.]*scan\.(io|org)\/tx\/0x/);
});

test('sound is off until switched on, the choice is kept, and coins ring at the toll', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const toggle = page.locator('.sound-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { sound?: boolean }).sound)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { castleSound: { played: Record<string, number> } }).castleSound.played.coins ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('.sound-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('the chronicle lists the recent transactions, newest first; a row opens its sheet', async ({ page }) => {
  await page.goto('/');
  await page.locator('.chronicle-btn').click();
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.sheet-title')).toHaveText('Chronicle');
  const rows = sheet.locator('.chronicle-row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);
  const label = (await rows.first().locator('.chronicle-label').textContent()) ?? '';
  await rows.first().click();
  await expect(sheet.locator('.sheet-title')).toHaveText(label);
  await expect(sheet.locator('.facts')).toBeVisible();
});

test('a transaction’s Quest Replay: every stop with the goods given and received; Replay sends its courier next', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await page.locator('.chronicle-btn').click();
  const sheet = page.locator('.sheet');
  // the first transaction that moved goods
  const row = sheet.locator('.chronicle-row').first();
  const key = (await row.getAttribute('data-errand'))!;
  await row.click();
  await expect(sheet.locator('h3', { hasText: /What happened|Step by step/ })).toBeVisible();
  await expect(sheet.locator('.replay-step').first()).toBeVisible();
  await sheet.locator('.replay-btn').click();
  await expect(sheet).toBeHidden();
  // its courier is out, or the next to set out
  expect((await sceneState(page)).upcoming).toContain(key);
});

test('the replay timeline plays the history (couriers set out), pauses, seeks, and goes back to live', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await page.locator('.replay-open').click();
  const bar = page.locator('.timeline');
  await expect(bar).toBeVisible();
  await expect(page.locator('.castle-view')).toHaveAttribute('data-replay', 'playing');
  const start = await bar.locator('.timeline-when').textContent();
  // a week a second: the history goes by, couriers set out
  await bar.getByLabel('Replay speed').selectOption({ label: '1 week / s' });
  await expect.poll(async () => (await sceneState(page)).couriers, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => bar.locator('.timeline-when').textContent()).not.toBe(start);

  await bar.getByLabel('Pause').click();
  await expect(page.locator('.castle-view')).toHaveAttribute('data-replay', 'paused');
  await bar.getByLabel('Replay position').fill('500');
  const middle = await bar.locator('.timeline-when').textContent();
  expect(middle).not.toBe(start);

  await bar.locator('.timeline-live').click();
  await expect(bar).toBeHidden();
  await expect(page.locator('.replay-open')).toBeVisible();
});

test('build mode: a building moves from its sheet; the places it can go are marked; a swap is kept across a reload; Reset brings the automatic layout back', async ({ page }) => {
  test.setTimeout(120_000);
  type Hook = { castleView: { slots(): Record<string, number>; buildingIds(): string[] } };
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Town' }).click();
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  const [a, b] = await page.evaluate(() => (window as unknown as Hook).castleView.buildingIds().slice(0, 2));
  const before = await page.evaluate(() => (window as unknown as Hook).castleView.slots());

  // no Arrange button in the scene: it starts from the building's sheet
  await expect(page.locator('.arrange-open')).toHaveCount(0);
  await tapBuilding(page, 0);
  await page.locator('.sheet .move-building').click();
  await expect(page.locator('.castle-view')).toHaveAttribute('data-arranging', 'true');
  await expect(page.locator('.arrange-hint')).toContainText('Moving');
  await expect(page.locator('.arrange-label.swap').first()).toBeAttached();
  await tapBuilding(page, 1);
  const after = await page.evaluate(() => (window as unknown as Hook).castleView.slots());
  expect(after[a!]).toBe(before[b!]);
  expect(after[b!]).toBe(before[a!]);
  await expect(page.locator('.castle-view')).toHaveAttribute('data-arranging', 'false');

  await page.reload();
  await page.locator('.tab', { hasText: 'Town' }).click();
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as Hook).castleView.slots())).toEqual(after);

  await tapBuilding(page, 0);
  await page.locator('.sheet .move-building').click();
  await page.locator('.arrange-bar .btn', { hasText: 'Reset' }).click();
  expect(await page.evaluate(() => (window as unknown as Hook).castleView.slots())).toEqual(before);
  await expect(page.locator('.castle-view')).toHaveAttribute('data-arranging', 'false');
});

test('a townsperson says they are an NPC and whose they are, and speaks in a bubble', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await tapPerson(page);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.npc-tag')).toBeVisible();
  await expect(sheet).toContainText(/Belongs to|belongs to no building/);
  await expect(sheet.locator('.person-line')).toBeVisible();
  await expect(page.locator('.speech-bubble').first()).toBeVisible();
});
