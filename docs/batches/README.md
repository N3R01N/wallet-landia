# v2 asset batches

Every batch goes through the same loop:
1. A brief here, with sizes, file names, look, clips and checks.
2. A design agent builds the batch and runs its coplanar checker.
3. The developer reviews it in the game and sends fixes until it's right.
4. The user looks at it in the game and approves.
5. Commit.

Rules: `docs/STYLEGUIDE_V2.md`, especially §10 (lessons).

| # | Batch | Brief | Agent | Status |
|---|---|---|---|---|
| 1 | Castle core (keep, wallet halls, walls, corners, gatehouse, storehouse, tollbooth, drawbridge) | [01](01-castle-core.md) | blender-f3 | ✅ approved, committed |
| 2 | Town frame (ground, path, lit overlay, water, lilies, reeds, bell tower, bell) | [02](02-town-frame.md) | blender-f3 | checked; waiting for the user's look |
| 4a | Category buildings, class S (7) | [04](04-category-buildings.md) | design agent "categories" | checked; waiting for the user's look |
| 4b | Category buildings, class M (7) | [04](04-category-buildings.md) | design agent "categories" | checked; waiting for the user's look |
| 5 | Category buildings, classes XS and L (14) | [04](04-category-buildings.md) | blender-3e | XS and L checked; waiting for the user's look |
| 6 | Category buildings, class XL (7) | [04](04-category-buildings.md) | blender-3e | checked; waiting for the user's look |
| 7a | Landmarks XL: Lido, Spark, EigenLayer, then Maker, Ethena, Morpho | [07a](07a-landmarks-xl.md) | design agent "landmarks" | all six checked; waiting for the user's look |
| 7b | Landmarks L: Uniswap, Compound, Curve, Rocket Pool, Fluid, Pendle, Convex | [07b](07b-landmarks-l.md) | design agent "landmarks-l" | checked; waiting for the user's look |
| 7c | Landmarks M and S: Frax, Yearn, Euler, Balancer, Blur, Across, Zora, Gondi | [07c](07c-landmarks-m-s.md) | blender-e2 | checked; waiting for the user's look |
| 7d | Landmarks XS: 1inch, OpenSea, ENS, SushiSwap, CoW, Stargate, Safe, ParaSwap, Kyber, LI.FI | [07d](07d-landmarks-xs.md) | blender-e2 | checked; waiting for the user's look |
| 11 | Townsfolk: the base helper and one per category | [11](11-townsfolk.md) | blender-f3 | checked; waiting for the user's look |
| 12 | Cargo (t0–t6), animals, props, trees, rocks, hill | [12](12-life-and-props.md) | blender-f3 | checked; waiting for the user's look |
| 13 | 2D art: icons, badges, ranks, app icons, effects | [13](13-2d-art.md) | blender-e2 | ✅ approved, committed |
| 14 | The world and the sky: mountains, forests, fields, farm, windmill, river, bridge, lake, ruin, camp, meadows, clouds | [14](14-world-and-sky.md) | blender-e2 | checked in the game (2026-10-15); river joins fixed with batch 16; waiting for the user's look |
| 15 | Life: toll keeper, walk clips for the townsfolk, birds, crows, sheep, cows, deer, fish, butterflies | [15](15-life.md) | blender-3e | checked in the game with its fix round (2026-10-15: basket and vessels, gatehouse caps, door sweeps); waiting for the user's look |
| 16 | Goods changing hands: coin, NFT frame, sparkle burst, the courier's carry clip | [16](16-exchange.md) | blender-e2 | checked in the game with the river join fix (2026-10-15); waiting for the user's look |
| 17 | Wallet halls by worth (t0–t6: lean-to, cottage, townhouse, stone hall, tower house, great tower, palace spire) and by what the wallet holds (tokens, DeFi, NFTs dressing) | [17](17-wallet-halls.md) | blender-e2 (t0, t3–t6), blender-3e (t1, t2) | all seven checked in the game (2026-10-15); waiting for the user's look |
| 18 | Path shapes: bend, tee, cross, end (the kerb no longer crosses a branch) | [18](18-path-tiles.md) | blender-3e | checked in the game (2026-10-15); waiting for the user's look |
| 19 | Siege units pilot: Militia, Ether Paladin, Oracle Archer (combat clips, instancing budget) | [19](19-siege-units-pilot.md) | blender-a4 | ✅ all three approved, committed |
| 21 | Siege units, the humanoids: Knight, Staked Paladin, Vault Warden, Scout Archer, Swap Mage, Battle Mage, Ghost Lender, Goblin, Construct | [21](21-siege-units-humanoid.md) | blender-a4 | briefed (2026-10-17) |
| 20 | Siege dressing: keep and wall damage states, capture ring, owner banner | [20](20-siege-dressing.md) | blender-de | ✅ checked in the game (2026-10-17), committed |
| 22 | Siege units, creatures and mounts: Titan, Golem, Lido Lancer, Name Rider, Shiba Pack, Frog Swarm | [22](22-siege-creatures.md) | blender-de | briefed (2026-10-17) |

The landmark classes come from each protocol's value on Ethereum (`src/castle/world/tvl.json`), so a protocol may change class when the snapshot is renewed. Batch 3 (castle wings) was dropped: castle layout 2 has none.

**Looking at a batch in the game:** `/?theme=medieval-castle-v2&preview=lido,spark,eigenlayer` puts those landmarks into the town at their real value. `preview=lending:5e6,dex:2e8` puts in category buildings at a given value (a $5M lending protocol, a $200M exchange).

**Committed in 0d5a849:** every batch marked checked, except the nft and other category buildings, the market stall prop and the 7c/7d buildings not yet reviewed (Gondi, OpenSea, ENS, SushiSwap, 1inch, CoW, Stargate, Safe, ParaSwap, Kyber, LI.FI).

**Open fixes from the user's look (2026-10-15):**
- Lido: holes in the boats;
- Spark: the lantern's shutters and flicker;
- Maker: brick-coloured smoke, and the back logo plate cut by the roof;
- Rocket Pool smoke and Ethena steam: to check;
- castle keep: ✅ fixed (white smoke; the banner ends 40 cm above the porch).

The landmarks go to blender-e2 and the keep to blender-3e.
- Category buildings (blender-3e): the market stall's fruit appears from inside the stall on tap (dex and `prop.market.stall`); the nft pictures are plain colours instead of paintings; the shop's door opens inwards on tap.
- Landmarks (blender-e2): check tap items hidden inside solids (Compound, Rocket Pool, Fluid, Convex, Maker, Spark).

`preview=lending:5e6` borrows a real protocol's logo (`lending:5e6:aave` names which one), so preview category buildings show real logos.

**Fix rounds done (2026-10-15):** Spark's lantern, Rocket Pool's open side, Maker's plates; the market stall's apples (a basket), real paintings on nft, shop doors opening outwards, banner and awning clearances (check_cloth).

**Seeing everything at once:** `/showroom.html?theme=medieval-castle-v2` shows every model in one 3D scene (click to play `tap`, the tier picker shows tier parts) and all the 2D art.

**State (2026-10-15):** every batch is done and committed.
- v2 is the default theme.
- XL buildings switch to their far copy when zoomed out.
- `npm run build` compresses the models (meshopt).

Open: a performance check on a real phone, and the push.

