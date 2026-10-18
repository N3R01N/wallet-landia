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
