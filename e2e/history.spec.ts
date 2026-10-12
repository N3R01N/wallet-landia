import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The lifetime ledger end to end, against a fake Zerion that pages like the
 * real one (newest first, 100 a page, inclusive time filters): the town loads
 * from the newest page, the rest of the wallet's history is gathered in the
 * background, and a reload asks for nothing it already has.
 */

const demo = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/demo/synthetic.json'), 'utf8'));
const ADDR: string = demo.address;
const T0 = Date.parse('2016-03-01T00:00:00Z');

/** 260 transactions over ten years, each a copy of a demo one with its own hash and time. */
const HISTORY = Array.from({ length: 260 }, (_, i) => {
  const base = demo.transactions[i % demo.transactions.length];
  return { ...base, id: `h-${i}`, attributes: { ...base.attributes, hash: `0x${(i + 1).toString(16).padStart(64, '0')}`, mined_at: new Date(T0 + i * 14 * 86_400_000).toISOString(), status: 'confirmed' } };
});

async function fakeNetwork(page: Page, o: { refuseOlder?: boolean } = {}): Promise<{ txRequests: string[] }> {
  const txRequests: string[] = [];
  await page.route('https://api.zerion.io/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.pathname.includes('/portfolio')) return json({ data: demo.portfolio });
    if (url.pathname.includes('/nft-positions/')) return json({ data: [], links: {} });
    if (url.pathname.includes('/positions/')) return json({ data: url.search.includes('only_complex') ? demo.complex : demo.simple, links: {} });
    if (url.pathname.includes('/transactions/')) {
      txRequests.push(url.search);
      // a Zerion that will not walk back (to prove a loaded file is what fills the history)
      if (o.refuseOlder && url.searchParams.has('filter[max_mined_at]')) return route.fulfill({ status: 500, body: 'no' });
      const since = Number(url.searchParams.get('filter[min_mined_at]') ?? -Infinity);
      const until = Number(url.searchParams.get('filter[max_mined_at]') ?? Infinity);
      const rows = HISTORY.filter((t) => {
        const at = Date.parse(t.attributes.mined_at);
        return at >= since && at <= until;
      }).sort((a, b) => Date.parse(b.attributes.mined_at) - Date.parse(a.attributes.mined_at));
      // like Zerion: a next link while more follow (the only sign of the end)
      return json({ data: rows.slice(0, 100), links: rows.length > 100 ? { next: `https://api.zerion.io/v1${url.pathname.replace(/^.*\/v1/, '')}?page[after]=more` } : {} });
    }
    return json({ data: [], links: {} });
  });
  await page.route('https://ethereum-rpc.publicnode.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const answer = (c: { id: number; method: string }) =>
      c.method === 'eth_getBlockByNumber'
        ? { jsonrpc: '2.0', id: c.id, result: { number: '0x10', gasUsed: '0x1', gasLimit: '0x2', baseFeePerGas: '0x3b9aca00', timestamp: '0x1', transactions: [] } }
        : { jsonrpc: '2.0', id: c.id, result: c.method === 'eth_call' ? `0x${'0'.repeat(64)}` : '0x1' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  return { txRequests };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((addr) => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('wallet-landia-v4/zerion-key', 'zk_test');
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ owned: [addr], view: 'top', tourDone: true }));
  }, ADDR);
});

test('a wallet’s whole history is gathered once in the background, and kept', async ({ page }) => {
  const fake = await fakeNetwork(page);
  await page.goto('/');
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  await page.locator('.btn', { hasText: 'Guild' }).click();
  const row = page.locator(`.history-row[data-address="${ADDR.toLowerCase()}"]`);
  // newest page for the town, then two pages back in time: all 260, back to March 2016
  await expect(row).toContainText('260 transactions', { timeout: 30_000 });
  await expect(row).toContainText('all of it');
  await expect(row).toContainText('2016');
  expect(fake.txRequests).toHaveLength(3);
  expect(fake.txRequests.filter((q) => q.includes('max_mined_at'))).toHaveLength(2);

  // the player's level and badges come from all of it: their first journey is ten years back
  await expect(async () => {
    await page.locator('.player-medal').click();
    await expect(page.locator('.player-sheet')).toContainText('First journey', { timeout: 1000 });
    await expect(page.locator('.player-sheet')).toContainText('2016', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('.player-medal .medal-level')).toHaveText(/^\d+$/);

  // a reload: the history is kept; nothing is asked again
  await page.reload();
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  await page.locator('.btn', { hasText: 'Guild' }).click();
  await expect(row).toContainText('260 transactions', { timeout: 10_000 });
  await page.waitForTimeout(2000);
  expect(fake.txRequests).toHaveLength(3);
});

test('a gathered history saved to a file fills another browser without asking Zerion', async ({ page, browser }) => {
  await fakeNetwork(page);
  await page.goto('/');
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  await page.locator('.btn', { hasText: 'Guild' }).click();
  const row = page.locator(`.history-row[data-address="${ADDR.toLowerCase()}"]`);
  await expect(row).toContainText('all of it', { timeout: 30_000 });
  const download = page.waitForEvent('download');
  await page.locator('.btn', { hasText: 'Save to a file' }).click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toMatch(/^wallet-landia-history-\d{4}-\d{2}-\d{2}\.json\.gz$/);

  // another browser: the town loads its newest page, but Zerion will not walk back
  const other = await (await browser.newContext({ baseURL: 'http://localhost:5198', viewport: { width: 1400, height: 860 } })).newPage();
  await other.addInitScript((addr) => {
    localStorage.setItem('wallet-landia-v4/zerion-key', 'zk_test');
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ owned: [addr], view: 'top', tourDone: true }));
  }, ADDR);
  await fakeNetwork(other, { refuseOlder: true });
  await other.goto('/');
  await expect(other.locator('.brand')).toContainText('live', { timeout: 20_000 });
  await other.locator('.btn', { hasText: 'Guild' }).click();
  const otherRow = other.locator(`.history-row[data-address="${ADDR.toLowerCase()}"]`);
  await expect(otherRow).toContainText('100 transactions', { timeout: 15_000 });
  await other.locator('input[aria-label="History file to load"]').setInputFiles(file);
  await expect(other.locator('.inspector .form-msg', { hasText: 'Loaded 260 transactions for 1 wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(otherRow).toContainText('260 transactions', { timeout: 15_000 });
  await expect(otherRow).toContainText('all of it');
  await other.context().close();
});
