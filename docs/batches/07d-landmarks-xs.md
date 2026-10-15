# Batch 7d: landmark protocol buildings, XS class (v2)

The same rules, tools and working arrangement as **[07a](07a-landmarks-xl.md)**: read that brief first. Also read `docs/STYLEGUIDE_V2.md` (§3, §8.1, §8.2, §9, §10). References:
- the 7b and 7c landmarks;
- the S category buildings (`models/building/category.*.s.glb`) for small-scale finish.

## The XS class

These protocols hold little value on Ethereum, or none that DefiLlama tracks (ENS, OpenSea, Safe), so the game gives them the smallest plot. They are **tiny signature buildings: a booth, a kiosk, a shopfront with one storey**. Think of a charming market-street shop with one unmistakable idea.

- **Size:** footprint **2 × 2 m**, overhangs up to 0.5 m; **3–4 m** tall, with a landmark element up to about 5 m. Doors 2.0–2.2 m, so most of the building is the door, a window and the roof.
- **Budget:** **1.5–3k tris**, ≤ 6 materials plus `Logo`. No LOD1.
- **Logo plate:** **≥ 0.6 m** on the front.
- **Clips:** `idle` and `tap`, as in 07a.
- **Colour:** one roof element in `Tint` is allowed. Dark or grey brands (CoW #0f3d8c, 1inch #2f4f87 are fine; Stargate #9e9e9e is grey) use `Tint` on cloth and the star.

## The ten buildings

| Asset (file) | Brand | Concept | `idle` | `tap` |
|---|---|---|---|---|
| `building.protocol.opensea` (`protocol.opensea.glb`) | nft, #2081e2 | **A harbourside picture kiosk**: a little gallery booth with a blue sail-awning (`Tint`) and framed pictures on the shutters | the sail ripples | the shutters flip their pictures round |
| `building.protocol.ens` (`protocol.ens.glb`) | names, #5298ff | **The scribe's booth**: a tiny hall with a big open ledger on a lectern outside and a quill sign | the ledger's pages lift slightly | the pages flick through, the quill sign spins |
| `building.protocol.sushiswap` (`protocol.sushiswap.glb`) | dex, #fa52a0 | **A fish-market stall house**: a curved low roof (`Tint`), hanging paper lanterns, a counter with fish on ice | the lanterns sway | a fish flips on the counter, the lanterns bounce |
| `building.protocol.1inch` (`protocol.1inch.glb`) | dex, #2f4f87 | **A broker's stable office**: a stable door (split top and bottom), a horse-head sign bracket, a hay rack | the sign swings | the top door half swings open and a horse head pokes out and back |
| `building.protocol.cow` (`protocol.cow.glb`) | dex, #0f3d8c | **A little dairy**: a gambrel-roofed booth, milk churns by the door, a cow-bell over the door | the bell sways | the bell rings (swings hard), a churn lid hops |
| `building.protocol.stargate` (`protocol.stargate.glb`) | bridge, #9e9e9e | **The star gate**: a stone gate arch over a tiny quay step, a gilded star on top (Trim) and a booth beside it | the star turns slowly | the star spins fast and glints, a lantern bobs |
| `building.protocol.safe` (`protocol.safe.glb`) | wallet, #12ff80 | **A vault of many locks**: a stout stone cube with an iron door barred by several padlocks | a padlock swings on its hasp | the padlocks spring open one by one and snap shut |
| `building.protocol.paraswap` (`protocol.paraswap.glb`) | dex, #2a6ef0 | **A paraglider's stall**: a stall house under a canopy shaped like a paraglider wing (`Tint`) | the canopy breathes | the canopy lifts up and settles |
| `building.protocol.kyber` (`protocol.kyber.glb`) | dex, #31cb9e | **A crystal trader's**: a faceted crystal roof (`Tint` crystal), green-blue crystals in the display window | crystals glint (small scale pulses) | the roof crystal rises a little and spins, the display crystals hop |
| `building.protocol.lifi` (`protocol.lifi.glb`) | bridge, #f7c2ff | **A signal tower**: a slim timber-and-stone tower with a turning wheel of pennants (`Tint`) | the pennant wheel turns slowly | the wheel spins fast, a flag runs up the mast and down |

## Delivery

As in 07a:
- **Files:** in `public/themes/medieval-castle-v2/models/building/`.
- **Renders:** into `docs/art-review/building.protocol.<id>/`.
- **Report:** checker results, triangle counts, sizes, clips and deviations.

Then stop for review.
