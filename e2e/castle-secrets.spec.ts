import { expect, test, type Page } from './fixtures.js';
import { sceneUp } from './castleHelpers.js';

/** The town's secrets and rare moments (docs/ENGAGEMENT.md, track C): the wishing well, the golden courier. */

interface View {
  castleView: {
    plan: { decor: { name: string; x: number; z: number }[] };
    focusAt(x: number, z: number, zoom?: number): void;
    pagePoint(x: number, y: number, z: number): { x: number; y: number } | null;
  };
  townSecrets: {
    test(): { biggest: string | null; looks: { look: string; colors: string[] }[] };
    sendBiggest(): boolean;
  };
}

/** The well's place on the page, once the camera has eased there. */
async function wellPoint(page: Page): Promise<{ x: number; y: number }> {
  const well = await page.evaluate(() => (window as unknown as View).castleView.plan.decor.find((d) => d.name === 'prop.well') ?? null);
  expect(well).not.toBeNull();
  await page.evaluate(({ x, z }) => (window as unknown as View).castleView.focusAt(x, z, 2.5), well!);
  const at = () => page.evaluate(({ x, z }) => (window as unknown as View).castleView.pagePoint(x, 0.9, z), well!);
  let last = await at();
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(300);
    const now = await at();
    if (now && last && Math.hypot(now.x - last.x, now.y - last.y) < 1) break;
    last = now;
  }
  const pt = await at();
  expect(pt).not.toBeNull();
  return pt!;
}

test('three quick taps on the well drop a coin in for a wish, and find a secret', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await sceneUp(page);
  const pt = await wellPoint(page);
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.speech-bubble').filter({ hasText: /wish/ })).toBeVisible();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('wallet-landia-v4/secrets/v1') ?? '{}') as Record<string, number>);
  expect(Object.keys(kept)).toContain('wishing-well');
  await expect(page.locator('.topbar .status')).toContainText('Secret found: The wishing well');
  // the Badges tab lists it
  await page.locator('.tab', { hasText: 'Badges' }).click();
  const secrets = page.locator('.badges-tab .secrets');
  await expect(secrets.locator('h2')).toContainText(/Secrets found · \d+ of 5/, { timeout: 30_000 });
  await expect(secrets.locator('[data-secret="wishing-well"]')).toContainText('The wishing well');
  expect(errors).toEqual([]);
});

test('the courier of the guild’s biggest transaction walks in gold', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await sceneUp(page);
  expect(await page.evaluate(() => (window as unknown as View).townSecrets.test().biggest)).not.toBeNull();
  expect(await page.evaluate(() => (window as unknown as View).townSecrets.sendBiggest())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as View).townSecrets.test().looks.find((l) => l.look === 'gold') ?? null)).not.toBeNull();
  const gold = await page.evaluate(() => (window as unknown as View).townSecrets.test().looks.find((l) => l.look === 'gold')!);
  expect(gold.colors.length).toBeGreaterThan(0);
  for (const c of gold.colors) expect(c).toBe('#f2c14e');
});
