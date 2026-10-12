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

test('build mode: select a building, move it, drag it, turn it, store it; undo and redo every step', async ({ page }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press('b');
  const drawer = page.locator('.build-drawer');
  // put one up
  const card = drawer.locator('.build-card').first();
  const id = await card.getAttribute('data-build');
  await card.locator('.btn', { hasText: 'Build' }).click();
  const a = await tileOnScreen(page, 10.5, 6.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 9, y: 5, rot: 0 }]);

  // select it in town; M picks it up, a click puts it down elsewhere (keeping its place in the order)
  await page.mouse.click(a.x, a.y);
  await expect(drawer.locator('.build-selected')).toBeVisible();
  await page.keyboard.press('m');
  const b = await tileOnScreen(page, 30.5, 6.5);
  await page.mouse.move(b.x, b.y);
  await page.mouse.click(b.x, b.y);
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 0 }]);

  // turned where it stands
  await expect(drawer.locator('.build-selected')).toBeVisible();
  await page.keyboard.press('r');
  await expect.poll(async () => (await savedTown(page))[0]?.rot).toBe(1);

  // dragged: pressed on it, moved, let go
  const c = await tileOnScreen(page, 14.5, 24.5);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move((b.x + c.x) / 2, (b.y + c.y) / 2, { steps: 4 });
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 13, y: 23, rot: 1 }]);

  // undo, step by step, and redo
  await page.keyboard.press('Control+z');
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 1 }]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 0 }]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 1 }]);

  // stored (Del), and back with Undo
  await page.mouse.click(b.x, b.y);
  await expect(drawer.locator('.build-selected')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect.poll(() => savedTown(page)).toEqual([]);
  await drawer.locator('.btn[aria-label="Undo"]').click();
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 1 }]);

  // Esc while moving leaves it where it was
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('m');
  await page.mouse.move(a.x, a.y);
  await page.keyboard.press('Escape');
  await expect.poll(() => savedTown(page)).toEqual([{ id, x: 29, y: 5, rot: 1 }]);
});

test('land: the medallion says when it grows; a level that brought more is told once; its edge is staked out', async ({ page }) => {
  // as if the land was last told at level 1 (16 × 12 tiles)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ view: 'top', tourDone: true, landArea: 16 * 12 }));
  });
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.player-medal .medal-land')).toHaveText(/More land at level \d+/, { timeout: 30_000 });
  const toast = page.locator('.toast', { hasText: 'More land for your town' });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const land = await page.evaluate(() => (window as unknown as { townView: { land: { x0: number; x1: number } | null } }).townView.land);
  expect(land).not.toBeNull();
  expect(land!.x1 - land!.x0).toBeGreaterThan(16);
  // told once: not again after a reload
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.player-medal .medal-land')).toHaveText(/More land/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.toast', { hasText: 'More land for your town' })).toHaveCount(0);
});

