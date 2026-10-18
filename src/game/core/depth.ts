/**
 * The depth systems (spec: "Protocols", "NFTs as relics"): the battle
 * abilities a side's protocol positions grant, the battlefield buildings and
 * their buffs, and the relics its NFTs give. Pure: the ArmyBuilder, the
 * BattleSim and the MatchController read these.
 */

import { hashString } from '../../util/rng.js';
import relicsJson from '../data/relics.json';
import type { ProtocolFn, Regime, Role, SideState } from './types.js';

// ---------- protocol abilities ----------

/** Battle abilities, owned by the side (not a unit), auto-cast. */
export type Ability = 'validator-shield' | 'slashing-guard' | 'flash-swap' | 'flash-loan';

export const ABILITY_NAME: Record<Ability | 'emergency-shutdown', string> = {
  'validator-shield': 'Validator Shield',
  'slashing-guard': 'Slashing Guard',
  'flash-swap': 'Flash Swap',
  'flash-loan': 'Flash Loan',
  'emergency-shutdown': 'Emergency Shutdown',
};

/**
 * An ability's name for a side: the curated protocol's (spec: "Curated
 * protocols reskin the building and rename the ability") when the side holds
 * the position there, else a generic one for the function.
 */
const CURATED_VENUE: Record<Ability | 'emergency-shutdown', string[]> = {
  'validator-shield': ['lido'],
  'slashing-guard': ['eigenlayer'],
  'flash-swap': ['uniswap'],
  'flash-loan': ['aave'],
  'emergency-shutdown': ['maker', 'sky'],
};
const GENERIC_NAME: Record<Ability | 'emergency-shutdown', string> = {
  'validator-shield': 'Stake Shield',
  'slashing-guard': 'Restake Guard',
  'flash-swap': 'Pool Swap',
  'flash-loan': 'Quick Loan',
  'emergency-shutdown': 'Vault Lockdown',
};
const ABILITY_FN: Record<Ability | 'emergency-shutdown', (p: SideState['portfolio']['positions'][number]) => boolean> = {
  'validator-shield': (p) => p.kind === 'staked',
  'slashing-guard': (p) => p.kind === 'restaked',
  'flash-swap': (p) => p.kind === 'lp',
  'flash-loan': (p) => p.kind === 'supplied' && p.protocol === 'lending',
  'emergency-shutdown': (p) => p.protocol === 'vault',
};

export function abilityName(side: SideState, ability: Ability | 'emergency-shutdown'): string {
  const curated = side.portfolio.positions.some((p) => ABILITY_FN[ability](p) && p.venue !== undefined && CURATED_VENUE[ability].includes(p.venue));
  return curated ? ABILITY_NAME[ability] : GENERIC_NAME[ability];
}

/** The curated venue for a protocol function, where the game puts a position nobody named (templates, the editor). */
export const DEFAULT_VENUE: Record<string, string> = { staked: 'lido', restaked: 'eigenlayer', lp: 'uniswap', lending: 'aave', vault: 'maker' };

/** Which protocol functions a side has a position in. */
export function functionsHeld(side: SideState): Set<ProtocolFn> {
  const out = new Set<ProtocolFn>();
  for (const p of side.portfolio.positions) {
    if (p.kind === 'staked') out.add('staking');
    if (p.kind === 'restaked') out.add('restaking');
    if (p.kind === 'lp') out.add('dex');
    if ((p.kind === 'supplied' || p.kind === 'borrowed') && p.protocol) out.add(p.protocol);
  }
  return out;
}

/** The battle abilities a side's positions grant (Borrowing's is the bigger army; the Vault's is the Siege phase's). */
export function abilitiesOf(side: SideState): Ability[] {
  const fns = functionsHeld(side);
  const out: Ability[] = [];
  if (fns.has('staking')) out.push('validator-shield');
  if (fns.has('restaking')) out.push('slashing-guard');
  if (fns.has('dex')) out.push('flash-swap');
  if (side.portfolio.positions.some((p) => p.kind === 'supplied' && p.protocol === 'lending')) out.push('flash-loan');
  return out;
}

/** Whether a side may call the Emergency Shutdown (a stable vault position, once per match). */
export function canShutdown(side: SideState): boolean {
  return !side.shutdownUsed && side.portfolio.positions.some((p) => p.protocol === 'vault');
}

// ---------- battlefield buildings ----------

export type BuildingKind = 'bank' | 'exchange' | 'temple' | 'vault' | 'oracle';

export const BUILDING_NAME: Record<BuildingKind, string> = { bank: 'Bank', exchange: 'Exchange', temple: 'Temple', vault: 'Vault', oracle: 'Oracle Tower' };

/** The protocol function that gives home advantage at a building (none at the Oracle Tower). */
export const HOME_FN: Record<BuildingKind, ProtocolFn | null> = { bank: 'lending', exchange: 'dex', temple: 'staking', vault: 'vault', oracle: null };

