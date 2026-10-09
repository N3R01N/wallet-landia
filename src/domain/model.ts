/**
 * The v4 domain: what the world is built from. Renderer-agnostic and
 * chain-agnostic (every asset and journey carries its chainId).
 */

import type { AssetCategory, BuildingKind, ProtocolCategory } from './catalog.js';
import type { Tier } from './tiers.js';

export type HeroClass = 'merchant' | 'monk' | 'paladin' | 'bard' | 'ranger' | 'adventurer' | 'sleeper';

export const CLASS_LABEL: Record<HeroClass, string> = {
  merchant: 'Merchant',
  monk: 'Monk',
  paladin: 'Paladin',
  bard: 'Bard',
  ranger: 'Ranger',
  adventurer: 'Adventurer',
  sleeper: 'Sleeper',
};

export interface Item {
  id: string;
  chainId: string;
  name: string;
  symbol: string;
  category: AssetCategory;
  quantity: number;
  usd: number | null;
  tier: Tier;
  iconUrl: string | null;
}

export type PositionKind = 'deposit' | 'loan' | 'staked' | 'reward' | 'locked' | 'investment' | 'other';

export interface StashEntry {
  name: string;
  symbol: string;
  kind: PositionKind;
  module: string | null;
  quantity: number;
  /** Signed: loans are negative. */
  usd: number;
  chainId: string;
}

/** A hero's holdings inside one protocol building. */
export interface Stash {
  protocolId: string;
  entries: StashEntry[];
  netUsd: number;
  grossUsd: number;
  tier: Tier;
  hasRewards: boolean;
  hasDebt: boolean;
}

export interface Protocol {
  id: string;
  name: string;
  iconUrl: string | null;
  url: string | null;
  category: ProtocolCategory;
  building: BuildingKind;
  /** Journeys from guild heroes that touched it, in the loaded window. */
  visits: number;
}

export interface Hero {
  address: string;
  label: string;
  name: string;
  /** Tokens + protocol positions + NFT floor value. */
  netWorth: number;
  /** Zerion's portfolio total (tokens and positions, no NFTs). */
  tokenWorth: number;
  /** Sum of NFT floor prices: a rough figure, floors are often thin. */
  nftWorth: number;
  tier: Tier;
  items: Item[];
  nfts: Item[];
  spamCount: number;
  stashes: Stash[];
  suggestedClass: HeroClass;
  verbCounts: Partial<Record<Verb, number>>;
  lastActiveAt: number | null;
}

export type Verb =
  | 'send'
  | 'receive'
  | 'swap'
  | 'addLiquidity'
  | 'removeLiquidity'
  | 'stake'
  | 'unstake'
  | 'supply'
  | 'withdraw'
  | 'borrow'
  | 'repay'
  | 'liquidated'
  | 'claim'
  | 'approve'
  | 'revoke'
  | 'wrap'
  | 'unwrap'
  | 'mint'
  | 'burn'
  | 'buyNft'
  | 'sellNft'
  | 'bid'
  | 'bridge'
  | 'delegate'
  | 'deploy'
  | 'airdrop'
  | 'deposit'
  /** P2P lending, lender side: you lend to a borrower through the protocol. */
  | 'lend'
  /** P2P lending, lender side: a borrower paid you back (with interest). */
  | 'loanRepaid'
  | 'unknown';

export interface Goods {
  /** Token symbol, or an NFT's collection. */
  symbol: string;
  quantity: number;
  usd: number | null;
  isNft: boolean;
  /** An NFT's own name ("AlchemistV3 Position #57"). */
  name?: string;
  /** An NFT's picture (a preview URL), when known. */
  image?: string;
}

export type Target =
  | { kind: 'building'; protocolId: string }
  | { kind: 'home'; address: string }
  | { kind: 'gate' };

export interface JourneyStep {
  verb: Verb;
  target: Target;
  give: Goods[];
  get: Goods[];
}

export interface Journey {
  /** chain:hash, shared across wallets so a guild-internal send is drawn once. */
  key: string;
  hash: string;
  chainId: string;
  hero: string;
  time: number;
  status: 'confirmed' | 'failed' | 'pending';
  feeUsd: number | null;
  /** Fee in the chain's native coin (ETH on mainnet). */
  feeNative: number | null;
  block: number | null;
  /** Decoded contract method, when Zerion knows it (e.g. "Multicall"). */
  method: string | null;
  /** Did this hero sign it (and so pay the toll at the Chronicle Tower)? */
  initiated: boolean;
  verb: Verb;
  steps: JourneyStep[];
  valueUsd: number;
  tier: Tier;
  /** 0..3 — how big a show to make of it (World Bible §5, drama scaling). */
  drama: 0 | 1 | 2 | 3;
  counterparty: string | null;
  /** Guild member on the other end of a send, if any. */
  counterpartyHero: string | null;
  label: string;
}

export interface Guild {
  heroes: Hero[];
  protocols: Map<string, Protocol>;
  /** Oldest first. */
  journeys: Journey[];
  windowStart: number;
  windowEnd: number;
}
