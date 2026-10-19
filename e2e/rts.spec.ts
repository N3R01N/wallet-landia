import { expect, test } from '@playwright/test';

/** Ledger Wars (rts.html): the start, the map, building from the hall and placing it, an upgrade. */

type Hook = { rts: { world: { step(): void; has(p: string, k: string): boolean; players: { A: { ready: string | null } }; hallOf(p: string): { id: number; level: number } }; send(c: unknown): { ok: boolean } } };
const fastForward = (page: import('@playwright/test').Page, seconds: number) =>
  page.evaluate((s) => {
    const w = (window as unknown as Hook).rts.world;
    for (let i = 0; i < s * 20; i++) w.step();
  }, seconds);

test('a match starts from a kit; the hall builds an exchange that is placed beside it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.rts-top')).toContainText('USDC');
  await page.locator('.rts-build-item[data-kind="exchange"]').click();
  await expect(page.locator('.rts-build .rts-progress-row')).toContainText('Exchange');
  await fastForward(page, 21);
  await page.locator('.rts-place').click();
  // the ghost follows the mouse; a click beside the hall places it
  const box = (await page.locator('.rts-canvas').boundingBox())!;
  const spot = await page.evaluate(() => {
    const v = (window as unknown as { rts: { view: { toScreen(x: number, y: number, z: number): { x: number; y: number } | null } } }).rts.view;
    return v.toScreen(9.5, 0, 57.5);
  });
  expect(spot).not.toBeNull();
  await page.mouse.move(spot!.x, spot!.y);
  await page.mouse.move(spot!.x + 1, spot!.y);
  await page.mouse.click(spot!.x, spot!.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).rts.world.has('A', 'exchange'))).toBe(true);
  expect(box.width).toBeGreaterThan(100);
  // the hall, selected, goes up a level
  const hall = await page.evaluate(() => {
    const v = (window as unknown as { rts: { view: { toScreen(x: number, y: number, z: number): { x: number; y: number } | null } } }).rts.view;
    return v.toScreen(0, 3, 62);
  });
  await page.mouse.click(hall!.x, hall!.y);
  await expect(page.locator('.rts-info h2')).toContainText('Wallet Hall');
  await page.locator('.rts-upgrade').click();
  await expect(page.locator('.rts-info')).toContainText('Upgrading');
  expect(errors).toEqual([]);
});

test('the economy: at the Exchange a swap, at the Staking House a stake that earns', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  // two buildings, built and placed through the hook (the placing itself is tested above)
  const place = (kind: string, x: number, z: number) =>
    page.evaluate(
      ([k, px, pz]) => {
        const r = (window as unknown as { rts: { world: { step(): void }; send(c: unknown): { ok: boolean; reason?: string } } }).rts;
        if (!r.send({ t: 'build', kind: k }).ok) throw new Error('build');
        for (let i = 0; i < 40 * 20; i++) r.world.step();
        const p = r.send({ t: 'place', x: px, z: pz });
        if (!p.ok) throw new Error(p.reason);
      },
      [kind, x, z] as const,
    );
  await place('exchange', 9.5, 57.5);
  await place('staking', -9.5, 57.5);
  type View = { rts: { view: { toScreen(x: number, y: number, z: number): { x: number; y: number } | null; buildingAt(x: number, y: number): number | null } } };
  const select = async (x: number, z: number) => {
    const at = await page.evaluate(([px, pz]) => (window as unknown as View).rts.view.toScreen(px, 1.5, pz), [x, z] as const);
    // its model is in the scene (they load as they are placed)
    await expect.poll(() => page.evaluate(([cx, cy]) => (window as unknown as View).rts.view.buildingAt(cx, cy), [at!.x, at!.y] as const)).not.toBeNull();
    await page.mouse.click(at!.x, at!.y);
  };
  await select(9.5, 57.5);
  await expect(page.locator('.rts-info h2')).toContainText('Exchange');
  await page.locator('.rts-select[aria-label="To"]').selectOption('eth');
  await page.locator('.rts-swap[data-share="0.5"]').click();
  await expect(page.locator('.rts-top')).toContainText('ETH');
  await select(-9.5, 57.5);
  await expect(page.locator('.rts-info h2')).toContainText('Staking House');
  await page.locator('.rts-stake[data-share="1"]').click();
  await expect(page.locator('.rts-info .rts-pos')).toContainText('Staked stETH');
  await expect(page.locator('.rts-income')).not.toContainText('+$0/');
  expect(errors).toEqual([]);
});

