import { expect, test } from './fixtures.js';
import { sceneState, showTown, tapBuilding, tapCourier, tapPerson } from './castleHelpers.js';

/** The castle and the town in 3D, from the session's wallets (captured or demo): couriers' errands play out, the view zooms, a building can be tapped. */

test.use({ viewport: { width: 1280, height: 800 } });

test('the guild’s transactions play as errands: the drawbridge lowers, the barrier lifts, couriers reach the town; the wheel zooms', async ({ page }) => {
  // a loaded machine draws few frames, and the scene's clock steps at most 0.1 s a frame: the errand slows down
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();

  // the barrier is up only for a moment: keep the highest of each on every frame, so a slow poll can't miss it
  await page.evaluate(() => {
    type State = { bridgeAngle: number; barrierAngle: number; courier: { z: number } | null };
    const w = window as unknown as { castleView: { state(): State }; peaks: { bridge: number; barrier: number; courierZ: number } };
    w.peaks = { bridge: -Infinity, barrier: -Infinity, courierZ: -Infinity };
    const sample = () => {
      const s = w.castleView.state();
      w.peaks.bridge = Math.max(w.peaks.bridge, s.bridgeAngle);
      w.peaks.barrier = Math.max(w.peaks.barrier, s.barrierAngle);
      if (s.courier) w.peaks.courierZ = Math.max(w.peaks.courierZ, s.courier.z);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const peak = (key: 'bridge' | 'barrier' | 'courierZ') =>
    page.evaluate((k) => (window as unknown as { peaks: Record<string, number> }).peaks[k], key);

  // the bridge starts raised (−90°) and lowers as the courier sets out
  await expect.poll(() => peak('bridge'), { timeout: 30_000 }).toBeGreaterThan(-0.2);
  // the barrier lifts once the toll is paid (the courier first crosses the courtyard from its hall)
  await expect.poll(() => peak('barrier'), { timeout: 60_000 }).toBeGreaterThan(1.2);
  // the courier gets into the town
  await expect.poll(() => peak('courierZ'), { timeout: 30_000 }).toBeGreaterThan(5);

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
  await showTown(page);
  const name = await tapBuilding(page, 1);
  await expect(page.locator('.sheet .sheet-title')).toHaveText(name);
});

test('a building’s sheet says what the guild keeps there; a courier’s sheet is its transaction, with an explorer link', async ({ page }) => {
  await page.goto('/');
  await showTown(page);
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

test('the replay plays the chosen range one courier after another; it pauses, jumps, changes range and closes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await page.locator('.replay-open').click();
  const bar = page.locator('.timeline');
  await expect(bar).toBeVisible();
  await expect(page.locator('.castle-view')).toHaveAttribute('data-replay', 'playing');
  // the last 100 transactions by default, counted as they go
  await expect(bar.getByLabel('What to replay')).toHaveValue('count:100');
  await expect(bar.locator('.timeline-when')).toContainText(/^1 of \d+/);
  await bar.getByLabel('Replay speed').selectOption('4');
  await expect.poll(async () => (await sceneState(page)).couriers, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => bar.locator('.timeline-when').textContent()).not.toMatch(/^1 of/);

  await bar.getByLabel('Pause').click();
  await expect(page.locator('.castle-view')).toHaveAttribute('data-replay', 'paused');
  await bar.getByLabel('Replay position').fill('20');
  await expect(bar.locator('.timeline-when')).toContainText(/^20 of/);

  // a smaller range starts over, and is remembered
  await bar.getByLabel('What to replay').selectOption('count:25');
  await expect(bar.locator('.timeline-when')).toContainText(/ of 25/);

  await bar.locator('.timeline-close').click();
  await expect(bar).toBeHidden();
  await expect(page.locator('.replay-open')).toBeVisible();
  await page.reload();
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await page.locator('.replay-open').click();
  await expect(page.locator('.timeline').getByLabel('What to replay')).toHaveValue('count:25');
});

test('build mode: a building moves from its sheet; the places it can go are marked; a swap is kept across a reload; Reset brings the automatic layout back', async ({ page }) => {
  test.setTimeout(120_000);
  type Hook = { castleView: { slots(): Record<string, number>; buildingIds(): string[] } };
  await page.goto('/');
  await showTown(page);
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
  await showTown(page);
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

test('a block’s light ripples out from the tower along the paths, not all at once', async ({ page }) => {
  test.setTimeout(60_000);
  type V = { castleView: { ringBell(): void; litDistances(): number[] } };
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  // every frame for a while after the bell: how far from the tower the lit tiles are
  const samples = await page.evaluate(
    () =>
      new Promise<number[][]>((done) => {
        const v = (window as unknown as V).castleView;
        v.ringBell();
        const t0 = performance.now();
        const out: number[][] = [];
        const step = () => {
          out.push(v.litDistances());
          if (performance.now() - t0 < 2500) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
  );
  const lit = samples.filter((d) => d.length);
  expect(lit.length).toBeGreaterThan(2);
  // the first light is by the tower; later the nearest lit tile is beyond where the first ones were
  const first = Math.max(...lit[0]!);
  expect(Math.min(...lit[0]!)).toBeLessThan(8);
  expect(lit.some((d) => Math.min(...d) > first)).toBe(true);
});

test('tapping a courier follows it from where it is, and the timeline is left alone', async ({ page }) => {
  test.setTimeout(60_000);
  type V = { castleView: { following: boolean } };
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  // out of the gatehouse first (inside it the courier can't be seen to be tapped)
  await expect.poll(async () => (await sceneState(page)).courier?.z ?? -99, { timeout: 30_000 }).toBeGreaterThan(3);
  await tapCourier(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as V).castleView.following)).toBe(true);
  await expect(page.locator('.follow-chip')).toBeVisible();
  // no replay was started
  await expect(page.locator('.timeline')).toBeHidden();
  await page.locator('.follow-chip').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as V).castleView.following)).toBe(false);
});
