# **Siege of the Ledger — Game Spec**

Oct 17, 2026 · @Sir

## **Overview**

Siege of the Ledger turns the existing wallet-city visualization into a 5–10 minute auto-battler: your portfolio is your army, trades are your draft, and you win by destroying the enemy keep. Version 1 is single-player against NPC archetypes; every system is built so PvP can be added later without rewrites.

**Design pillars**

* **The portfolio is the army.** Nothing is bought in a shop. Every unit on the field exists because a position exists.  
* **Price is fate.** Price moves change how many units you field, how strong your walls are, and whether your leverage survives.  
* **Trading is strategy.** Between battles, the only lever is what a real trader has: swap, stake, provide liquidity, lend, borrow.  
* **Readable chaos.** Every price effect has a visible cause on the battlefield: a squad grows, a wall cracks, a liquidated squad explodes.

**Decisions locked in the design interview**

| Topic | Decision |
| :---- | :---- |
| Format | Auto-battler; players act only between battles |
| Player action | Trading \= drafting (swap, stake, LP, lend, borrow) |
| Portfolio source | Fully simulated, or import a wallet and edit it |
| Prices | Simulated (seeded); live/historical feeds later via the same interface |
| Size | Portfolio size matters: bigger position \= more units |
| Unit scaling | Each unit type has fixed stats; position value sets the unit count |
| Price effects | Squad size, liquidations, market events, keep HP from stablecoins |
| Win condition | Destroy the enemy keep |
| Opponent | NPC first (archetypes \+ difficulty), PvP-ready architecture |
| Match length | 5–10 minutes |
| Tokens → units | Curated roster for top tokens, category fallback for the rest |
| NFTs | Relics (passive buffs) |
| Protocols | Positions grant abilities **and** buildings exist on the map |
| Couriers | Animate trade-phase swaps |
| Chains | Ethereum mainnet only: ETH, ERC-20 tokens, ERC-721/1155 NFTs, Ethereum protocols |
| Stack | Three.js / React Three Fiber |

## **Core match loop**

A match is up to 7 rounds of about 75 seconds each. Each round, the market moves, you trade, and the armies fight. Surviving attackers then damage the enemy keep. The first keep to reach 0 HP loses.

| Phase | Duration | What happens | Player input |
| :---- | :---- | :---- | :---- |
| 0\. Setup | before the match | Choose a portfolio (import \+ edit, or simulated) and an NPC archetype \+ difficulty. The match seed is fixed here. | Yes |
| 1\. Market | \~8 s | Prices advance one simulated week (7 daily candles, shown on a ticker). Market events fire. Liquidation checks run on every candle. Squads resize. | No |
| 2\. Trade | 30 s (pausable vs NPC) | Swap, stake, LP, lend, borrow, slot relics. Couriers animate each action. Next round's event rumor is visible. | Yes |
| 3\. Battle | up to 45 s | Armies spawn from the portfolio and fight automatically across the city. Protocol abilities auto-cast. | No |
| 4\. Siege | \~5 s | Each surviving unit deals its Siege value to the enemy keep. | No |

![round loop · 4 phases][image1]

round loop · 4 phases

Trade is the only phase where the player acts. Everything else follows from what they hold.

* Armies are rebuilt from the portfolio at the start of every battle. Battle casualties do **not** burn tokens; the portfolio is the source of truth.  
* Round 1 skips the Market phase, so the first trade happens at known prices.  
* **Sudden death:** if both keeps stand after round 7, round 8 runs with siege damage ×3 and no trade phase. If both keeps are still standing after that, the higher keep HP % wins.  
* **Momentum:** after each Market phase, the side with the higher portfolio % change gets \+10% ATK for that battle. This makes PnL directly visible.

## **Portfolio sources**

There are two ways to start a match, and both end in the same Portfolio Editor. The game never signs transactions. Imported wallets are read-only snapshots.

**A. Import and edit**

