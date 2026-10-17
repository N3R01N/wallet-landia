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

test('match setup: a template, a wallet import, a blank build within its budget, a loadout, then the match starts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=siege');
  await showTown(page);
  const panel = page.locator('.siege-panel');
  // the default: the Balanced template, with units against the opponent
  await expect(panel.locator('.siege-positions tr')).not.toHaveCount(0);
  await expect(panel.locator('.siege-preview')).toContainText('units');

  // a wallet the town has loaded
  const source = panel.locator('.siege-source');
  const wallet = await source.locator('optgroup[label="Import a wallet"] option').first().getAttribute('value');
  expect(wallet).toBeTruthy();
  await source.selectOption(wallet!);
  await expect(panel.locator('.siege-positions tr')).not.toHaveCount(0);
  await expect(panel.locator('.siege-limit')).toContainText('match cap');

  // a blank build: the budget holds
  await source.selectOption('blank');
  await expect(panel.locator('.siege-positions tr')).toHaveCount(0);
  await expect(panel.locator('.siege-start')).toBeDisabled();
  await panel.locator('.siege-add-asset').selectOption('eth');
  await panel.locator('.siege-add-dollars').fill('20000');
  await panel.locator('.siege-add').click();
  await expect(panel.locator('.siege-message')).toContainText('budget');
  await panel.locator('.siege-add-dollars').fill('8000');
  await panel.locator('.siege-add').click();
  await expect(panel.locator('.siege-positions tr')).toHaveCount(1);
  await expect(panel.locator('.siege-limit')).toContainText('Budget left: $2,000');

  // kept as a loadout
  await panel.locator('.siege-loadout-name').fill('All in on ETH');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.locator('.siege-loadouts li')).toContainText('All in on ETH');

  await panel.locator('.siege-start').click();
  await expect(panel.locator('.siege-match')).toContainText('Round 1');
  await panel.locator('.siege-leave').click();
  await expect(panel.locator('.siege-setup')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a battle in the town: the enemy castle stands past it, the armies fight on the streets, the siege hits the keeps', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=siege');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
  const panel = page.locator('.siege-panel');
  await panel.locator('.siege-start').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'trade');
  await panel.locator('.siege-go').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'battle', { timeout: 30_000 });
  // squad banners over the field, for both sides
  await expect(page.locator('.siege-banner-A').first()).toBeAttached();
  await expect(page.locator('.siege-banner-B').first()).toBeAttached();
  await panel.locator('.siege-skip').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'siege', { timeout: 30_000 });
  await expect(panel.locator('.siege-note')).toContainText('Siege:');
  await expect(panel.locator('.siege-replay')).toBeVisible();
  // the next round opens on trading again (or the match is over)
  await panel.locator('.siege-next').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', /trade|ended|siege/);
  expect(errors).toEqual([]);
});
