import { expect, test } from '@playwright/test';

/** The look sandbox renders, and its controls change the real scene without errors. */
test('the look sandbox renders and its controls work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/sandbox.html?quality=low&cam=overview&hour=12');
  await expect(page.locator('.panel h1')).toHaveText('Look sandbox');
  await expect(page.locator('.perf')).toContainText('draw calls', { timeout: 30_000 });

  const state = (): Promise<{ anim: string; chars: number; sky: string | null; view: string }> =>
    page.evaluate(() => {
      const s = (window as unknown as { sandbox: { anim: string; view: string; env: { current: string | null }; scene: { traverse(f: (o: { isSprite?: boolean }) => void): void } } }).sandbox;
      let chars = 0;
      s.scene.traverse((o) => {
        if (o.isSprite) chars++;
      });
      return { anim: s.anim, chars, sky: s.env.current, view: s.view };
    });

  await page.locator('select[aria-label="Animation"]').selectOption('run');
  await page.locator('select[aria-label="View"]').selectOption('wireframe');
  await page.locator('select[aria-label="Sky"]').selectOption('sunset');
  await page.locator('select[aria-label="Hero tier"]').selectOption('6');
  await expect.poll(async () => (await state()).sky, { timeout: 30_000 }).toBe('sunset');
  const s = await state();
  expect(s.anim).toBe('run');
  expect(s.view).toBe('wireframe');
  expect(s.chars).toBeGreaterThanOrEqual(12); // 7 heroes + 5 villagers
  const shot = await page.locator('.world').screenshot({ timeout: 90_000 });
  expect(shot.length).toBeGreaterThan(30_000);
  expect(errors).toEqual([]);
});
