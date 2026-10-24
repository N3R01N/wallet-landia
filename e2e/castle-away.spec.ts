import { expect, test, type Page } from './fixtures.js';
import { sceneUp } from './castleHelpers.js';

/**
 * While you were away, and the castle that grows (docs/ENGAGEMENT.md A4, A7):
 * a last visit set back in time shows the herald's card with the couriers
 * since, Watch replays just those; a lower stored tier plays the growth
 * moment; a fresh visit shows neither.
 */

const VISITS = 'zenigard/castle/visits';
const TIER_NAMES = ['Dust', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

type Visit = { at: number; latest: { time: number; key: string } | null; tiers: { keep: number; wallets: Record<string, number> } };

async function visits(page: Page): Promise<Record<string, Visit>> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, Visit>, VISITS);
}

test('a visit two days ago: the card counts the couriers since, Watch replays them; the keep that grew has its moment; then a fresh visit shows none', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await sceneUp(page);
  // the first visit: nothing to tell, and the visit remembered
  await expect(page.locator('.away-card')).toHaveCount(0);
  const stored = await visits(page);
  const scopes = Object.keys(stored);
  expect(scopes).toHaveLength(1);

  // set it two days back, before the newest few transactions, and the keep a tier lower
  const world = await page.evaluate(() => {
    const w = (window as unknown as { castleWorld: { tier: number; errands: { time: number }[] } }).castleWorld;
    return { tier: w.tier, times: w.errands.map((e) => e.time) };
  });
  const times = [...new Set(world.times)].sort((a, b) => b - a);
  expect(times.length).toBeGreaterThan(4);
  const cutoff = times[3]!;
  const count = world.times.filter((t) => t > cutoff).length;
  expect(world.tier).toBeGreaterThan(0);
  const back: Visit = { ...stored[scopes[0]!]!, at: Date.now() - 2 * 86_400_000 - 60_000, latest: { time: cutoff, key: 'then' } };
  back.tiers = { ...back.tiers, keep: world.tier - 1 };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [VISITS, JSON.stringify({ [scopes[0]!]: back })] as const);

  await page.reload();
  await sceneUp(page);
  const card = page.locator('.away-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-count', String(count));
  await expect(card.locator('h3')).toHaveText('While you were away (2 days)');
  await expect(card).toContainText(`${count} courier${count === 1 ? '' : 's'}:`);
  // the keep grew: its moment (a theme without the scaffolding plays the sparkles), and the toast
  await expect(page.locator('.castle-view')).toHaveAttribute('data-growth', /keep:(full|plain)/);
  await expect(page.locator('.growth-toast')).toHaveText(`✨ Your keep is now ${TIER_NAMES[world.tier]}`);

  // Watch: the replay of just those couriers
  await card.locator('.away-watch').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.castle-view')).toHaveAttribute('data-replay', 'playing');
  await expect(page.locator('.timeline-when')).toContainText(` of ${count}`);

  // remembered as seen now: back again, nothing to tell and nothing grew
  await page.reload();
  await sceneUp(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.away-card')).toHaveCount(0);
  await expect(page.locator('.growth-toast')).toHaveCount(0);
  expect((await visits(page))[scopes[0]!]!.tiers.keep).toBe(world.tier);
});

test('Later closes the card; a visit under an hour ago tells nothing', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await sceneUp(page);
  const stored = await visits(page);
  const scope = Object.keys(stored)[0]!;
  // half an hour ago, before every transaction: too soon to tell
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify({ [s]: { at: Date.now() - 30 * 60_000, latest: null, tiers: { keep: 0, wallets: {} } } })), [VISITS, scope] as const);
  // (as the keep is stored at Dust, it grows: the toast shows, but no card)
  await page.reload();
  await sceneUp(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.away-card')).toHaveCount(0);

  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify({ [s]: { at: 0, latest: null, tiers: { keep: 9, wallets: {} } } })), [VISITS, scope] as const);
  await page.reload();
  await sceneUp(page);
  const card = page.locator('.away-card');
  await expect(card).toBeVisible();
  await card.locator('.away-later').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.castle-view')).not.toHaveAttribute('data-replay', 'playing');
});
