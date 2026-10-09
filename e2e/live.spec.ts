import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The live path end to end, against a fake Zerion and a fake RPC: the browser
 * code is real, the network is not, so this costs no quota and is repeatable.
 */

const demo = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/demo/synthetic.json'), 'utf8'));
const ADDR: string = demo.address;

interface Fake {
  zerionRequests: string[];
  nonce: string;
  transactions: unknown[];
}

async function fakeNetwork(page: Page): Promise<Fake> {
  const fake: Fake = { zerionRequests: [], nonce: '0x1', transactions: [...demo.transactions] };
  await page.route('https://api.zerion.io/**', async (route) => {
    const url = route.request().url();
    fake.zerionRequests.push(url);
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.includes('/portfolio')) return json({ data: demo.portfolio });
    if (url.includes('/nft-positions/')) return json({ data: [], links: {} });
    if (url.includes('/positions/')) return json({ data: url.includes('only_complex') ? demo.complex : demo.simple, links: {} });
    if (url.includes('/transactions/')) return json({ data: fake.transactions, links: {} });
    return json({ data: [], links: {} });
  });
  let block = 1000;
  await page.route('https://ethereum-rpc.publicnode.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const answer = (c: { id: number; method: string }) => {
      switch (c.method) {
        case 'eth_getBlockByNumber':
          block++;
          return { jsonrpc: '2.0', id: c.id, result: { number: `0x${block.toString(16)}`, gasUsed: '0x1', gasLimit: '0x2', baseFeePerGas: '0x3b9aca00', timestamp: '0x1', transactions: [] } };
        case 'eth_getTransactionCount':
          return { jsonrpc: '2.0', id: c.id, result: fake.nonce };
        case 'eth_getBalance':
          return { jsonrpc: '2.0', id: c.id, result: '0x10' };
        default: // eth_call (ENS): no resolver
          return { jsonrpc: '2.0', id: c.id, result: `0x${'0'.repeat(64)}` };
      }
    };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  return fake;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((addr) => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('wallet-landia-v4/zerion-key', 'zk_test');
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ owned: [addr], view: 'top' }));
  }, ADDR);
});

test('loads live, caches, and plays a new transaction when the chain moves', async ({ page }) => {
  const fake = await fakeNetwork(page);
  await page.goto('/');
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  expect(fake.zerionRequests).toHaveLength(5);
  await expect(page.locator('.btn.ink')).toHaveText('✒ 295');

  // A reload within the cache window costs nothing.
  await page.reload();
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  expect(fake.zerionRequests).toHaveLength(5);

  // Let the session take its baseline of the chain, then the wallet sends
  // something: its nonce moves, and Zerion has a new tx.
  await page.waitForTimeout(1500);
  const fresh = structuredClone(demo.transactions[0]);
  delete fresh.attributes.flags;
  delete fresh.relationships.dapp;
  delete fresh.attributes.application_metadata;
  fresh.id = 'fresh';
  fresh.attributes.hash = '0xfeedface';
  fresh.attributes.operation_type = 'send';
  fresh.attributes.mined_at = new Date().toISOString();
  fresh.attributes.sent_from = ADDR;
  fresh.attributes.transfers = [
    { direction: 'out', quantity: { int: '1', decimals: 0, float: 3, numeric: '3' }, value: 9000, price: 3000, sender: ADDR, recipient: '0xabcdef0000000000000000000000000000001234', fungible_info: { name: 'Ether', symbol: 'ETH', icon: null } },
  ];
  fake.transactions = [fresh, ...fake.transactions];
  fake.nonce = '0x2';

  await expect(page.locator('.questlog-list')).toContainText('Send 3 ETH to 0xabcd', { timeout: 30_000 });
  // 1 for the new history tail, then 2 to re-measure tokens after a plain send.
  await expect.poll(() => fake.zerionRequests.length).toBe(8);
  const kinds = fake.zerionRequests.slice(5).map((u) => /\/(transactions|portfolio|nft-positions|positions)\b/.exec(u)?.[1]);
  expect(kinds).toEqual(['transactions', 'portfolio', 'positions']);
});

test('the Guild panel adds a wallet and rejects nonsense', async ({ page }) => {
  await fakeNetwork(page);
  await page.goto('/');
  await page.locator('.btn', { hasText: '⚙ Guild' }).click();
  await expect(page.locator('.inspector h2')).toHaveText('⚙ Guild');
  await expect(page.locator('.inspector')).toContainText('A key is saved');
  const follow = page.locator('.inspector input[aria-label="0x… or name.eth"]').nth(1);
  await follow.fill('not an address');
  await page.locator('.inspector .btn', { hasText: 'Follow' }).click();
  await expect(page.locator('.inspector .form-msg').nth(1)).toContainText('0x… address or an ENS name');
  await follow.fill('0x1111111111111111111111111111111111111111');
  await page.locator('.inspector .btn', { hasText: 'Follow' }).click();
  await expect(page.locator('.inspector')).toContainText('Followed towns (1)');
});

test('visiting a town and coming home again is free once cached, while the wallets have not moved', async ({ page }) => {
  const fake = await fakeNetwork(page);
  const OTHER = '0x2222222222222222222222222222222222222222';
  await page.addInitScript(([addr, other]) => {
    localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ owned: [addr], followed: [other], view: 'top' }));
  }, [ADDR, OTHER]);
  await page.goto('/');
  await expect(page.locator('.brand')).toContainText('live', { timeout: 20_000 });
  expect(fake.zerionRequests).toHaveLength(5);

  const visit = async (): Promise<void> => {
    // the Guild panel stays open across towns; its button toggles it
    if (!(await page.locator('.inspector h2', { hasText: '⚙ Guild' }).isVisible())) await page.locator('.btn', { hasText: '⚙ Guild' }).click();
    await page.locator('.inspector .btn', { hasText: 'Visit' }).click();
    await expect(page.locator('.brand')).toContainText('Visiting', { timeout: 20_000 });
  };
  const home = async (): Promise<void> => {
    await page.locator('.btn', { hasText: 'Return home' }).click();
    await expect(page.locator('.brand')).toContainText('Your guild', { timeout: 20_000 });
  };
  await visit();
  expect(fake.zerionRequests).toHaveLength(10); // a first visit: the whole wallet
  await home();
  await visit();
  await home();
  expect(fake.zerionRequests).toHaveLength(10); // back and forth: all from the cache
});
