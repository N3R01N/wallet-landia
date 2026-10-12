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
