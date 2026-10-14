# Batch 1: castle core (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first, including **§10, the lessons from the pilot**. Everything there applies. The Aave building (`public/themes/medieval-castle-v2/models/building/protocol.aave.glb`) is the reference for the look and the quality bar.

Deliver into `public/themes/medieval-castle-v2/models/castle/` (and `models/bridge/` for the drawbridge).

**File names** (the game derives them from the asset name):

| Asset | File, under `public/themes/medieval-castle-v2/` |
|---|---|
| keep | `models/castle/keep.glb` |
| hall | `models/castle/hall.wallet.glb` |
| wall segment | `models/castle/wall.segment.glb` |
| corner | `models/castle/wall.corner.glb` |
| gatehouse | `models/castle/gatehouse.glb` |
| storehouse | `models/castle/storehouse.glb` |
| tollbooth | `models/castle/tollbooth.glb` |
| barrier | `models/castle/tollbooth.barrier.glb` |
| drawbridge | `models/bridge/drawbridge.glb` |

The root node is named as the asset (e.g. `castle.hall.wallet`). Review renders go into `docs/art-review/<asset>/` (§9).

## The castle's new layout (why the pieces change)

In v1 the wallet towers stood on the back wall, hidden behind the keep. In v2 **each wallet is a hall built into the curtain wall**: the first two wallets flank the gate on the front wall, facing the camera and the town, and the next four stand along the side walls. The **keep stands against the back wall**, so nothing important hides behind it. The castle is the guild's home at human scale: a strong, warm, fortified manor next to the town's landmarks. Aave, at 20+ m, is taller than the keep, and that is intended.

```
                back wall (outer face -z, away from the town)
     ┌corner┐ ═══════ [========= KEEP =========] ═══════ ┌corner┐
     ║                                                          ║
     ║  [hall 5]                                    [hall 6]    ║
     ║                                                          ║
     ║  [hall 3]          courtyard + storehouse    [hall 4]    ║
     ║                                                          ║
     └corner┘ ═ [hall 1] ═ [GATEHOUSE] ═ [hall 2] ═ ┌corner┘
                front wall (outer face +z, towards the moat and the town)
                              ║ drawbridge
                              ║ tollbooth + barrier
   ═ and ║ = plain 1 m wall segments between the pieces (no two pieces touch)
```

**Exact grid (metres, island x −10…10, z −21…−2).** Every piece meets only wall segments, never another building, so no two faces can coincide:
- **Corners** 2 × 2 m at the four corners.
- **Gatehouse** 4.0 wide on the front wall, x −2…2.
- **Front halls** x 3…7 (and −7…−3), with one segment either side.
- **Side halls** at z −7…−11 and −12…−16, with segments between.
- **Keep** 8.0 wide on the back wall, x −4…4, with four segments to each corner.

- **Island:** 20 × 19 m inside the moat. The curtain wall runs round its edge. Up to six wallet halls; more wallets share the last hall's banner (the game handles it).
- **Halls:** every hall's **outer face is part of the curtain wall**. The game leaves out the plain wall segments where a hall stands, so the hall's back is the wall there. Empty slots get plain wall.
- **Orientation:** all pieces are modelled with the **outer face (moat side) at −Z** and the **courtyard side at +Z**. The game turns each piece to its wall. The exception is the gatehouse and its outside, which follow v1: the town side is +Z.

## Shared rules for this batch

- **Wall height:**
  - the curtain wall's walkway at **3.0 m**, merlons up to 3.8 m, wall 1.0 m thick;
  - halls, the keep and the gatehouse continue that wall line on their outer face, with the walkway and merlon heights lining up exactly, so the wall reads as one;
  - end every piece's wall flush at its side faces (x = ±half width), so neighbours meet without a gap or an overlap. The game places them edge to edge, so **no overlap means no flicker**.
- **Tier parts (new, §7):**
  - tiers show as extra parts the game switches on: `tier.2`, `tier.4` and `tier.6`, each a node under `body`. The game shows `tier.N` when the tier is ≥ N;
  - t0 is the plain model with all three hidden. Each step adds to the silhouette, as in §7: t2 crenellated parapets or an oriel, t4 a turret or a taller roof, t6 a gilded crown, spire or dome;
  - each tier part must look right with and without the parts above it, and must not overlap the base model's faces (checker, with the parts shown).
