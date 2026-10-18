/**
 * Ledger Wars' rules: the tokens, the buildings, the units, the economy's
 * numbers (docs/rts/PLAN.md). Everything the simulation reads lives here, so
 * balancing is one file.
 */

import type { UnitTypeId } from '../../game/core/types.js';

export type PlayerId = 'A' | 'B';

/** The tokens of the match: opening price, price class (the Siege market's classes) and what follows what. */
export const TOKENS = {
  usdc: { symbol: 'USDC', price: 1, cls: 'stable' },
  dai: { symbol: 'DAI', price: 1, cls: 'stable' },
  eth: { symbol: 'ETH', price: 3000, cls: 'eth' },
  steth: { symbol: 'stETH', price: 3000, cls: 'eth', follows: 'eth' },
  wbtc: { symbol: 'WBTC', price: 60000, cls: 'btc' },
  link: { symbol: 'LINK', price: 15, cls: 'largecap' },
  uni: { symbol: 'UNI', price: 8, cls: 'defi' },
  ldo: { symbol: 'LDO', price: 2, cls: 'defi' },
  aave: { symbol: 'AAVE', price: 100, cls: 'defi' },
  mkr: { symbol: 'MKR', price: 2000, cls: 'defi' },
  ens: { symbol: 'ENS', price: 20, cls: 'largecap' },
  shib: { symbol: 'SHIB', price: 0.00002, cls: 'meme' },
  pepe: { symbol: 'PEPE', price: 0.00001, cls: 'meme' },
} as const satisfies Record<string, { symbol: string; price: number; cls: string; follows?: string }>;

export type TokenId = keyof typeof TOKENS;
export const TOKEN_IDS = Object.keys(TOKENS) as TokenId[];
export const STABLES: readonly TokenId[] = ['usdc', 'dai'];

export type BuildingKind = 'hall' | 'exchange' | 'staking' | 'restaking' | 'bank' | 'vault' | 'barracks' | 'archery' | 'memepit' | 'bridgeworks' | 'workshop';

export interface BuildingRule {
  name: string;
  /** What the building does, for the build menu. */
  blurb: string;
  /** The model by level (1-based; the last repeats), and the tier parts shown (`tier.2/4/6`). */
  models: readonly string[];
  /** Side of its square footprint, in metres (cells). */
  footprint: number;
  /** Dollars to build, and to raise it to each next level. */
  cost: number;
  upgrade: readonly number[];
  /** Seconds to build, and to upgrade (each level). */
  time: number;
  upgradeTime: number;
  hp: number;
  /** HP gained per level. */
  hpPerLevel: number;
  maxLevel: number;
  /** The wallet hall's level it needs to be built. */
  hallLevel: number;
  /** Other buildings it needs (one of each, finished). */
  needs: readonly BuildingKind[];
}

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingRule>> = {
  hall: { name: 'Wallet Hall', blurb: 'Your seat. Builds every other building; trains Militia.', models: ['castle.hall.wallet.t0', 'castle.hall.wallet.t2', 'castle.hall.wallet.t4', 'castle.hall.wallet.t6'], footprint: 6, cost: 0, upgrade: [1500, 3000, 6000], time: 0, upgradeTime: 40, hp: 3000, hpPerLevel: 750, maxLevel: 4, hallLevel: 0, needs: [] },
  exchange: { name: 'Exchange', blurb: 'Uniswap: swap tokens, and pools that earn fees. Trains Swap Mages (UNI).', models: ['building.protocol.uniswap'], footprint: 5, cost: 800, upgrade: [1200, 2400], time: 20, upgradeTime: 25, hp: 1000, hpPerLevel: 300, maxLevel: 3, hallLevel: 1, needs: [] },
  staking: { name: 'Staking House', blurb: 'Lido: stake ETH for stETH that grows. Trains Lido Lancers (LDO), then Staked Paladins (stETH).', models: ['building.protocol.lido'], footprint: 5, cost: 800, upgrade: [1200, 2400], time: 20, upgradeTime: 25, hp: 1000, hpPerLevel: 300, maxLevel: 3, hallLevel: 1, needs: [] },
  restaking: { name: 'Restaking Hall', blurb: 'EigenLayer: restake stETH for more yield.', models: ['building.protocol.eigenlayer'], footprint: 5, cost: 1500, upgrade: [2000], time: 30, upgradeTime: 30, hp: 1000, hpPerLevel: 300, maxLevel: 2, hallLevel: 2, needs: ['staking'] },
  bank: { name: 'Bank', blurb: 'Aave: supply to earn and to borrow against. Leverage, and liquidation under health 1. Trains Ghost Lenders (AAVE).', models: ['building.protocol.aave'], footprint: 5, cost: 1200, upgrade: [1500, 3000], time: 25, upgradeTime: 25, hp: 1000, hpPerLevel: 300, maxLevel: 3, hallLevel: 1, needs: [] },
  vault: { name: 'Vault', blurb: 'Maker: mint DAI against ETH. Trains Vault Wardens (MKR).', models: ['building.protocol.maker'], footprint: 5, cost: 1500, upgrade: [2000], time: 30, upgradeTime: 30, hp: 1400, hpPerLevel: 400, maxLevel: 2, hallLevel: 2, needs: ['bank'] },
  barracks: { name: 'Barracks', blurb: 'Knights (USDC), then Ether Paladins (ETH) and Name Riders (ENS).', models: ['building.category.governance.s', 'building.category.governance.m', 'building.category.governance.m'], footprint: 5, cost: 600, upgrade: [900, 1800], time: 15, upgradeTime: 20, hp: 1200, hpPerLevel: 400, maxLevel: 3, hallLevel: 1, needs: [] },
  archery: { name: 'Archery', blurb: 'Scout Archers (USDC), then Oracle Archers (LINK).', models: ['building.category.other.s', 'building.category.other.m', 'building.category.other.m'], footprint: 5, cost: 700, upgrade: [1000, 2000], time: 18, upgradeTime: 20, hp: 1000, hpPerLevel: 300, maxLevel: 3, hallLevel: 1, needs: [] },
  memepit: { name: 'Meme Pit', blurb: 'Swarms: Goblins (USDC), Shiba Packs (SHIB), Frog Swarms (PEPE).', models: ['building.category.nft.s', 'building.category.nft.m'], footprint: 5, cost: 600, upgrade: [1200], time: 15, upgradeTime: 20, hp: 900, hpPerLevel: 300, maxLevel: 2, hallLevel: 1, needs: [] },
  workshop: { name: 'Workshop', blurb: 'Constructs and Battle Mages (USDC).', models: ['building.category.dex.s', 'building.category.dex.m'], footprint: 5, cost: 1500, upgrade: [2000], time: 30, upgradeTime: 30, hp: 1200, hpPerLevel: 400, maxLevel: 2, hallLevel: 2, needs: ['barracks'] },
  bridgeworks: { name: 'Bridge Works', blurb: 'Stone Golems (USDC), then Bitcoin Titans (WBTC).', models: ['building.category.bridge.m', 'building.category.bridge.l'], footprint: 6, cost: 2000, upgrade: [3000], time: 35, upgradeTime: 35, hp: 1600, hpPerLevel: 500, maxLevel: 2, hallLevel: 3, needs: ['barracks'] },
};

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];

