/**
 * Ledger Wars in plain words: what each unit is for, what each building
 * does, and the ideas a new player meets (the campaign's cards, the help's
 * Units tab). The numbers come from the rules, so the words never go stale.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { Role, UnitTypeId } from '../../game/core/types.js';
import { BUILDINGS, RULES, TOKENS, TRAIN, type BuildingKind } from './rules.js';
import { ECON } from '../core/economy.js';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const ROLE_NOTES: Readonly<Record<Role, { name: string; icon: string; note: string }>> = {
  melee: { name: 'Melee', icon: '🗡', note: 'Fights up close. Beats cavalry; loses to archers and mages.' },
  cavalry: { name: 'Cavalry', icon: '🐎', note: 'Fast riders. Beats ranged units; loses to melee.' },
  ranged: { name: 'Ranged', icon: '🏹', note: 'Strikes from afar. Beats melee; loses to cavalry. Keep it behind your front line.' },
  swarm: { name: 'Swarm', icon: '🐸', note: 'Cheap and quick, many at a time. Area attacks (Battle Mages) hurt swarms more.' },
  support: { name: 'Support', icon: '✨', note: 'Helps the army round it more than it fights.' },
  siege: { name: 'Siege', icon: '🪨', note: 'Slow, and weak against units, but it smashes buildings.' },
};

const ABILITY: Readonly<Record<string, string>> = {
  'heal-adjacent': 'Heals friends standing next to it.',
  'reveal-crit': 'One arrow in four hits double.',
  'pack-bonus': 'Hits harder in a big pack (+1 attack for every 10 friends close by, up to +2).',
  'death-burst': 'Bursts as it dies, hurting whoever killed it.',
  'swap-enemies': 'Every 8 s it swaps two enemies’ places, breaking their line.',
  charge: 'Its first strike hits double: lead with it.',
  'start-shield': 'Starts each fight behind a 10-point shield.',
  'drain-atk': 'Weakens what it hits: 20% less attack.',
  taunt: 'Enemies close by must attack it first: put it in front.',
  'buff-atk': 'Friends close by hit 10% harder.',
  'small-area': 'Its blasts splash onto the enemies round the target: deadly against swarms.',
  hardened: 'Takes 30% less damage.',
};

/** Each unit's job in a line (its role and ability say the rest). */
const UNIT_LINE: Readonly<Record<string, string>> = {
  militia: 'Cheap foot soldiers from the hall: the first defence.',
  knight: 'Sturdy foot soldiers: the backbone of an early army.',
  'paladin.eth': 'Heavy foot soldiers paid in ETH that keep each other standing.',
  'rider.name': 'Very fast riders paid in ENS, for raids and for running down archers.',
  'archer.scout': 'Cheap archers: let the knights hold the line while they shoot.',
  'archer.oracle': 'Better archers paid in LINK, with lucky shots.',
  'swarm.goblin': 'A cheap mob, quick to train, paid in USDC.',
  'pack.shiba': 'A cheap pack paid in SHIB; the more of them, the harder they bite.',
  'swarm.frog': 'A cheap swarm paid in PEPE that punishes whoever kills it.',
  'mage.swap': 'A mage paid in UNI that scrambles the enemy’s line.',
  'lancer.lido': 'Fast lancers paid in LDO: charge the enemy’s archers.',
  'paladin.staked': 'Heavy foot soldiers paid in stETH, shielded as a fight begins.',
  'lender.ghost': 'A ghost paid in AAVE that saps the strength of what it touches.',
  'warden.vault': 'A wall of a unit paid in MKR: it soaks up the blows meant for others.',
  construct: 'A machine that makes the soldiers round it hit harder.',
  'mage.battle': 'A mage whose blasts hit everything round the target.',
  'golem.stone': 'A walking siege engine: slow, tough, and it tears down buildings.',
  'titan.bitcoin': 'The heaviest unit, paid in WBTC: hard to hurt and ruinous to buildings.',
};

export interface UnitNote {
  name: string;
  role: Role;
  line: string;
  ability: string | null;
  token: string;
  usd: number;
  where: string;
  stats: string;
}

export function unitNote(id: UnitTypeId): UnitNote {
  const u = UNIT_TYPES[id]!;
  const rule = TRAIN.find((t) => t.unit === id)!;
  return {
    name: u.name,
    role: u.role,
    line: UNIT_LINE[id] ?? '',
    ability: u.ability ? (ABILITY[u.ability] ?? null) : null,
    token: TOKENS[rule.token].symbol,
    usd: RULES.unitValue * u.costMult,
    where: `${BUILDINGS[rule.at].name}${rule.level > 1 ? ` at level ${rule.level}` : ''}`,
    stats: `${u.hp * 2} HP · ${u.atk} attack · ${u.range > 1.5 ? `range ${u.range}` : 'melee reach'} · ${u.speed >= 1.5 ? 'fast' : u.speed < 0.8 ? 'slow' : 'steady'}`,
  };
}