- **Colours:**
  - `Trim` is the tier colour;
  - `Tint` is the wallet's crest colour (halls) or the guild's (keep, gatehouse banners). Give big **crest banners** in `Tint` (closed slabs, §10) a place where they show from outside the walls.
- **No logo plates** on castle pieces.
- **Animation (§8.2):**
  - every building has `idle` (looping) and `tap` (one-shot, ends at rest, a `body` bounce plus its own reaction);
  - `tap` never touches the nodes `idle` moves;
  - the ideas below are suggestions; better ones are welcome.
- **Budgets:**
  - keep 8–12k tris;
  - halls and gatehouse 4–8k;
  - corner tower ≤ 2.5k;
  - storehouse and tollbooth ≤ 3k;
  - **wall segment ≤ 600** (it repeats about 40 times);
  - ≤ 6 materials each.
- **Checks:**
  - your coplanar checker on each asset: rest pose, every 0.1 s of every clip, the ground, and tier parts on;
  - plus a check of **two neighbours side by side**: hall next to wall segment, wall segment next to corner, and gatehouse next to wall segment, with no coincident faces where they meet.

## Assets

### 1. `castle.keep`: one model, tiers as parts
- **Size:** footprint **8 m wide (x) × 5.5 m deep (z)**, against the back wall. **12–13 m** to the main roof's ridge, and the flagpole or turret top up to 16 m.
- **Look:**
  - the guild's tower house: a massive stone keep with a tall hipped or pyramid roof in the guild's colour group, and corner turrets with conical caps;
  - a projecting entrance with a stair up to a raised door on the courtyard side (+Z);
  - arrow slits low, real windows high;
  - its outer face (−Z) continues the curtain wall line up to 3.8 m, then the keep rises above it with buttresses and few windows;
  - a big crest banner (`Tint`) on the courtyard face.
- **Empties:** `door` on the ground 1 m in front of the stair's foot (+Z), and `flag` at the flagpole's top.
- **Tiers:**
  - `tier.2`: machicolated parapet round the roof's foot;
  - `tier.4`: a fourth corner turret, or a lantern on the roof;
  - `tier.6`: a gilded crown or spire, and gold finials.
- **Idle (6–8 s):** the crest banner sways; smoke puffs from a chimney; the rooftop flag waves.
- **Tap (1.2–1.5 s):** bounce; the great doors swing open and bang shut; the flag snaps out straight once.

### 2. `castle.hall.wallet`: one per wallet, tiers as parts
- **Size:** **4.0 m wide (x, along the wall) × 4.0 m deep (z)**, including the 1 m wall at the back. **6.5–7.5 m** to the ridge.
- **Look:**
  - a timber-and-stone hall built against the inside of the curtain wall;
  - the outer face (−Z) is the curtain wall up to 3.8 m with merlons, and above it the hall's upper storey with two windows and the roof's gable or eaves. **A tall crest banner (`Tint`) hangs on the outer face**, from under the eaves down over the wall, so each wallet's colour shows from outside the castle;
  - the courtyard face (+Z) has a door at human scale (2.1–2.3 m), a lantern, a small window, and a bench or a barrel at the door;
  - the roof slopes to the courtyard, with the ridge parallel to the wall, a chimney and roof colour from palette v2 (the roof stays neutral; the crest colour is on the banners).
- **Empties:** `door` on the ground 1 m in front of the door (+Z). The courier hands over goods there.
- **Tiers:**
  - `tier.2`: a dormer or an oriel window;
  - `tier.4`: a small corner turret on the wall line;
  - `tier.6`: a gilded weathervane and gold trim.
- **Idle (5–7 s):** the outer banner sways; the lantern swings a little.
- **Tap (1.0–1.3 s):** bounce; the shutters fly open and shut; the door opens a crack and closes; the banner snaps.

