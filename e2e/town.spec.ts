import { expect, test, type Page } from '@playwright/test';

// a player's own town, as they build it: not the suggested town the other tests start from
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: [{ name: 'wallet-landia-v4/prefs/v1', value: JSON.stringify({ view: 'top', tourDone: true }) }] }] } });

type Plan = { buildings: { id: string; kind: string }[]; homes: Map<string, { kind: string }> };
const plan = (page: Page): Promise<{ ids: string[]; homeKinds: string[] }> =>
  page.evaluate(() => {
    const p = (window as unknown as { townSim: { plan: Plan } }).townSim.plan;
    return { ids: p.buildings.map((b) => b.id), homeKinds: [...p.homes.values()].map((h) => h.kind) };
  });

test('a town starts as the bare square: the tower, the guildhall and the gate; heroes live outside the gate', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const p = await plan(page);
  expect(p.ids).toEqual(['tower', 'guildhall', 'gate']);
  expect(p.homeKinds.length).toBeGreaterThan(0);
  expect(new Set(p.homeKinds)).toEqual(new Set(['gate']));
});

test('what is built stays built: a saved town is raised again after a reload', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  // build the first two things this history unlocks (the build menu comes later: straight into the saved town here)
  const ids = await page.evaluate(() => {
    const s = (window as unknown as { townSim: { guild: { heroes: { address: string }[]; protocols: Map<string, unknown> } } }).townSim;
    return [`home:${[...s.guild.heroes].map((h) => h.address).sort()[0]}`, `b:${[...s.guild.protocols.keys()].sort()[0]}`];
  });
  await page.evaluate((ids) => {
    const key = 'wallet-landia-v4/prefs/v1';
    const prefs = JSON.parse(localStorage.getItem(key) ?? '{}') as { towns?: Record<string, unknown> };
    prefs.towns = { ethereum: { v: 1, placed: [{ id: ids[0], x: 4, y: 24, rot: 0 }, { id: ids[1], x: 32, y: 6, rot: 3 }] } };
    localStorage.setItem(key, JSON.stringify(prefs));
  }, ids);
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const p = await plan(page);
  expect(p.ids).toEqual(['tower', 'guildhall', 'gate', ...ids]);
  expect(p.homeKinds).toContain('home');
});

test('your wallets are private until you say otherwise, and the choice is kept', async ({ page }) => {
  const addr = '0x8ebfe0a1b5989c87f3c34bec8c160cf9e80b2a78';
  await page.addInitScript((a) => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ view: 'top', tourDone: true, owned: [a] }));
  }, addr);
  await page.goto('/?freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await page.locator('.btn', { hasText: 'Guild' }).click();
  const toggle = page.locator('.inspector .privacy').first();
  await expect(toggle).toHaveText('🔒 Private');
  await toggle.click();
  await expect(page.locator('.inspector .privacy').first()).toHaveText('🔓 Public');
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const kept = await page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { publicWallets?: string[] }).publicWallets);
  expect(kept).toEqual([addr]);
  await page.locator('.btn', { hasText: 'Guild' }).click();
  await expect(page.locator('.inspector .privacy').first()).toHaveText('🔓 Public');
});

/** Where on screen a tile's middle is (top-down view), to point at it. */
const tileOnScreen = async (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => {
  const [sx, sy] = await page.evaluate(([tx, ty]) => (window as unknown as { townView: { toScreen(x: number, y: number): [number, number] } }).townView.toScreen(tx, ty), [x, y] as const);
  const box = (await page.locator('.stage-wrap').boundingBox())!;
  return { x: box.x + sx, y: box.y + sy };
};
const savedTown = (page: Page): Promise<{ id: string; x: number; y: number; rot: number }[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { towns?: Record<string, { placed: { id: string; x: number; y: number; rot: number }[] }> }).towns?.ethereum?.placed ?? []));

test('build mode: pick a home, see it where it would stand, put it up, turn the next one; it is all kept', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const btn = page.locator('.build-btn');
  await expect(btn.locator('.count')).toHaveText(/^\d+$/);
  const waiting = Number(await btn.locator('.count').textContent());
  await btn.click();
  const drawer = page.locator('.build-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.locator('.questlog')).toBeHidden();
  // homes first, while there are homes to build
  await expect(drawer.locator('.tab.on')).toContainText('Homes');
  const first = drawer.locator('.build-card').first();
  const id = await first.getAttribute('data-build');
  await first.locator('.btn', { hasText: 'Build' }).click();
  await expect(drawer.locator('.build-card.held')).toHaveCount(1);

  // over the town: a ghost (green where it may stand), then a click puts it up
  const at = await tileOnScreen(page, 10.5, 6.5);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { townView: { build: { ghost: { ok: boolean } | null } | null } }).townView.build?.ghost?.ok)).toBe(true);
  await expect(drawer.locator('.build-hint')).toContainText('click to build here');
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 9, y: 5, rot: 0 }]);
  await expect(drawer.locator('.build-card.held')).toHaveCount(0);

  // not on the square: red, with the reason
  const homes = await drawer.locator('.build-card').count();
  if (homes > 0) {
    await drawer.locator('.build-card').first().locator('.btn', { hasText: 'Build' }).click();
    const square = await tileOnScreen(page, 20.5, 16.5);
    await page.mouse.move(square.x, square.y);
    await expect(drawer.locator('.build-hint')).toHaveClass(/bad/);
    await expect(drawer.locator('.build-hint')).toContainText(/square|built there/);
    await page.mouse.click(square.x, square.y);
    expect((await savedTown(page)).length).toBe(1);
    // turned once: its door faces west
    await page.keyboard.press('r');
    const spot = await tileOnScreen(page, 32.5, 6.5);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);
    await expect.poll(async () => (await savedTown(page))[1]?.rot).toBe(1);
  }

  // the count went down; done; and after a reload the town stands as built
  await drawer.locator('.btn', { hasText: 'Done' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.questlog')).toBeVisible();
  const left = (await btn.locator('.count').count()) === 0 ? 0 : Number(await btn.locator('.count').textContent());
  expect(left).toBeLessThan(waiting);
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const ids = await page.evaluate(() => (window as unknown as { townSim: { plan: Plan } }).townSim.plan.buildings.map((b) => b.id));
  expect(ids).toContain(id);
});

test('build mode: store a building, and let the town arrange the rest on your land', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press('b');
  const drawer = page.locator('.build-drawer');
  await expect(drawer).toBeVisible();
  await drawer.locator('.btn', { hasText: 'Arrange the rest for me' }).click();
  await expect.poll(async () => (await savedTown(page)).length).toBeGreaterThan(3);
  const built = (await savedTown(page)).length;
  await drawer.locator('.tab', { hasText: 'Built' }).click();
  await expect(drawer.locator('.build-card')).toHaveCount(built);
  await drawer.locator('.build-card').first().locator('.btn', { hasText: 'Store' }).click();
  await expect.poll(async () => (await savedTown(page)).length).toBe(built - 1);
  // Esc leaves build mode (nothing in hand)
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});
