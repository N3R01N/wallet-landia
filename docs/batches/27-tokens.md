# Batch 27: tokens you can tell apart in flight (v2)

For the design agents. Read `docs/STYLEGUIDE_V2.md` §4, §8 and **§10**, and batch 16 (`docs/batches/16-exchange.md`). The reference is the existing coin, `public/themes/medieval-castle-v2/models/fx/coin.glb`: about 0.145 m across and 0.034 m thick, both faces a round plate in a `Logo` material (0–1 UVs, upright, white vertex colour) that the game fills with the token's icon, and a `Trim` rim the game paints.

## Why

When a courier pays, gets paid or swaps, goods stream between them. Today every token is the same gold coin with a letter on it, so a swap of USDC for ETH looks like coins for coins. The player should see **at one glance what changes hands**:

| What moves | It flies as | The game paints |
|---|---|---|
| ETH and its wrappers (WETH, stETH, wstETH, rETH, cbETH, weETH, …) | **a little 3D ETH diamond** | `Tint`: ETH's own blue-violet (#627eea), or the wrapper's colour (stETH light blue, rETH orange, cbETH Coinbase blue, …) |
| Stablecoins (USDC, USDT, DAI, USDS, PYUSD, USDe, GHO, crvUSD, …) | **a small folded banknote**, fluttering | `Tint`: the paper, in the brand colour (USDC blue, USDT teal, DAI amber, …); `Logo`: the token's icon on the note's round seal |
| Bitcoin wrappers (WBTC, cbBTC, tBTC) | **a small gold ingot** | `Logo`: the token's icon stamped in its top |
| Every other token | the existing coin | `Logo`: the token's own icon; `Trim`: its brand colour |

Many fly at once (up to a few dozen coins in a big transfer), so **all of them are tiny and cheap**. They spin or tumble in flight (the game turns them); only the banknote has a clip of its own.

## Shared rules

- **Chunky, readable at 20–30 px**, cosy, no realism. Bevelled edges so the shape catches light.
- **No alpha blending**; opaque only.
- **Origin at the piece's centre** (the game flies it by its centre); front +Z.
- **Recoloured materials:** `Tint` is painted by the game, so give it a white base colour and put the light and dark facets in **vertex colour** (`COLOR_0`, light ≈ 1.0, dark ≈ 0.55), so any tint keeps its shading. `Logo` faces: 0–1 UVs, upright, white vertex colour. `Trim` as on the coin.
- **Budgets:** ≤ 300 tris each, ≤ 3 materials, no textures except what the coin already uses.
- Files under `public/themes/medieval-castle-v2/models/fx/`.

## The pieces

| Asset (file) | Agent | Size | Look | Clips |
|---|---|---|---|---|
| `fx.eth` (`eth.glb`) | blender-74 | 0.24 m tall | **The ETH diamond in 3D**, the octahedron the logo is drawn from: an **upper body**, a square pyramid on top of a short inverted pyramid (an elongated octahedron, its widest band about 40% down), and **below it, separated by a clear gap (about 6% of the height), the lower chevron**: a hollow inverted pyramid shell (four faces meeting at the bottom point, its top rim following the upper body's lower faces), so from the front it reads as the logo's diamond over its V. All `Tint`, the four sides of each part alternating light and dark in vertex colour (the logo's two-tone facets: the left faces lighter, the right faces darker), the top pyramid's faces lighter than the band below. A slim bevel on the edges so they catch light | none (the game spins it about its vertical axis) |
| `fx.banknote` (`banknote.glb`) | blender-e0 | 0.30 × 0.15 m, folded | **A small paper banknote** folded once along its middle (the halves at about 150° to each other, a slight curl at the ends): the paper in `Tint` with a thin printed border band and a few engraving lines in slightly darker vertex colour, and **a round seal plate** (`Logo`, 0.09 m across) in the middle of **each side**, where the game puts the token's icon. A thin `Trim` edge band on the long sides. Two halves as two nodes, `half.l` and `half.r`, hinged on the fold | `flutter` 0.5 s, seamless: the halves flap a little (±15°) as it flies |
| `fx.ingot` (`ingot.glb`) | blender-e0 | 0.20 × 0.09 m, 0.06 m high | **A small gold ingot**: a classic bar with sloped sides (top narrower than the base), bevelled, `Trim` (the game paints it gold), and a square `Logo` plate stamped slightly into the top face (0.07 m), where the game puts the token's icon | none (the game tumbles it) |

## Checks

- Coplanar checker at rest (and every 0.05 s of `flutter` for the banknote).
- ETH: the gap between the upper body and the chevron is visible from the front and from 45° above; the chevron's faces don't intersect the upper body.
- Banknote: the two halves never cross each other in `flutter`; both seals face out.
- Each `Logo` plate: 0–1 UVs, upright (a test image reads the right way up from the front).

## Delivery

Renders in `docs/art-review/fx.<name>/`: the piece alone at close range from the front and 45° above, with a sample tint (ETH #627eea, a USDC banknote #2775ca with a test icon on its seal, an ingot with a test icon), and at game size (about 25 px). For the banknote, four frames of `flutter`. Report triangle counts, file sizes, materials, clips and deviations. Then stop for review.