### 3. `castle.wall.segment`
- **Size:** **1.0 m long (x) × 1.0 m thick (z) × 3.8 m** to the merlon tops. Walkway at 3.0 m, a merlon and a crenel per metre.
- **Look:** big dressed stone blocks, a battered (sloped) foot over the bottom 0.6 m, string course under the walkway, moss at the base; both faces finished.
- **Tiling:** it must tile end to end with no visible seam, and no faces at its two ends (x = ±0.5): a neighbour closes the gap. Vary the stone pattern so a repeat every metre doesn't show; if you can, make the texture repeat over 3 m.
- No clips. Not interactive.

### 4. `castle.wall.corner`
- **Size:** a corner tower, **2.0 × 2.0 m**, **5.5–6 m** tall, with a conical or crenellated cap.
- **Join:** it meets wall segments on two sides (its −Z outer face and its −X side are outside; walls leave from its +X face and its +Z face). Leave no end faces where walls join.
- **Idle:** a small pennant waves on the cap (`Tint`).
- No tap (not interactive).

### 5. `castle.gatehouse`
- **Size:** **4.0 m wide (x) × 3.5 m deep (z)**, **7–7.5 m** tall. Passage **2.4 m wide × 2.8 m high**, front (+Z) to back.
- **Look:**
  - two half-round towers flanking the arch on the town side (+Z), a crenellated top and the guild's crest banner (`Tint`) over the arch;
  - the passage floor at y = 0;
  - wall line at the sides continuing the curtain wall (walkway 3.0 m), with no end faces at x = ±2.0.
- **Nodes:**
  - `portcullis` (Metal and Timber grid) in the arch, rest pose **raised**;
  - empty `hinge` where the drawbridge hangs: the arch's front edge on the ground.
- **Idle (6 s):** the portcullis chains sway; torch flames by the arch flicker (scale and wobble a flame mesh, no material animation).
- **Tap (1.2 s):** a small bounce; the portcullis drops halfway, judders and rises back.

### 6. `castle.storehouse`
- **Size:** **3 × 3 m**, **5 m** (S class). It stands free in the courtyard.
- **Look:** a granary or storehouse on a stone base, a timber upper floor with a hoist beam and hook over a loft door, and sacks, crates and barrels stacked at the ground door.
- **Empties:** `door` 1 m in front of the ground door (+Z).
- **Idle:** the hoist rope and hook sway.
- **Tap:** bounce; the loft door flaps open and shut; a sack tips over and rights itself.

### 7. `castle.tollbooth` and `castle.tollbooth.barrier`
- **Sizes:**
  - booth: **2 × 2 m, 3 m** tall;
  - barrier arm: **2.6 m** long (it spans the road), pivot at the post end at 1.0 m height. Same contract as v1 (ASSET_SPEC §3.3).
- **Look:**
  - booth: a timber toll hut on a stone sill, a small hipped roof in `Trim`, a serving window with a fold-down counter on the road side (+Z), a lantern on a bracket, a coin box, and a toll board at the `sign` empty;
  - barrier: a striped arm (`Trim` and plaster) with a counterweight at the post.
- **Booth clips:**
  - **idle:** the lantern sways;
  - **tap:** bounce; the window shutter flips open and shut, and a coin hops out of the box and back.
- **Barrier clips** (keep v1's): `lift` (down → vertical, 0.6 s) and `drop` (the reverse).

### 8. `bridge.drawbridge`
- **Size:** deck **2.6 m wide × 2.2 m long**, 0.25 m thick, pivot at the hinge (the castle-side edge on the ground), the deck running towards +Z.
- **Rest pose:** raised. Clips `lower` (raised → flat, 1.2 s, ease in-out) and `raise` (the reverse), as in v1.
- **Look:** heavy planks with iron bands, two chains from the outer corners up to where the gatehouse's chain holes would be (part of this model, moving with the deck).
- No tap.

## Delivery

For each asset:
- the renders (§9), plus `tiers.png` showing t0, t2, t4 and t6 side by side for the keep and the hall;
- `wall-join.png`: hall, wall segment, corner and gatehouse placed side by side as the game does;
- your checker results;
- triangle count and file size.

Then stop. The developer checks the batch in the game, sends fixes, and shows it to the user.