1. Choose one of the wallets the existing visualization already loads, reading Ethereum mainnet only.  
2. Snapshot its Ethereum mainnet holdings only: ETH and ERC-20 tokens, ERC-721/1155 NFTs, and Ethereum protocol positions (staked, LP, supplied, borrowed), through the visualization's existing data layer. Assets on other chains or L2s are ignored.  
3. Normalize the snapshot into a Portfolio (see Architecture). Unknown tokens go to category fallback. Tokens with no category are tagged misc.  
4. Open the Portfolio Editor: adjust quantities, add or remove positions, add simulated NFTs.

**B. Fully simulated**

* **Templates:** "Degen", "Whale", "Stable Maxi", "Yield Farmer", "Balanced" (the same templates the NPCs use).  
* **Blank build:** spend a starting budget (default \$10,000) across the curated list and any category-fallback token.

**Portfolio Editor rules**

* The total portfolio value is capped at the **match cap** (default \$1,000,000, configurable). An import above the cap is scaled down proportionally, with a notice.  
* Positions below the dust threshold (default 0.25 × UNIT\_VALUE) are shown but produce no units.  
* Prices at setup come from the price provider's opening snapshot. In sim mode, an import is valued at those sim prices.  
* The edited portfolio can be saved locally as a named loadout.

## **Price simulation**

Prices come from a seeded, correlated random walk with market regimes. Each round is one simulated week of 7 daily steps. The same seed always produces the same prices, which makes replays and future PvP fair.

Each daily log return for asset i is a shared market move scaled by the asset's beta, plus its own noise, plus any active event shock:

r\_{i,t} \= \\beta\_i \\, m\_t \+ \\sigma\_i \\, \\varepsilon\_{i,t} \+ \\text{shock}\_{i,t}, \\qquad m\_t \\sim \\mathcal{N}(\\mu\_{\\text{regime}}, \\sigma\_{\\text{market}})

* **Regimes:** Bull, Crab, Bear. A Markov switch is checked each round (default: stay with 70% probability). The current regime is shown in the HUD.  
* **Stablecoins:** fixed at 1.00 except during a Depeg event.  
* **Volatility is compressed.** One sim week moves about as much as a real month, so 7 rounds feel eventful.  
* **Interface:** PriceProvider with snapshot() and step(round): Candle\[\]. Ship SimPriceProvider in v1. HistoricalReplayProvider (real candles from a past date range) and LivePriceProvider come later and plug in without changing game code.

Starting parameters per class (daily, tune in config):

| Class | Beta | Own volatility σ | Notes |
| :---- | :---- | :---- | :---- |
| WBTC / cbBTC / tBTC | 0.8 | 2.5% | Market anchor; tracks BTC |
| ETH, LSTs | 1.0 | 3.5% | LSTs track ETH with ±0.2% noise |
| Large-cap ERC-20s (e.g. LDO, ENS) | 1.3 | 5% |  |
| DeFi / infra | 1.2 | 6% |  |
| Memecoins (ERC-20) | 1.8 | 12% | Fat tails: 3% daily chance of a ±25% jump |
| Stablecoins (USDC, USDT, DAI/USDS) | 0 | 0% | Depeg event only |
| NFT floors | 0.9 | 4% | Affect relic tier only (see NFTs) |

## **Units**

Every unit type has fixed stats. Position value only decides how many units of that type you field. A 20% price rise means about 20% more units; it never means stronger ones.

**Squad size**

\\text{count}\_i \= \\left\\lfloor \\frac{q\_i \\times p\_i}{\\text{UNIT\\\_VALUE} \\times \\text{costMult}\_i} \\right\\rfloor

* UNIT\_VALUE is fixed once per match at setup: the larger of the two starting army values (excluding stables and NFTs), divided by 120\. So the bigger side starts with about 120 units and the smaller side proportionally fewer. Size matters, and the unit count stays renderable.  
* costMult balances strong units against weak ones (a Titan costs more value than a goblin).  
* Squads recompute after every Market phase and every trade.  
* **Render cap:** above 300 units per side, units merge into stacks (one entity with a ×N multiplier and a banner showing N). The simulation treats a stack as N units for damage and HP.

