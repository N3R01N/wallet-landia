# Wallet-landia: World Bible

How every on-chain concept appears in the RPG world. This is the source of truth for visual and naming decisions. When a new on-chain concept shows up, add it here before building it.

> Working tone: **cosy Stardew-like fantasy town**, readable for newcomers. Each metaphor should **teach** the real concept instead of hiding it, so hover text always names the real thing ("Aave Counting House · lending protocol").
>
> **Everything visual is a swappable slot** (see §8). The Stardew look is just the default asset pack, not hard-coded. Players can mix and match packs per slot, and later build and sell their own.

---

## 0. The value scale (one legend for everything)

Newcomers need to estimate value at a glance, so **every** value-carrying thing uses the same log-scale tier and colour:

| Tier | USD range | Colour (rarity) | Hero mount | Caravan (tx size) |
|---|---|---|---|---|
| 0 Dust | < $10 | grey | barefoot, walking stick | empty-handed |
| 1 Common | $10 – 100 | white | on foot, small pack | coin pouch |
| 2 Uncommon | $100 – 1k | green | donkey | saddlebags |
| 3 Rare | $1k – 10k | blue | horse | pack mule |
| 4 Epic | $10k – 100k | purple | armoured warhorse | cart |
| 5 Legendary | $100k – 1M | orange | griffin | wagon train |
| 6 Mythic | > $1M | gold | dragon | royal convoy |

- Item frames, building stash chests, caravans and mounts all use this tier.
- The rough figure ("~$12k") appears on hover; exact values appear in drill-down panels.
- Tier boundaries are config, not code, so they can be tuned.

---

## 1. Who acts

| On-chain | World | Notes |
|---|---|---|
| **User / player** | **Guild** with a crest and banner | Crest is generated from the first wallet address, and the player can customise it later. |
| **Wallet (EOA)** | **Hero** | Mount = net-worth tier. Class = behaviour (below). Name = ENS name, or a generated fantasy name seeded from the address ("Aldric Ashford"). |
| **Smart account: Safe multisig** | **Order of Knights**: a hero with a council of *m* shield-bearers | Its shield shows *n-of-m* seals. When it acts, the bearers gather and stamp the scroll. |
| **Smart account: ERC-4337** | Hero with an **artificer golem companion** | The golem (bundler/paymaster) can carry out errands and pay tolls for the hero. |
| **EIP-7702 delegated EOA** | Hero with **glowing runes** on their armour | Shows that the hero has been "enchanted" with contract code. |
| **Connected (own) wallets** | Heroes wearing **your guild banner** and colours | They live in the Guild Quarter of *your* town. |
| **Followed wallets** | **Other towns** that you **visit** in a separate mode (see §7) | They don't live in your town. A **signpost / travel map** at your Town Gate lists followed towns. When you send to a followed wallet, the recipient appears at your gate as a **named traveller carrying their crest**. |
| **Unknown counterparties** | **Travellers / villagers** who appear at the town gate | They're generic NPCs: hooded figures, merchants. |
| **Labelled counterparties** | **Named NPCs** (e.g. "Binance Trading Company" caravan, "Notorious Bandit" for a known exploiter) | Label sources come later. |
| **Your own wallet → your other wallet** | Guild members passing goods inside the **Guild Hall** | Shown differently from external sends so internal shuffling doesn't look like spending. |

### Hero class (suggested from behaviour, player can override)
Class decides outfit and weapon. Mount (value) and class (behaviour) are separate, so a poor trader and a rich trader look clearly different.
The class is **auto-suggested** from the last 30 days of activity. The player can **pick a different one** per hero, and the choice is stored locally. The suggestion stays visible ("The town sees you as a Merchant").

| Dominant activity | Class | Look |
|---|---|---|
| Swaps | **Merchant / Rogue** | Coin scales, cloak, dagger |
| Staking / yield | **Monk / Farmer** | Robes, staff, seed pouch |
| Lending / borrowing | **Banker / Paladin** | Ledger, heavy armour |
| NFTs | **Collector / Bard** | Feathered hat, lute, frames on their back |
| Mostly transfers | **Courier / Ranger** | Satchel, bow, ravens |
| Mixed | **Adventurer** | Generic armour |
| No activity in 30 days | **Sleeper** | Napping on a bench at home, cobwebs |