export interface TrainRule {
  unit: UnitTypeId;
  /** The building and its level that trains it. */
  at: BuildingKind;
  level: number;
  /** The token it costs (its dollar cost is `UNIT_VALUE × the unit's costMult`, paid in this token at its price). */
  token: TokenId;
  /** Seconds to train. */
  time: number;
}

export const TRAIN: readonly TrainRule[] = [
  { unit: 'militia', at: 'hall', level: 1, token: 'usdc', time: 6 },
  { unit: 'knight', at: 'barracks', level: 1, token: 'usdc', time: 9 },
  { unit: 'paladin.eth', at: 'barracks', level: 2, token: 'eth', time: 12 },
  { unit: 'rider.name', at: 'barracks', level: 3, token: 'ens', time: 10 },
  { unit: 'archer.scout', at: 'archery', level: 1, token: 'usdc', time: 8 },
  { unit: 'archer.oracle', at: 'archery', level: 2, token: 'link', time: 10 },
  { unit: 'swarm.goblin', at: 'memepit', level: 1, token: 'usdc', time: 4 },
  { unit: 'pack.shiba', at: 'memepit', level: 1, token: 'shib', time: 4 },
  { unit: 'swarm.frog', at: 'memepit', level: 2, token: 'pepe', time: 4 },
  { unit: 'mage.swap', at: 'exchange', level: 2, token: 'uni', time: 12 },
  { unit: 'lancer.lido', at: 'staking', level: 1, token: 'ldo', time: 10 },
  { unit: 'paladin.staked', at: 'staking', level: 2, token: 'steth', time: 12 },
  { unit: 'lender.ghost', at: 'bank', level: 2, token: 'aave', time: 12 },
  { unit: 'warden.vault', at: 'vault', level: 1, token: 'mkr', time: 14 },
  { unit: 'construct', at: 'workshop', level: 1, token: 'usdc', time: 12 },
  { unit: 'mage.battle', at: 'workshop', level: 2, token: 'usdc', time: 12 },
  { unit: 'golem.stone', at: 'bridgeworks', level: 1, token: 'usdc', time: 18 },
  { unit: 'titan.bitcoin', at: 'bridgeworks', level: 2, token: 'wbtc', time: 22 },
];

export const RULES = {
  /** Ticks a second. */
  tickHz: 20,
  /** The map: a square this many metres a side, centred on 0. */
  mapSize: 160,
  /** Where each side starts (its hall). */
  start: { A: { x: 0, z: 62 }, B: { x: 0, z: -62 } } as Record<PlayerId, { x: number; z: number }>,
  /** Dollars each side starts with. */
  startUsd: 10000,
  /** A new building goes within this many metres of one of yours (centre to centre). */
  buildRadius: 20,
  /** A unit's dollar cost: this × its costMult. */
  unitValue: 100,
  /** Prices step this often (s), with a game day's moves spread over this many seconds. */
  priceStep: 1,
  daySeconds: 20,
  /** Units a player may have (alive and in training), and a building's queue. */
  unitCap: 150,
  queueMax: 5,
  /** How much of a building's cost comes back when a build is cancelled. */
  refund: 1,
} as const;

export type StartKit = 'usdc' | 'eth' | 'mix';

/** What each side starts with, by the kit chosen (dollars per token at the opening prices). */
export const START_KITS: Readonly<Record<StartKit, { name: string; dollars: Partial<Record<TokenId, number>> }>> = {
  usdc: { name: '$10,000 in USDC', dollars: { usdc: 10000 } },
  eth: { name: '$10,000 in ETH', dollars: { eth: 10000 } },
  mix: { name: 'A basic mix', dollars: { usdc: 4000, eth: 4000, link: 1000, uni: 1000 } },
};

/** A building's name with its article ("an Exchange", "a Bank"). */
export function aName(kind: BuildingKind): string {
  const n = BUILDINGS[kind].name;
  return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;
}
