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
  NftPositionResource,
  PortfolioResource,
  PositionResource,
  TransactionResource,
} from './types.js';

export const TX_PAGE_SIZE = 100;

/** L1 only for now. Widening this is how other chains plug in later. */
export const DEFAULT_CHAINS = ['ethereum'];

export interface ChainScope {
  chains?: readonly string[];
}

function chainFilter(scope: ChainScope): string {
  return (scope.chains ?? DEFAULT_CHAINS).join(',');
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

export function getTransactions(
  client: ZerionClient,
  address: string,
  options: ChainScope & { pages?: number; since?: number; signal?: AbortSignal } = {},
): Promise<TransactionResource[]> {
  const params: Record<string, string | number | undefined> = {
    currency: client.currency,
    'page[size]': TX_PAGE_SIZE,
    'filter[trash]': 'only_non_trash',
    'filter[chain_ids]': chainFilter(options),
  };
  if (options.since !== undefined) params['filter[min_mined_at]'] = Math.floor(options.since);
  const paging: { maxPages: number; signal?: AbortSignal } = { maxPages: options.pages ?? 1 };
  if (options.signal !== undefined) paging.signal = options.signal;
  return client.getAll<TransactionResource>(`/wallets/${address}/transactions/`, params, paging);
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
  options: { label?: string; signal?: AbortSignal; onWarn?: (msg: string) => void } = {},
): Promise<RawWallet> {
  const warn = options.onWarn ?? (() => undefined);
  // The portfolio and NFT calls are allowed to fail: a wallet Zerion has never
  // indexed, or an NFT index still warming up (202), is still a wallet.
  const [portfolio, simple, complex, nfts, transactions] = await Promise.all([
    getPortfolio(client, address).catch((e: unknown) => (warn(`portfolio: ${String(e)}`), null)),
    getPositions(client, address, 'only_simple'),
    getPositions(client, address, 'only_complex'),
    getNftPositions(client, address).catch((e: unknown) => (warn(`nfts: ${String(e)}`), [])),
    getTransactions(client, address, options.signal ? { signal: options.signal } : {}),
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
