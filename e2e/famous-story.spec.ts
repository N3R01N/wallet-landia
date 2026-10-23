import { expect, test } from './fixtures.js';
import { sceneUp } from './castleHelpers.js';

/** A famous castle's story: the Poly Network exploiter, beat by beat, with his messages on the board. */

test.use({ viewport: { width: 390, height: 844 } });

type Hook = { castleView: { story(): Promise<{ state(): { pinned: number; board: boolean; hit: string[]; ice: boolean } } | null> } };
const storyState = (page: import('@playwright/test').Page) => page.evaluate(async () => (await (window as unknown as Hook).castleView.story())?.state() ?? null);

test('the story plays beat by beat: the vault empties, the bridge is hit, his messages are pinned', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#famous=poly-exploiter');
  await sceneUp(page);

  await expect(page.locator('.story-board')).toContainText('Messages (');
  await page.locator('.story-open').click();
  const card = page.locator('.story-card');
  await expect(card).toContainText('The first coins');
  await expect(card).toContainText('1 of 12');

  // ▶ plays the couriers on to the next beat, and stops there
  await card.locator('.story-next').click();
  await expect(page.locator('.story-card[data-beat="1"]')).toContainText('The trick', { timeout: 60_000 });
  await page.locator('.story-card .story-next').click();
  const vault = page.locator('.story-card[data-beat="2"]');
  await expect(vault).toContainText('The vault empties', { timeout: 60_000 });
  await expect(vault.locator('.story-haul')).toContainText('Taken so far');
  expect((await storyState(page))?.hit).toEqual(['story:poly-network']);

  // while the couriers walk: where to and how many, and a skip straight there
  await page.locator('.story-card .story-next').click();
  await expect(page.locator('.story-playing')).toContainText('A tip of 13.37 ETH');
  await page.locator('.story-playing .story-skip').click();
  await expect(page.locator('.story-card[data-beat="3"]')).toBeVisible();
  await expect(page.locator('.story-playing')).toHaveCount(0);
  await page.locator('.story-card .story-back').click();
  await expect(vault).toBeVisible();

  // jumping back: the town as it was then (the bridge whole again)
  await vault.locator('.story-back').click();
  await expect(page.locator('.story-card[data-beat="1"]')).toBeVisible();
  expect((await storyState(page))?.hit).toEqual([]);

  // the notice board lists his messages (addresses shortened) and the crowd's
  await page.locator('.story-card .story-close').click();
  await page.locator('.story-board').click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('READY TO RETURN THE FUND!');
  await expect(sheet).toContainText('From the crowd');
  await expect(sheet).toContainText('0x71Fb…142f');
  expect(errors).toEqual([]);
});
