/**
 * Siege of the Ledger's core types (spec: "Architecture and data model").
 * Plain serialisable data: the whole match state is JSON (bigints as strings),
 * changed only by commands, so it can be replayed, sent to a worker, or later
 * over the network.
 */

import type { PriceClass, Regime } from '../config/balance.js';

export type { PriceClass, Regime };

/** A sim id ('eth', 'usdc'…): the importer maps contract addresses onto these. */
export type AssetId = string;
export type UnitTypeId = string;
export type EventId =
  | 'black-swan'
  | 'bull-run'
  | 'meme-mania'
  | 'depeg'
  | 'rug-pull'
  | 'gas-spike'
  | 'slashing'
  | 'airdrop';

/** Token categories: the curated roster's own, and the fallback ones. */
export type Category =
  | 'native'
  | 'lst'
  | 'btc'
  | 'stable'
  | 'largecap'
  | 'defi-gov'
  | 'infra'
  | 'meme'
  | 'rwa'
  | 'ai-gaming'
  | 'misc';

export interface Asset {
  id: AssetId;
  symbol: string;
  category: Category;
  priceClass: PriceClass;
  isStable: boolean;
  curatedUnit?: UnitTypeId;
  /** LSTs and wrapped coins follow this asset's moves. */
  follows?: AssetId;
  /** Whether it may be supplied as collateral (memecoins may not). */
  collateral: boolean;
  /** Opening price, in dollars. */
  price: number;
}

export type Role = 'melee' | 'ranged' | 'cavalry' | 'swarm' | 'siege' | 'support';

export interface UnitType {
  id: UnitTypeId;
  name: string;
  role: Role;
  costMult: number;
  hp: number;
  atk: number;
  range: number;
  speed: number;
  siege: number;
  ability?: string;
}

export type PositionKind = 'spot' | 'staked' | 'restaked' | 'lp' | 'supplied' | 'borrowed';
/** What a protocol does: any lending protocol plays as 'lending', and so on. */
export type ProtocolFn = 'staking' | 'restaking' | 'dex' | 'lending' | 'vault';

export interface Position {
  asset: AssetId;
  qty: bigint;
  kind: PositionKind;
  protocol?: ProtocolFn;
  /** LP: the other token of the pair, and its amount. */
  pairWith?: AssetId;
  pairQty?: bigint;
  /** Unstaking: the round from which it is spot again. */
  unlocksAtRound?: number;
}

export interface RelicSlot {
  nft: string;
}

export interface NftHolding {
  /** The collection: a contract address, or a sim collection id. */
  collection: string;
  /** Floor value in dollars at setup (moves with the price sim). */
  floor: number;
}

export interface Portfolio {
  positions: Position[];
  nfts: NftHolding[];
  /** Three slots; null is empty. */
  relics: (RelicSlot | null)[];
}

export type SideId = 'A' | 'B';
export type Archetype = 'degen' | 'whale' | 'stable-maxi' | 'yield-farmer' | 'balanced';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface SideState {
  id: SideId;
  portfolio: Portfolio;
  keepHp: number;
  keepHpMax: number;
  buildingsOwned: string[];
  isNpc: boolean;
  npc?: { archetype: Archetype; difficulty: Difficulty };
  /** Has this side ended its Trade phase. */
  tradeDone: boolean;
  /** Net portfolio value at the start of the last Market phase (for Momentum). */
  valueBeforeMarket: number;
  /** Liquidations since the last battle: the seized collateral's squads detonate at the next one. */
  liquidations: Liquidation[];
  /** Emergency Shutdown already used this match. */
  shutdownUsed: boolean;
}

export interface Liquidation {
  round: number;
  /** Which daily candle of the week (0–6). */
  day: number;
  protocol: ProtocolFn;
  repaid: number;
  seized: { asset: AssetId; qty: bigint; value: number }[];
}

export type Phase = 'market' | 'trade' | 'battle' | 'siege' | 'ended';

/** One day's prices: open and close per asset. */
export interface Candle {
  day: number;
  open: Record<AssetId, number>;
  close: Record<AssetId, number>;
}

/** An event that fires in a Market phase, with what it picked. */
export interface MarketEvent {
  id: EventId;
  /** Depeg's stablecoin, Rug Pull's token. */
  target?: AssetId;
  /** Black Swan's drop. */
  size?: number;
}

/** A shock still running from an earlier round (Meme Mania's fall, a Depeg's recovery). */
export interface Aftermath {
  id: 'meme-fall' | 'depeg-recover';
  target?: AssetId;
  /** Rounds it still applies to (meme-fall), or the depeg's remaining gap. */
  value: number;
}

export interface MarketState {
  regime: Regime;
  prices: Record<AssetId, number>;
  /** The event drawn for the next Market phase (null: none), decided a round early so its rumor can be shown. */
  next: MarketEvent | null;
  /** What the Trade phase's rumor says about it (null: "calm"). */
  rumor: EventId | null;
  /** This round's event (null: none). */
  current: MarketEvent | null;
  aftermath: Aftermath[];
  /** NFT collections' floors, in dollars (they move with the sim: relic tiers follow). */
  nftFloors: Record<string, number>;
  /** The last Market phase's candles. */
  candles: Candle[];
  /** Gas multiplier for this round's Trade phase. */
  gasMult: number;
}

export interface MatchConfig {
  /** Total value cap in dollars. */
  matchCap: number;
}

export interface MatchState {
  seed: string;
  configVersion: string;
  round: number;
  phase: Phase;
  unitValue: number;
  /** Assets an imported wallet brought that the data files lack. */
  customAssets: Asset[];
  market: MarketState;
  sides: [SideState, SideState];
  /** Momentum's side for this round's battle (null: none). */
  momentum: SideId | null;
  suddenDeath: boolean;
  winner: SideId | 'draw' | null;
  /** The last battle's result. */
  lastBattle: BattleResult | null;
}

type Qty = bigint;
export type Command =
  | { t: 'swap'; from: AssetId; to: AssetId; qty: Qty }
  | { t: 'stake' | 'unstake' | 'restake'; asset: AssetId; qty: Qty }
  | { t: 'lpAdd' | 'lpRemove'; a: AssetId; b: AssetId; qty: Qty }
  | { t: 'supply' | 'withdraw' | 'borrow' | 'repay'; asset: AssetId; qty: Qty; via?: 'lending' | 'vault' }
  | { t: 'slotRelic'; nft: string; slot: 0 | 1 | 2 }
  | { t: 'endTrade' };

/** A command in the log: who sent it in which round. */
export interface LoggedCommand {
  round: number;
  side: SideId;
  cmd: Command;
}

/** A squad: one asset's units of one type. */
export interface Squad {
  asset: AssetId;
  unit: UnitTypeId;
  count: number;
  /** Multipliers of the rendered entities (a stack of ×N is one entity); sums to count. */
  stacks: number[];
  /** Spawned from collateral seized in a liquidation: detonates at 3 s. */
  detonates?: boolean;
}

export interface Army {
  side: SideId;
  squads: Squad[];
  /** ATK multiplier for the whole army (Momentum, buffs). */
  atkMult: number;
}

export interface BattleResult {
  /** Surviving units per side, per squad (same order as the armies). */
  survivors: [Squad[], Squad[]];
  /** Seconds the battle lasted. */
  seconds: number;
}