---

## 2. Hero home (the drill-down into holdings)

Each hero has a **home on the Guild Quarter square**. Clicking it opens the **Treasure Room / Character Sheet** (the inventory view).

- **Home size = value tier** (net worth, same scale as §0): T0 bedroll → T1 tent → T2 cottage → T3 house → T4 manor → T5 keep → T6 castle. The mount and home agree on purpose, which reinforces the value reading.
- *Deferred:* wallet **age** as wear and tear (moss, weathered stone, old banners). Not built for now.
- Ambient detail on the home: lit windows = recent activity, a "!" over the door = something needs attention (claimable rewards, risky approval, low health factor), and a junk pile by the fence = spam tokens.

### Inventory: assets as items
| On-chain asset | Item | Notes |
|---|---|---|
| **ETH** (native coin) | **Gold coins** | The realm's currency. Tolls are paid in gold. |
| **Stablecoins** (USDC, USDT, DAI) | **Silver bars / stamped banknotes** with the issuer's seal | Stable means a calm silver look. |
| **Wrapped tokens** (WETH, WBTC) | **Sealed chests** of the underlying coin | Same value, different packaging. |
| **Blue-chip / governance tokens** (UNI, AAVE) | **Guild seals / charters** | They grant votes at the Council Hall. |
| **Memecoins** | **Odd trinkets and creatures in jars** (frogs, dogs) | They wobble and jiggle, which hints at volatility. |
| **Liquid staking tokens** (stETH, rETH) | **Blessed gold** (gold with a soft glow) | It slowly gets brighter as it earns. |
| **Receipt tokens** (aTokens, vault shares, LP tokens) | **Deeds / claim tickets** with the issuing building's seal | "This paper says you own something stored at X." |
| **Debt tokens** | **Red-sealed IOU scrolls**; the hero drags a **ball and chain** sized by debt tier | Debt counts *against* net worth. |
| **NFT: art / PFP** | **Paintings and portraits** hung in the home's gallery | |
| **NFT: collectibles / POAPs** | **Medals and badges** on the character sheet | |
| **NFT: Uniswap v3 position** | **Deed to a market stall** | It's a liquidity position. |
| **NFT: ENS name** | **Name plaque / title deed** | The primary ENS name becomes the hero's name. |
| **NFT: locks** (veCRV etc.) | **Oath scroll with an hourglass** | Shows the unlock date. |
| **Spam / scam tokens** | **Cursed junk** in a midden outside the fence, "Unopened letters from strangers" | Hidden from the inventory by default. Scam ones are marked cursed. |

- Item frame colour = value tier. Stacks show quantity, and hover shows the exact amount and USD value.
- Small items below a threshold are grouped into **"a pouch of odds and ends"** so the inventory doesn't explode.

### Keyring: token approvals
Each approval is a **key the hero gave to a building's keeper**.
- Limited approval = a plain key. Unlimited = a **master key**, glowing red.
- A key held by an unknown or flagged contract = a **cursed key**.
- Revoking = taking the key back (later a quest: "Recover your lost keys").

---

## 3. The town: protocols as buildings

Generated buildings use **an archetype per category, the protocol logo on a sign/banner/shield, and the brand colour as roof/banner colour**. Building size = the protocol's global significance (TVL tier, from config). Your stake in it is shown separately as your **guild banner on its wall plus a stash chest** sized by your position's tier.

