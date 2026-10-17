# Batch 20: siege dressing, damage states and capture markers (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first, including **§7** (tier parts: damage parts work the same way) and **§10**. Background for the game mode: `docs/game/MAPPING.md`. The pieces you change were made in batch 1 (`docs/batches/01-castle-core.md`).

## What the game does

In the new siege mode the keep has hit points. As it loses them the castle shows it, in four steps:

| State | When | What the player sees |
|---|---|---|
| 1 Cracked | HP ≤ 75% | Cracks and a few chipped stones on the keep and walls |
| 2 Breached | HP ≤ 50% | The outer wall broken open at the front, battlements knocked off, rubble at the wall feet |
| 3 Burning | HP ≤ 25% | Fire in the keep's windows and roof, dark-grey smoke |
| 4 Collapsed | HP 0 | The keep is a heap of rubble with a smouldering stump; the crest banner lies on it |

Still **cosy**: a toy castle knocked about, not a war ruin. Smoke from fire is a warm grey (#8a8580…#c9c6bf), darker than chimney smoke but never black; fire is chunky stylised flames in `Glow` (orange to yellow), no alpha blending.

## How the parts work (like tier parts)

- In `keep.glb`, `wall.segment.glb`, `wall.corner.glb` and `gatehouse.glb`, add nodes **`damage.1`**, **`damage.2`**, **`damage.3`** under `body`. The game shows `damage.N` when the state is at least N.
  - Each part must look right with and without the parts above it, and with and without the keep's `tier.2/4/6` parts.
  - **Damage parts sit on the surface, never in it:** crack slabs at least 1 cm off the wall, chips as small separate stones (§8, §10: no coincident faces).
  - **Breach (`damage.2`) on the wall segment:** the intact wall can't be cut by an overlay, so give the segment a node **`intact`** (the part of the wall that the breach removes: the battlement and a top chunk of the face) that the game **hides** at state ≥ 2, and a `damage.2` with the broken edge, the fallen stones and the rubble heap at its foot.
  - **Fire (`damage.3`)** animates in `idle` (flames flicker by small rotation and scale inside their window or roof hole, smoke puffs rise and shrink): name these clip tracks so they don't touch nodes the existing `idle` or `tap` move.
- **Collapse (state 4):** in `keep.glb` add a node **`ruin`** beside `body` (not under it), hidden by default: the rubble heap, a broken stump of the keep about 30% of its height, the fallen banner in `Tint`, a thin smoulder of smoke in its own `idle` track. The game hides `body` and shows `ruin`.

## New pieces

| Asset | File under `public/themes/medieval-castle-v2/models/` | What |
|---|---|---|
| `fx.capture.ring` | `fx/capture.ring.glb` | A flat ring on the ground for a capturable building: 1 m radius (the game scales it), a band 8 cm wide made of 24 separate segments named `seg.00`…`seg.23` (the game fills them as capture progresses), material `Tint`, 2 cm above the ground, ≤ 400 tris |
| `prop.banner.owner` | `prop/banner.owner.glb` | A tall pole banner planted beside a captured building's door: 3.2 m pole, a hanging banner 0.8 × 1.4 m in `Tint` (double-sided in its own material, §10), a gilt finial; `idle` sway 3–4 s; `tap` a snap of the cloth; **cloth clearance** from the pole ≥ 10 cm; ≤ 800 tris |

## Delivery

- **renders (§9)** of the keep and a wall segment at each state 0–4 from iso-0 and iso-180, the keep with and without its tier parts, and the two new pieces;
- **checker results:** coplanar pairs at every state (with each combination of damage and tier parts shown), every 0.1 s of the fire and smoke tracks, cloth clearance for the banners;
- **triangle count** added per state, file size, materials.

Then stop for review.