**Combat roles and counters**

Roles: Melee, Ranged, Cavalry, Swarm, Siege, Support. Counter triangle: Cavalry beats Ranged, Ranged beats Melee, Melee beats Cavalry (+50% damage each). Swarm takes \+50% from area attacks. Siege units deal triple keep damage but only 0.5× damage to units.

**Curated roster (v1; data-driven, extend via units.json)**

| Token (Ethereum) | Unit | Role | costMult | HP | ATK | Range | Speed | Siege | Ability |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| WBTC, cbBTC, tBTC | Bitcoin Titan | Siege | 3 | 60 | 8 | 1 | 0.6 | 6 | Hardened: takes −30% damage |
| ETH, WETH | Ether Paladin | Melee | 2 | 30 | 6 | 1 | 1.0 | 2 | Heals adjacent allies 2 HP/s |
| stETH / other LSTs | Staked Paladin | Melee | 2 | 34 | 5 | 1 | 0.9 | 2 | Starts each battle with a 10 HP shield |
| LDO | Lido Lancer | Cavalry | 1.5 | 18 | 6 | 1 | 2.0 | 1 | Charge: first hit ×2 |
| LINK | Oracle Archer | Ranged | 1.2 | 10 | 5 | 5 | 1.0 | 1 | Reveals stealth; \+25% crit |
| UNI | Swap Mage | Ranged | 1.5 | 12 | 4 | 4 | 0.9 | 1 | Every 8 s, swaps places of two enemy units |
| AAVE | Ghost Lender | Support | 1.5 | 14 | 3 | 3 | 1.1 | 1 | Drains 20% ATK from its target |
| MKR / SKY | Vault Warden | Melee | 2 | 40 | 3 | 1 | 0.8 | 1 | Taunts nearby enemies |
| ENS | Name Rider | Cavalry | 1 | 12 | 4 | 1 | 1.8 | 1 | — |
| SHIB | Shiba Pack | Swarm | 0.5 | 5 | 2 | 1 | 1.6 | 1 | Pack bonus: \+1 ATK per 10 allies nearby |
| PEPE | Frog Swarm | Swarm | 0.4 | 4 | 2 | 1 | 1.5 | 1 | Explodes on death: 3 area damage |

**Category fallback (any token not in the roster)**

| Category | Unit | Role | costMult | Notes |
| :---- | :---- | :---- | :---- | :---- |
| Large-cap ERC-20s | Knight | Melee | 1.5 | Solid generic line |
| DeFi governance | Battle Mage | Ranged | 1.3 | Small area attack |
| Infra / oracle | Scout Archer | Ranged | 1.1 | Long range, low HP |
| Memecoins | Goblin Swarm | Swarm | 0.5 | Cheap, fragile, many |
| RWA / gold-backed (e.g. PAXG) | Stone Golem | Siege | 2.5 | Slow tank |
| AI / gaming | Construct | Support | 1.3 | Buffs nearby ATK \+10% |
| misc | Militia | Melee | 1 | Default |

Category comes from a static token→category map maintained in data. The wallet importer may fill gaps using the existing visualization's metadata where it has any.

## **Castle and keep**

Stablecoins are the walls. They produce no units, but they set the keep's maximum HP. This creates the game's core tension: every dollar moved into stables makes you harder to kill and weaker on offense.

\\text{KeepHP}\_{\\max} \= 100 \+ 2 \\times \\frac{\\text{stableValue}}{\\text{UNIT\\\_VALUE}}

* **HP is persistent across rounds**: damage taken stays taken.  
* **Swapping into stables** raises max HP, and current HP rises by the same amount. Walls get built visibly, and couriers deliver the stones.  
* **Swapping out of stables** lowers max HP, and current HP is clamped to the new max. Converting walls back into an army has a cost.  
* **Damage states** in the existing castle mesh: cracks at 75%, a breached outer wall at 50%, a burning keep at 25%, collapse at 0%.  
* **Siege damage** each round \= the sum of Siege values of the enemy's surviving units. A Momentum or Siege multiplier from events applies on top.  
* The keep has no attack of its own in v1. It does count as a capture-proof structure for abilities that target buildings.

