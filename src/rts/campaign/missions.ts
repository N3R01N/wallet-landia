/**
 * The campaign's ten missions (docs/rts/CAMPAIGN.md): each opens a little
 * more of the game, from a hall and its Militia to the whole of it against
 * the computer. What a mission allows grows from the one before it.
 */

import type { UnitTypeId } from '../../game/core/types.js';
import { BUILDING_KINDS, BUILDINGS, TRAIN, type BuildingKind } from '../data/rules.js';
import type { Allowed } from '../core/world.js';
import type { Mission } from './run.js';
import { attackMove, borrow, build, clear, destroy, destroyHall, earn, group, look, moveTo, place, pool, raid, rally, restake, selectHall, selectUnits, stake, startBuild, supply, swap, train, trainAny, unpool, upgrade, vault } from './steps.js';

/** Where raiders gather: across the middle bridge, on the enemy's side. */
const NORTH = { x: 0, z: -14 };

const allow = (buildings: BuildingKind[], units: UnitTypeId[], top = 1): Allowed => ({
  buildings,
  units,
  levels: Object.fromEntries(['hall' as const, ...buildings].map((k) => [k, Math.min(top, BUILDINGS[k].maxLevel)])),
});

const U1: UnitTypeId[] = ['militia'];
const U2: UnitTypeId[] = [...U1, 'knight'];
const U3: UnitTypeId[] = [...U2, 'archer.scout'];
const U5: UnitTypeId[] = [...U3, 'lancer.lido'];
const U6: UnitTypeId[] = [...U5, 'paladin.eth', 'archer.oracle', 'mage.swap', 'paladin.staked'];
const U7: UnitTypeId[] = [...U6, 'swarm.goblin', 'pack.shiba', 'swarm.frog'];
const U8: UnitTypeId[] = [...U7, 'lender.ghost', 'warden.vault'];
const U9: UnitTypeId[] = [...U8, 'construct', 'mage.battle'];

