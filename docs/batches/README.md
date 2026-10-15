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
| 5 | Category buildings, classes XS and L (14) | [04](04-category-buildings.md) | blender-3e | XS checked (waiting for the user's look); L in progress |
| 6 | Category buildings, class XL (7) | [04](04-category-buildings.md) | blender-3e | next after 5 |
| 7a | Landmarks XL: Lido, Spark, EigenLayer, then Maker, Ethena, Morpho | [07a](07a-landmarks-xl.md) | design agent "landmarks" | all six checked; waiting for the user's look |
| 7b | Landmarks L: Uniswap, Compound, Curve, Rocket Pool, Fluid, Pendle, Convex | [07b](07b-landmarks-l.md) | design agent "landmarks-l" | checked; waiting for the user's look |
| 7c | Landmarks M and S: Frax, Yearn, Euler, Balancer, Blur, Across, Zora, Gondi | [07c](07c-landmarks-m-s.md) | blender-e2 | 7 of 8 built and checked in the game (no renders yet); Gondi to build |
| 7d | Landmarks XS: 1inch, OpenSea, ENS, SushiSwap, CoW, Stargate, Safe, ParaSwap, Kyber, LI.FI | [07d](07d-landmarks-xs.md) | blender-e2 | OpenSea, ENS built; SushiSwap broken mid-build; 7 to build |
| 11 | Townsfolk: the base helper and one per category | [11](11-townsfolk.md) | blender-f3 | checked; waiting for the user's look |
| 12 | Cargo (t0–t6), animals, props, trees, rocks, hill | [12](12-life-and-props.md) | blender-f3 | checked; waiting for the user's look |
| 13 | 2D art: icons, badges, ranks, app icons, effects | — | — | own short guide first |

The landmark classes come from each protocol's value on Ethereum (`src/castle/world/tvl.json`), so a protocol may change class when the snapshot is renewed. Batch 3 (castle wings) was dropped: castle layout 2 has none.

**Looking at a batch in the game:** `/?theme=medieval-castle-v2&preview=lido,spark,eigenlayer` puts those landmarks into the town at their real value. `preview=lending:5e6,dex:2e8` puts in category buildings at a given value (a $5M lending protocol, a $200M exchange).

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