## **Protocols**

Protocols matter in two ways. Having a position in a protocol gives you that protocol's battle ability. Separately, the protocol's building stands on the battlefield and can be captured by either side.

**1\. Positions grant abilities**

Each protocol is a building type in the existing city. Protocols are grouped by function, so any lending protocol behaves like "Lending". Curated protocols reskin the building and rename the ability.

| Function (curated example) | Position mechanics | Battle ability (auto-cast) |
| :---- | :---- | :---- |
| Staking (Lido) | Stake ETH → LST. Units become Staked Paladins. Unstaking takes 1 round. | **Validator Shield:** at 10 s, all your Melee units get \+10 HP shield |
| Restaking (EigenLayer) | Wrap an LST. \+3% value per round in yield. | **Slashing Guard:** \+15% HP to Staked units, but a Slashing event can burn 10% of the position |
| DEX LP (Uniswap) | Deposit two tokens. Earns 1% of pool value per round in fees and suffers simulated impermanent loss. Units are spawned for both tokens. | **Flash Swap:** every 12 s, swaps the positions of your weakest squad and your strongest squad |
| Lending supply (Aave) | Supply a token. Earns 1.5% per round. Units still spawn from supplied tokens. Required to borrow. | **Flash Loan:** at 20 s, \+50% units of your largest squad for 8 s, then they vanish |
| Borrowing (Aave) | Borrow up to the LTV limit. Borrowed tokens spawn units (leverage). See Liquidations. | — (borrowing is the ability: a bigger army) |
| Stable vault (Maker / Sky) | Mint stables against collateral. Raises keep HP without selling. | **Emergency Shutdown:** once per match, at keep HP \< 25%, the keep is immune for one Siege phase |

Yields and fees are paid at the start of each Market phase, into the position itself.

**2\. Buildings on the battlefield**

* The city between the two castles holds 3–5 neutral protocol buildings, chosen from the protocols either side uses, plus fill.  
* A side captures a building by holding it uncontested with 5+ units for 4 s. Ownership persists into the next battle.  
* **Home advantage:** if you have a position in that protocol, you capture it at double speed.

| Building | Owner's buff during the battle |
| :---- | :---- |
| Bank (lending) | \+10% ATK |
| Exchange (DEX) | \+20% move speed |
| Temple (staking) | Heal 1 HP/s in radius |
| Vault (stables) | \+5% keep HP max (applies at round end) |
| Oracle Tower | \+1 range for Ranged units |

## **NFTs as relics**

NFTs are relics: passive buffs slotted into the keep. They spawn no units, and their value is excluded from UNIT\_VALUE and from army value.

* **3 relic slots.** Relics are slotted during the Trade phase. Changing a relic costs one action's gas.  
* **Tier** comes from the collection's floor value relative to UNIT\_VALUE: Common (\< 1×), Rare (1–5×), Epic (5–25×), Legendary (\> 25×). Effects scale ×1 / ×1.5 / ×2 / ×3. Floors move with the price sim, so a relic can be upgraded or downgraded between rounds.  
* **Curated collections** get named relics, for example: a punk-style PFP collection gives \+Siege to all units; an ape-style PFP gives \+HP to Swarm units; a generative-art collection gives \+1 range to Ranged units. The exact collections are chosen in relics.json.  
* **Fallback:** any other Ethereum (ERC-721/1155) collection gets a relic picked deterministically from a generic pool, by hashing the contract address. The same NFT always yields the same relic.  
* **In sim mode,** players add NFTs from a list of example collections with editable floor values.

| Generic relic | Effect at Common tier |
| :---- | :---- |
| Banner of the Bull | \+5% ATK while the market regime is Bull |
| Bear Pelt | \+8% HP while the market regime is Bear |
| Mason's Seal | \+5% keep HP max |
| Gas Rebate | −25% gas cost per action |
| Liquidator's Eye | Your Health Factor warnings appear 1 candle earlier, and liquidation penalty −2 pts |
| War Drum | \+10% speed for the first 10 s of battle |

