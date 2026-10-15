# Batch 7c: landmark protocol buildings, M and S classes (v2)

The same rules, tools and working arrangement as **[07a](07a-landmarks-xl.md)**: read that brief first. Also read `docs/STYLEGUIDE_V2.md` (§3, §8.1, §8.2, §9, §10). References:
- the 7a landmarks and Aave;
- the category buildings of class S (`models/building/category.*.s.glb`), which show the finish at small scale.

## The classes

| Class | Footprint | Height | Tris | Front logo plate |
|---|---|---|---|---|
| **M** | 5 × 5 m | 8–11 m; landmark element to about 13 m | 4–8k | 1.2 m |
| **S** | 3 × 3 m | 5–7 m; landmark element to about 8.5 m | 2–4k | 0.8 m |

- **No LOD1.** Overhangs up to 0.5 m.
- **Human-scale parts:** doors 2.0–2.3 m, storeys 2.4–2.7 m. A small landmark is a *small building with one strong idea*.
- **Clips:** `idle` and `tap`, as in 07a.
- **Colour:**
  - one big roof element in `Tint` is allowed;
  - dark brand colours (Frax #2b2b2b, Balancer #3b3b3b) put `Tint` on cloth only.

## The eight buildings

| Asset (file) | Class | Brand | Concept | `idle` | `tap` |
|---|---|---|---|---|---|
| `building.protocol.frax` (`protocol.frax.glb`) | M | stable, #2b2b2b (cloth only) | **A fractional reserve**: a stone treasury house with a big half-and-half door (one leaf iron, one gilded) and a set of large balance scales on the roof ridge as the landmark | the scales tip gently back and forth | the scales swing hard and settle level, the doors open |
| `building.protocol.yearn` (`protocol.yearn.glb`) | M | yield, #0657f9 | **A vault-keeper's terraced garden house**: a tower house with a walled kitchen garden of vegetable beds on raised terraces, a water barrel and a harvest cart | a little windmill pump turns | the cart's sacks hop, the garden gate swings |
| `building.protocol.euler` (`protocol.euler.glb`) | M | lending, #e2554b | **A mathematician's observatory**: a round stone tower with a domed roof and a slot (`Tint` dome), a brass orrery on a terrace | the orrery rings turn slowly | the dome slot opens and a telescope pokes out and back |
| `building.protocol.balancer` (`protocol.balancer.glb`) | M | dex, #3b3b3b (cloth only) | **The weigh house**: an open ground-floor hall with a giant beam balance hanging inside, pans with goods, a clock gable above | the beam balance sways | the pans swap height, sacks hop |
| `building.protocol.blur` (`protocol.blur.glb`) | S | nft, #ff8700 | **A fast courier's gallery**: a narrow, tall gallery with streaked "speed" banners (`Tint`), pictures in the windows and a weather-vane hare | the banners flutter fast | the hare spins round, the pictures flip |
| `building.protocol.across` (`protocol.across.glb`) | S | bridge, #4ed6b8 | **A ferryman's toll bridge house**: a small house on a little arched bridge stub over a raised water channel, a rope-ferry post | the water ripples, the ferry rope sways | the toll pole swings up and down |
| `building.protocol.zora` (`protocol.zora.glb`) | S | nft, #5b5bf5 | **A glassblower's studio**: a round furnace house with a glowing kiln mouth and glass globes in many colours on shelves outside (`Tint` globe on the roof) | the kiln glows softly (scale a flame mesh) | the roof globe rises a little and lands, sparkles |
| `building.protocol.gondi` (`protocol.gondi.glb`) | S | nft lending, #c9d94a | **A pawnbroker's**: a narrow house with three golden balls hanging from a bracket (the landmark), a barred window full of curios | the three balls sway | the balls spin, the shutter flips |

## Delivery

As in 07a:
- **Files:** in `public/themes/medieval-castle-v2/models/building/`.
- **Renders:** into `docs/art-review/building.protocol.<id>/`.
- **Report:** checker results, triangle counts, sizes, clips and deviations.

Then stop for review.