/** Each building's job, in more words than the build menu's blurb. */
const BUILDING_LINE: Readonly<Record<BuildingKind, string>> = {
  hall: 'Your seat: it builds every other building and trains Militia, and its arrows hit anything close. Lose it and you lose. Its level caps every other building’s.',
  exchange: 'Uniswap. Swap any token for any other (units each want their own token), and put two tokens into a pool that earns fees.',
  staking: 'Lido. Stake ETH and it grows, paid as stETH.',
  restaking: 'EigenLayer. Restake stETH for the best yield in the game.',
  bank: 'Aave. Supply tokens to earn a little and to borrow against them.',
  vault: 'Maker. Lock ETH and take DAI against it.',
  barracks: 'Trains foot soldiers.',
  archery: 'Trains archers.',
  memepit: 'Trains swarms: cheap units that come in numbers.',
  workshop: 'Trains machines and mages.',
  bridgeworks: 'Trains siege units, the building breakers.',
};

export interface BuildingNote {
  name: string;
  line: string;
  cost: string;
  needs: string;
  trains: string;
}

export function buildingNote(kind: BuildingKind): BuildingNote {
  const r = BUILDINGS[kind];
  const needs = [r.hallLevel > 1 ? `the hall at level ${r.hallLevel}` : '', ...r.needs.map((n) => `a ${BUILDINGS[n].name}`)].filter(Boolean);
  const trains = TRAIN.filter((t) => t.at === kind).map((t) => `${UNIT_TYPES[t.unit]!.name}${t.level > 1 ? ` (level ${t.level})` : ''}`);
  return {
    name: r.name,
    line: BUILDING_LINE[kind],
    cost: kind === 'hall' ? 'You start with it' : `$${r.cost.toLocaleString('en-US')} · ${r.time} s to build`,
    needs: needs.length ? `Needs ${needs.join(' and ')}` : '',
    trains: trains.length ? `Trains ${trains.join(', ')}` : '',
  };
}

export type Concept = 'controls' | 'build' | 'triangle' | 'positions' | 'tokens' | 'market' | 'levels' | 'swarms' | 'borrow' | 'siege';

export const CONCEPTS: Readonly<Record<Concept, { icon: string; title: string; text: string }>> = {
  controls: { icon: '🖱', title: 'Commanding', text: 'Left-click selects; drag a box round your units. Right-click the ground to move, or an enemy to attack it. The arrow keys or the arrow strips at the screen’s edges move the view; the wheel zooms.' },
  build: { icon: '🏗', title: 'Building', text: 'Pick a building in the Build menu: the hall pays for it (in stablecoins, then ETH) and builds it. When it is ready, press Place and click the ground near your other buildings.' },
  triangle: { icon: '🔺', title: 'The counter triangle', text: 'Ranged beats Melee, Melee beats Cavalry, Cavalry beats Ranged: +50% damage. Bring the right units, and keep your archers behind your knights.' },
  positions: { icon: '📈', title: 'Positions earn, tokens don’t', text: `Tokens in your wallet earn nothing. Put them to work in positions (a pool, a stake…) and they earn every second, more at higher building levels. To spend what they earn, take it back out.` },
  tokens: { icon: '🪙', title: 'Units cost their own token', text: 'Militia, Knights and Scout Archers cost USDC; most others want a token of their own (Lancers LDO, Paladins ETH, Titans WBTC). Swap for it at the Exchange.' },
  market: { icon: '🐂', title: 'Prices move', text: `The market moves all match: a bull, crab or bear regime, a new game day every ${RULES.daySeconds} s. What you hold rises and falls with it; stablecoins hold still.` },
  levels: { icon: '⬆', title: 'Levels', text: 'Select a building and press ⬆ to raise its level: more HP, more yield, and better units. No building may be above your wallet hall, so raise the hall first.' },
  swarms: { icon: '🐸', title: 'Swarms', text: 'Swarm units are cheap and quick to train: many bodies for little money. Area attacks tear through them, so mix them with sturdier units.' },
  borrow: { icon: '🏦', title: 'Borrowing and health', text: `Supplied tokens back a loan of up to ${pct(ECON.ltv)} of their worth. The loan grows a little each minute. If prices fall and the health drops under 1, part of your collateral is sold to repay it, with a ${pct(ECON.penalty)} penalty. Keep the health well above 1.` },
  siege: { icon: '🪨', title: 'Siege', text: 'Siege units are slow and do little to other units, but each blow takes a big bite out of a building. Escort them to the enemy hall.' },
};
