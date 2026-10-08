import { expect, test, type Page } from '@playwright/test';

/** Errors that are not ours: logo hosts without CORS, an offline RPC. */
const IGNORED = [/CORS policy/, /ERR_FAILED/, /net::ERR_/, /Failed to load resource/];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

/** Sweep the town until something answers a hover with a tooltip. */
async function findSomethingToHover(page: Page): Promise<{ x: number; y: number } | null> {
  const box = await page.locator('.world').boundingBox();
  if (!box) return null;
  for (let gy = 0.25; gy <= 0.8; gy += 0.05) {
    for (let gx = 0.3; gx <= 0.85; gx += 0.04) {
      const x = box.x + box.width * gx;
      const y = box.y + box.height * gy;
      await page.mouse.move(x, y);
      if (await page.locator('.tooltip').isVisible()) return { x, y };
    }
  }
  return null;
}

for (const [key, name] of [['t', 'top-down'], ['i', 'isometric'], ['3', '3D']] as const) {
  test(`${name} view renders, hovers and opens a panel`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('.topbar')).toBeVisible();
    await page.keyboard.press(key);
    await page.waitForTimeout(key === '3' ? 4000 : 1500);

    const spot = await findSomethingToHover(page);
    expect(spot, 'nothing in the town answered a hover').not.toBeNull();
    if (spot) {
      await page.mouse.click(spot.x, spot.y);
      await expect(page.locator('.inspector')).toBeVisible();
      await expect(page.locator('.inspector h2')).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });
}

test('the replay advances and the quest log fills', async ({ page }) => {
  await page.goto('/');
  await page.locator('.btn', { hasText: '8×' }).click();
  await expect(page.locator('.questlog-list .log-row').first()).toBeVisible({ timeout: 20_000 });
});
