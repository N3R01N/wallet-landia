/**
 * The guide's words (ui/guide.ts): what each unit, role, ability, building,
 * holding and market event does, and how to get them. The numbers come from
 * the game's own data and balance, so the guide says what the game does.
 */

import { BALANCE } from '../config/balance.js';
import { CAPTURE_SECONDS, CAPTURE_UNITS, LOAN_AT, LOAN_FOR, SHIELD_AT, SWAP_EVERY } from '../core/battle.js';
import { BASE_ASSETS, UNIT_FALLBACK, UNIT_TYPES } from '../core/catalog.js';
import { BEATS } from '../core/quickBattle.js';
import type { Ability } from '../core/depth.js';
import type { Category, EventId, Role, UnitTypeId } from '../core/types.js';
import eventsJson from './events.json';
import relicsJson from './relics.json';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const BT = BALANCE.battle;
const L = BALANCE.ledger;
const K = BALANCE.keep;

export const ROLES: readonly Role[] = ['melee', 'cavalry', 'ranged', 'swarm', 'support', 'siege'];

export const ROLE_TEXT: Record<Role, { name: string; icon: string; text: string }> = {
  melee: { name: 'Melee', icon: '🛡', text: 'The front line: sturdy, fights up close.' },
  cavalry: { name: 'Cavalry', icon: '🐎', text: 'Fast riders that dive past the line onto the archers and mages.' },
  ranged: { name: 'Ranged', icon: '🏹', text: 'Archers and mages: hit from a distance, fragile up close.' },
  swarm: { name: 'Swarm', icon: '🐸', text: 'Cheap, many and weak. Spells that hit an area tear through them.' },
  support: { name: 'Support', icon: '✨', text: 'Helps the units around it more than it fights.' },
  siege: {
    name: 'Siege',
    icon: '🪨',
    text: `Slow and huge: only half damage against units, but ${K.siegeRoleMult}× its Siege against the keep when it gets there.`,
  },
};

/** Who a role beats and who beats it (the counter triangle: +50% damage). */
export function counters(role: Role): { beats: Role | null; beatenBy: Role | null } {
  const beatenBy = (Object.entries(BEATS) as [Role, Role][]).find(([, d]) => d === role)?.[0] ?? null;
  return { beats: BEATS[role] ?? null, beatenBy };
}

export const UNIT_ABILITY_TEXT: Record<string, { name: string; text: string }> = {
  hardened: { name: 'Hardened', text: 'Takes 30% less damage from every hit.' },
  'heal-adjacent': { name: 'Healing aura', text: `Heals the allies beside it ${BT.paladinHeal} HP a second.` },
  'start-shield': { name: 'Staked shield', text: 'Starts every battle with a 10 HP shield.' },
  charge: { name: 'Charge', text: 'Its first hit in a battle deals double damage.' },
  'reveal-crit': { name: 'Oracle sight', text: 'A 25% chance on every shot to hit for double.' },
  'swap-enemies': { name: 'Swap', text: 'Every 8 s it swaps the places of two enemies nearby, breaking their line.' },
  'drain-atk': { name: 'Drain', text: 'Its hits weaken the target: 20% less attack.' },
  taunt: { name: 'Taunt', text: 'Enemies nearby must attack it first.' },
  'pack-bonus': { name: 'Pack', text: '+1 attack for every 10 of its pack close by.' },
  'death-burst': { name: 'Death burst', text: 'Bursts when it dies, hurting its killer. Counts as an area attack against Swarms.' },
  'small-area': { name: 'Blast', text: `Each spell splashes half damage onto enemies round the target; +${pct(BT.swarmAreaBonus)} against Swarms.` },
  'buff-atk': { name: 'War engine', text: 'Allies near it hit 10% harder.' },
};

/** What fields a unit: the tokens curated for it, and the categories whose other tokens fall back to it. */
export function unitSources(id: UnitTypeId): { tokens: string[]; categories: Category[] } {
  const tokens = BASE_ASSETS.filter((a) => a.curatedUnit === id).map((a) => a.symbol);
  const categories = (Object.entries(UNIT_FALLBACK) as [Category, UnitTypeId][]).filter(([, u]) => u === id).map(([c]) => c);
  return { tokens, categories };
}

