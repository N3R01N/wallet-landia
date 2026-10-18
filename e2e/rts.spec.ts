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
  await page.goto('/rts.html?seed=e2e');
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
  await page.goto('/rts.html?seed=e2e');
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