export const BUILDING_BUFF: Record<BuildingKind, string> = {
  bank: '+10% ATK',
  exchange: '+20% move speed',
  temple: 'Heals 1 HP/s nearby',
  vault: '+5% keep HP max (at the round’s end)',
  oracle: '+1 range for Ranged units',
};

/** A side's home advantage at a building: it holds a position in that protocol. */
export function homeAt(side: SideState, kind: BuildingKind): boolean {
  const fn = HOME_FN[kind];
  if (!fn) return false;
  const fns = functionsHeld(side);
  return fns.has(fn) || (fn === 'staking' && fns.has('restaking'));
}

// ---------- relics ----------

interface RelicDef {
  name: string;
  effect: 'siege' | 'swarm-hp' | 'ranged-range' | 'bull-atk' | 'bear-hp' | 'keep-max' | 'gas' | 'liq-eye' | 'early-speed';
  value: number;
  text: string;
}

const RELICS = relicsJson.relics as Record<string, RelicDef>;
const CURATED = relicsJson.curated as Record<string, string>;
const GENERIC = relicsJson.generic;
const TIERS = relicsJson.tiers as { id: string; name: string; below: number | null; mult: number }[];

export interface Relic {
  id: string;
  name: string;
  effect: RelicDef['effect'];
  tier: string;
  tierName: string;
  mult: number;
  /** The effect at this tier (value × the tier's multiplier). */
  amount: number;
  text: string;
}

/** The relic a collection gives: its curated one, else one from the generic pool by hashing its id (always the same). */
export function relicId(collection: string): string {
  const id = collection.toLowerCase();
  return CURATED[id] ?? CURATED[collection] ?? GENERIC[hashString(id) % GENERIC.length]!;
}

/** A collection's relic at its floor today (the tier moves with the floor). */
export function relicOf(collection: string, floor: number, unitValue: number): Relic {
  const id = relicId(collection);
  const def = RELICS[id]!;
  const ratio = floor / unitValue;
  const tier = TIERS.find((t) => t.below === null || ratio < t.below) ?? TIERS[TIERS.length - 1]!;
  const amount = def.value * tier.mult;
  const text = def.text
    .replace('{v}', String(Math.round(amount * 10) / 10))
    .replace('{p}', `${Math.round(amount * 100)}%`)
    .replace('{pts}', String(Math.round(amount * 100)));
  return { id, name: def.name, effect: def.effect, tier: tier.id, tierName: tier.name, mult: tier.mult, amount, text };
}

/** The relics a side has slotted, at today's floors. */
export function slottedRelics(side: SideState, floors: Readonly<Record<string, number>>, unitValue: number): Relic[] {
  return side.portfolio.relics.flatMap((r) => {
    if (!r) return [];
    const nft = side.portfolio.nfts.find((n) => n.collection === r.nft);
    if (!nft) return [];
    return [relicOf(nft.collection, floors[nft.collection] ?? nft.floor, unitValue)];
  });
}

/** What a side's relics (and abilities that work at spawn) do to its army in a battle. */
export interface ArmyMods {
  /** HP multipliers by role, and for staked units. */
  hp: Partial<Record<Role, number>>;
  stakedHp: number;
  atk: number;
  /** Range added for Ranged units; Siege added to every unit. */
  rangedRange: number;
  siege: number;
  /** Speed multiplier for the first 10 s. */
  earlySpeed: number;
  abilities: Ability[];
}

export function armyMods(side: SideState, relics: readonly Relic[], regime: Regime): ArmyMods {
  const mods: ArmyMods = { hp: {}, stakedHp: 1, atk: 1, rangedRange: 0, siege: 0, earlySpeed: 1, abilities: abilitiesOf(side) };
  const allHp = (f: number) => {
    for (const r of ['melee', 'ranged', 'cavalry', 'swarm', 'siege', 'support'] as const) mods.hp[r] = (mods.hp[r] ?? 1) * f;
  };
  for (const r of relics) {
    if (r.effect === 'siege') mods.siege += r.amount;
    if (r.effect === 'swarm-hp') mods.hp.swarm = (mods.hp.swarm ?? 1) * (1 + r.amount);
    if (r.effect === 'ranged-range') mods.rangedRange += r.amount;
    if (r.effect === 'bull-atk' && regime === 'bull') mods.atk *= 1 + r.amount;
    if (r.effect === 'bear-hp' && regime === 'bear') allHp(1 + r.amount);
    if (r.effect === 'early-speed') mods.earlySpeed *= 1 + r.amount;
  }
  if (mods.abilities.includes('slashing-guard')) mods.stakedHp *= 1.15;
  return mods;
}

/** A relic effect's total for a side (gas, keep max, the Liquidator's Eye). */
export function relicTotal(relics: readonly Relic[], effect: RelicDef['effect']): number {
  return relics.filter((r) => r.effect === effect).reduce((s, r) => s + r.amount, 0);
}
