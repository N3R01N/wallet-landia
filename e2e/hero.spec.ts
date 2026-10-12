import { expect, test, type Page } from '@playwright/test';

type View = { hover: { kind: string; address?: string } | null; following?: string | null };
const view = (page: Page): Promise<View> => page.evaluate(() => {
  const v = (window as unknown as { townView: View }).townView;
  return { hover: v.hover, following: v.following ?? null };
});

/** Sweep the town (in the page, through the view's own hit test: quick) for a spot over a hero; where it is. */
async function findHero(page: Page): Promise<{ x: number; y: number; address: string } | null> {
  const box = await page.locator('.stage-wrap').boundingBox();
  if (!box) return null;
  const hit = await page.evaluate(([w, h]) => {
    const v = (window as unknown as { townView: { hitTest(x: number, y: number): { kind: string; address?: string } | null } }).townView;
    for (let gy = 0.2; gy <= 0.85; gy += 0.0125)
      for (let gx = 0.2; gx <= 0.95; gx += 0.01) {
        const t = v.hitTest(w * gx, h * gy);
        if (t?.kind === 'hero' && t.address !== undefined) return { x: w * gx, y: h * gy, address: t.address };
      }
    return null;
  }, [box.width, box.height] as const);
  return hit === null ? null : { x: box.x + hit.x, y: box.y + hit.y, address: hit.address };
}

test('one picker for the three views', async ({ page }) => {
  await page.goto('/?freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const pick = page.locator('.view-select');
  await expect(pick).toHaveValue('top');
  await pick.selectOption('iso');
  await expect(pick).toHaveValue('iso');
  // the keys still switch, and the picker follows
  await page.locator('.world').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');
  await expect(pick).toHaveValue('top');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { view?: string });
  expect(kept.view).toBe('top');
});

test('the level medallion: the level in a ring, the rank and what is left to the next level', async ({ page }) => {
  await page.goto('/?freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const medal = page.locator('.player-medal');
  await expect(medal).toBeVisible();
  await expect(medal.locator('.medal-level')).toHaveText(/^\d+$/);
  await expect(medal.locator('.medal-next')).toContainText(/XP to level \d+/, { timeout: 30_000 });
  const ring = medal.locator('.medal-ring');
  const progress = Number(await ring.evaluate((e) => (e as HTMLElement).style.getPropertyValue('--progress')));
  expect(progress).toBeGreaterThanOrEqual(0);
  expect(progress).toBeLessThanOrEqual(1);
  // top left of the town, under the header
  const box = (await medal.boundingBox())!;
  const world = (await page.locator('.world').boundingBox())!;
  expect(box.x - world.x).toBeLessThan(40);
  expect(box.y - world.y).toBeLessThan(40);
  await medal.click();
  await expect(page.locator('.inspector .player-sheet')).toBeVisible();
});

test('a hero, clicked: their current quest, the camera following them, and their whole sheet a click away', async ({ page }) => {
  await page.goto('/?expose');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  // let the replay send someone out, then hold it still for the pointer
  await page.locator('.btn', { hasText: '8×' }).click();
  await expect(page.locator('.questlog-list .log-row').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.btn[title^="Play / pause"]').click();
  await expect(page.locator('.btn[title^="Play / pause"]')).toHaveText('▶');

  let hero: { x: number; y: number; address: string } | null = null;
  await expect(async () => {
    hero = await findHero(page);
    expect(hero).not.toBeNull();
  }).toPass({ timeout: 30_000 });
  const { x, y, address } = hero!;
  await page.mouse.click(x, y);

  const card = page.locator('.inspector .hero-quest');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-hero', address);
  await expect(card.locator('.hero-doing')).not.toBeEmpty();
  // their quest (on it, or the last one), or word that they have had none yet in this replay
  const said = (await card.textContent()) ?? '';
  expect(said).toMatch(/Current quest|Last quest|no quest in this window yet/);
  if (/Current quest|Last quest/.test(said)) await expect(card.locator('.quest-steps li').first()).toBeVisible();
  expect((await view(page)).following).toBe(address);

  // the whole sheet, and back
  await card.locator('.btn', { hasText: 'Hero overview' }).click();
  await expect(page.locator('.inspector h3', { hasText: 'Treasure' })).toBeVisible();
  expect((await view(page)).following).toBe(address);
  await page.locator('.inspector .btn', { hasText: 'Current quest' }).click();
  await expect(page.locator('.inspector .hero-quest')).toBeVisible();

  // closing the card lets the camera go
  await page.locator('.inspector .close').click();
  expect((await view(page)).following).toBeNull();
});
