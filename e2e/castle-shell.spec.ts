import { expect, test } from '@playwright/test';
import { tapBuilding } from './castleHelpers.js';

/** The castle shell: a phone gets bottom tabs and a drawer sheet, a desktop a side rail and a docked sheet. */

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('bottom tabs, no horizontal scroll, the sheet rises and closes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    const shell = page.locator('.shell');
    await expect(shell).toHaveAttribute('data-layout', 'phone');

    const tabs = await page.locator('.tabs').boundingBox();
    expect(tabs && tabs.y + tabs.height).toBeGreaterThan(780); // at the bottom of a 844px screen
    expect(tabs?.width).toBeGreaterThan(380); // full width

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.locator('.tab', { hasText: 'Town' }).click();
    await expect(page.locator('.tab', { hasText: 'Town' })).toHaveAttribute('aria-current', 'page');
    const name = await tapBuilding(page);
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.sheet-title')).toHaveText(name);
    await expect(sheet).toContainText('What your guild keeps here');
    // the sheet rises for 180 ms: wait for it to settle, then check it sits on the tabs
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box ? Math.round(box.y + box.height) : -1;
      })
      .toBe(Math.round(tabs?.y ?? 0));
    const box = await sheet.boundingBox();
    expect(box && box.y).toBeGreaterThan(100); // not full screen

    await sheet.locator('.sheet-close').click();
    await expect(sheet).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('switching tabs closes the sheet', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab', { hasText: 'Town' }).click();
    await tapBuilding(page);
    await expect(page.locator('.sheet')).toBeVisible();
    await page.locator('.tab', { hasText: 'Guild' }).click();
    await expect(page.locator('.sheet')).toBeHidden();
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('side rail, and the sheet docks beside the stage without covering it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.shell')).toHaveAttribute('data-layout', 'desktop');

    const tabs = await page.locator('.tabs').boundingBox();
    expect(tabs?.x).toBeLessThan(10); // on the left
    expect(tabs?.width).toBeLessThan(200);

    await page.locator('.tab', { hasText: 'Town' }).click();
    const stageBefore = await page.locator('.stage').boundingBox();
    await tapBuilding(page);
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox?.x).toBeGreaterThan(900); // on the right
    const stageAfter = await page.locator('.stage').boundingBox();
    expect(stageAfter && stageBefore && stageAfter.width).toBeLessThan(stageBefore?.width ?? 0);
    expect(stageAfter && sheetBox && stageAfter.x + stageAfter.width).toBeLessThanOrEqual(sheetBox?.x ?? 0);
    // no backdrop on a desktop
    await expect(page.locator('.scrim')).toBeHidden();
  });
});

test('the castle page can be installed: its manifest names the theme’s app icons, and they exist', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = (await (await request.get(href!)).json()) as { icons: { src: string; purpose: string }[]; start_url: string };
  expect(manifest.start_url).toBe('/');
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});