## **Leverage, liquidations and market events**

Leverage is the high-risk way to a bigger army. Market events are the shared shocks that make both players react.

**Borrowing**

* Supply collateral to a lending building, then borrow any token up to the LTV limit (default 70%; memecoins cannot be collateral). Borrowed tokens spawn units like any other holding.  
* Debt grows 2% per round.  
* **Health Factor** HF \= (collateral value × liquidation threshold 0.8) / debt value. It is shown on the HUD as a gauge per loan.

**Liquidations**

* HF is checked on **every daily candle** in the Market phase, so a crash mid-week can liquidate before you can react.  
* When HF \< 1, 50% of the debt is repaid by seizing collateral worth the repaid amount \+ 10% penalty. This repeats until HF ≥ 1\.  
* **On the battlefield:** at the start of the next battle, the squad built from the seized collateral appears and then **detonates** at 3 s. It deals 3 area damage to *your own* nearby units. A liquidation always gets a visible, painful moment.  
* **Warnings:** HF \< 1.2 turns the gauge amber, and the courier at that lending building waves a red flag. In the Trade phase, one-tap "Repay" and "Add collateral" actions are shown.

**Market events**

Each Market phase has a 40% chance of an event, chosen by seeded weight. The event for round N+1 is **rumored** during round N's Trade phase with 70% accuracy ("Whispers of a depeg…"), so de-risking is a real choice.

| Event | Effect | Battlefield look |
| :---- | :---- | :---- |
| Black Swan | All non-stable assets −20% to −35% across the week | Storm over the city |
| Bull Run | Market drift strongly positive this week | Golden light, banners |
| Meme Mania | Memecoins \+60% this week, −30% guaranteed next week | Goblins dancing on rooftops |
| Depeg | One stablecoin drops to 0.85, recovers 50% per round after | That keep's wall section crumbles |
| Rug Pull | One random fallback-category token −90% | Its squad flees off-map |
| Gas Spike | Gas ×5 in the next Trade phase | Couriers move slowly, carrying lanterns |
| Slashing | Restaked positions −10% | Lightning hits the Temple |
| Airdrop | Each side receives a token worth 3 × UNIT\_VALUE | A cart arrives at both castles |

**Gas and fees** (keep trading meaningful but not spammy): each action costs 0.1 × UNIT\_VALUE of gas, paid in ETH (falling back to stables if the side holds no ETH). Swaps cost a 0.3% fee plus slippage of 0.5% per 10 × UNIT\_VALUE of trade size.

## **Auto-battle resolution**

Battles are a deterministic fixed-step simulation that runs headless (in a Web Worker) and streams state to the renderer. The same seed and inputs always produce the same outcome.

* **Tick rate:** 20 Hz logic; the renderer interpolates. Maximum 45 s \= 900 ticks.  
* **Map:** a 2D logical plane mapped onto the city. There are 3 lanes (left, center, right) along city streets between the castles, with buildings at the junctions. Squads are assigned to lanes round-robin by role: Cavalry on the flanks, Siege in the center.  
* **Spawn order:** Melee in front, then Ranged and Support, then Siege at the back.  
* **Targeting:** nearest enemy within aggro radius 6\. Otherwise, the next uncaptured or enemy building on the lane. Otherwise, the enemy keep. Taunt overrides.  
* **Damage per hit:** ATK × counter multiplier × buffs. Attack interval is 1 s for all units (stats already encode the differences).  
* **Abilities** fire on timers or conditions as listed. Protocol abilities belong to the side, not to a unit, and show as a banner when cast.  
* **End:** one side has no units, or the timer expires. Then the Siege phase runs, where every survivor on either side hits the opposing keep.  
* **Spatial queries:** a uniform grid / spatial hash. The budget is 600 entities total at 20 Hz with headroom (stacks enforce this).  
* **Output:** an event stream (spawn, move, attack, death, ability, capture, detonate, siege) for rendering and replays.

