import { test as base, type Page } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

/**
 * The browser tests' `test`: every page's requests to the world outside the
 * dev server are answered here, at once, so a test neither waits on the
 * network nor meets a public node's rate limit (four workers, each page
 * asking the node ~70 times on a fresh start, got 429s).
 *
 * Nothing a test checks comes from outside: ENS names, NFT pictures, token
 * icons and the bell's heartbeat are extras the castle does without. The
 * answers are valid but empty, so no console error is logged for them:
 * - a node (JSON-RPC POST): `result: null` for every call, but a plain new
 *   block for `eth_getBlockByNumber`, so the heartbeat beats;
 * - a picture: a 1 × 1 see-through PNG;
 * - anything else: `{}`;
 * and the dev server's picture proxy (/api/image, which fetches from outside) a pixel too.
 *
 * A test that wants its own answer (a famous castle's file) routes it itself:
 * routes added later take precedence.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await answerOutside(page);
    await use(page);
  },
});

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let block = 24_000_000;

/** Answers every request that leaves the dev server (see above). */
export async function answerOutside(page: Page): Promise<void> {
  // the picture proxy is on the dev server, but it fetches from outside: a pixel too
  await page.route('**/api/image?*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route(
    (url) => url.hostname !== 'localhost' && url.protocol.startsWith('http'),
    async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && (req.headers()['content-type'] ?? '').includes('json')) {
        const body = JSON.parse(req.postData() ?? '{}') as { id?: number; method?: string } | { id?: number; method?: string }[];
        const answer = (c: { id?: number; method?: string }) => ({
          jsonrpc: '2.0',
          id: c.id ?? 1,
          result:
            c.method === 'eth_getBlockByNumber'
              ? { number: `0x${(block++).toString(16)}`, gasUsed: '0xe4e1c0', gasLimit: '0x1c9c380', baseFeePerGas: '0x3b9aca00', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: [] }
              : null,
        });
        await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
        return;
      }
      if (req.resourceType() === 'image' || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(req.url())) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
        return;
      }
      await route.fulfill({ json: {} });
    },
  );
}