export const CATEGORY_TEXT: Record<Category, string> = {
  native: 'ETH',
  lst: 'liquid staking tokens',
  btc: 'bitcoin tokens',
  stable: 'stablecoins',
  largecap: 'other large-cap tokens',
  'defi-gov': 'other DeFi governance tokens',
  infra: 'other infrastructure tokens',
  meme: 'other memecoins',
  rwa: 'real-world-asset tokens',
  'ai-gaming': 'AI and gaming tokens',
  misc: 'any other token',
};

/** Example tokens of a fallback category (in the game's list, with no unit of their own). */
export function categoryExamples(c: Category): string[] {
  return BASE_ASSETS.filter((a) => a.category === c && !a.curatedUnit && !a.isStable).map((a) => a.symbol);
}

/** The units in the order the guide shows them: by role, then by name. */
export function unitsByRole(): UnitTypeId[] {
  return Object.values(UNIT_TYPES)
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name))
    .map((u) => u.id);
}

export const SIDE_ABILITY_TEXT: Record<Ability | 'emergency-shutdown', { from: string; text: string }> = {
  'validator-shield': { from: 'Staked ETH (Lido)', text: `At ${SHIELD_AT} s every melee unit of yours gets a ${BT.validatorShield} HP shield.` },
  'slashing-guard': { from: 'Restaked ETH (EigenLayer)', text: 'Your staked units get 15% more HP. The Slashing event burns part of restaked positions.' },
  'flash-swap': { from: 'A pool position (Uniswap)', text: `Every ${SWAP_EVERY} s your weakest squad and your strongest trade places on the field.` },
  'flash-loan': { from: 'Supplying on a lending protocol (Aave)', text: `At ${LOAN_AT} s, ${pct(BT.flashLoanShare)} of your largest squad joins the fight as a reserve, for ${LOAN_FOR} s.` },
  'emergency-shutdown': { from: 'A stablecoin vault (Maker/Sky)', text: 'Once a match: when your keep is under 25%, it takes no damage in that Siege phase.' },
};

/** What each kind of holding does, and the trade that gets it. */
export const HOLDINGS: readonly { what: string; does: string; how: string }[] = [
  { what: 'Tokens (not stablecoins)', does: 'Units. The token picks the unit type; its value picks how many. Prices move every week, so your army grows and shrinks with them.', how: 'Swap into the token.' },
  { what: 'Stablecoins', does: `Walls: keep HP (${K.hpPerStableUnit} HP for every unit’s worth). In the Siege phase the walls loose a volley at the attackers before they hit.`, how: 'Swap into USDC, DAI, USDT or USDS.' },
  { what: 'Staked ETH', does: 'Staked Paladins, and the shield ability. Unstaking takes a round.', how: 'Stake ETH.' },
  { what: 'Restaked ETH', does: `The Slashing Guard, and ${pct(L.restakeYield)} a round, but the Slashing event burns part of it.`, how: 'Restake stETH.' },
  { what: 'Pool (LP) position', does: `Both tokens still fight, they earn ${pct(L.lpFee)} a round in fees, and you get Flash Swap.`, how: 'Add to a pool.' },
  { what: 'Supplied on lending', does: `Still fights, earns ${pct(L.supplyYield)} a round, gives Flash Loan, and is collateral to borrow against.`, how: 'Supply.' },
  {
    what: 'Borrowing',
    does: `More tokens, so a bigger army, up to ${pct(L.ltv)} of your collateral. The debt grows ${pct(L.debtGrowth)} a round. If prices drop and health falls under 1, you are liquidated: collateral is sold with a ${pct(L.liquidationPenalty)} penalty and blows up among your own troops.`,
    how: 'Supply first, then Borrow. Repay to be safe.',
  },
  { what: 'A vault (Maker/Sky)', does: 'Borrow stablecoins against collateral: walls without selling. Gives the Emergency Shutdown.', how: 'Supply or Borrow “at the Vault”.' },
  { what: 'NFTs', does: 'Relics: slot up to three for a passive bonus. The rarer the collection’s floor, the stronger the relic.', how: 'Slot a relic (you must hold the NFT).' },
];