## **NPC opponents**

NPCs play by exactly the same rules and through the same command API as the player. Difficulty changes only their starting value and decision quality, never hidden information.

| Archetype | Starting portfolio | Trading personality |
| :---- | :---- | :---- |
| Degen | 60% memecoins (PEPE, SHIB), 30% large-cap ERC-20s, 10% stables; borrows early | Chases the best performer from last round; ignores most rumors; maxes leverage |
| Whale | 45% WBTC, 35% ETH, 20% stables | Rarely trades; buys dips after Black Swan; slow but huge |
| Stable Maxi | 60% stables, 25% ETH (staked), 15% WBTC | Turtles behind a big keep; moves into risk only when ahead on keep HP |
| Yield Farmer | LP positions, supplied assets, LSTs, restaking | Maximizes protocol abilities and building captures; rebalances LP |

| Difficulty | Starting value vs player | Behavior |
| :---- | :---- | :---- |
| Easy | 0.7× | 1 action per Trade phase, random within personality; ignores rumors; never manages Health Factor |
| Normal | 1.0× | Up to 3 actions; reacts to rumors 50% of the time; repays debt at HF \< 1.15 |
| Hard | 1.25× | Up to 5 actions; counter-picks your largest role via the counter triangle; de-risks before rumored crashes; keeps HF \> 1.4 |

Implementation: a utility-scoring planner. Each candidate action is scored as personality weight × expected army value change × risk penalty, and the top N actions are taken, where N comes from difficulty. Everything is seeded.

## **Balance and size scaling**

Portfolio size matters directly: a side with twice the army value fields twice the units. Three guardrails keep this from becoming "biggest wallet wins": the match cap, NPC value matched to the player, and future PvP matchmaking by size tier.

* **Match cap** (default \$1M) applies to imports and to the editor.  
* **Future PvP:** players are matched within tiers of log10(portfolio value) (\$1k, \$10k, \$100k, \$1M). Cross-tier play is opt-in.  
* **Balance targets** (to verify with an automated headless sim of 1,000 NPC-vs-NPC matches per archetype pair):  
  * Median match length is 5–7 rounds; under 5% of matches reach sudden death.  
  * No archetype wins more than 60% against any other at equal value and difficulty.  
  * Holding 100% stables never wins; holding 100% memecoins wins 35–50% with high variance.  
  * At least 1 liquidation occurs in 30–50% of matches that include borrowing.  
* **All numbers** in this spec live in config/balance.ts, units.json, relics.json, and events.json. Nothing is hard-coded in systems.

## **Integration with the existing visualization**

The game reuses the existing R3F city: the wallet castle becomes the player's keep, a mirrored castle is added for the opponent, and protocol buildings become battlefield buildings. **The implementing agent must first audit the existing repo** and write a short mapping note (existing component → game role) before changing anything.

**Reuse**

* **Castle mesh** → keep, plus four damage states (new variants or decals).  
* **Protocol building meshes** → battlefield buildings, plus a capture ring and an owner-color banner.  
* **Couriers** → Trade-phase animation only. Each trade action spawns a courier that carries the source token from the castle to the protocol building and returns with the result. Swaps go to the DEX, borrows go to the Bank, and so on. Gas Spike slows couriers. The Trade phase ends only after the last courier has left; arrival is cosmetic.  
* **Existing data layer / wallet loading** → wrapped by WalletImporter; it is not modified.

**New**

* Unit models built per **Unit assets** below, rendered as one InstancedMesh per unit type. HP bars and squad banners use the same overlay/material style as the existing visualization's labels.  
* An opponent castle and a symmetric city layout. If the existing layout is wallet-driven, a battle-arena layout generator.  
* VFX: hit sparks, detonation, siege impacts, event weather.  
* HUD (HTML overlay):  
  * price ticker with candles  
  * regime badge  
  * portfolio panel (positions → squad counts)  
  * Health Factor gauges  
  * keep HP bars  
  * round/phase timer  
  * rumor card  
  * trade panel  
