# Styleguide v2: "stylised realism" for the castle and town

For the Blender design agent. Replaces the art direction of `docs/ASSET_SPEC.md` §1 (its names, folders, material names and clip names stay). Evidence and sources: `docs/research/LOOK_AND_FEEL.md`.

**The target in one line:** a modern smartphone city builder (Boom Beach, Whiteout Survival, Rise of Kingdoms level), chunky and readable, with materials and light that feel real: bevelled forms, baked soft occlusion, warm sun and cool shade. Not flat low-poly blocks, and not photoreal.

**Why v1 looked wrong:** flat colours with no baked light, sharp unbevelled boxes, everything on one 2×2 m footprint, a grey and dark palette, and simple shapes that read as CAD.

---

## 1. How the game shows your models

Design for this view; check every asset in it (§9).

- **Camera:** perspective, narrow lens (vertical FOV ~30°), looking down **35–60°** (default 45°), and **it rotates all the way round.** Every asset needs **four finished sides**: no blank backs.
- **Distance:** a building fills 60–400 px of a phone screen, a person 25–60 px. Read at that size.
- **Light (set by the game):** a warm sun from about 55° up, a cool sky-blue fill, a soft environment reflection, real sun shadows from buildings, a blob shadow under people. **Bake soft occlusion and gradients (§4), never directional light or cast shadows.**
- **Colour pipeline:** sRGB albedo, Khronos Neutral tone mapping (saturated colours survive as painted).
- **Runtime colour:** `Tint` (brand or crest colour) and `Trim` (tier colour) are multiplied over your texture at runtime. Give them a **light greyscale** texture with soft variation (86–96% white).

## 2. Proportions (human scale, gently compressed)

| Measure | Value |
|---|---|
| Person (courier, townsfolk) | **1.75 m**, **3–3.5 heads** tall |
| Door | **2.0–2.3 m** high (1.1–1.3× a person), 1.1–1.4 m wide |
| Storey | **2.4–2.7 m** (1.3–1.5× a person) |
| Window | 1.0–1.3 m tall, deep set, chunky frames |
| Roof | **40–55% of the building's visible height**, overhang **15–30%** of the wall height |
| Plinth / base course | **10–20%** of the height, a visible stone step that anchors the building |

Doors, windows, steps and people stay this size on every building, small or giant. **A bigger building has more storeys, towers and wings, never a bigger door.**

## 3. Size classes (buildings by economic size)

The game sizes a protocol's building by its real value (a protocol holding billions dwarfs a castle worth a million: `src/castle/world/size.ts`). Each building is modelled in one **class**, at its true size in metres; the game fine-tunes it within about ±25% to fit its plot.

| Class | Footprint | Height (to the ridge or top of the main mass) | Landmark element | For values of |
|---|---|---|---|---|
| **XS** stall / cottage | 2 × 2 m | 3–4 m | — | up to ~$3M |
| **S** house / shop | 3 × 3 m | 5–7 m | a chimney or sign | ~$3M–$30M |
| **M** hall | 5 × 5 m | 8–11 m | a small tower or gable | ~$30M–$300M |
| **L** guild hall | 8 × 8 m | 12–16 m | a tower, dome or big roof | ~$300M–$3B |
| **XL** landmark | 12 × 12 m | 18–24 m, spire or dome to 28 m | one silhouette element visible from the far end of town | ~$3B and up |

Overhangs may pass the footprint by up to 0.5 m (S/XS) or 1 m (L/XL). Big classes are **compositions of human-scale parts** (a cathedral-like mass of halls, towers, buttresses), not a blown-up house.

## 4. Shape and surface

**Shape language**
- **Bevel every hard edge**: 3–8% of the piece's smallest dimension (a 0.3 m wall gets 1–2 cm; a 1 m block 4–6 cm), 1–2 segments, and a **Weighted Normal** modifier (or Auto Smooth with harden normals) so flat faces stay flat and edges catch the light.
- **Chunky masses**: a fat plinth, thick walls, a big roof: each a separate readable block. Exaggerate a few features: thick roof tiles, big chimneys, oversized hinges and lanterns, quoin stones at corners.
- **Break the straight line**: a slight sag or flare in rooflines, irregular stone courses at corners, gently tapering towers and walls. Nothing perfectly vertical or perfectly flat.
- **Detail grading**: about 70% large shapes (mass, roof), 20% medium (windows, doors, chimneys, towers), 10% small (beams, shutters, sacks, lanterns). Cluster small detail at the door and the focal point; leave calm areas.