export const RELIC_TEXT: readonly { name: string; text: string }[] = Object.values(relicsJson.relics as Record<string, { name: string; text: string; value: number }>).map((r) => ({
  name: r.name,
  text: r.text.replace('{v}', String(r.value)).replace('{p}', pct(r.value)).replace('{pts}', String(Math.round(r.value * 100))),
}));

const E = eventsJson.events as Record<EventId, Record<string, number | string>>;
const n = (id: EventId, k: string) => Number(E[id][k]);

export const EVENT_TEXT: Record<EventId, string> = {
  'black-swan': `Every token crashes ${pct(n('black-swan', 'dropMin'))}–${pct(n('black-swan', 'dropMax'))}. Loans get dangerous; stablecoins hold.`,
  'bull-run': `Everything climbs about ${pct(n('bull-run', 'dailyDrift'))} a day all week.`,
  'meme-mania': `Memecoins jump ${pct(n('meme-mania', 'rise'))}, then fall ${pct(n('meme-mania', 'fallNext'))} the week after.`,
  depeg: `A stablecoin slips to $${n('depeg', 'to')}: walls built on it crack. It recovers over the next rounds.`,
  'rug-pull': `One small token with no unit of its own loses ${pct(n('rug-pull', 'drop'))}; its squads flee the field.`,
  'gas-spike': `Every action costs ${n('gas-spike', 'gasMult')}× the gas this round.`,
  slashing: `Restaked positions lose ${pct(n('slashing', 'burn'))}.`,
  airdrop: `Both sides get ${n('airdrop', 'units')} units’ worth of DROP tokens for free.`,
};

/** The match, step by step. */
export const HOW_TO_PLAY: readonly { title: string; text: string }[] = [
  { title: 'Your portfolio is your army', text: 'Every token you hold becomes a squad of soldiers: the token decides which unit, its dollar value decides how many. Stablecoins become your walls.' },
  { title: '1. Market week', text: 'Prices move for seven days (shown as candles). A rumor warns of the event that may come. Your army grows or shrinks with your tokens.' },
  { title: '2. Trade (30 s)', text: 'Swap, stake, supply, borrow, join pools or slot relics. Each action is done at once and costs a little gas. The preview tells you what it does to your army, walls and loans.' },
  { title: '3. Battle', text: 'Both armies march down three lanes and fight. Capture buildings on the way for bonuses. Melee beats Cavalry, Cavalry beats Ranged, Ranged beats Melee.' },
  { title: '4. Siege', text: 'Survivors reach the enemy gate. Their walls shoot first, then the attackers hit the keep. Siege units hit hardest.' },
  { title: 'Winning', text: `Bring the enemy keep down to 0. After ${BALANCE.match.rounds} rounds a sudden-death round decides it (siege ×${BALANCE.match.suddenDeathSiegeMult}); then the stronger keep wins.` },
  { title: 'Tips', text: 'Mix roles so no counter wipes you out. Keep some stablecoins for walls. Watch loan health before a crash, and read the rumor.' },
];

/** The buildings on the field, and how to take one. */
export const CAPTURE_TEXT = `Stand ${CAPTURE_UNITS} units by a building, with no enemy near, for ${CAPTURE_SECONDS} s to take it (half the time where you have home advantage: a position in that protocol). Its holder gets its bonus.`;

export const REGIME_TEXT: readonly { name: string; text: string }[] = [
  { name: '🐂 Bull market', text: 'Prices tend to rise.' },
  { name: '🦀 Crab market', text: 'Prices drift sideways.' },
  { name: '🐻 Bear market', text: 'Prices tend to fall, and swing harder.' },
];

export const LOAN_TEXT = `Borrowing lets you hold more than you own, up to ${pct(L.ltv)} of your collateral. Health = collateral × ${pct(L.liquidationThreshold)} ÷ debt. Under ${L.hfWarning} the gauge turns amber; under 1 you are liquidated a candle at a time.`;

export const GAS_TEXT = `Every action costs gas (${L.gasUnits} of a unit’s worth, paid in ETH, else stablecoins). Swaps also pay a ${pct(L.swapFee)} fee, plus slippage on big trades.`;