test('units: trained at the hall, box-selected, sent across the map with a right click', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  type R = { rts: { world: { step(): void; units: { id: number; x: number; z: number; owner: string; order: { t: string } }[] }; selection: Set<number>; view: { toScreen(x: number, y: number, z: number): { x: number; y: number } | null; buildingAt(x: number, y: number): number | null } } };
  const screen = (x: number, y: number, z: number) => page.evaluate(([a, b, c]) => (window as unknown as R).rts.view.toScreen(a, b, c), [x, y, z] as const);
  // the hall, selected: its Train buttons
  const hall = (await screen(0, 3, 62))!;
  await expect.poll(() => page.evaluate(([x, y]) => (window as unknown as R).rts.view.buildingAt(x, y), [hall.x, hall.y] as const)).not.toBeNull();
  await page.mouse.click(hall.x, hall.y);
  const train = page.locator('.rts-train[data-unit="militia"]');
  for (let i = 0; i < 3; i++) await train.click();
  await expect(page.locator('.rts-queue')).toContainText('Militia');
  await page.evaluate(() => {
    const w = (window as unknown as R).rts.world;
    for (let i = 0; i < 20 * 20; i++) w.step();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as R).rts.world.units.length)).toBe(3);
  // a box round them
  const pts = await page.evaluate(() => (window as unknown as R).rts.world.units.map((u) => (window as unknown as R).rts.view.toScreen(u.x, 0.8, u.z)!));
  const x0 = Math.min(...pts.map((p) => p.x)) - 30;
  const y0 = Math.min(...pts.map((p) => p.y)) - 30;
  const x1 = Math.max(...pts.map((p) => p.x)) + 30;
  const y1 = Math.max(...pts.map((p) => p.y)) + 30;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.rts-info h2')).toContainText('3 units');
  // right click the ground ahead: they go
  const goal = (await screen(0, 0, 40))!;
  await page.mouse.click(goal.x, goal.y, { button: 'right' });
  await page.evaluate(() => {
    const w = (window as unknown as R).rts.world;
    for (let i = 0; i < 15 * 20; i++) w.step();
  });
  const units = await page.evaluate(() => (window as unknown as R).rts.world.units.map((u) => ({ z: u.z, order: u.order.t })));
  for (const u of units) {
    expect(u.order).toBe('idle');
    expect(Math.abs(u.z - 40)).toBeLessThan(5);
  }
  expect(errors).toEqual([]);
});