* Camera: overview during Market/Trade, a lane-follow option during Battle.  
* The existing "visualization only" mode stays reachable; the game is an additional mode.

**Unit assets: reuse first, then extend in the established style**

Units must look like they belong to the existing city. Use what already exists wherever possible. Make anything new with the same process and constraints as the current assets, not a new art style.

1. **Inventory (part of M0).** List every existing model, material, texture and animation. Also document how they were produced:  
   * modeling approach (procedural geometry in code vs. GLTF from a 3D tool)  
   * poly and texture budgets  
   * palette and color rules  
   * material/shader setup  
   * scale reference  
   * naming, file and folder conventions  
   * export settings

   Write this up in the mapping note as an **asset style guide**.

2. **Reuse map.** For each unit type, choose the first option that works:  
   1. an existing asset as-is;  
   2. a variant of an existing asset, for example a courier body with a different tint, scale, or added parts;  
   3. a new asset, only when nothing existing fits.

   Record the choice in a table: Unit · Source (reuse / variant / new) · Base asset · Changes.

3. **New assets follow the existing pipeline.** Use the same tooling, budgets, palette, materials and file conventions. Do not add third-party asset packs or a different art style unless the existing pipeline already uses them.  
4. **Token identity.** Units show which token they come from the same way the existing visualization already does (for example the color, logo or label it puts on couriers and buildings).  
5. **Placeholders.** For M3, placeholders are reused or variant existing assets, not generic primitives, so the battle reads correctly from the start.

## **Architecture and data model**

The game core is pure, deterministic TypeScript with no React or Three.js imports. Players and NPCs change state only through serializable commands. Rendering only consumes events. This makes v1 testable headlessly and makes PvP a networking problem, not a rewrite.

**Determinism rules**

* One seeded PRNG (e.g. mulberry32 or sfc32) per subsystem (market, events, battle, NPC), all derived from the match seed. Math.random is never used in the core.  
* Fixed timestep. No wall-clock reads in the core.  
* A match replay is {seed, config version, initial portfolios, command log}.  
* Use integer or fixed-point (micro-units) math for portfolio quantities to avoid float drift across machines.

**Core types (sketch)**

type AssetId \= string; // Ethereum contract address (or 'eth' for native ETH), or a sim id

interface Asset { id: AssetId; symbol: string; category: Category; curatedUnit?: UnitTypeId; isStable: boolean; }

interface Position {  
  asset: AssetId; qty: bigint;          // fixed-point  
  kind: 'spot' | 'staked' | 'restaked' | 'lp' | 'supplied' | 'borrowed';  
  protocol?: ProtocolFn;                // 'staking' | 'dex' | 'lending' | 'vault' | 'restaking'  
  pairWith?: AssetId;                   // LP  
  unlocksAtRound?: number;              // unstaking delay  
}

interface Portfolio { positions: Position\[\]; relics: RelicSlot\[\]; }

interface SideState { id: 'A' | 'B'; portfolio: Portfolio; keepHp: number; keepHpMax: number; buildingsOwned: BuildingId\[\]; isNpc: boolean; npc?: { archetype: Archetype; difficulty: Difficulty }; }

interface MatchState { seed: string; round: number; phase: 'market' | 'trade' | 'battle' | 'siege' | 'ended'; unitValue: number; prices: Record\<AssetId, number\>; regime: Regime; pendingRumor?: EventId; sides: \[SideState, SideState\]; }

type Command \=  
  | { t: 'swap'; from: AssetId; to: AssetId; qty: bigint }  
  | { t: 'stake' | 'unstake' | 'restake'; asset: AssetId; qty: bigint }  
  | { t: 'lpAdd' | 'lpRemove'; a: AssetId; b: AssetId; qty: bigint }  
  | { t: 'supply' | 'withdraw' | 'borrow' | 'repay'; asset: AssetId; qty: bigint }  
  | { t: 'slotRelic'; nft: string; slot: 0 | 1 | 2 }  
  | { t: 'endTrade' };  
**Modules**

