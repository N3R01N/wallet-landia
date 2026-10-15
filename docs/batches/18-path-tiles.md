# Batch 18: path shapes (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` (§4, §8, **§10 lessons**) and `docs/batches/02-town-frame.md` §2 (`path.tile.straight`, which these must match exactly).

From the user (2026-10-15): "the road looks odd: some parts lead to nowhere, just cross the middle road and then stop; no corners are there."

The game lays the town's paths on a 1 m grid: the avenue, the turn round the bell tower, and a branch to every building's door. Today every cell is `path.tile.straight`, which has a stone kerb along both sides (x = ±0.5). So wherever two paths meet, a kerb runs across the opening: branches look cut off, and turns have no corner. The game now picks each cell's shape from its neighbours, and needs these four tiles.

## Assets

All are 1 × 1 m, at exactly the shipped straight tile's heights (earth 0.028, kerb tops 0.036), the same packed-earth and gravel surface, the same kerb (section, stone and colour) and the same material. At every open side the surface and kerb ends must meet `path.tile.straight` (and each other) edge to edge, with no seam, step or gap. **Openings are given for rot 0**; the game turns the tile about y in 90° steps.

| Asset (file) | Open to | Kerb | Notes |
|---|---|---|---|
| `path.tile.bend` (`models/path/tile.bend.glb`) | +z and +x | along −x and −z, meeting in a rounded outer corner; a single small corner stone at the inner corner (+x +z) | the path's surface follows a smooth quarter turn |
| `path.tile.tee` (`models/path/tile.tee.glb`) | +z, −z and +x | along −x only; small corner stones at the two inner corners on the +x side | the avenue's kerb stops cleanly where a branch leaves it |
| `path.tile.cross` (`models/path/tile.cross.glb`) | all four sides | none along the sides; four small corner stones | |
| `path.tile.end` (`models/path/tile.end.glb`) | +z only | round the other three sides, with a rounded end at −z | where a path stops at a building's door point |

- **Budget:** ≤ 60 tris each, one material (the straight tile's), no clips.
- **Checks:** check_coplanar TOTAL 0 on each tile, and on **joins**: place a 3 × 3 m sample (a cross in the middle, straights out to each side, a bend and a tee at the corners, and an end on one arm) and check it, with no faces meeting where the tiles join.
- Wear and pebbles vary a little from the straight tile, so a junction doesn't look stamped.

## Delivery

- Renders of each tile from above and at the game's 45°;
- `joins.png`: the 3 × 3 m sample above, plus a T where a 5-tile branch leaves a 7-tile avenue;
- checker results and triangle counts.

Then stop for review.

## What the game does

- `src/castle/scene/plan.ts` `pathShape` picks the shape and turn per cell from its four neighbours.
- `castleView` `#layPaths` lays them instanced.
- While a shape is missing it lays a straight tile along the busier way (today's look).