| Protocol category | Building | Inside (your account there) |
|---|---|---|
| **DEX** (Uniswap, Curve) | **Bazaar / money-changer stalls** around a **liquidity fountain** | Your stall deeds (LP positions), fees earned (coins in the fountain) |
| **Aggregator / router** (1inch, CoW, 0x) | **Broker's office**: a broker NPC runs between stalls for you | Routing history |
| **Lending** (Aave, Compound, Morpho) | **Counting House / Bank** with vaults | Collateral vault, IOU ledger, **the Banker's Scale** (health factor) |
| **Liquid staking** (Lido, Rocket Pool) | **Temple** on the hill; monks are the validators | Offered gold, blessed gold received, withdrawal tickets with an hourglass |
| **Restaking** (EigenLayer) | **Paladin Order barracks**: your blessed gold is sworn to extra oaths | Oaths sworn, slashing-risk banner |
| **Yield vaults** (Yearn, Pendle) | **Alchemist's tower** with bubbling cauldrons | Your brews (vault shares). Pendle splits into "principal" and "yield" essences. |
| **NFT marketplace** (OpenSea, Blur) | **Auction House / Gallery** | Listings, bids, sales |
| **Bridges** | **Harbour / Portal Gate** at the edge of town | Ships to other realms (later phases) |
| **Governance / DAO** | **Council Hall** with a voting urn | Votes cast, delegations |
| **ENS** | **Hall of Names / Herald's office** | Names owned, renewals |
| **WETH contract** | **Packing House** (crates gold into sealed chests) | |
| **NFT minting contracts** | **The Forge / Atelier** | Commissions (mints) |
| **Airdrop distributors** | **Festival cart / Royal Herald** | |
| **CEX deposit addresses** | **Trading Company docks**: goods leave the realm | |
| **Unknown / unverified contracts** | **Mysterious tents and fog-shrouded ruins** in the Wilds, marked "?" | Always the fallback. Nothing goes unrepresented. |
| **Known-malicious contracts** | **Thieves' Den** (red lanterns, skull sign) | |

### Positions
- Your money *inside* a protocol is a **stash chest** in that building, with your banner on the outside.
- **Claimable rewards** = a harvest pile growing next to your stash, and a "!" quest marker over the building.
- **Lending health factor** = the **Banker's Scale**. When it's balanced and green you're safe. As it tips, **bailiffs** start gathering outside, and in a liquidation they march to the vault.
- **Withdrawal queues and unlocks** = a ticket or oath scroll with an **hourglass**.

### Town layout (districts)
```
                 [ The Wilds: fog, tents, ruins, Thieves' Den ]
   [Temple Hill]        [Alchemist's Lane]        [Council Hall · Hall of Names]
          \                    |                         /
 [Counting Row: banks] -- [ TOWN SQUARE + Chronicle Tower ] -- [Market District: Bazaar, Brokers, Auction House]
          /                    |                         \
 [Guild Quarter: your homes]                       [Harbour: bridges, Trading Company]
                    [ Town Gate: travellers · signpost to followed towns ]
```
- District slots are fixed. Buildings appear only for protocols your shown heroes have touched, plus a few always-on landmarks (Chronicle Tower, Bazaar, Bank, Temple).
- Layout is **deterministic** (seeded), so the same wallets always produce the same town.
- **Fog of war:** unvisited districts and buildings stay misty. This is a free hook for the later game phase.

---

## 4. The chain

| On-chain | World |
|---|---|
| **Blockchain (Ethereum L1)** | **The Chronicle**: a great ledger kept by scribes in the **Chronicle Tower** at the centre of the square |
| **Block** (~12 s) | A **page of the Chronicle**. The **tower bell tolls** and a sealed page flies out. This is the town's heartbeat and runs live off the real chain. |
| **Transactions in a block** | Entries on the page. Your entries glow in your guild colour. |
| **Validators / builders** | Scribe-monks in the tower (flavour only) |
| **Gas fee** | **Toll paid at the tower gate**. The base fee is thrown into the **sacred fire** (burned, as in EIP-1559), and the priority fee is a tip to the scribe. |
| **Gas price / congestion** | **Crowd at the tower gate** (bigger queue when busy) |
| **Mempool / pending tx** | **Waiting line at the tower gate**: heroes holding unsealed scrolls |
| **Failed tx** | The hero returns with a **torn scroll** in a puff of smoke, and the toll is still paid |
| **Finality** | The wax seal hardens (a subtle shine a few minutes later) |
| **Other chains (later)** | **Other realms** across the sea. L2s are **vassal provinces** that send tribute (batches) to the capital's Chronicle, each with its own small tower. |

---

## 5. Transactions as journeys

