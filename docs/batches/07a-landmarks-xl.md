# Batch 7a: landmark protocol buildings, XL class (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` fully first, especially:
- **§3** (size classes),
- **§8.1** (logo plates),
- **§8.2** (`idle` and `tap`),
- **§9** (delivery and checker),
- **§10** (lessons from the pilot: every row is a mistake already made once).

**The reference is the Aave building**: `public/themes/medieval-castle-v2/models/building/protocol.aave.glb` and its renders in `docs/art-review/building.protocol.aave/`. It is XL like these six, and it passed review after five rounds, so match its quality, structure and node setup. The castle batch (`models/castle/`) shows the current finish for stone, roofs and cloth.

## Tools

These exist from the earlier design sessions, in `/home/mat/projects/blender/wallet-landia-castle/v2/`:
- `ASSET_RULES.md`: that agent's working notes;
- `check_coplanar.py`: the checker, which must report 0;
- `check_join.py`;
- `render_review.py`: the §9 renders;
- `v2lib.py`, `castle_lib.py`, `gen_textures_v2.py`, `build_aave_v2.py`: building helpers and the Aave build.

Blender is `/home/mat/projects/blender/downloads/blender/extract/blender-5.2.2-linux-x64/blender`; run it headless (`--background --factory-startup --python <script> -- <args>`).

Another design agent works in parallel in the same folder, on the town and castle. **Don't edit its files.**
- Put your scripts in a new folder `/home/mat/projects/blender/wallet-landia-castle/v2/landmarks/`.
- To change a shared library, copy it into that folder first.
- Write models only to the paths below.

## The six buildings

All six share these specs:
- **Size:**
  - **XL class:** footprint **12 × 12 m**; overhangs up to 1 m; **18–24 m** to the main mass's top; one landmark element (spire, dome, tower or chimney) up to **28 m**.
  - **Scale:** the game scales the model by ±25% to fit its plot, and keeps human-scale parts the same size (doors 2.0–2.3 m, storeys 2.4–2.7 m).
- **Orientation and empties:**
  - origin at the footprint's centre on the ground; front +Z, facing the avenue;
  - `door` 1 m in front of the front wall at the main door;
  - `sign` above the door.
- **Hierarchy:**
  - root `building.protocol.<id>` (never animated) > `body` (the tap bounce) > `building.protocol.<id>.lod0` and `.lod1`;
  - logo plates `logo`, `logo.1`…;
  - animated nodes and tier-less detail.
  - **LOD1** at about 50% triangles, in the same file.
- **Logo plates (§8.1, XL):**
  - the main plate on the front, 3–4 m;
  - a high plate visible from the far end of town;
  - plates on the sides and the back;
  - high plates lean back towards the camera; UVs exactly 0–1; white vertex colour.
- **Brand colour (`Tint`):**
  - signature buildings may carry the brand colour on **one big roof element** (as Aave's roofs), plus banners;
  - when the brand colour is very dark or very light (Ethena's #2c2c2c), keep the roofs in palette `Roof` and put `Tint` on cloth only;
  - the game paints `Tint` with the protocol's colour, so model it with the light greyscale texture.
- **Trim:** the tier colour (window frames, a band, finials).
- **Clips:**
  - **`idle`** (5–8 s, seamless): the building's signature motion (below) plus cloth.
  - **`tap`** (1.0–1.5 s, one-shot, ends at rest): a `body` bounce plus the reaction below.
  - `tap` never touches nodes that `idle` moves.
- **Budget:**
  - 12–20k tris (LOD0), LOD1 about 50%;
  - ≤ 6 materials plus `Logo`;
  - textures as §4.

| Asset (file) | Brand | Concept at XL | `idle` | `tap` |
|---|---|---|---|---|
| `building.protocol.lido` (`protocol.lido.glb`) | staking, #00a3ff | **A grand regatta hall on a lake basin.** A long stone boathouse hall whose roof is three overlapping curved **sail-shaped roofs** (Tint), a quay with moored rowing boats in a basin of water inside a stone rim in front (water 0.1 m above ground, never at 0), and a slim signal tower with a flag as the landmark | sails ripple slightly, boats bob, flag waves | the boathouse doors swing up, a boat slides out a little and back, the tower's flag snaps |
| `building.protocol.spark` (`protocol.spark.glb`) | lending, #f5a742 | **The lantern-makers' bank.** A stout guild hall in warm stone with a tall central **lantern tower** whose top is a huge glowing lantern (Glow) in an iron cage; many bracket lanterns on the facades | lanterns sway, a gentle glow-flicker by scaling inner flame meshes | the big lantern's shutters snap open and shut, sparks (small Glow shards) pop up and fall back |
| `building.protocol.eigenlayer` (`protocol.eigenlayer.glb`) | staking, #3a2ea0 | **A layered stone ziggurat.** Four stacked terraces, each smaller and set back, with stairways up the front, planted terraces, and a shrine pavilion with a Tint roof on top. The layers are the idea: make each clearly distinct | a pennant on the shrine, small water runnels down the stairs (moving strips) | the terraces bounce one after another, bottom to top (a ripple up the layers), and the shrine's doors open |
| `building.protocol.maker` (`protocol.maker.glb`) | lending, #1aab9b | **The mint.** A fortified mint: a stout treasury tower, a forge hall with a tall brick **chimney stack** (the landmark), coin presses in an open arcade, and stacked coin crates | smoke puffs from the stack, a press hammer rises and falls slowly | the press slams twice, coins (Trim gold) hop out of a crate and back, the treasury doors flash open |
| `building.protocol.ethena` (`protocol.ethena.glb`) | staking, #2c2c2c (dark: cloth only) | **The salt works.** A refinery hall with a tall timber **evaporation tower** (graduation tower with brushwood walls) as the landmark, terraced white salt pans in front, and a store with salt sacks | brine drips down the graduation wall (moving strip), a little steam over the pans | a rake-arm sweeps across a pan, sacks hop, the store doors open |
| `building.protocol.morpho` (`protocol.morpho.glb`) | lending, #2470ff | **The butterfly pavilion.** A domed central counting hall with **two great curved wing roofs** spreading left and right like butterfly wings (Tint, with Trim veins), on slender columns; a garden in front | the wings breathe: a slow, slight up-and-down flutter of the wing tips | the wings flap once fully and settle, the dome's lantern spins |

## Delivery

- **Files:** in `public/themes/medieval-castle-v2/models/building/`. **Don't touch `protocol.aave.glb`.**
- **Renders:** into `docs/art-review/building.protocol.<id>/` (§9): iso views, phone, silhouette, tap and logo.
- **Checker results per file:** same- and opposite-facing pairs, the LOD0 and LOD1 views, every 0.1 s of every clip, and the ground.
- **Per file:** triangle count, file size and materials.

Report back to the developer, then stop for review. Fixes come back the same way, until the developer and the user approve.
