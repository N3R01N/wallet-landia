# Ledger Wars: the real-time strategy mode

A second game mode next to Siege of the Ledger: StarCraft / Command & Conquer
style. You start with one building, your wallet hall, and a little money;
you build, trade and stake to earn, train units with the tokens they need,
and command them yourself until one wallet hall falls.

Branch `rts-v1` (from `game-v1`). Existing assets only: no new models or art.

## Decisions (the user's, 2026-10-18)

| Question | Answer |
|---|---|
| Map | A new open map built from the scenery models, two start spots at opposite ends |
| Building | From the wallet hall, C&C style: pick a building, it is built over time, then you place it near your own buildings. No worker units |
| A destroyed building's positions | Frozen until rebuilt: no income, no withdrawing; nothing lost |
| Opponent | One AI, by the same rules; about 15-minute matches; destroying the enemy wallet hall wins |
| Income | Only from positions: staking, Uniswap pools, lending (and leverage). Spot tokens earn nothing |
| Swapping | Needs your own Uniswap building first |
| Units | Each costs its own token (the Siege mapping: a Paladin ETH, a Titan WBTC, a Shiba Pack SHIB…) |
| Control | Direct: select units, move, attack, attack-move, defend/hold; no auto battle |

## Defaults I chose (say if you want them otherwise)

- **Its own page**, `rts.html`, with a full-screen map and an RTS camera; a button in the castle's topbar opens it.
- **Start**: the wallet hall alone, and a choice of $10,000 in USDC, in ETH, or a basic mix.
- **No fog of war** in v1.
- **Prices move** all match (a seeded market, one game day every 20 s), so what you hold and when you swap matters.
- **Buildings cost** a dollar amount paid in stablecoins or ETH (the hall takes either); **units** cost their token.
- **Deterministic** simulation at 20 ticks a second (seeded), on the page for now; a worker and PvP can come later.

## Buildings (all existing models)

| Building | Model | Does | Trains |
|---|---|---|---|
| Wallet Hall | `castle.hall.wallet.t0…t6` | Builds every building; its tier unlocks the others' tiers | Militia (USDC) |
| Exchange | `building.protocol.uniswap` | Swaps; pool (LP) positions that earn fees | Swap Mage (UNI) |
| Staking House | `building.protocol.lido` | Stake ETH → stETH, which grows | Lido Lancer (LDO); Staked Paladin (stETH, tier 2) |
| Restaking Hall | `building.protocol.eigenlayer` | Restake stETH: more yield | — |
| Bank | `building.protocol.aave` | Supply (earns a little, is collateral); borrow against it; liquidation under health 1 | Ghost Lender (AAVE) |
| Vault | `building.protocol.maker` | Mint DAI against ETH | Vault Warden (MKR) |
| Barracks | `building.category.governance.*` | — | Knight (USDC); Ether Paladin (ETH, tier 2); Name Rider (ENS) |
| Archery | `building.category.other.*` | — | Scout Archer (USDC); Oracle Archer (LINK, tier 2) |
| Meme Pit | `building.category.nft.*` | — | Goblin Swarm, Shiba Pack (SHIB), Frog Swarm (PEPE) |
| Bridge Works | `building.category.bridge.*` | — | Stone Golem; Bitcoin Titan (WBTC, tier 3) |
| Workshop | `building.category.dex.*` | — | Construct; Battle Mage |

Upgrades raise a building's tier (its `tier.2/4/6` parts show; category buildings
also grow a size class), its HP, the yield of what it holds, and unlock its
better units.

## Milestones (a commit after each)

1. **R1 The ground**: `rts.html`, the map (ground, scenery, two start spots), the RTS camera, the wallet halls, the build menu and placement, construction, the market ticking, the resource bar.
2. **R2 The economy**: swaps, pools, staking, restaking, lending and borrowing, the vault, yields, liquidation; upgrades; frozen positions.
3. **R3 Units**: training queues and costs, drawn instanced; selection (click, box, double-click), move with pathfinding and formations.
4. **R4 Combat**: attack, attack-move, stop, hold/defend, the counter triangle and abilities, building damage and destruction, effects, victory and defeat.
5. **R5 The AI**: an opponent that builds, trades and attacks by the same rules; a headless runner to tune the economy to ~15-minute matches.
6. **R6 Polish**: minimap, hotkeys and control groups, a guide, the topbar button, tests.

## Status (2026-10-18): R1–R6 built

All six milestones are in (`src/rts/`, tests `test/rts*.test.ts` and `e2e/rts.spec.ts`).

Changes from the plan made along the way:

- **The camera moves by the arrows**, the screen's edges or the middle button: A, S and H are orders (attack-move, stop, hold), as in most RTS games.
- **Pacing** (from the headless runner, `npx vite-node scripts/rts-sim.ts [n] [A] [B] [kit]`): units cost $200 per point of their cost, yields are game-fast (staking 12% a minute, pools 16%, restaking 18%, paid each second), the wallet hall has 4,000 HP and shoots arrows, buildings take 0.8× a unit's attack plus 6 per point of Siege. Positions can be taken out in part.
- **The computer** comes in Easy, Normal and Hard (start screen). Hard beats Normal 5 to 1, Normal beats Easy 6 to 0 in about 24 minutes; Normal beats a player who never fights back in about 6.5 minutes. A human who attacks should end matches sooner; the 15-minute target needs a playtest.
- **No button on phones**: the castle's topbar has a "🗡 RTS" link on desktop only (the mode needs a mouse).
- `?ai=0` on rts.html starts without an opponent (a sandbox; the browser tests use it).

**The campaign** (2026-10-19, `docs/rts/CAMPAIGN.md`): ten guided missions that open the game a piece at a time, on the start screen above the skirmish.

Not done yet: fog of war, a worker and PvP, sounds, saving a match.