/** Arrange a town, then make a share link of it from the build drawer. */
async function shareLink(page: Page, which: 'Share my town' | 'Share a design'): Promise<string> {
  await page.keyboard.press('b');
  const drawer = page.locator('.build-drawer');
  await drawer.locator('.btn', { hasText: 'Arrange the rest for me' }).click();
  await expect.poll(async () => (await savedTown(page)).length).toBeGreaterThan(3);
  await drawer.locator('.btn', { hasText: which }).click();
  const input = drawer.locator('input[aria-label="Share link"]');
  await expect(input).toHaveValue(/#(town|design)=[A-Za-z0-9_-]+$/);
  return input.inputValue();
}

test('sharing a design: a friend opens the link, uses it for their own town, and can undo it', async ({ page, browser }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const link = await shareLink(page, 'Share a design');
  expect(link).toContain('#design=');
  const built = (await savedTown(page)).length;

  // a friend: another browser, an empty town of their own
  const friend = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: [{ name: 'wallet-landia-v4/prefs/v1', value: JSON.stringify({ view: 'top', tourDone: true }) }] }] } });
  const f = await friend.newPage();
  await f.goto(link.replace(/^https?:\/\/[^/]+\//, '/').replace('/#', '/?expose&freeze#'));
  await expect(f.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const offer = f.locator('.inspector .share-offer');
  await expect(offer).toContainText('A town design');
  // asked once: the link is gone from the address
  expect(new URL(f.url()).hash).toBe('');
  await offer.locator('.btn', { hasText: 'Use this design' }).click();
  await expect(f.locator('.build-drawer')).toBeVisible();
  await expect(f.locator('.build-hint')).toContainText(/Design used: \d+ of \d+/);
  await expect.poll(async () => (await savedTown(f)).length).toBe(built);
  await f.keyboard.press('Control+z');
  await expect.poll(async () => (await savedTown(f)).length).toBe(0);
  await friend.close();
});

test('sharing your town: only public wallets go; a friend visits it as built, in your style or theirs', async ({ page, browser }) => {
  await page.goto('/?expose&freeze');
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const heroes = await page.evaluate(() => (window as unknown as { townSim: { guild: { heroes: { address: string; name: string }[] } } }).townSim.guild.heroes.map((h) => h.address).sort());
  const [pub, ...priv] = heroes as [string, ...string[]];
  // one wallet public, a name for its hero; the rest stay private
  await page.evaluate(([a]) => {
    const key = 'wallet-landia-v4/prefs/v1';
    const p = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...p, publicWallets: [a], names: { [a!]: 'Sir Shares-a-Lot' } }));
  }, [pub]);
  await page.reload();
  await expect(page.locator('.veil')).toBeHidden({ timeout: 30_000 });
  const link = await shareLink(page, 'Share my town');
  await expect(page.locator('.build-share')).toContainText('Sir Shares-a-Lot');
  await expect(page.locator('.build-share')).toContainText(`${priv.length} private wallet`);
  // the link itself never holds a private address
  const { decodeShare } = await import('../src/world/townShare.js');
  const shared = await decodeShare(link.split('#town=')[1]!);
  expect(shared.heroes.map((h) => h.address)).toEqual([pub]);
  for (const a of priv) expect(JSON.stringify(shared)).not.toContain(a.slice(2));

  const friend = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: [{ name: 'wallet-landia-v4/prefs/v1', value: JSON.stringify({ view: 'top', tourDone: true }) }] }] } });
  const f = await friend.newPage();
  await f.goto(link.replace(/^https?:\/\/[^/]+\//, '/').replace('/#', '/?expose&freeze#'));
  await expect(f.locator('.veil')).toBeHidden({ timeout: 30_000 });
  await expect(f.locator('.inspector .share-offer')).toContainText("Sir Shares-a-Lot's town");
  await f.locator('.inspector .btn', { hasText: "Visit Sir Shares-a-Lot's town" }).click();
  await expect(f.locator('.brand')).toContainText("Visiting Sir Shares-a-Lot's town", { timeout: 30_000 });
  const visited = await f.evaluate(() => {
    const p = (window as unknown as { townSim: { plan: { buildings: { id: string; heroAddress?: string }[] }; guild: { heroes: { address: string; name: string }[] } } }).townSim;
    return { ids: p.plan.buildings.map((b) => b.id), heroes: p.guild.heroes.map((h) => [h.address, h.name]) };
  });
  expect(visited.ids.filter((i) => i.startsWith('estate:'))).toHaveLength(priv.length);
  expect(visited.ids).toContain(`home:${pub}`);
  expect(visited.heroes).toEqual([[pub, 'Sir Shares-a-Lot']]);
  // their style, or yours
  const banner = f.locator('.visit-banner');
  await expect(banner).toContainText('shown in their style');
  await banner.locator('.btn', { hasText: 'Use my style' }).click();
  await expect(banner).toContainText('shown in your style');
  // home again: the banner goes, and their town stays theirs
  await f.locator('.btn', { hasText: 'Return home' }).click();
  await expect(banner).toBeHidden({ timeout: 30_000 });
  expect(await savedTown(f)).toEqual([]);
  await friend.close();
});
