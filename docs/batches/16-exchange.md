# Batch 16: goods changing hands (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` (§4, §8, **§10 lessons**) and `docs/plans/goods-exchange.md` (what the game does with these).

When a courier pays a toll, hands goods to a building's person, or brings goods home, coins stream from the giver to the taker in an arc, like resource collection in Clash of Clans or Hay Day. NFTs travel as a small framed picture of the actual NFT.

## Assets

| Asset (file) | Size | Look | Notes |
|---|---|---|---|
| `fx.coin` (`models/fx/coin.glb`) | 0.22 m across, 0.05 m thick | A chunky stylised gold coin: raised rim, bevelled, a soft highlight. **Both faces** carry a round plate in a `Logo` material (0–1 UVs, upright, white vertex colour), where the game puts the token's logo; the rim and face edge are `Trim` (the game paints silver for stablecoins). | ≤ 200 tris. It spins in flight (the game rotates it), no clips |
| `fx.nft.frame` (`models/fx/nft.frame.glb`) | 0.5 × 0.06 × 0.6 m | A small gilt picture frame with a short carrying handle on top, a `Picture` material face (0–1 UVs, upright, white vertex colour) where the game puts the NFT's image, and a cream backboard | ≤ 400 tris. Origin at the handle's grip (the courier holds it there) |
| `fx.sparkle.burst` (`models/fx/sparkle.burst.glb`) | 0.6 m | 5–7 four-point stars on flat cards (alpha-test, double-sided, its own material `Glow`) | Clip `pop` (0.5 s: the stars burst out, spin and shrink to nothing; ends invisible) |
| **The courier's `carry` clip** (`models/courier/base.glb`) | — | Arms raised in front, holding something at chest height while walking (a 0.9 s walk with the arms held); the `hand` bone where the frame hangs | Keep every other clip as it is |

The usual checks:
- checker results (single-sided except the stars);
- feet never below 0 in the courier's new clip.

## Delivery

Per asset: renders (iso views, and the clip frames for the sparkle burst and the carry), checker results and triangle counts. Then stop for review.
