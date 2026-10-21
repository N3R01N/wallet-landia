import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** The Guild tab: the player's key and wallets, shared with the town. */

test.use({ viewport: { width: 390, height: 844 } });

test('wallets are added and removed, nonsense is refused with a reason, and a bad key is not kept', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const tab = page.locator('.guild-tab');
  await expect(tab.locator('.source')).not.toHaveText('Loading…');

  // nonsense: a reason, nothing added
  const input = tab.getByLabel('Wallet address or ENS name');
  await input.fill('not a wallet');
  await tab.locator('[data-section="wallets"] .btn', { hasText: 'Add' }).click();
  await expect(tab.locator('[data-section="wallets"]').locator('.form-msg')).toContainText('0x… address or an ENS name');

  // an address: listed, kept in the shared preferences, and removable
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  await input.fill(address);
  await tab.locator('[data-section="wallets"] .btn', { hasText: 'Add' }).click();
  await expect(page.locator('.guild-tab [data-section="wallets"] .wallet-row')).toContainText('0x1234…5678');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { owned?: string[] });
  expect(saved.owned).toContain(address);
  await page.locator('.guild-tab [data-section="wallets"]').getByRole('button', { name: /^Remove / }).click();
  await expect(page.locator('.guild-tab [data-section="wallets"] .wallet-row')).toHaveCount(0);

  // a key with a stray character is refused, with the reason
  await page.locator('.guild-tab').getByLabel('Zerion API key').fill('zk_dev abc');
  await page.locator('.guild-tab [data-section="key"] .btn', { hasText: 'Save' }).click();
  await expect(page.locator('.guild-tab [data-section="key"]').locator('.form-msg')).not.toBeEmpty();
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => /key/i.test(k) && (localStorage.getItem(k) ?? '').includes('zk_dev abc')))).toBe(false);

  expect(errors).toEqual([]);
});

test('the history file and the Ethereum node: a refused node address says why, a good one is kept', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const tab = page.locator('.guild-tab');
  await expect(tab.locator('h2', { hasText: 'Your history' })).toBeVisible();
  await expect(tab.locator('.btn', { hasText: 'Save to a file' })).toBeVisible();
  const node = tab.getByLabel('Ethereum node address');
  await node.fill('http://evil.example');
  await tab.locator('.btn', { hasText: 'Use' }).click();
  await expect(tab.locator('[data-section="node"]').locator('.form-msg')).toContainText('Use an https address');
  await tab.locator('.btn', { hasText: 'Default' }).click();
  await expect(tab.locator('[data-section="node"]').locator('.form-msg')).toContainText('free public node');
});

test('follow a wallet, visit its castle (just that wallet’s towers), and return home', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  const wallets = await page.evaluate(() => (window as unknown as { castleView: { walletIds(): string[] } }).castleView.walletIds());
  expect(wallets.length).toBeGreaterThan(1);
  const other = wallets[1]!;

  await page.locator('.tab', { hasText: 'Guild' }).click();
  const followed = page.locator('[data-section="followed"]');
  await followed.getByLabel('Wallet to follow').fill(other);
  await followed.locator('.btn', { hasText: 'Follow' }).click();
  await expect(followed.locator('.wallet-row')).toHaveCount(1);
  await followed.locator('.btn', { hasText: 'Visit' }).click();

  // the castle tab, showing that one wallet; a way home
  await expect(page.locator('.tab', { hasText: 'Castle' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.topbar .guild-name')).toContainText('Visiting');
  await expect(page.locator('.home-btn')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { castleView: { walletIds(): string[] } }).castleView.walletIds().join(',')))
    .toBe(other);

  await page.locator('.home-btn').click();
  await expect(page.locator('.home-btn')).toBeHidden();
  await expect(page.locator('.topbar .guild-name')).not.toContainText('Visiting');
});

test('share: only public wallets go in the link, and the link opens that castle as a visit', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  const wallets = await page.evaluate(() => (window as unknown as { castleView: { walletIds(): string[] } }).castleView.walletIds());
  const mine = wallets[0]!;

  await page.locator('.tab', { hasText: 'Guild' }).click();
  const share = page.locator('[data-section="share"]');
  const yours = page.locator('[data-section="wallets"]');
  await yours.getByLabel('Wallet address or ENS name').fill(mine);
  await yours.locator('.btn', { hasText: 'Add' }).click();
  // private by default: nothing to share yet
  await expect(share).toContainText('Mark at least one');
  await yours.locator('.privacy').click();
  const link = await share.getByLabel('Your share link').inputValue();
  expect(link).toContain(`#visit=${mine}`);

  const friend = await page.context().newPage();
  await friend.goto(link);
  await expect(friend.locator('.topbar .guild-name')).toContainText('Visiting');
  await expect(friend.locator('.home-btn')).toBeVisible();
  await expect
    .poll(() => friend.evaluate(() => (window as unknown as { castleView?: { walletIds(): string[] } }).castleView?.walletIds().join(',') ?? ''))
    .toBe(mine);
});