test('combat: an attack order, effects as they fight, and victory when the enemy hall falls', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  type R = { rts: { world: { step(): void; winner: string | null; units: { id: number; owner: string; died: number }[]; hallOf(p: string): { id: number; x: number; z: number } }; send(c: unknown): { ok: boolean }; spawn(o: string, t: string, x: number, z: number): void } };
  // your titans and knights at the enemy's door; a few defenders
  await page.evaluate(() => {
    const r = (window as unknown as R).rts;
    const hall = r.world.hallOf('B');
    for (let i = 0; i < 4; i++) r.spawn('A', 'titan.bitcoin', hall.x - 4 + i * 2.5, hall.z + 12);
    for (let i = 0; i < 6; i++) r.spawn('A', 'knight', hall.x - 4 + i * 1.5, hall.z + 14);
    for (let i = 0; i < 3; i++) r.spawn('B', 'militia', hall.x + i * 1.2, hall.z + 7);
    const mine = r.world.units.filter((u) => u.owner === 'A').map((u) => u.id);
    r.send({ t: 'order', units: mine, kind: 'attack', target: hall.id });
    for (let i = 0; i < 4 * 20; i++) r.world.step();
  });
  // the defenders fight back; the fight goes on
  await page.evaluate(() => {
    const w = (window as unknown as R).rts.world;
    for (let i = 0; i < 200 * 20 && !w.winner; i++) w.step();
  });
  await expect(page.locator('.rts-over')).toContainText('Victory', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('the computer opponent builds and trains by the same rules (Easy, Normal or Hard on the start screen)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e');
  await page.locator('.rts-difficulty').selectOption('hard');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  type R = { rts: { world: { step(): void; has(p: string, k: string): boolean; units: { owner: string }[]; ai: Map<string, { difficulty: string }> } } };
  expect(await page.evaluate(() => (window as unknown as R).rts.world.ai.get('B')?.difficulty)).toBe('hard');
  await page.evaluate(() => {
    const w = (window as unknown as R).rts.world;
    for (let i = 0; i < 90 * 20; i++) w.step();
  });
  expect(await page.evaluate(() => (window as unknown as R).rts.world.has('B', 'exchange'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as R).rts.world.units.filter((u) => u.owner === 'B').length)).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('the help, the minimap and control groups', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  // the help: every building and what it trains
  await page.locator('.rts-help-btn').click();
  const help = page.locator('dialog.rts-help');
  await expect(help).toBeVisible();
  await help.locator('.rts-help-tab[data-tab="buildings"]').click();
  await expect(help).toContainText('Bitcoin Titan (WBTC');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  // the minimap: a click looks there
  type R = { rts: { view: { cameraState: { x: number; z: number } }; selection: Set<number>; spawn(o: string, t: string, x: number, z: number): void; world: { units: { id: number }[] } } };
  const map = (await page.locator('.rts-minimap').boundingBox())!;
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
  const cam = await page.evaluate(() => (window as unknown as R).rts.view.cameraState);
  expect(Math.abs(cam.z)).toBeLessThan(6);
  // a group: Ctrl+1 keeps it, 1 brings it back
  await page.evaluate(() => {
    const r = (window as unknown as R).rts;
    for (let i = 0; i < 3; i++) r.spawn('A', 'knight', i * 1.5, 50);
    for (const u of r.world.units) r.selection.add(u.id);
  });
  await page.locator('.rts-canvas').focus();
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as R).rts.selection.size)).toBe(0);
  await page.keyboard.press('1');
  expect(await page.evaluate(() => (window as unknown as R).rts.selection.size)).toBe(3);
  expect(errors).toEqual([]);
});

test('the castle’s topbar opens Ledger Wars', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.topbar .rts-link');
  await expect(link).toHaveAttribute('href', /rts\.html$/);
});

test('the edge strips, shown with arrows, move the view while the pointer is on them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  type R = { rts: { view: { cameraState: { x: number; z: number } } } };
  const cam = () => page.evaluate(() => (window as unknown as R).rts.view.cameraState);
  const top = page.locator('.rts-edge-top');
  await expect(top).toBeVisible();
  await expect(top).toContainText('▲');
  const before = await cam();
  await top.hover();
  await expect.poll(async () => (await cam()).z).toBeLessThan(before.z - 2);
  // off the strip: it stops
  await page.mouse.move(600, 400);
  const stopped = (await cam()).z;
  await page.waitForTimeout(600);
  expect(Math.abs((await cam()).z - stopped)).toBeLessThan(0.5);
  // a corner goes both ways
  const left = (await cam()).x;
  await page.locator('.rts-edge-bottom-left').hover();
  await expect.poll(async () => (await cam()).x).toBeLessThan(left - 2);
});