| Module | Responsibility |
| :---- | :---- |
| data/WalletImporter | Wraps the existing visualization's wallet data → Portfolio |
| data/PriceProvider | Interface; SimPriceProvider in v1, historical replay and live later |
| core/Ledger | Applies commands: fees, gas, slippage, LTV, yields, IL, liquidations |
| core/Market | Regimes, candles, events, rumors |
| core/ArmyBuilder | Portfolio \+ prices → squads (count formula, stacks, relic buffs) |
| core/BattleSim | 20 Hz deterministic battle → event stream |
| core/MatchController | Phase state machine, keep HP, win check, Momentum |
| ai/NpcPlanner | Archetype \+ difficulty → commands |
| render/\* | R3F scene, instancing, VFX, couriers, camera |
| ui/\* | HUD, Portfolio Editor, trade panel |
| sim/HeadlessRunner | Batch NPC-vs-NPC matches for balance reports |

State management on the React side: a thin store (e.g. Zustand) holding the latest snapshot plus the event queue. Core simulation runs in a Web Worker, communicating via postMessage.

## **Milestones and acceptance criteria**

Build headless-first: the core must be playable and testable in Node before any new 3D work. Each milestone is a mergeable slice.

| \# | Milestone | Done when |
| :---- | :---- | :---- |
| M0 | Repo audit | Mapping note exists (existing components → game roles), including the asset style guide and the unit reuse map; game mode toggle stubbed |
| M1 | Deterministic core | Ledger, Market, ArmyBuilder, MatchController with unit tests; the same seed \+ commands give byte-identical state across runs; 7-round match completes headlessly |
| M2 | Portfolio setup | Import from an existing wallet, editor with cap/dust rules, 5 templates, blank budget build, local loadouts |
| M3 | Battle sim \+ rendering | BattleSim at 20 Hz in a Worker; 600 entities at 60 fps on a mid-range laptop; instanced units, HP bars, keep damage states; replay from event log |
| M4 | Trade phase | All commands in the UI, fees/gas/slippage, couriers animate each action, 30 s timer with pause |
| M5 | Depth systems | Protocol abilities \+ capturable buildings, borrowing \+ per-candle liquidations \+ detonation, 8 events with rumors, relics |
| M6 | NPCs | 4 archetypes × 3 difficulties via the command API only |
| M7 | Balance pass | Headless runner report meets the targets in Balance; config values tuned |

**Test checklist for the implementing agent**

* ☐ Squad count formula, including costMult and stacks  
* ☐ Keep HP max/current behavior on swaps into and out of stables  
* ☐ Liquidation triggers on an intra-week candle, not only at week end  
* ☐ LP impermanent loss matches the constant-product formula  
* ☐ Rumor accuracy is \~70% over 10,000 seeded draws  
* ☐ NPC never issues a command a human couldn't

## **Assumptions and open questions**

The interview did not settle these points. Each one is set to a default the implementing agent can build on; change the default here if you disagree.

| Topic | Default in this spec | Alternative |
| :---- | :---- | :---- |
| Battle casualties | Don't burn tokens; armies rebuild each round | Casualties permanently reduce positions (harsher, more "real") |
| Unit scale | UNIT\_VALUE \= larger starting army value ÷ 120, fixed per match | Fixed \$ per unit across all matches (true absolute size, harder to render) |
| Wallet import cap | Scaled down to \$1M | Hard reject above the cap |
| Real PnL link | None; the sim is fully separate from real funds | Show a "what this would have done for real" recap |
| Unit stats | Placeholder numbers in Units | Designer pass before M7 |
| Art direction | Reuse existing assets first; new units follow the existing asset style and production process | — |

**Open questions**

* Should the player be able to pause during the Battle phase to inspect (no input), or is the battle watch-only?  
* Is a post-match recap screen wanted (PnL chart, liquidations, MVP squad)?  
* Should loadouts be persisted beyond local storage (an account or a wallet signature)?  
* For later PvP: synchronous lockstep with a shared seed, or async battles against saved snapshots?

[image1]: <data:image/png;base64,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>