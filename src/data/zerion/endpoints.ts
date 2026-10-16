/**
 * Raw Zerion fetchers. Everything returns API resources untouched; mapping into
 * the domain happens in `src/domain/mappers.ts`, so fixtures and live data take
 * exactly the same path.
 *
 * Cold load per wallet: portfolio + simple + complex + 1 tx page + NFTs = 5
 * requests, against a free budget of 300 a day.
 */

import type { ZerionClient } from './client.js';
import type {
  FungibleResource,
  NftPositionResource,
  PortfolioResource,
  PositionResource,
  TransactionResource,
} from './types.js';

export const TX_PAGE_SIZE = 100;

/**
 * The realm: Ethereum and the L2 provinces it rules (Phase 6). Zerion takes
 * them all in one comma-joined filter, so more chains cost no more requests
 * (they share the one page of transactions, though).
 */
export const DEFAULT_CHAINS: readonly string[] = ['ethereum', 'base', 'arbitrum', 'optimism'];

let realmChains: readonly string[] = DEFAULT_CHAINS;

/** The chains every request covers from now on (the player's realm). */
export function setRealmChains(chains: readonly string[]): void {
  realmChains = chains.length > 0 ? [...chains] : DEFAULT_CHAINS;
}

export function currentChains(): readonly string[] {
  return realmChains;
}

/** The realm as a storage scope (`ethereum+base…`): caches and the ledger keep each realm apart. */
export function realmScope(): string {
  return realmChains.join('+');
}

export interface ChainScope {
  chains?: readonly string[];
}

function chainFilter(scope: ChainScope): string {
  return (scope.chains ?? realmChains).join(',');
}

export function getPortfolio(
  client: ZerionClient,
  address: string,
  scope: ChainScope = {},
): Promise<PortfolioResource> {
  return client.getOne<PortfolioResource>(`/wallets/${address}/portfolio`, {
    currency: client.currency,
    'filter[positions]': 'no_filter',
    'filter[chain_ids]': chainFilter(scope),
  });
}

export function getPositions(
  client: ZerionClient,
  address: string,
  kind: 'only_simple' | 'only_complex',
  scope: ChainScope = {},
): Promise<PositionResource[]> {
  return client.getAll<PositionResource>(`/wallets/${address}/positions/`, {
    currency: client.currency,
    'filter[positions]': kind,
    'filter[trash]': 'only_non_trash',
    'filter[chain_ids]': chainFilter(scope),
    sort: 'value',
  });
}

export function getNftPositions(
  client: ZerionClient,
  address: string,
  scope: ChainScope = {},
): Promise<NftPositionResource[]> {
  return client.getAll<NftPositionResource>(
    `/wallets/${address}/nft-positions/`,
    { currency: client.currency, 'filter[chain_ids]': chainFilter(scope), sort: '-floor_price' },
    { maxPages: 1 },
  );
}

/** ETH's market: its price now and how it moved over the last day (one request; null when Zerion has no price). */
export async function getEthMarket(client: ZerionClient): Promise<{ usd: number; pct1d: number } | null> {
  const f = await client.getOne<FungibleResource>('/fungibles/eth', { currency: client.currency });
  const usd = f.attributes.market_data.price;
  const pct1d = f.attributes.market_data.changes?.percent_1d;
  return usd !== null && usd > 0 && typeof pct1d === 'number' ? { usd, pct1d } : null;
}

type TxOptions = ChainScope & { pages?: number; since?: number; until?: number; signal?: AbortSignal; spam?: boolean };

function txParams(client: ZerionClient, options: TxOptions): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    currency: client.currency,
    'page[size]': TX_PAGE_SIZE,
    // with spam left out, Zerion drops it from pages already cut at 100: a short
    // page then says nothing about the end of the history (the ledger asks for
    // everything; the mapper sets spam aside itself)
    'filter[trash]': options.spam === true ? 'no_filter' : 'only_non_trash',
    'filter[chain_ids]': chainFilter(options),
  };
  if (options.since !== undefined) params['filter[min_mined_at]'] = Math.floor(options.since);
  // (both ends inclusive: walking back in time, `until` is the oldest one already kept)
  if (options.until !== undefined) params['filter[max_mined_at]'] = Math.floor(options.until);
  return params;
}

/** Up to `pages` pages of transactions, and whether Zerion has more after them (its `links.next`): the only sure sign of the end. */
export function getTransactionPages(client: ZerionClient, address: string, options: TxOptions = {}): Promise<{ data: TransactionResource[]; more: boolean }> {
  const paging: { maxPages: number; signal?: AbortSignal } = { maxPages: options.pages ?? 1 };
  if (options.signal !== undefined) paging.signal = options.signal;
  return client.getPages<TransactionResource>(`/wallets/${address}/transactions/`, txParams(client, options), paging);
}

export async function getTransactions(client: ZerionClient, address: string, options: TxOptions = {}): Promise<TransactionResource[]> {
  return (await getTransactionPages(client, address, options)).data;
}

/** One wallet, as raw resources. This is also the fixture file format. */
export interface RawWallet {
  address: string;
  currency: string;
  capturedAt: number;
  label: string;
  portfolio: PortfolioResource | null;
  simple: PositionResource[];
  complex: PositionResource[];
  nfts: NftPositionResource[];
  transactions: TransactionResource[];
}

export async function fetchRawWallet(
  client: ZerionClient,
  address: string,
  options: { label?: string; signal?: AbortSignal; onWarn?: (msg: string) => void; transactions?: () => Promise<TransactionResource[]> } = {},
): Promise<RawWallet> {
  const warn = options.onWarn ?? (() => undefined);
  // The portfolio and NFT calls are allowed to fail: a wallet Zerion has never
  // indexed, or an NFT index still warming up (202), is still a wallet.
  const [portfolio, simple, complex, nfts, transactions] = await Promise.all([
    getPortfolio(client, address).catch((e: unknown) => (warn(`portfolio: ${String(e)}`), null)),
    getPositions(client, address, 'only_simple'),
    getPositions(client, address, 'only_complex'),
    getNftPositions(client, address).catch((e: unknown) => (warn(`nfts: ${String(e)}`), [])),
    // (the lifetime ledger fetches them when there is one, and keeps them)
    options.transactions ? options.transactions() : getTransactions(client, address, options.signal ? { signal: options.signal } : {}),
  ]);
  return {
    address: address.toLowerCase(),
    currency: client.currency,
    capturedAt: Date.now(),
    label: options.label ?? address,
    portfolio,
    simple,
    complex,
    nfts: Array.isArray(nfts) ? nfts : [],
    transactions,
  };
}