test('the campaign: the mission list, a briefing, and mission 1’s first objectives played through the page', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/rts.html');
  await page.evaluate(() => localStorage.removeItem('wallet-landia.rts.campaign'));
  await page.reload();
  // the first mission is open, the second not yet
  await expect(page.locator('.rts-mission[data-mission="1"]')).toBeEnabled();
  await expect(page.locator('.rts-mission[data-mission="2"]')).toBeDisabled();
  await page.locator('.rts-mission[data-mission="1"]').click();
  await expect(page.locator('.rts-briefing h1')).toHaveText('First Steps');
  await expect(page.locator('.rts-card[data-unit="militia"]')).toContainText('USDC');
  await page.locator('.rts-go').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  const panel = page.locator('.rts-objectives');
  await expect(panel.locator('.current')).toContainText('Look around');
  // nothing to build in mission 1
  await expect(page.locator('.rts-build')).toContainText('Nothing to build yet');
  await expect(page.locator('.rts-build-item')).toHaveCount(0);
  // the view moves: done
  await page.locator('.rts-canvas').focus();
  await page.keyboard.down('ArrowUp');
  await expect(panel.locator('.current')).toContainText('Select your Wallet Hall', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  // back to the hall, and click it
  type R = { rts: { view: { focus(x: number, z: number): void; toScreen(x: number, y: number, z: number): { x: number; y: number } | null; buildingAt(x: number, y: number): number | null }; run: { index: number } } };
  await page.evaluate(() => (window as unknown as R).rts.view.focus(0, 52));
  const hall = (await page.evaluate(() => (window as unknown as R).rts.view.toScreen(0, 3, 62)))!;
  await expect.poll(() => page.evaluate(([x, y]) => (window as unknown as R).rts.view.buildingAt(x, y), [hall.x, hall.y] as const)).not.toBeNull();
  await page.mouse.click(hall.x, hall.y);
  await expect(panel.locator('.current')).toContainText('Train 3 Militia');
  // the button it means glows; only Militia is offered
  await expect(page.locator('.rts-train[data-unit="militia"]')).toHaveClass(/rts-glow/);
  await expect(page.locator('.rts-train')).toHaveCount(1);
  // the help shows only what the mission has opened
  await page.locator('.rts-help-btn').click();
  await page.locator('.rts-help-tab[data-tab="units"]').click();
  await expect(page.locator('.rts-help-units tbody tr')).toHaveCount(1);
  await expect(page.locator('dialog.rts-help')).toContainText('later missions');
  expect(errors).toEqual([]);
});

test('sound: on by default, heard as units fight, and switched off from the corner', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/rts.html?seed=e2e&ai=0');
  await page.evaluate(() => localStorage.removeItem('wallet-landia.rts.sound'));
  await page.reload();
  await page.locator('.rts-kit[data-kit="usdc"]').click();
  await expect(page.locator('.rts[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  const btn = page.locator('.rts-sound-btn');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  type R = { rts: { world: { step(): void }; sounds: { played: Record<string, number> }; spawn(o: string, t: string, x: number, z: number): void; view: { focus(x: number, z: number): void } } };
  // a click on the map lets the browser start audio; then a fight in view
  await page.mouse.click(700, 400);
  await page.evaluate(() => {
    const r = (window as unknown as R).rts;
    r.view.focus(0, 30);
    for (let i = 0; i < 3; i++) r.spawn('A', 'knight', i, 30);
    for (let i = 0; i < 3; i++) r.spawn('B', 'archer.scout', i, 26);
  });
  await expect.poll(() => page.evaluate(() => { const p = (window as unknown as R).rts.sounds.played; return (p.blade ?? 0) + (p.arrow ?? 0); }), { timeout: 20_000 }).toBeGreaterThan(0);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('wallet-landia.rts.sound'))).toBe('off');
});
