# Batch 2: the town frame (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first, including **§10 (lessons)** and the **"`Tint` only on cloth"** row. Everything there applies. References: the Aave building and batch 1 (the castle) in `public/themes/medieval-castle-v2/models/`.

These are the surfaces and the landmark everything else stands on: the ground, the paths, the water and the bell tower in the plaza. They repeat a lot, so **tiling and calm** matter more than detail. They must sit quietly under the buildings and let them shine (§5: about 70% of the screen is warm muted mid-tones).

## File names

| Asset | File, under `public/themes/medieval-castle-v2/` |
|---|---|
| `town.ground` | `models/town/ground.glb` |
| `path.tile.straight` | `models/path/tile.straight.glb` |
| `path.tile.lit` | `models/path/tile.lit.glb` |
| `moat.water` | `models/moat/water.glb` |
| `moat.lily` | `models/moat/lily.glb` |
| `moat.reeds` | `models/moat/reeds.glb` |
| `town.tower.chronicle` | `models/town/tower.chronicle.glb` |
| `town.tower.bell` | `models/town/tower.bell.glb` |

The root node is named as the asset.

## How the game uses them

- **`town.ground`:**
  - **Tiles:** 2 × 2 m tiles on a 2 m grid, covering the castle courtyard, a band 8 m wide along the avenue, and the plaza round the bell tower.
  - **Next to them:** the rest of the land is a flat grass plane at y = −0.02 (#5b7a4a, the game's), and buildings stand on top of the tiles.
- **`path.tile.straight`:**
  - **Tiles:** 1 × 1 m tiles in a line, the avenue from the gate to the town's end, turned by 90° where it goes round the bell tower. One more tile is the step to each door.
  - **Height:** they lie on the ground tiles, and their top is at y = 0.02.
- **`path.tile.lit`:**
  - **Use:** a glow overlay laid over each path tile and shown only while a courier walks there (the bell's block ring flashes them all). It sits 0.015 m up, and the game colours it warm (#ffc861) and emissive.
- **`moat.water`:**
  - **Tiles:** 2 × 2 m tiles on a 2 m grid, filling the moat ring round the castle island. The surface is at y = 0, and the island's ground and walls rise from its edge.
- **`moat.lily`, `moat.reeds`:**
  - **Placement:** scattered on the water and at the moat's edge.
- **`town.tower.chronicle`:**
  - **Placement:** the bell tower in the middle of the plaza. Couriers walk round it.
  - **Fading:** the game fades it to 30% opacity when a courier walks behind it. So keep it to **≤ 5 materials**; every material fades.
  - **The bell:** it hangs at the tower's empty `hinge` (the bell's yoke point), as a separate model.
- **`town.tower.bell`:**
  - **Use:** the game plays `ring` on every new block (about every 12 s).

## Assets

### 1. `town.ground`: cobbled ground, 2 × 2 m, tileable
- **Look:** warm cobbles (#b9a98a…#cdbd9c, stone light/shade from palette v2), rounded setts with darker joints and a few worn flags. A little moss in some joints, kept calm.
- **Height:** 0.05 m thick, top at y = 0.02 (top flush with the paths, which lie on it).
- **Tiling:**
  - It must tile seamlessly in both directions **and under 90° turns**: the game may rotate tiles. Use a texture that repeats exactly over 2 m, or better 1 m, with no edge features.
  - Vary it subtly; a 2 m repeat must not read as a grid from the default camera.
- **Ground rule:** this tile is the ground. Its top faces are at 0.02, not at 0, so the "no up-facing face near y = 0" rule doesn't apply to it. It must not overlap a neighbour tile: no faces at its x = ±1 and z = ±1 edges, only the top and a short skirt down to y = −0.03.
- **Budget:** ≤ 50 tris, 1 material, texture 256–512 px (128–256 px/m).
- No clips.

### 2. `path.tile.straight`: the avenue, 1 × 1 m, tileable along Z
- **Look:** a packed-earth and gravel path (#a07a4c…#b88f5c), its edges set with a narrow kerb of darker stone along x = ±0.5. A little worn in the middle; small pebbles. It must contrast with the cobbles (it's the courier's road).
- **Height:** top at y = 0.022 (2 mm over the ground tile, so the two never coincide).
- **Tiling:** seamless end to end along Z, and two tiles side by side across X must also look right (the turn round the bell tower meets at corners).
- **Budget:** ≤ 40 tris, 1 material. No clips.

### 3. `path.tile.lit`: the glow overlay, 1 × 1 m
- **Shape:** a flat plate of 0.9 × 0.9 m with rounded corners, 4 mm thick, top at y = 0.03 (the game lifts it a further 0.015). One material named `Glow` (white; the game colours it). Its alpha should be a soft-edged mask, or simply a plain plate.
- **Budget:** ≤ 20 tris. No clips.

### 4. `moat.water`: water, 2 × 2 m, tileable
- **Look:** clear stylised water: Water #3c8fb5 with darker depth toward the middle, soft ripple highlights and a few sparkles. No foam.
- **Material:** a single material named `Water`, roughness 0.15, metallic 0. The game may later move its UVs for a slow flow, so its texture must tile at the 2 m tile size.
- **Shape and tiling:** surface at y = 0, a thin plate (top at 0, no other faces up). Seamless in both directions and under rotation.
- **Exception:** this tile *is* the y = 0 surface, so the ground rule doesn't apply to it.
- **Budget:** ≤ 20 tris. No clips.

### 5. `moat.lily`: lily pads with one flower, about 0.6 × 0.6 m
- **Look:** three or four round notched pads, one white-pink flower. The pads float 1 cm above y = 0 (never at 0).
- **Budget:** ≤ 300 tris.
- **Clip `idle` (4 s):** a gentle bob and turn of a few degrees.

### 6. `moat.reeds`: a clump of reeds with two bulrushes, about 0.6 × 0.4 × 0.9 m
- **Look:** closed thin blades, not alpha cards. If you use alpha cards, use alpha-test and a separate material.
- **Clip `idle` (5 s):** a breeze sway.
- **Budget:** ≤ 400 tris.

### 7. `town.tower.chronicle`: the bell tower (the plaza's landmark), tiers off
- **Size:** 3 × 3 m footprint, **12–14 m** to the cap's top (M class, slender). It stands free in a plaza with all four sides finished.
- **Look:** a slender stone campanile on a stepped plinth, with string courses, a clock face on all four sides at about 7 m (painted face with gilded hands as separate nodes), an open belfry stage at about 9–10 m (arches on four sides, the bell visible inside), and a pyramid or bellcast cap in Roof red with a gilded finial and weathervane. Small arched door at the foot (+Z).
- **Empties:**
  - `hinge` at the bell's yoke point, inside the belfry at about 9.5 m, centred;
  - `door` 1 m in front of the door.
- **Nodes:** `hand.hour` and `hand.minute` on each face (or one shared pair per face), pivoting at the clock's centre; `weathervane`.
- **Clips:**
  - **`idle` (8 s, seamless):** the weathervane swings a little; the minute hands creep (one tick); a few pigeons on the belfry ledge bob (optional).
  - **`tap` (1.2 s):** a `body` bounce; the clock hands spin once round and settle; the weathervane spins.
- **Budget:** 4–7k tris, **≤ 5 materials**.

### 8. `town.tower.bell`: the bell
- **Size:** about 0.8 m tall, 0.75 m across the lip.
- **Look:** bronze (Metal, gold-bronze #b08a3a, roughness 0.4) with a timber yoke and iron straps.
- **Pivot:** at the yoke's axle (origin there; the bell hangs down −Y).
- **Clip `ring` (1.5 s, one-shot):** a swing of about 25° each way, then 15° and back to rest, with the clapper (a separate node) lagging behind.
- **Budget:** ≤ 1.5k tris.

## Delivery

For each asset:
- the renders (§9). For the tiles, also `tiling.png`: a 6 × 6 m patch of ground with a path running through it and a turn, and a 6 × 6 m patch of water, seen from the game's camera at 45°;
- your checker (ground and lit tiles: no overlaps between neighbouring tiles; the tower and the bell through every clip);
- triangle counts and sizes.

Then stop. The developer checks the batch in the game, sends fixes, and shows it to the user.
