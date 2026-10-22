# Batch 29: winter, snow on every roof (v2)

For the design agents. Read `docs/STYLEGUIDE_V2.md` (§4, §5, §8 and **§10**). The snow material and look are batch 28's `prop.snow` (blender-e0): the `Snow` material, white with a faint blue in the hollows (vertex colour), soft rounded edges.

## Why

In December the town should look snowed in. Today the snow falls (`fx.snowfall`), but the roofs stay as they are: a cap laid on a building's bounding box floats over a pitched roof like a cloud, and landmark roofs are in their brand colour, so painting them white would also whiten their banners.

## What: one snow file per building, beside it

**Don't change the buildings' own files.** For each model below, make **a separate file next to it, named after it with `.snow`**: for `models/building/protocol.aave.glb`, the file `models/building/protocol.aave.snow.glb`. It holds **only the snow**, in the **same coordinates as the building** (same origin, same axes, made at the same size), so the game can lay it on the building as a child and it fits.

- **Snow on every roof surface you can see from above:** the main roofs, porch and dormer roofs, tops of towers and chimneys, ridges and wide ledges and window sills (a thin strip), the tops of walls and battlements (castle pieces), and the tops of big props on the building (crates, barrels) where they are part of the model.
- **Following the roof, not floating:** a slab 6–12 cm thick lying on each roof plane, **1–2 cm above it** (never coplanar, §10), its top gently rounded, slightly overhanging the eaves (5–10 cm) with a soft rolled edge; a few short chunky icicles along some eaves (optional, in `Snow` too).
- **Leave free:** chimney tops that smoke, signs and logo plates, banners, sails and flags, doors and windows, `Glow` lights.
- **Tier parts:** cover the base building. Where a `tier.2/4/6` part adds a roof, put that roof's snow in a node named `tier.N` (the same N) in the snow file, so the game shows it with the tier.
- **Moving parts:** snow on something that moves in `idle` or `tap` (a door, a hatch, a balance beam) is left out.
- **Budget:** at most 15% of the building's own triangles (and at most 1,500); one material, `Snow`; no textures; no clips.
- Root node named like the file (`building.protocol.aave.snow`).

## Who does what

**blender-74:** the 32 landmarks (`models/building/protocol.*.glb`) and the town's own pieces: `town/tower.chronicle.glb`, `town/gate.glb`, `town/furnace.glb` (not the chimney's smoking top).

**blender-e0:** the 35 category buildings (`models/building/category.*.glb`), the castle pieces (`castle/keep.glb`, `castle/hall.wallet.glb` and `hall.wallet.t0`–`t6`, `castle/gatehouse.glb`, `castle/wall.segment.glb`, `castle/wall.corner.glb`, `castle/tollbooth.glb`, `castle/storehouse.glb`) and `prop/market.stall.glb`.

Script it: load each building, find the roof faces (faces pointing mostly up, not in the excluded materials, not in moving nodes), offset and thicken them into snow, round the edges, add the eave roll. Then look at every one.

## Checks

- The building with its snow file laid on it: coplanar checker 0 (snow against the roof), at rest and with each tier combination.
- No snow inside the building's solids, none floating more than 3 cm off the surface it lies on.
- Renders in `docs/art-review/winter/`: a contact sheet per agent with every building with its snow from 45° above, and a few close-ups.

Report per group as you go (triangles, file sizes, anything left out and why), then stop for review.
