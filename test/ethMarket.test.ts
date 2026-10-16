/**
 * ETH's 24-hour move: read live from Zerion's ETH market, else from the
 * wallets' own native ETH. The arrow and the sky follow its sign.
 */

import { describe, expect, it } from 'vitest';
import { ZerionClient } from '../src/data/zerion/client.js';
import { getEthMarket, type RawWallet } from '../src/data/zerion/endpoints.js';
import type { PositionResource } from '../src/data/zerion/types.js';
import { ethMarketOf } from '../src/domain/mappers.js';

function clientReplying(body: unknown, urls: string[] = []): ZerionClient {
  const fetch = ((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }) as unknown as typeof globalThis.fetch;
  return new ZerionClient({ apiKey: 'zk_test', transport: 'direct', requestsPerSecond: 1000, fetch, sleep: () => Promise.resolve() });
}

const market = (price: number | null, percent_1d: number | null | undefined) => ({
  data: { type: 'fungibles', id: 'eth', attributes: { name: 'Ethereum', symbol: 'ETH', market_data: { price, changes: percent_1d === undefined ? undefined : { percent_1d } } } },
});

describe("Zerion's ETH market", () => {
  it('reads the price and the 24h change from /fungibles/eth', async () => {
    const urls: string[] = [];
    expect(await getEthMarket(clientReplying(market(4120.5, 3.1), urls))).toEqual({ usd: 4120.5, pct1d: 3.1 });
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).pathname).toMatch(/\/fungibles\/eth$/);
    expect(new URL(urls[0]!).searchParams.get('currency')).toBe('usd');
  });

  it('keeps a fall a fall', async () => {
    expect(await getEthMarket(clientReplying(market(3900, -3)))).toEqual({ usd: 3900, pct1d: -3 });
  });

  it('is null with no price or no 24h change', async () => {
    expect(await getEthMarket(clientReplying(market(null, 2)))).toBeNull();
    expect(await getEthMarket(clientReplying(market(4000, null)))).toBeNull();
    expect(await getEthMarket(clientReplying(market(4000, undefined)))).toBeNull();
  });
});

function position(symbol: string, chain: string, address: string | null, price: number | undefined, percent_1d: number | undefined): PositionResource {
  return {
    type: 'positions',
    id: `${chain}-${symbol}`,
    attributes: {
      name: symbol,
      quantity: { int: '1', decimals: 0, float: 1, numeric: '1' },
      ...(price !== undefined ? { price } : {}),
      ...(percent_1d !== undefined ? { changes: { absolute_1d: 0, percent_1d } } : {}),
      fungible_info: { name: symbol, symbol, icon: null, implementations: [{ chain_id: chain, address }] },
    },
    relationships: { chain: { data: { type: 'chains', id: chain } } },
  };
}

const wallet = (...simple: PositionResource[]): RawWallet => ({ address: '0x1', currency: 'usd', capturedAt: 0, label: '', portfolio: null, simple, complex: [], nfts: [], transactions: [] });

describe("the wallets' own ETH (the fallback)", () => {
  it("takes native ETH's price and 24h change", () => {
    expect(ethMarketOf([wallet(position('ETH', 'ethereum', null, 4000, 3))])).toEqual({ usd: 4000, pct1d: 3 });
    expect(ethMarketOf([wallet(position('ETH', 'base', '', 4000, -2.5))])).toEqual({ usd: 4000, pct1d: -2.5 });
  });

  it('passes over tokens named ETH, other coins, and ETH with no change, to the next wallet', () => {
    const raws = [wallet(position('ETH', 'ethereum', '0xbridged', 1, 50), position('USDC', 'ethereum', '0xa0b8', 1, 0), position('ETH', 'ethereum', null, 4000, undefined)), wallet(position('ETH', 'arbitrum', null, 3990, 1.2))];
    expect(ethMarketOf(raws)).toEqual({ usd: 3990, pct1d: 1.2 });
  });

  it('is null with no ETH', () => {
    expect(ethMarketOf([wallet(position('USDC', 'ethereum', '0xa0b8', 1, 0))])).toBeNull();
    expect(ethMarketOf([])).toBeNull();
  });
});