export const MISSIONS: readonly Mission[] = [
  {
    n: 1,
    title: 'First Steps',
    tagline: 'The view, your hall, and your first soldiers',
    briefing: [
      'This is your Wallet Hall: your seat, and the one building you can’t lose. It trains Militia, cheap foot soldiers paid in USDC.',
      'Bandits have crossed the river and camp on your side of it. Train a few Militia, march them out, and drive the bandits off.',
    ],
    cards: [{ building: 'hall' }, { unit: 'militia' }, { concept: 'controls' }],
    debrief: 'You can move the view, select, train, move and attack: the heart of every battle to come.',
    seed: 'campaign-1',
    still: true,
    allowed: allow([], U1),
    player: { dollars: { usdc: 1500 } },
    steps: [
      look(),
      selectHall(),
      train('militia', 3, { hint: 'With the hall selected, press Militia in the panel at the bottom right, three times. Each costs $200 in USDC (your money is along the top) and takes 6 s.' }),
      selectUnits(3),
      moveTo(0, 42, 3),
      clear('bandits', 'Drive off the bandits', 'Select your Militia and right-click a bandit to attack it. Once in a fight, they take on the rest by themselves.', { units: [['swarm.goblin', 3]], x: 9, z: 28 }),
    ],
  },
  {
    n: 2,
    title: 'The Barracks',
    tagline: 'Building, rally points, and Knights',
    briefing: [
      'The hall builds every other building, C&C style: pick one, the hall builds it, then you place it near your own.',
      'Raiders are on their way. Build a Barracks, train Knights (sturdier than Militia, still paid in USDC), and hold.',
    ],
    cards: [{ concept: 'build' }, { building: 'barracks' }, { unit: 'knight' }],
    debrief: 'Building, placing and rally points. Idle soldiers guard where they stand: they take on any enemy that comes close, then go back.',
    seed: 'campaign-2',
    still: true,
    allowed: allow(['barracks'], U2),
    player: { dollars: { usdc: 3500 }, units: [['militia', 2]] },
    steps: [
      startBuild('barracks'),
      place('barracks'),
      rally('barracks'),
      train('knight', 4),
      raid('raid1', [['militia', 4]], NORTH, 'Beat the raiders', 'They are coming over the middle bridge (the ringed spot). Idle soldiers fight anything that comes within 9 m; or select them all and right-click the raiders.', 5),
      raid('raid2', [['militia', 4], ['knight', 2]], NORTH, 'Beat the second, bigger raid', 'More are on the way: train more Knights while you wait. Your hall’s arrows help near home.', 20),
    ],
  },
  {
    n: 3,
    title: 'Bows and the Triangle',
    tagline: 'Archers, the counter triangle, groups and attack-move',
    briefing: [
      'Every unit has a role, and roles beat each other: Ranged beats Melee, Melee beats Cavalry, Cavalry beats Ranged. The winner of a pairing deals half again as much damage.',
      'The enemy sends foot soldiers, and keeps an outpost across the river. Raise archers, stop the charge, then take the outpost.',
    ],
    cards: [{ concept: 'triangle' }, { building: 'archery' }, { unit: 'archer.scout' }],
    debrief: 'The triangle, groups and attack-move: archers behind knights, and the whole army moving as one.',
    seed: 'campaign-3',
    still: true,
    allowed: allow(['barracks', 'archery'], U3),
    player: { dollars: { usdc: 4500 }, buildings: [['barracks']], units: [['knight', 3]] },
    enemy: {
      buildings: [{ tag: 'outpost', kind: 'barracks', x: 0, z: -26 }],
      guards: [{ name: 'outpost-guard', units: [['militia', 3], ['archer.scout', 2]], x: 0, z: -20 }],
    },
    steps: [
      build('archery'),
      train('archer.scout', 4),
      raid('charge', [['knight', 3], ['militia', 3]], NORTH, 'Stop the charge', 'Melee soldiers are coming: your archers beat them. Keep your knights in front and the archers a step behind.', 5, { concept: 'triangle' }),
      group(),
      attackMove(),
      destroy('outpost', 'Destroy the enemy outpost', 'The enemy Barracks across the river. Attack-moving units fight the guards first, then the building; or right-click the building to attack it.'),
    ],
  },
  {
    n: 4,
    title: 'The Exchange',
    tagline: 'Swaps, pools, and money that earns',
    briefing: [
      'Money sitting in your wallet earns nothing. Money put to work in positions earns every second: that is how you pay for an army.',
      'Build an Exchange (Uniswap): swap one token for another, and pool two tokens to earn the fees of every swap. Prices hold still for now.',
    ],
    cards: [{ building: 'exchange' }, { concept: 'positions' }],
    debrief: 'Swap, pool, earn, take it out to spend. Every position in the game works this way.',
    seed: 'campaign-4',
    still: true,
    allowed: allow(['barracks', 'archery', 'exchange'], U3),
    player: { dollars: { usdc: 6000 }, buildings: [['barracks'], ['archery']], units: [['knight', 3], ['archer.scout', 3]] },
    steps: [
      build('exchange'),
      swap('eth', 1000, { hint: 'Select the Exchange. Under Swap, pick From USDC → To ETH and press 25%.' }),
      pool(),
      earn(150),
      unpool(),
      raid('raid', [['knight', 4], ['militia', 4]], NORTH, 'Defend the base', 'Spend what you earned: more Knights and Archers. Archers beat their foot soldiers.', 15),
    ],
  },
  {
    n: 5,
    title: 'Stake and Charge',
    tagline: 'Staking, moving prices, and Lido Lancers',
    briefing: [
      'From now on prices move: ETH, LDO and the rest rise and fall with the market. Stablecoins hold still.',
      'Build a Staking House and stake your ETH. It also trains Lido Lancers: fast riders paid in LDO, the first unit that wants a token of its own. Enemy archers wait across the river: cavalry beats ranged.',
    ],
    cards: [{ building: 'staking' }, { unit: 'lancer.lido' }, { concept: 'tokens' }, { concept: 'market' }],
    debrief: 'Staking earns while you fight; and units paid in their own token mean swapping at the Exchange first.',
    seed: 'campaign-5',
    allowed: allow(['barracks', 'archery', 'exchange', 'staking'], U5),
    player: { dollars: { usdc: 4000, eth: 3000 }, buildings: [['barracks'], ['archery'], ['exchange']], units: [['knight', 2], ['archer.scout', 2]] },
    steps: [
      build('staking'),
      stake(),
      swap('ldo', 900, { hint: 'Lancers cost LDO. Select the Exchange, pick From USDC → To LDO and press 25%.' }),
      train('lancer.lido', 3),
      clear('archers', 'Run down the archers', 'Archers are ranged: cavalry beats them, and a Lancer’s first strike hits double. Select your Lancers and right-click an archer.', { units: [['archer.scout', 5]], x: 0, z: -17 }),
    ],
  },
  {
    n: 6,
    title: 'Rising Levels',
    tagline: 'Upgrades, four new units, and the first enemy hall',
    briefing: [
      'Buildings go up in levels: more HP, more yield, and better units. No building may be above your wallet hall, so the hall goes first.',
      'Level 2 opens four units: the Ether Paladin (ETH) at the Barracks, the Oracle Archer (LINK) at the Archery, the Swap Mage (UNI) at the Exchange and the Staked Paladin (stETH) at the Staking House.',
      'Then go for the enemy’s Wallet Hall. Mind its arrows: it shoots anything that comes close, so go in with many at once.',
    ],
    cards: [{ concept: 'levels' }, { unit: 'paladin.eth' }, { unit: 'archer.oracle' }, { unit: 'mage.swap' }, { unit: 'paladin.staked' }],
    debrief: 'Levels open better units: the hall first, then the buildings that train what you need.',
    seed: 'campaign-6',
    allowed: allow(['barracks', 'archery', 'exchange', 'staking'], U6, 2),
    player: { dollars: { usdc: 9000, eth: 3000 }, buildings: [['barracks'], ['archery'], ['exchange'], ['staking']], units: [['knight', 3], ['archer.scout', 3]] },
    enemy: {
      buildings: [
        { tag: 'barracks', kind: 'barracks', x: -12, z: -52 },
        { tag: 'archery', kind: 'archery', x: 12, z: -52 },
      ],
      guards: [{ name: 'gate', units: [['knight', 4], ['archer.scout', 4]], x: 0, z: -40 }],
    },
    steps: [
      upgrade('hall', 2, { card: { concept: 'levels' } }),
      upgrade('barracks', 2),
      train('paladin.eth', 3, { hint: 'Select the Barracks and press Ether Paladin: $400 in ETH each. They heal the friends beside them.' }),
      trainAny(['archer.oracle', 'mage.swap', 'paladin.staked'], 2, 'Train 2 of the other new units', 'Oracle Archers (LINK, Archery at level 2), Swap Mages (UNI, Exchange at level 2) or Staked Paladins (stETH, Staking House at level 2). Raise the building, swap for its token, train. stETH comes from staking ETH and then unstaking it.'),
      clear('gate', 'Break through the gate guards', 'Eight guards stand before the enemy base. Attack-move your whole army at them: knights and paladins in front, archers behind.'),
      destroyHall('Bring everything. The hall has 4,000 HP and shoots whatever comes within 10 m; many units at once take it down fast.'),
    ],
  },
  {
    n: 7,
    title: 'The Meme Pit',
    tagline: 'Swarms: Goblins, Shiba Packs and Frogs',
    briefing: [
      'The Meme Pit trains swarms: cheap, quick units that win by numbers. Goblins are paid in USDC, Shiba Packs in SHIB (they bite harder the bigger the pack), Frog Swarms in PEPE at level 2 (they burst when they die).',
      'An assault is coming. Build up a swarm, survive it, and burn the enemy hall.',
    ],
    cards: [{ building: 'memepit' }, { concept: 'swarms' }, { unit: 'swarm.goblin' }, { unit: 'pack.shiba' }, { unit: 'swarm.frog' }],
    debrief: 'Swarms trade quality for numbers: cheap to replace, and deadly in a crowd. Beware the area attacks you will meet next.',
    seed: 'campaign-7',
    allowed: allow(['barracks', 'archery', 'exchange', 'staking', 'memepit'], U7, 2),
    player: { dollars: { usdc: 7000, eth: 2000 }, hall: 2, buildings: [['barracks', 2], ['archery', 2], ['exchange'], ['staking']], units: [['knight', 4], ['archer.scout', 4]] },
    enemy: {
      buildings: [{ tag: 'barracks', kind: 'barracks', x: -12, z: -52 }],
      guards: [{ name: 'garrison', units: [['knight', 3], ['archer.scout', 3], ['swarm.goblin', 4]], x: 0, z: -46 }],
    },
    steps: [
      build('memepit'),
      train('swarm.goblin', 3),
      swap('shib', 700, { hint: 'Shiba Packs cost SHIB. At the Exchange, pick From USDC → To SHIB and press 25%.' }),
      train('pack.shiba', 6),
      raid('assault', [['knight', 6], ['militia', 6]], NORTH, 'Survive the assault', 'Twelve foot soldiers. Swarms are fast: let them surround the enemy while your archers shoot from behind.', 10),
      upgrade('memepit', 2),
      train('swarm.frog', 4, { hint: 'Frog Swarms cost PEPE: swap for it at the Exchange, then train them at the Meme Pit.' }),
      destroyHall('A garrison guards the hall. Attack-move everything at it.'),
    ],
  },
  {
    n: 8,
    title: 'Borrowed Power',
    tagline: 'The Bank and the Vault: collateral, loans and liquidation',
    briefing: [
      'The Bank (Aave) lets you supply tokens as collateral and borrow against them: money to spend now while your collateral stays yours. The Vault (Maker) does the same for ETH, paying out DAI.',
      'A loan has a health: under 1, part of your collateral is sold to repay it. With prices moving, borrow well under the limit.',
      'Both train new units: the Vault Warden (MKR), a wall that draws the enemy’s blows, and, at Bank level 2, the Ghost Lender (AAVE), which weakens what it hits.',
    ],
    cards: [{ building: 'bank' }, { building: 'vault' }, { concept: 'borrow' }, { unit: 'warden.vault' }, { unit: 'lender.ghost' }],
    debrief: 'Borrowing turns what you hold into money to spend without selling it. Keep the health up, and the loan is yours to repay when you choose.',
    seed: 'campaign-8',
    allowed: allow(['barracks', 'archery', 'exchange', 'staking', 'memepit', 'bank', 'vault'], U8, 2),
    player: { dollars: { eth: 8000, usdc: 3000 }, hall: 2, buildings: [['barracks', 2], ['archery', 2], ['exchange'], ['staking']], units: [['knight', 4], ['archer.scout', 4]] },
    steps: [
      build('bank'),
      supply(),
      borrow(),
      build('vault'),
      vault(),
      train('warden.vault', 2, { hint: 'Wardens cost MKR. At the Exchange swap DAI or USDC → MKR ($400 each), then train them at the Vault.' }),
      upgrade('bank', 2),
      train('lender.ghost', 2, { hint: 'Ghost Lenders cost AAVE. Swap for it at the Exchange ($300 each), then train them at the Bank.' }),
      raid('raid', [['knight', 5], ['archer.scout', 4]], NORTH, 'Hold off the raid', 'Wardens in front: the enemy must strike them first. Ghost Lenders behind them sap the enemy’s strength.', 10),
    ],
  },
  {
    n: 9,
    title: 'Restake and Build',
    tagline: 'Restaking, the Workshop, Constructs and Battle Mages; the computer plays',
    briefing: [
      'The Restaking Hall (EigenLayer) takes stETH and pays the best yield in the game. The Workshop trains Constructs, which make the soldiers round them hit harder, and Battle Mages, whose blasts hit everything round their target.',
      'This time the computer plays the other side (Easy). It loves swarms: Battle Mages tear through them.',
    ],
    cards: [{ building: 'restaking' }, { building: 'workshop' }, { unit: 'construct' }, { unit: 'mage.battle' }],
    debrief: 'Support and area damage turn a good army into a great one. One mission left: the whole game.',
    seed: 'campaign-9',
    allowed: allow(['barracks', 'archery', 'exchange', 'staking', 'memepit', 'bank', 'vault', 'restaking', 'workshop'], U9, 2),
    player: { dollars: { usdc: 8000, eth: 3000, steth: 2000 }, hall: 2, buildings: [['barracks', 2], ['archery', 2], ['exchange'], ['staking']], units: [['knight', 4], ['archer.scout', 4]] },
    enemy: {
      ai: 'easy',
      dollars: { usdc: 8000 },
      allowed: { buildings: ['exchange', 'barracks', 'archery', 'memepit', 'staking'], units: ['militia', 'knight', 'archer.scout', 'swarm.goblin', 'pack.shiba', 'swarm.frog'], levels: { hall: 2, memepit: 2 } },
    },
    steps: [
      build('restaking'),
      restake(),
      build('workshop'),
      train('construct', 2),
      upgrade('workshop', 2),
      train('mage.battle', 3),
      destroyHall('The computer builds and trains as you do. Strike before it grows: your whole army, Constructs among them, Battle Mages behind.'),
    ],
  },
  {
    n: 10,
    title: 'Ledger Wars',
    tagline: 'Siege, and the whole game against the computer',
    briefing: [
      'Everything is open: every building to its highest level, every unit. At hall level 3 comes the Bridge Works, with Stone Golems and Bitcoin Titans (WBTC): siege units, slow and weak against soldiers, but they tear buildings down. Barracks at level 3 train the Name Rider (ENS), the fastest unit in the game.',
      'You start with your hall and $10,000, as in a skirmish. The computer plays at Normal. Win this and you know Ledger Wars.',
    ],
    cards: [{ building: 'bridgeworks' }, { concept: 'siege' }, { unit: 'golem.stone' }, { unit: 'titan.bitcoin' }, { unit: 'rider.name' }],
    debrief: 'You have learned it all. Skirmishes await, at Easy, Normal or Hard.',
    seed: 'campaign-10',
    allowed: { buildings: BUILDING_KINDS.filter((k) => k !== 'hall'), units: TRAIN.map((t) => t.unit), levels: Object.fromEntries(BUILDING_KINDS.map((k) => [k, BUILDINGS[k].maxLevel])) },
    player: { dollars: { usdc: 10000 } },
    enemy: { ai: 'normal', dollars: { usdc: 10000 } },
    steps: [
      build('exchange', { hint: 'Start the economy: an Exchange to swap and pool, then a Staking House and a Barracks. The computer’s first attack comes in about five minutes.' }),
      build('barracks'),
      upgrade('hall', 3, { hint: 'Select the hall and press ⬆, twice: level 2, then level 3 ($1,500 and $3,000). Keep earning and training while it rises.' }),
      build('bridgeworks'),
      train('golem.stone', 2),
      destroyHall('Golems and Titans smash buildings; escort them with the rest of your army.'),
    ],
  },
];
