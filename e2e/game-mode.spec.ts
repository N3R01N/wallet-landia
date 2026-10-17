import { expect, test } from '@playwright/test';
import { showTown } from './castleHelpers.js';

/** Siege of the Ledger's switch in the topbar: the game over the castle view, and back to the town. */

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the siege switch turns the game on and off, with no horizontal scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await showTown(page);
    const toggle = page.locator('.topbar .siege-toggle');
    const panel = page.locator('.siege-panel');
    const chronicle = page.locator('.chronicle-btn');
    await expect(toggle).toHaveAttribute('aria-label', 'Siege of the Ledger');
    // every topbar button fits on the phone's screen
    for (const b of await page.locator('.topbar button:visible').all()) {
      const box = await b.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(390);
    }
    await expect(panel).toBeHidden();
    await expect(chronicle).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Siege of the Ledger');
    // the town's own buttons step aside
    await expect(chronicle).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toBeHidden();
    await expect(chronicle).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('?mode=siege starts in the game, from any tab', async ({ page }) => {
    await page.goto('/?mode=siege');
    await showTown(page);
    await expect(page.locator('.siege-panel')).toBeVisible();
    await page.locator('.tab', { hasText: 'Guild' }).click();
    await page.locator('.topbar .siege-toggle').click(); // off
    await page.locator('.topbar .siege-toggle').click(); // on again: back to the castle tab
    await expect(page.locator('.tab', { hasText: 'Castle' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.siege-panel')).toBeVisible();
  });
});
