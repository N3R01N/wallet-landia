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
  // off the device and back: its code, the loadout deleted, the code pasted
  await panel.locator('.siege-share').first().click();
  const code = await panel.locator('.siege-code-out').inputValue();
  expect(code.startsWith('SIEGE1:')).toBe(true);
  await panel.locator('.siege-loadouts li', { hasText: 'All in on ETH' }).getByRole('button', { name: /Delete/ }).click();
  await expect(panel.locator('.siege-loadouts li', { hasText: 'All in on ETH' })).toHaveCount(0);
  await panel.locator('.siege-code-in').fill(code);
  await panel.getByRole('button', { name: 'Import' }).click();
  await expect(panel.locator('.siege-message')).toContainText('Imported');
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
  // the match runs in a worker and a replica on the page: they must never disagree
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('desync')) errors.push(m.text());
  });
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
  // the battle pauses and plays on
  await panel.locator('.siege-battle-pause').click();
  await expect(panel.locator('.siege-battle-pause')).toHaveText('▶ Play');
  await panel.locator('.siege-battle-pause').click();
  await expect(panel.locator('.siege-battle-pause')).toHaveText('⏸ Pause');
  // the camera follows a lane, then goes free again
  await panel.locator('.siege-follow').selectOption('1');
  await page.waitForTimeout(500);
  await panel.locator('.siege-follow').selectOption('free');
  await panel.locator('.siege-skip').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'siege', { timeout: 30_000 });
  await expect(panel.locator('.siege-note')).toContainText('Siege:');
  await expect(panel.locator('.siege-replay')).toBeVisible();
  // the next round opens on trading again (or the match is over)
  await panel.locator('.siege-next').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', /trade|ended|siege/);
  expect(errors).toEqual([]);
});

test('the trade phase: the timer pauses, a swap goes out with its courier, the rumor and the ticker show, the market week plays', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=siege');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
  const panel = page.locator('.siege-panel');
  await panel.locator('.siege-start').click();
  const timer = panel.locator('.siege-timer');
  await expect(timer).toHaveText(/\d+ s/);
  await panel.locator('.siege-pause').click();
  await expect(timer).toHaveText('⏸');
  await expect(panel.locator('.siege-rumor')).toContainText('Rumor');
  await expect(panel.locator('.siege-tick')).not.toHaveCount(0);
  // a swap: the preview, then the courier
  await panel.locator('.siege-action').selectOption('swap');
  await panel.locator('.siege-quick', { hasText: '25%' }).click();
  await expect(panel.locator('.siege-preview-line')).toContainText('gas');
  await expect(panel.locator('.siege-preview-line')).toContainText('fee and slippage');
  await panel.locator('.siege-send').click();
  await expect(panel.locator('.siege-message')).toContainText('courier sets out');
  await expect.poll(() => page.evaluate(() => (window as unknown as { castleView: { state(): { couriers: number } } }).castleView.state().couriers), { timeout: 20_000 }).toBeGreaterThan(0);
  // the portfolio folds open
  await panel.locator('.siege-portfolio-toggle').click();
  await expect(panel.locator('.siege-portfolio tr')).not.toHaveCount(0);
  // through the battle to the next round's market week, then trading again
  await panel.locator('.siege-go').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'battle', { timeout: 30_000 });
  await panel.locator('.siege-skip').click();
  await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'siege', { timeout: 30_000 });
  const winner = await panel.locator('.siege-winner').count();
  if (winner === 0) {
    await panel.locator('.siege-next').click();
    await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'market');
    await expect(panel.locator('.siege-candles').first()).toBeAttached();
    await panel.locator('.siege-skip').click();
    await expect(panel.locator('.siege-match')).toHaveAttribute('data-phase', 'trade');
  }
  expect(errors).toEqual([]);
});

test('a whole match ends in the recap: charts of the portfolios and keeps, the MVP, the table', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=siege');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
  const panel = page.locator('.siege-panel');
  const match = panel.locator('.siege-match');
  await panel.locator('.siege-start').click();
  for (let i = 0; i < 60; i++) {
    const phase = await match.getAttribute('data-phase');
    if (phase === 'ended') break;
    const next = { trade: '.siege-go', battle: '.siege-skip', siege: '.siege-next', market: '.siege-skip' }[phase ?? ''];
    const button = next ? panel.locator(next) : null;
    // short waits: the phase may move on between reading it and clicking (its button then never comes back)
    if (button && (await button.isEnabled({ timeout: 1000 }).catch(() => false))) await button.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await expect(match).toHaveAttribute('data-phase', 'ended', { timeout: 60_000 });
  const recap = panel.locator('.siege-recap');
  await expect(recap.locator('.siege-recap-head')).toHaveText(/Victory|Defeat|A draw/);
  await expect(recap.locator('.siege-chart')).toHaveCount(2);
  await expect(recap.locator('.siege-tile')).toHaveCount(4);
  await expect(recap.locator('.siege-mvp')).toContainText('MVP');
  await recap.locator('.siege-recap-table summary').click();
  await expect(recap.locator('.siege-recap-table tbody tr').first()).toBeVisible();

  // the replay: as a file, and played again
  const [download] = await Promise.all([page.waitForEvent('download'), panel.locator('.siege-download').click()]);
  const file = await download.path();
  await panel.locator('.siege-watch').click();
  await expect(panel.locator('.siege-replay-panel')).toHaveAttribute('data-phase', 'replay', { timeout: 30_000 });
  await expect(panel.locator('.siege-round')).toContainText('Replay · round');
  for (let i = 0; i < 12 && (await panel.locator('.siege-replay-panel').getAttribute('data-phase')) !== 'ended'; i++) {
    await panel.locator('.siege-replay-next').click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await expect(panel.locator('.siege-replay-panel')).toHaveAttribute('data-phase', 'ended', { timeout: 30_000 });
  await panel.locator('.siege-leave').click();
  // the downloaded file, loaded in the setup
  await panel.locator('.siege-replay-file').setInputFiles(file!);
  await expect(panel.locator('.siege-replay-panel')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