Every transaction is a **Journey**: the hero leaves home → (pays the toll at the tower) → travels to one or more destinations → performs an action there → returns with changed inventory. The caravan size shows value tier. The **Quest Log** is the transaction history.

| Transaction | Journey |
|---|---|
| Send ETH/token to a hero in town | Hero rides to the recipient's home and hands over a pouch |
| Send to a stranger | Hero rides to the **Town Gate** and hands it to a hooded traveller |
| Receive | A **courier raven** (or the sending hero, if they're in town) arrives at your home |
| Send/receive NFT | Delivering a wrapped painting or medal |
| Swap | Barter at a **Bazaar stall**: items go in, other items come out |
| Swap via aggregator | A **broker** NPC dashes between several stalls for you |
| Add / remove liquidity | Pour two kinds of coin into the **fountain** and receive a stall deed, or the reverse |
| Collect LP fees | Fish coins out of the fountain |
| Stake | Kneel at the **Temple**, offer gold, receive blessed gold |
| Unstake | Get a **withdrawal ticket with an hourglass**; collect later |
| Supply / withdraw (lending) | Deposit or withdraw at the **bank vault** |
| Borrow | Sign a red **IOU scroll** and receive coins; the **ball and chain** appears |
| Repay | Burn the IOU at the bank counter; the chain shrinks |
| **Liquidation** (happens to you) | **Bailiffs** seize collateral. How dramatic it is depends on the tier of the loss (see "Drama scaling" below). |
| Claim rewards | Harvest the pile at the building (the "!" turns into coins) |
| Approve / revoke | Hand a key to a keeper / take it back |
| Wrap / unwrap ETH | Packing House: crate or uncrate gold |
| Mint NFT | Commission at the **Forge**: sparks fly, an item appears |
| Buy / sell NFT | **Auction House**: bid hammer |
| Burn | Toss into the forge fire |
| Bridge (later) | Board a ship at the **Harbour** or step through a portal |
| Vote / delegate | Drop a stone in the **Council urn** / hand your seal to another hero |
| Deploy contract | The hero lays a **foundation stone** in the Wilds and a new tent appears |
| Airdrop | The **Royal Herald** drops a gift chest at your door |
| Spam token received | A goblin tosses junk over your fence |
| **Composite tx** (multicall, zap) | An **Expedition**: one journey with numbered waypoints across several buildings, shown as one entry in the Quest Log with sub-steps |
| **Flash loan** | **Phantom gold**: the banker conjures ghostly coins that must be returned before the journey ends |
| Atomic revert of a composite tx | The expedition **rewinds**: footsteps vanish backwards, and only the toll is lost |
| Unknown contract call | **"Mysterious errand"** to a tent in the Wilds (the fallback for anything we can't decode) |

### Drama scaling
Each event's **intensity** = f(value tier, verb), from 0 to 3. The intensity picks the effect level, so a $5 swap is a quiet nod and a $500k one gets fanfare. This matters most for losses:

| Loss tier | Liquidation / big loss |
|---|---|
| T0–T2 | A lone clerk pockets a few coins; a small "oof" puff |
| T3–T4 | Bailiffs march in with a cart, the alarm bell rings, the hero slumps |
| T5–T6 | **Town-wide siege**: storm clouds, alarm bells, bailiffs and wagons cart off the vault, smoke, villagers gather to watch, the camera pulls in. It leaves a lingering scar on the home for a few days. |

Positive events scale the same way (big claims → fireworks, huge airdrop → the Royal Herald arrives with a procession).

---

## 6. Ambient life (driven by real data)

| Signal | World effect |
|---|---|
| New block | The bell tolls and a page flies from the tower (live) |
| Gas price | Size of the crowd queuing at the tower gate |
| ETH 24 h price change | Weather: sun when rising, overcast or drizzle when falling, a storm on a big drop |
| Real local time | Day/night cycle, lanterns |
| Global activity per protocol (from the latest blocks) | Anonymous villagers walking into the matching buildings (a busy Bazaar means Uniswap is busy right now) |
| Accruing yield / rebasing | Crops growing, blessed gold glowing brighter |
| Hero idle time | Active heroes stroll and polish gear; dormant ones nap with cobwebs |
| Health factor | Bailiffs gathering, the scale wobbling |
| Pending tx | Your hero visibly waiting in the tower queue |

---

## 7. Views (zoom levels)

| Level | Name | Shows |
|---|---|---|
| L0 | **Realm Map** *(later, multi-chain)* | The capital (L1) plus provinces (L2s) and sea routes |
| L1 | **Town** (default) | Your heroes, the buildings they touch, journeys replaying, the Chronicle heartbeat |
| L1′ | **Visiting** (separate mode) | A followed wallet's town, generated the same way, with its own crest. Read-only, with a "return home" button. Entered through the signpost at the gate. |
| L2 | **Hero / Home**: Character Sheet | Portrait (mount + class), stats (net worth, tier, renown, tolls paid), inventory grid, keyring, "stashes abroad" list, quest log |
| L3 | **Building interior** | "Your account at Aave Counting House": stash, debts, scale, rewards, your history here, the global stats of the place |
| L4 | **Quest Replay** | One transaction as a step-by-step storyboard: route, actions, items in/out ledger, toll, outcome, link to Etherscan |
| — | **Chronicle view** | Browse pages (blocks); your entries are highlighted |

### Time
- **Chronicle Scroll** (timeline) along the bottom: last 30 days or last 100 transactions, scrubbable.
- **Replay** at selectable speeds. The default is **event time**: idle gaps are compressed so replays stay lively, and a toggle switches to wall-clock time.
- **Town Crier**: a "while you were away" summary when you return.

---

## 8. Visual slots & asset packs (modularity)

The world layer never says "draw a donkey". It says **"draw slot `mount.t2` for this hero"**. An **asset pack** fills slots, the **player's loadout** picks which pack fills each slot, and anything missing falls back to the default pack.

### Slot catalogue (initial)
| Slot family | Slot keys | Variants per slot |
|---|---|---|
| Hero body | `hero.body` | crest colours applied at runtime |
| Hero class outfit | `hero.class.{merchant,monk,paladin,bard,ranger,adventurer,sleeper}` | |
| Mount | `mount.t0` … `mount.t6` | |
| Home | `home.t0` … `home.t6` | (later: `home.wear.{0..3}` for age) |
| Item icons | `item.{native,stable,wrapped,governance,meme,lst,receipt,debt,nft-art,nft-collectible,nft-position,nft-name,nft-lock,spam,unknown}` | rarity frame applied at runtime |
| Item frames | `frame.t0` … `frame.t6`, `frame.unpriced` | |
| Buildings | `building.{bazaar,broker,bank,temple,barracks,alchemist,auction,harbour,council,names,packing,forge,herald,trading-co,tent,thieves-den,chronicle-tower,guild-hall}` | protocol logo + brand colour applied at runtime |
| Caravans | `caravan.t0` … `caravan.t6` | |
| NPCs | `npc.{traveller,courier-raven,broker,bailiff,herald,goblin,scribe,villager}` | |
| Effects | `fx.{bell,toll-fire,swap,pour,kneel,key,scroll-tear,rewind,phantom-gold,fireworks,siege}` with an intensity level 0–3 | |
| Environment | `env.{ground,path,tree,water,weather.*,sky.*}` | |
| UI skin | `ui.{panel,button,tooltip,font}` | |
| Lexicon | `lexicon.*`: text names ("Counting House", "Chronicle") | so a sci-fi pack can rename everything |

### Pack format (draft)
```jsonc
{
  "id": "stardew-default", "name": "Hearth & Harvest", "author": "...", "version": "0.1.0",
  "targets": ["2d", "3d"],           // a pack may support one or both renderers
  "slots": {
    "mount.t2": { "2d": { "sheet": "mounts.png", "frames": "donkey_*" }, "3d": { "gltf": "donkey.glb" } },
    "lexicon.building.bank": "Counting House"
  }
}
```
- Packs are **data only** (images, models, JSON), never code, so a pack can't be malicious.
- Loadout = `{ slotKey → packId }`, stored locally.
- Later: a community pack gallery, creator tools, and possibly selling packs (on-chain ownership of packs as NFTs would fit the theme nicely).
