import { expect, test, type Page } from './fixtures.js';
import { sceneUp } from './castleHelpers.js';

/**
 * Real events as town events (docs/ENGAGEMENT.md Track B), with forced
 * conditions: the market pinned (`?market=`), the node's block with a high
 * base fee, the day pinned (`?date=`). Batch 28's models may not be in the
 * theme yet: what is planned is checked, and what shows needs its model.
 */

interface Occasions {
  gas: string | null;
  tollWait: number;
  grumbles: number;
  crateAt: { x: number; z: number } | null;
  cratePoint: { x: number; y: number } | null;
  occasions: { festival: boolean; storm: boolean; snow: boolean; pumpkins: boolean; anniversary: number | null };
  planned: Record<string, number>;
  shown: Record<string, number>;
  snowfall: number;
  fireworks: number;
  crate: string | null;
  shut: number;
  toast: string | null;
}

const occasions = (page: Page): Promise<Occasions> => page.evaluate(() => (window as unknown as { castleView: { occasions(): Occasions } }).castleView.occasions());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('a big rise dresses the town for a festival; a crash shuts the stalls', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?market=boom&hour=21');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).occasions.festival).toBe(true);
  const boom = await occasions(page);
  expect(boom.occasions.storm).toBe(false);
  expect(boom.planned['prop.bunting']).toBeGreaterThan(0);
  expect(boom.planned['prop.lantern.festival']).toBe(boom.planned['prop.bunting']! * 2);
  expect(boom.shut).toBe(0);

  await page.goto('/?market=crash');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).occasions.storm).toBe(true);
  const crash = await occasions(page);
  expect(crash.occasions.festival).toBe(false);
  expect(crash.planned['prop.bunting'] ?? 0).toBe(0);
  // the stalls' awnings and wares are put away
  expect(crash.shut).toBeGreaterThan(0);
  expect(Number(await page.locator('.castle-view').getAttribute('data-rain'))).toBe(1);
  expect(errors).toEqual([]);
});

test('a high base fee jams the toll: couriers wait longer and the toll keeper grumbles', async ({ page }) => {
  const errors = watchErrors(page);
  let block = 25_000_000;
  // the node's latest block with a 40 gwei base fee (the fixture answers everything else)
  await page.route('https://ethereum-rpc.publicnode.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { id?: number; method?: string };
    if (Array.isArray(body) || body.method !== 'eth_getBlockByNumber') return route.fallback();
    const result = { number: `0x${(block++).toString(16)}`, gasUsed: '0x1c9c380', gasLimit: '0x1c9c380', baseFeePerGas: `0x${(40e9).toString(16)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: [] };
    await route.fulfill({ json: { jsonrpc: '2.0', id: body.id ?? 1, result } });
  });
  await page.goto('/');
  await sceneUp(page);
  await expect(page.locator('.castle-view')).toHaveAttribute('data-gas', 'jammed', { timeout: 30_000 });
  const jammed = await occasions(page);
  expect(jammed.gas).toBe('jammed');
  expect(jammed.tollWait).toBeGreaterThan(4);
  // a courier pays at the barrier: the toll keeper says what he thinks of the road
  await expect.poll(async () => (await occasions(page)).grumbles, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the fixture’s ordinary block keeps the toll as it is', async ({ page }) => {
  await page.goto('/');
  await sceneUp(page);
  await expect(page.locator('.castle-view')).toHaveAttribute('data-gas', 'busy', { timeout: 30_000 });
  expect((await occasions(page)).grumbles).toBe(0);
});

test('a pinned December day lays snow on the roofs; late October has pumpkins by the doors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?date=2026-12-24');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).occasions.snow).toBe(true);
  const december = await occasions(page);
  const buildings = await page.evaluate(() => (window as unknown as { castleView: { plan: { buildings: unknown[] } } }).castleView.plan.buildings.length);
  expect(december.planned['prop.snow']).toBeGreaterThan(buildings);
  expect(december.occasions.pumpkins).toBe(false);

  await page.goto('/?date=2026-10-25');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).occasions.pumpkins).toBe(true);
  const october = await occasions(page);
  expect(october.planned['prop.pumpkin']).toBe(buildings);
  expect(october.occasions.snow).toBe(false);
  expect(errors).toEqual([]);
});

test("the guild's day: a toast on the anniversary of its first transaction", async ({ page }) => {
  const errors = watchErrors(page);
  // the demo guild's first transaction (fixtures/demo: 28 July 2026, 09:14 UTC), a year on
  await page.goto('/?demo&date=2027-07-28');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).occasions.anniversary).toBe(1);
  await expect(page.locator('.occasion-toast')).toContainText('a year since its first transaction');
  await page.goto('/?demo&date=2027-07-29');
  await sceneUp(page);
  expect((await occasions(page)).occasions.anniversary).toBeNull();
  await expect(page.locator('.occasion-toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a fresh airdrop leaves a crate at the gate; tapped, it shows what came and stays opened', async ({ page }) => {
  const errors = watchErrors(page);
  // the demo guild's Optimism airdrop claim
  await page.goto('/?demo');
  await sceneUp(page);
  await expect.poll(async () => (await occasions(page)).crate, { timeout: 15_000 }).not.toBeNull();
  // a plain crate stands in until the theme has the airdrop's
  const before = await occasions(page);
  expect((before.shown['prop.crate.airdrop'] ?? 0) + (before.shown['prop.crate'] ?? 0)).toBe(1);
  // look at it, then tap it
  await page.evaluate((at) => (window as unknown as { castleView: { focusAt(x: number, z: number, zoom?: number): void } }).castleView.focusAt(at.x, at.z, 2), before.crateAt!);
  await page.waitForTimeout(2000);
  const pt = (await occasions(page)).cratePoint;
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await expect(page.locator('.speech-bubble', { hasText: /^(An airdrop|Freshly minted): / })).toBeVisible();
  expect((await occasions(page)).crate).toBeNull();
  // opened for good: not there on the next visit
  await page.reload();
  await sceneUp(page);
  await page.waitForTimeout(1000);
  expect((await occasions(page)).crate).toBeNull();
  expect(errors).toEqual([]);
});
