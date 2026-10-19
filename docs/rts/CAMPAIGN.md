# Ledger Wars: the campaign

The skirmish puts everything in front of a new player at once: eleven
buildings, eighteen units, thirteen tokens and six kinds of position. The
campaign is ten short missions that open the game a piece at a time. Each one
has a briefing that introduces what is new (a card per unit, building or
idea), a guided list of objectives in the corner with a hint for the current
one, a glow on the button to press and a beacon on the map, and a debrief.
Only what has been introduced so far can be built or trained, so the menus
stay short.

## The missions

| # | Mission | New buildings | New units | What it teaches | Enemy |
|---|---|---|---|---|---|
| 1 | First Steps | (the Wallet Hall) | Militia (USDC) | The view; selecting; training; moving; attacking | Bandits by the river |
| 2 | The Barracks | Barracks | Knight (USDC) | Build, wait, place; rally points; idle units guard | Two raids |
| 3 | Bows and the Triangle | Archery | Scout Archer (USDC) | The counter triangle; control groups; attack-move | A raid, then an outpost to destroy |
| 4 | The Exchange | Exchange | — | Tokens earn nothing, positions do; swaps; pools; taking earnings out | A raid at the end |
| 5 | Stake and Charge | Staking House | Lido Lancer (LDO) | Staking; units that cost their own token; prices move | Archers to run down |
| 6 | Rising Levels | — | Ether Paladin (ETH), Oracle Archer (LINK), Swap Mage (UNI), Staked Paladin (stETH) | Upgrades: the hall first, then the rest; the first enemy hall | A guarded base |
| 7 | The Meme Pit | Meme Pit | Goblin Swarm (USDC), Shiba Pack (SHIB), Frog Swarm (PEPE) | Swarms: cheap, fast, weak to area attacks | An assault, then a base |
| 8 | Borrowed Power | Bank, Vault | Ghost Lender (AAVE), Vault Warden (MKR) | Collateral, borrowing, health and liquidation; DAI from a vault | A raid |
| 9 | Restake and Build | Restaking Hall, Workshop | Construct, Battle Mage (USDC) | Restaking; support units; area damage | The computer (Easy), swarms |
| 10 | Ledger Wars | Bridge Works | Stone Golem (USDC), Bitcoin Titan (WBTC), Name Rider (ENS) | Siege units; the whole game | The computer (Normal) |

Every building and unit of the skirmish is introduced once (a test checks it).

## How it works

- **Restrictions in the World**: a setup may limit a side to some buildings,
  some units and a top level per building. Locked buildings and units are not
  shown in the menus; an upgrade past the mission's cap says it comes later.
  The computer skips locked buildings in its build order.
- **A mission's setup**: its seed, still or moving prices, the player's
  tokens, hall level and buildings already standing, the enemy's buildings,
  guards and whether the computer plays.
- **Objectives** run in order. Each has a text, a hint, a button to glow and
  a point on the map to mark, an optional wait ("raiders cross in 20 s"), what
  happens when it starts (a raid spawns) and when it is done (read from the
  World, its command log and the selection). The last one done wins the
  mission; losing the wallet hall loses it.
- **Progress** is kept on the device (localStorage): a mission opens when the
  one before it is won. `?mission=N` opens a mission directly.
- **The help** gains a Units tab: every unit's role, token, where it is trained
  and what it is good at, in plain words (the skirmish gets it too).
- **Tests**: every mission is played to victory headless by a scripted
  player (test/rtsCampaign.test.ts), and a browser test plays mission 1's
  first objectives through the UI.

## Milestones

1. **C1** Restrictions and setup in the World; the objective runner; the
   campaign menu, briefing, objectives panel and debrief; the ten missions;
   the units help; tests.