**Baked light (the single most important change)**
- Bake **coloured ambient occlusion** (warm brown-purple, not black) at **40–70% strength** into the **vertex colours (`COLOR_0`)**, multiplied with the albedo. Creases under roofs, wall feet, between stones and in window recesses must darken.
- Add a **top-down gradient per object**: 10–20% lighter at the top of each wall and roof than at its foot, darker at ground contact. Also in vertex colour.
- **Edge highlights**: a light painted highlight on convex edges (curvature mask), 1–3 px wide at game size.
- No baked sun direction, no cast shadows: the game adds those.

**Materials (keep v1's names: Stone, Timber, Plaster, Roof, Thatch, Metal, Cloth, Trim, Tint, Glow, Water, Cobweb, Moss; new: Logo, §8.1)**
- PBR, but stylised: **roughness 0.6–0.9** almost everywhere (rougher than real); metals metallic 0.6–1.0 with roughness ≥ 0.4; no mirrors.
- **Albedo simple**: two or three colour variations per material, soft gradients, painted wear at corners; albedo values between sRGB ~30 and ~240 (no pure black or white).
- **Horizontal and vertical surfaces differ in value**: roofs and ground must not merge with walls.
- **Texel density**: buildings **~128–256 px/m**, people and animals **~256–512 px/m**, consistent across all assets (a giant landmark is not sharper per metre). Use trim sheets for repeating stone courses, beams and roof tiles on big buildings.
- Textures: WebP in the `.glb`, at most 1024 px per map (2048 only for one shared atlas). Colour maps only, plus an optional small tiling detail normal for stone and wood. No alpha blending; alpha-test (mask) only for leaves and fringes.

## 5. Palette v2 (lighter, warmer, more saturated)

| Role | Hex | Notes |
|---|---|---|
| Stone light | `#c9bba0` | warm, not grey |
| Stone shade | `#9a8c76` | |
| Timber | `#7a5233` | warm |
| Plaster | `#efe3c8` | |
| Roof red | `#b84a32` | |
| Roof blue | `#3f6fa8` | |
| Roof slate | `#55607a` | blue-grey, never near-black |
| Thatch | `#d1a55c` | |
| Grass | `#7fae4a` | yellow-green |
| Water | `#3c8fb5` | |
| Gold | `#d9a93a` | accents, tier 6 |

Per screen: about 70% warm muted mid-tones (stone, earth, grass), 20% each building's own colour group (mostly its roof), 10% saturated accents (banners, brand colour on roofs and signs, gold, lit windows). Each building gets its own colour group so neighbours don't merge.

## 6. Characters

- **3–3.5 heads tall**, 1.75 m. Head, hands and feet **1.3–1.5× oversized**, plus **one identifying prop** (the courier's satchel, a merchant's apron, a banker's hat).
- **Colour blocking**: 2–3 large colour areas, the main one saturated and **unlike the ground** (no green on grass, no grey on stone).
- **2,000–3,500 triangles**, one 512 px texture, about 16–25 bones (the v1 16-bone skeleton is fine).
- **Animation**: snappy and exaggerated, with a bounce in the walk, a big arm swing and a little anticipation. Walk cycle 0.8–1.0 s. Clip names as in v1.
- Bevel and bake occlusion as for buildings (§4); soft rounded forms rather than boxes.
- **Clothing sits where it is worn**: hats and caps on the crown of the head (skinned to the head bone, never hanging at the neck unless it is a deliberate hood); shoes shaped to the foot (rounded toe, heel, toe spring, soles only 1–2 cm proud), never square slabs.

## 7. Upgrade tiers (t0–t6)

Tier and size are **separate axes**: size comes from the class (§3), tier from finish and ornament. The same footprint at every tier.

- **Material ladder**: timber and thatch → stone and slate → dressed stone with metal trim → marble, gold and glow.
- **Silhouette milestones** at t2, t4 and t6 (a tower, then a spire or dome, then a crown or gilded roof); otherwise +10–20% height and more ornament.
- Life at high tiers: flags, smoke, glowing windows.
- **Exception: the wallet halls** have one model per tier, each its own building (lean-to → palace spire), each with three `focus.*` dressing sets (tokens, DeFi, NFTs) the game picks by what the wallet mostly holds (`docs/batches/17-wallet-halls.md`): they are the player's own buildings, so tier and holdings show in the building itself.
- **Tier parts** (one model for all tiers): the extra pieces of tiers 2, 4 and 6 are nodes named `tier.2`, `tier.4` and `tier.6` under `body`. The game shows `tier.N` when the tier is at least N, and paints `Trim` in the tier colour. Each part must look right with and without the parts above it, and must not overlap the base model.

## 8. Technical

- **glTF 2.0 binary**, Y-up, metres, transforms applied, origin at the **footprint centre on the ground**, front **+Z**. Node and empty names as in v1 (`door` on the ground at the front, `sign`).
  - **The `door` empty stands 1 m in front of the front wall** (not at a fixed 2 m: the footprint varies by class).
- Vertex colours (`COLOR_0`) for the baked AO and gradient; one UV set (plus an optional second for a trim sheet).
- **Budgets**: XS–S buildings 1,500–4,000 tris; M 4,000–8,000; L 8,000–12,000; XL 12,000–20,000 with an **LOD1** at about 50% (`<asset>.lod1` mesh in the same file); people 2,000–3,500; props ≤ 1,000. Materials per building ≤ 6 (plus `Logo`, §8.1).
- **No coincident faces**: two faces with the same facing closer than 5 mm and overlapping flicker as the camera moves (z-fighting). Merge such parts and delete hidden faces, or raise a part at least 1 cm off the surface it sits on.
- **Single-sided materials** (backface culling on, glTF `doubleSided: false`) for everything solid. Delete the hidden faces where parts touch (the back of a window frame against the wall, the end of a string course in a wall): back faces lying on a wall flicker on real GPUs. Only genuinely thin parts (banners, cloth, leaves) may be double-sided, in their own material.
- Animated parts as separate nodes (as v1: Curve's wheel, Pendle's pendulum).

### 8.1 Protocol logos

Every protocol building carries the protocol's logo. **The game supplies the logo image at runtime** (the files stay free of trademarks, one model can show any protocol, and a logo can change without a new model). The model provides the places it goes:

- **A `Logo` material** on one or more flat, square **logo plates**: a shield, a plaque, a round medallion, a hanging banner, a pediment disc. Each plate's UVs fill **exactly 0–1**, upright (V up = up in the world), not mirrored. Nothing else uses `Logo`. Give it a neutral placeholder texture (an off-white plate with a simple generic emblem) so the model reads without the game.
- **The game swaps the `Logo` texture** for the protocol's logo (a square image, transparent background, composited over the plate colour `#efe3c8`). Keep a frame of `Trim`, `Tint` or `Metal` round each plate: the logo sits inside the frame, not on bare wall.
- **No baked occlusion on the logo faces**: their vertex colour is white, so the logo is never darkened.
- **Readable at game size**. Plate size (the square's side):

  | Class | Size |
  |---|---|
  | XS | ≥ 0.6 m |
  | S | ≥ 0.8 m |
  | M | 1.2 m |
  | L | 1.8–2.5 m |
  | XL | 3–4 m |

  A logo plate must cover at least 25 px on a phone at the default view.
- **Placement**:
  - **Main plate:** one on the front (+Z), above or beside the door, visible at the default pitch.
  - **L and XL:** a second, high plate visible from the far end of town, on a tower, gable, dome drum or big banner. Also a plate on each side or the back, so the building shows its logo from any camera angle.
  - **Height:** plates more than 6 m up lean back 10–15°, their face turned up towards the camera, which looks down at 45°: a plate leaning forward is foreshortened to about half.
- **Technical**:
  - **Single-sided, raised 1–2 cm** proud of the surface behind it (§8: no coincident faces).
  - **One node per plate**, named `logo`, `logo.1`, `logo.2` and so on, so the game can find them, hide them or animate them.
  - **Banners:** the plate may be part of a banner that waves in `idle`; keep the UV square undistorted at rest.
- **The `sign` empty stays** for the game's own text and labels. Make sure the logo plates don't cover it.

### 8.2 Animation: idle and tap

Every building and every person has **two clips besides its working ones**. The game plays `idle` all the time and `tap` once each time the player taps it. Clip names are exact.

**Buildings**

| Clip | Length | Loop | What it shows |
|---|---|---|---|
| `idle` | 4–8 s | seamless | **Quiet life**: a flag or banner sways, smoke puffs, a wheel or weathervane turns, a sign creaks, birds circle a tower. 1–3 moving parts, small amplitude; **the building itself stands still**. A protocol's signature motion goes here (Curve's wheel, Pendle's pendulum). |
| `tap` | 0.8–1.5 s | one-shot, ends exactly at rest | **A playful reaction**: the whole building does a squash-and-stretch bounce (height 100 → 96 → 104 → 100%, anchored at the ground, ease out), plus one reaction of its own: doors swing open and shut, banners snap, the main logo plate flips or turns once round, coins or sparks pop from a chimney, shutters fly open. Snappy: anticipation, overshoot, settle. |

- **The bounce goes on a node named `body`**, the parent of every visible part, with its origin on the ground at the centre. The game scales the file's root to fit the plot, so never animate the root.
- **`tap` runs on top of `idle`** (both play at once): `tap` may animate `body`, doors, shutters and logo plates, but **not the nodes `idle` moves**.
- **The LOD1 copy** gets the same `idle` and `tap`.

**People and animals**

| Clip | Length | What it shows |
|---|---|---|
| `idle` | 2–4 s, seamless | Breathing, a shift of weight, a glance round; a prop moved now and then (the courier pats the satchel). |
| `tap` | 1–1.5 s, one-shot, ends at rest | Turns towards the viewer (+Z) and reacts: a wave, a bow, a tip of the hat, a startled hop. Exaggerated, readable at 40 px. |

**For both:**
- **How to animate:** with object transforms or bones, sampled at 30 fps. No shape keys and no animated materials (the game drives light and colour).
- **Size:** keep the clips small, about 50 KB per building.
- **Working clips stay as they are:** the courier's `walk`, `hand-over` and `toll`; the townsfolk's own; the bell's `ring`.

## 9. Delivery and review

For every asset, before delivering:
1. **Renders** for review (PNG, transparent background is fine), into `docs/art-review/<asset name>/`:
   - `iso-0.png`, `iso-90.png`, `iso-180.png`, `iso-270.png`: perspective FOV 30°, pitch 45°, the asset centred, four yaws;
   - `phone.png`: the iso-0 view scaled so the asset is **64 px** tall (buildings) or **40 px** (people), to check readability;
   - `silhouette.png`: iso-0 as a flat black shape (it must still read);
   - for people, `walk.png`: four frames of the walk;
   - `tap.png`: four frames of the `tap` clip (buildings and people), and `logo.png`: the logo plates with a test logo (any square image with a clear edge) applied, to check the UVs.
2. **Self-check** against §2–§8 and §10, and list any deviation with a reason. Run the coplanar checker (`v2/check_coplanar.py <file.glb>` in the design agent's folder) and report its numbers:
   - **Pairs:** faces facing the same way, **and** faces facing opposite ways, within 5 mm of each other and overlapping. Check them with node transforms composed and skinned meshes posed.
   - **Views:** the LOD0 view and the LOD1 view, each separately.
   - **When:** at rest and at every 0.1 s of every clip.
   - **Ground:** plus no up-facing face within 5 mm of y = 0, and the lowest moving vertex per clip (feet must not sink below 0).
3. **Renders as the game draws:** back faces culled, LOD0 only.
4. The `.glb` into the theme folder named in the request; report triangle count, file size, texture sizes and materials per asset.

The developer reviews each delivery in the game and in these renders, and sends concrete changes until it is right.

## 10. Lessons from the pilot (Aave and the courier, five rounds)

Mistakes that cost a review round each. Check every new asset against this list.

| What went wrong | Why | Rule now |
|---|---|---|
| Walls flickered as the camera turned | Nested boxes (the staircase) and flush parts left faces lying on faces | §8: no coincident faces; merge parts, delete hidden faces or raise parts ≥ 1 cm |
| Walls still flickered on a real GPU | Every material was double-sided, so the backs of window frames, string courses and quoins, lying on the wall, fought it. The first check only looked at faces facing the same way | §8: single-sided materials; delete contact faces; the checker covers opposite-facing pairs too |
| Banners vanished from behind once materials were single-sided | They were open sheets | Thin parts are closed slabs, or double-sided in their own material |
| Stretched triangles at the window bays, a "melted" back door, a log across the top step, flicker on a landing | The game drew LOD1 over LOD0. three.js strips `.` `:` `/` `[` `]` from node names when loading (`….lod1` arrives as `…lod1`), so the game's LOD rule never matched | The game matches on the original name (`userData.name`). Names keep their dots in the file; don't count on them at runtime |
| Grey stripes beside the apse, faces dragged into neighbours | LOD1 decimation moved UVs and vertices | Re-project LOD1 UVs after decimating; lock Trim/Tint vertices and the edges of openings |
| The cap sat at the back of the neck | It hung off the neck instead of being seated on the head | §6: hats on the crown, skinned to the head bone |
| The shoes read as flat pucks and slabs at game size, twice | A separate sole plate wider than the boot; only checked from the side | §6: one boot shape with a thin sole band; check from the top, at 40 px and in the game |
| Feet sank into the ground after the boots changed | The clips were made for the old feet | After any change to the feet or legs, re-check the lowest point of every clip |
| Top windows were squashed under the cornice | Windows were placed by storey without room for the head | Every window keeps its full frame and sill, with ≥ 0.2 m of wall above it |
| Logo plates tilted down were foreshortened to about half | The camera looks down at 45° | §8.1: high plates lean back towards the camera |
| The castle turned into a green toy with a bright crest colour | `Tint` was on the keep's roof and every tower cap | **`Tint` only on cloth** (banners, flags, pennants; on signature buildings the brand's roof is the one exception, as with Aave). Roofs and caps use `Roof` from palette v2 |
| Chimney smoke looked like brick (keep, Maker) | The smoke puffs used `Stone`, so they took its texture | Smoke and steam are **soft pale grey to white** (#e6e3dc…#c9c6bf), with no texture pattern: a flat light texel or a light vertex colour, rounded puffs that shrink and fade as they rise |
| Lido's boats had holes | Open hulls modelled as single-sided shells | Anything open (boats, bowls, barrows, crates) needs **wall thickness**: outer and inner faces and a rim, plus a floor or thwarts. Look into it from above in the renders |
| Spark's lantern looked strange | Eight dark shutters stood out at odd angles, and the flame flickered by scaling | Moving parts must read at game size: no dark slabs at random angles. A flicker stays inside its glass and changes only a little |
| The keep's banner swung into the porch's stones | The sway was checked for coplanar faces, not for passing through solid parts | **Cloth clearance:** banners and flags keep ≥ 10 cm from every solid at every frame of `idle` and `tap`. Check interpenetration, not only coplanarity |
| Maker's back logo plate was cut in half | It sat on a gable that the hipped roof doesn't have, so the roof sliced through it | A logo plate needs a flat wall behind it and nothing in front of it. Check every plate in the iso views from all four sides |
| A fruit popped up out of the solid stall on `tap`, then vanished into it again | It was hidden inside the geometry when still | **Nothing appears from nowhere.** Every moving item is visible where it starts and ends (on the counter, in an open crate). It may come out only through a real opening: a door, a lid, a chimney, a cuckoo door |
| The nft buildings showed plain red and blue rectangles as pictures | Placeholder colours instead of artwork | Pictures are **small paintings** (landscape, portrait, still life, a ship at sea…) painted in the palette, in gilt or timber frames |
| The shop's door swung inwards into the dark wall on `tap` | The hinge was set to open inwards | **Doors that move on `tap` open outwards** (towards +Z, the visitor), or stay shut |
| Spark's lantern read as beige blocks behind bars | A flat bright texel on all the glass, with no frames, gradient or visible flame | A lit object needs **contrast and a focal point**: framed panes, a light gradient in the glass, and a big clearly shaped flame. Judge it at game size: would someone new name it? |
| The review renders looked fine while the game didn't | Cycles draws back faces, and the renders hid LOD1 | §9: render as the game draws (culled, LOD0); judge in the game, not in renders alone |