test('a wallet’s crest: pick a tincture (kept, shared with the town), or go back to the one it was born with', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const yours = page.locator('[data-section="wallets"]');
  const address = '0x' + 'c'.repeat(40);
  await yours.getByLabel('Wallet address or ENS name').fill(address);
  await yours.locator('.btn', { hasText: 'Add' }).click();
  await yours.getByLabel('Crest colour', { exact: true }).click();
  await yours.getByLabel('Azure', { exact: true }).click();
  const crests = () => page.evaluate(() => (JSON.parse(localStorage.getItem('wallet-landia-v4/prefs/v1') ?? '{}') as { crests?: Record<string, string[]> }).crests ?? {});
  expect((await crests())[address]?.[0]).toBe('#2a58b0');
  await expect(yours.getByLabel('Crest colour', { exact: true })).toHaveAttribute('style', /#2a58b0|42, 88, 176/);
  await yours.getByLabel('Crest colour', { exact: true }).click();
  await yours.locator('.btn', { hasText: 'Born' }).click();
  expect((await crests())[address]).toBeUndefined();
});

test('the Guild tab says what the castle is not, and its link opens the legal page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const about = page.locator('.guild-tab [data-section="about"]');
  await expect(about).toContainText('Not financial advice');
  await expect(about).toContainText('not affiliated with Zerion');
  await about.getByRole('link', { name: 'Legal notice, privacy and terms' }).click();
  await expect(page).toHaveURL(/\/legal\.html$/);
  for (const id of ['owner', 'disclaimer', 'privacy', 'terms']) await expect(page.locator(`section#${id} h2`)).toBeVisible();
  await expect(page.locator('#owner')).toContainText('§ 25 Mediengesetz');
  expect(errors).toEqual([]);
});

test('without a key, the Guild tab shows how to get one, and why it is your own', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const guide = page.locator('.guild-tab [data-section="key"] .key-guide');
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide).toContainText('zk_');
  await expect(guide).toContainText('Why your own key?');
  await expect(guide.getByRole('link', { name: 'dashboard.zerion.io' })).toHaveAttribute('href', 'https://dashboard.zerion.io/');
});

/** A famous castle served by the test: the synthetic demo peer under a famous name. */
async function serveFamous(page: Page): Promise<void> {
  const raw = JSON.parse(readFileSync('fixtures/demo/synthetic-peer-1.json', 'utf8')) as { address: string };
  const entry = { slug: 'test-famous', address: raw.address, name: 'Famous Tester', about: 'A castle for the tests', capturedAt: Date.parse('2026-10-01T00:00:00Z') };
  await page.route('**/famous/index.json', (r) => r.fulfill({ json: [entry] }));
  await page.route(`**/famous/${raw.address}.json?v=*`, (r) => r.fulfill({ json: raw }));
}

test('a famous castle is visited without a key, and its link opens it again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await serveFamous(page);
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const famous = page.locator('.guild-tab [data-section="famous"]');
  await expect(famous).toBeVisible();
  await expect(famous).toContainText('Famous Tester');
  await famous.getByRole('button', { name: "Visit Famous Tester's castle" }).click();
  await expect(page).toHaveURL(/#famous=test-famous$/);

  await page.locator('.tab', { hasText: 'Guild' }).click();
  await expect(page.locator('.guild-tab .source')).toHaveText(/famous castle/);
  await expect(page.locator('.guild-tab [data-section="famous"] .btn', { hasText: 'Here' })).toBeVisible();

  // the address bar can be shared: opened fresh, it is the same castle
  await page.reload();
  await page.locator('.tab', { hasText: 'Guild' }).click();
  await expect(page.locator('.guild-tab .source')).toHaveText(/famous castle/);
  expect(errors).toEqual([]);
});

test('with no famous castles to show, the section stays hidden', async ({ page }) => {
  await page.route('**/famous/index.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  await expect(page.locator('.guild-tab .source')).not.toHaveText('Loading…');
  await expect(page.locator('.guild-tab [data-section="famous"]')).toBeHidden();
});
