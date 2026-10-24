# Castle assets: styleguide and specification (medieval theme)

> **Art direction is now `docs/STYLEGUIDE_V2.md`** (stylised realism, size classes, baked occlusion, palette v2). The names, folders, materials and clips below still hold.


Brief for the Blender design agent. The art direction and the full list of asset names, sizes, pivots, clips and tiers. Every name here is a contract: the game asks for it by exact name. Deviations need a note to the developer, not a silent rename.

Source of truth for names: `docs/REDESIGN.md` §4 and this file. Once the prototype exists, the same list is also in `src/castle/assets/manifest.ts`.

---

## 1. Styleguide

### 1.1 Look
- **Stylised medieval**, cosy and readable, like a fantasy board game. Chunky shapes, slightly exaggerated proportions, clear silhouettes. A building must be recognisable at 60 px on a phone.
- **Hand-painted feel, PBR-ready.** Flat colour blocks with light wear (chipped stone, worn wood, soft moss). No photoreal scans, no dirt-heavy grime.
- **No text, no logos, no brand names in the models.** Brand colour and logos are added at runtime: the `Tint` material, and logo plates in the `Logo` material that the game fills with the protocol's logo (`docs/STYLEGUIDE_V2.md` §8.1).
- **Light is set by the game.** Do not bake lighting or shadows into textures.

### 1.2 Palette (reference, use these hues)

| Role | Hex | Use |
|---|---|---|
| Stone light | `#a8a193` | walls, paths |
| Stone dark | `#6b675f` | plinths, keep base |
| Timber | `#6b4a2b` | beams, doors, fences |
| Plaster | `#e8dcc0` | infill between beams |
| Roof slate | `#3d3a40` | steep roofs |
| Thatch | `#b9925a` | cottages, granaries |
| Moss | `#5b7a4a` | ground, ivy |
| Water | `#2f6f8f` | moat |
| Gold | `#c9a24a` | gilded tier accents, banners' trim |
| Cloth | `#8a3b32` | banners (base, recoloured by `Tint`) |

### 1.3 Tier look (the value tiers, same as `docs/WORLD_BIBLE.md` §0)

Every tierable asset (`*.t0`–`*.t6`) is the same building kit with more investment. The tier colour is the **trim** (edges, roof ridge, window frames, banner); the base materials get more finished as the tier rises.

| Tier | Name | Trim colour | Build quality |
|---|---|---|---|
| t0 | Dust | grey `#8a8a8a` | weathered timber, patched thatch, no glass |
| t1 | Common | white `#e8e8e8` | plain stone and timber, shutters |
| t2 | Uncommon | green `#4caf50` | proper stone, slate roof, glazed windows |
| t3 | Rare | blue `#3f7fd6` | added storeys, banners, a gate |
| t4 | Epic | purple `#8e4bd1` | ornate stone, carved trim, towers |
| t5 | Legendary | orange `#e8843a` | fortified, buttresses, lanterns |
| t6 | Mythic | gold `#c9a24a` | gilded roofs, spires, the most detail |

The tier trim colour is applied at runtime through the `Trim` material, so the model only needs the slot. Model the trim as a separate material and keep the rest neutral.

### 1.4 Scale, orientation, pivot
- **1 unit = 1 metre.** Apply all transforms before export. Check the sizes in §3.
- **Pivot:** the origin is at the **centre of the footprint, on the ground** (y = 0). Exception: `bridge.drawbridge` and `castle.tollbooth.barrier` pivot where the spec says.
- **Front faces +Z.** The front is the side that faces the town (for the castle, the drawbridge side; for buildings, the door side).
- **Footprint** is the ground area the model occupies (a 2×2 m building fills a 2×2 m tile). Stay inside it, except for overhangs (say so in your notes).

### 1.5 Polygon and texture budget

| Type | Triangles (max) | Textures |
|---|---|---|
| Keep, gatehouse | 12 000 | one 1024 px atlas |
| Wall, tower, wing, building | 4 000 (t0) → 8 000 (t6) | one 1024 px atlas per model |
| Props (storehouse, crates, banner, bridge, barrier) | 1 500 | shared atlas |
| Person (courier, NPC) | 6 000 | one 1024 px atlas |
| Ground and water tiles | 500 | 512 px, tileable |
| Path tiles | 200 | 256 px, tileable |

- **Share materials across assets** where you can: one `Stone`, one `Timber`, one `Plaster`, one `Roof`, one `Metal`. A shared atlas per group (castle, town, people) is better than one per model.
- Textures: PNG or JPEG in the `.glb` (we convert them later). Max 1024 px.

### 1.6 Materials (names are fixed)

| Material | Meaning | Runtime |
|---|---|---|
| `Stone` | walls, plinths, paths | none |
| `Timber` | beams, doors, fences, bridge deck | none |
| `Plaster` | infill, washes | none |
| `Roof` | slate or tile roofs | none |
| `Thatch` | thatch roofs | none |
| `Metal` | hinges, chains, bells, lantern frames | none |
| `Cloth` | banners, awnings | recoloured by `Tint` |
| `Trim` | the tier trim (see §1.3) | recoloured by the tier |
| `Tint` | brand or crest colour (a roof, a banner, a sign plate) | recoloured per protocol or guild |
| `Glow` | windows, lanterns, the lit path overlay | emissive at night |
| `Water` | moat surface | animated by the game |
| `Cobweb` | cobweb overlay | shown when a building is dormant |
| `Moss` | foliage, grass, the hill (added in batch 3) | none |

Use only these names. A model may use fewer.

### 1.7 Animation
- Animations live **inside the same `.glb`** as named clips. Clip names are exact (lowercase, as listed in §3).
- Times in **seconds**. Looping clips loop cleanly. One-shot clips end in their rest pose.
- Rigged people: a single armature, ~ 25 bones max, Y-up, the standard humanoid proportions (1.7 m tall for a grown person).

### 1.8 Export (glTF 2.0)
- File: **`.glb`** (binary), one file per asset.
- Y-up. Apply transforms and modifiers. No cameras, no lights, no empty helper objects **except** the named attach points below.
- **Node names inside the file match the asset name exactly** (e.g. `castle.keep.t0`). Attach points are named empties: `door`, `sign`, `hinge` (see §3).
- No Draco compression: the developer compresses the files later.
- Only the materials in §1.6 (plus textures they use).

### 1.9 Naming and folders

Asset name → file path:

```
asset name                 file (under the theme's models folder)
castle.keep.t0       →     models/castle/keep.t0.glb
castle.wing.lending  →     models/castle/wing.lending.glb
building.category.lending.t0  →  models/building/category.lending.t0.glb
courier.base         →     models/courier/base.glb
path.tile.straight   →     models/path/tile.straight.glb
badge.first-steps    →     art/badge/first-steps.svg   (2D, see §1.9)
```

Rule: the first word is the **folder**, the rest of the name is the **file name** (without the first word). Glb files: `models/<folder>/<rest>.glb`. Folder names are lowercase. File names keep their dots and use lowercase with hyphens for multi-word parts (`wing.nft`, `tollbooth.barrier`).

The theme folder for this work is: **`public/themes/medieval-castle/`**. Models go in `public/themes/medieval-castle/models/<group>/`. Textures (atlases, if separate) go in `public/themes/medieval-castle/textures/<group>/`.

2D art goes in `public/themes/medieval-castle/art/<group>/` as **SVG** where possible, otherwise **PNG** at the size given. The same rule applies: `badge.first-steps` → `art/badge/first-steps.svg`, `rank.knight` → `art/rank/knight.svg`, `ui.icon.bell` → `art/ui/icon.bell.svg`, `fx.dust` → `art/fx/dust.png`.

---

## 2. Required, optional and fallback

- **Required** (must exist for the prototype to look complete): marked **R** in §3.
- **Optional**: marked **O**. The game uses a fallback when they are missing.
- **Fallback:** a missing model falls back to the standin in the game (a coloured shape). A missing tier falls back to the nearest tier that exists, so one tier model is enough to start.

Prototype target: **all R items**. Priority order: castle and moat, the town and tower, the courier and one NPC, then the building kit, then the rest.

---

## 3. Asset list

Format for each entry: **name** · required · size (w × d × h, metres) · pivot · notes · clips · attach points.

### 3.1 Castle (`castle.*`) → `models/castle/`

| Name | Req | Size (w×d×h) | Pivot | Notes |
|---|---|---|---|---|
| `castle.keep.t0` … `castle.keep.t6` | R (t0, t3, t6) · O (others) | t0: 4×4×5 · t3: 6×6×10 · t6: 8×8×14 | centre, ground | The main keep. Front (+Z) has the gate arch. Tier shows in the roof and the trim. |
| `castle.wall.segment` | R | 1×0.3×3 | centre, ground | One metre of curtain wall, length along X. Battlements on top. Must tile end to end. |
| `castle.wall.corner` | R | 1×1×3 | centre, ground | Corner piece that meets two segments. |
| `castle.gatehouse` | R | 4×4×6 | centre, ground | Gate tower over the drawbridge. Arch opening faces +Z, 2.5 m wide. Portcullis optional, as a separate `Metal` mesh. |
| `castle.tower.wallet` | R | r 0.8 · 3 tall | centre, ground | One round tower per wallet, stacked on the walls. Conical roof. |
| `castle.tower.wallet.t0` … `t6` | O | as above | centre, ground | Tier variants: roof and trim only. |
| `castle.wing.lending` | R | 4×3×3 | centre, ground | Vault wing (protocols that lend). Strongroom door on the front. |
| `castle.wing.staking` | R | 4×3×3 | centre, ground | Granary wing: thatch, sacks, a barn door. |
| `castle.wing.dex` | R | 4×3×3 | centre, ground | Market wing: awnings, stalls. |
| `castle.wing.nft` | R | 4×3×3 | centre, ground | Gallery wing: tall windows, a portrait frame (plain, no picture). |
| `castle.wing.governance` | R | 4×3×3 | centre, ground | Council hall: a long hall, a seal plate on the front. |
| `castle.wing.other` | R | 4×3×3 | centre, ground | Fallback wing for other categories. |
| `castle.storehouse` | R | 2×2×2 | centre, ground | Crates and sacks. Holds tokens with no protocol. |
| `castle.banner` | R | 1×0.05×1.5 | top centre, base at 0 | Hangs from a pole or a wall. Cloth material, `Tint` on the front face. Clip `wave`. |

### 3.2 Moat and drawbridge (`moat.*`, `bridge.*`) → `models/moat/`, `models/bridge/`

| Name | Req | Size | Pivot | Notes |
|---|---|---|---|---|
| `moat.water` | R | 2×2×0.1 | centre, surface at y = 0 | Flat water tile. Tileable. `Water` material. |
| `moat.edge` | R | 1×0.3×0.2 | centre, ground | Stone lip, 1 m, length along X. Tileable. |
| `bridge.drawbridge` | R | deck 3 wide × 2 long × 0.2 (the length runs from the hinge towards the town, +Z) | **hinge** (the castle-side edge, at the deck's near end, at ground height) | Deck of the bridge. Rest pose is **raised** (rotated 90° up). Clips `lower` (raised → flat, 1.2 s, ease in-out) and `raise` (the reverse). Empty `hinge`. |
| `bridge.chain` | O | 0.1×0.1×1.5 | top of the gatehouse | Raising chain for the drawbridge, `Metal`. |

### 3.3 Tollbooth (`castle.tollbooth*`) → `models/castle/`

| Name | Req | Size | Pivot | Notes |
|---|---|---|---|---|
| `castle.tollbooth` | R | 2×2×2.5 | centre, ground | Border post between the drawbridge and the town. A small booth with a window on the front (+Z) and a shuttered window on the back. A `Trim` roof. Empty `sign` for a toll board. |
| `castle.tollbooth.barrier` | R | 2×0.1×0.1 (arm) | **post** (the end at the booth, at barrier height 1.0 m) | Barrier arm. Rest pose **down**, horizontal across the path. Clips `lift` (down → vertical, 0.6 s) and `drop` (reverse). Striped `Trim`. |

### 3.4 Town (`town.*`, `path.*`) → `models/town/`, `models/path/`

| Name | Req | Size | Pivot | Notes |
|---|---|---|---|---|
| `town.ground` | R | 2×2×0.05 | centre, ground | Town ground tile (cobbles, grass patches). Tileable, `512 px`. |
| `town.tower.chronicle` | R | base 3×3 · 10 tall | centre, ground | The Chronicle tower in the middle of the town. Open belfry at the top. Empty `hinge` at the bell's yoke (see below). |
| `town.tower.bell` | R | Ø0.6 × 0.6 | the bell's **yoke** (top of the bell, where it hangs) | The bell, `Metal`. Clip `ring` (swings 20° each way and back, 1.5 s, one-shot). |
| `path.tile.straight` | R | 1×1×0.02 | centre | Path, straight across. `Stone` or packed earth. Tileable. |
| `path.tile.corner` | R | 1×1×0.02 | centre | Path, 90° bend. |
| `path.tile.junction` | R | 1×1×0.02 | centre | Path, three-way. |
| `path.tile.lit` | R | 1×1×0.01 | centre | Glow overlay for any path tile. `Glow` material only. The game sets its opacity. |

### 3.5 Protocol buildings (`building.*`) → `models/building/`

Footprint is **2×2 m** for all buildings (a tile). Height 2–4 m for tier 0 to tier 3, up to 6 m for tier 6.

**Generic category buildings (required, the fallback):**

| Name | Req | Notes |
|---|---|---|
| `building.category.lending.t0` | R | Counting house, a small bank. Strongbox window. |
| `building.category.lending.t3` | R | The same, with a second storey and a sign. |
| `building.category.dex.t0` | R | Market stall. Awning in `Cloth`. |
| `building.category.dex.t3` | R | Trading hall with a larger awning. |
| `building.category.staking.t0` | R | Granary: thatch roof, sacks outside. |
| `building.category.staking.t3` | R | Granary with a barn door and a fence. |
| `building.category.nft.t0` | R | Small gallery, one tall window. |
| `building.category.nft.t3` | R | Gallery with a frame above the door. |
| `building.category.governance.t0` | R | Small council hut with a seal plate. |
| `building.category.governance.t3` | R | Council hall with a pennant. |
| `building.category.bridge.t0` | R | Harbour shed with a crane arm. |
| `building.category.bridge.t3` | R | Harbour house with a quay. |
| `building.category.other.t0` | R | Plain shop. |
| `building.category.other.t3` | R | Shop with a second storey. |
| `building.category.<cat>.t1`, `.t2`, `.t4`, `.t5`, `.t6` | O | Other tiers. The game uses the nearest tier that exists. |

Every building model has:
- empty **`door`** at the front, on the ground, where a person stands (1 m in front of the door).
- empty **`sign`** above the door, where the brand plate goes (a flat `Tint` plane, optional in the mesh).

**Per-protocol buildings (optional):** `building.protocol.<id>` (for example `building.protocol.aave`). Same rules as above, with the protocol's own look. Use a generic category building until a protocol has its own.

`building.dormant` · O · 1×1×0.5 · centre, ground · a cobweb overlay for dormant buildings, `Cobweb` material only.

### 3.6 People (`courier.*`, `person.*`) → `models/courier/`, `models/person/`

Rigged humanoids, 1.7 m tall, one armature each. Same skeleton for all people, so one animation set works for everyone.

| Name | Req | Clips | Notes |
|---|---|---|---|
| `courier.base` | R | `idle`, `walk`, `hand-over`, `toll` | The transaction figure: a traveller with a satchel. `hand-over` (1.0 s): hands the cargo to the person it meets. `toll` (1.0 s): holds out a coin purse to the booth. |
| `courier.cargo.t0` · `t3` · `t6` | R | — | Cargo carried on the back: t0 a small pouch, t3 a sack, t6 a chest. Attach to the courier's `hand` bone (or the origin, if no rig). |
| `courier.cargo.t1`, `t2`, `t4`, `t5` | O | — | Other tiers. |
| `person.npc.base` | R | `idle`, `emerge`, `receive`, `return` | A townsperson, generic. `emerge` (1.0 s): steps out of a door. `receive` (1.0 s): takes goods from the courier. `return` (1.0 s): steps back into the door. |
| `person.npc.<category>` | O | same as base | Category-specific: `lending` (banker), `dex` (merchant), `staking` (farmer), `nft` (painter), `governance` (councillor), `bridge` (ferryman), `other` (villager). |
| `person.guard` | O | `idle`, `walk` | Stands at the drawbridge. |

### 3.7 Effects (`fx.*`) → `art/fx/` (PNG, not models)

Effects are sprites or small textures, not `.glb`.

| Name | Req | Size | Notes |
|---|---|---|---|
| `fx.bell.ring` | R | 256×256 PNG, transparent | Ring wave around the tower, a soft circle. |
| `fx.dust` | R | 128×128 PNG | Dust puff when a courier arrives at a building. |
| `fx.coins` | R | 128×128 PNG | A few coins for the toll and for exchanges. |
| `fx.splash` | O | 128×128 PNG | Moat splash at the drawbridge. |
| `fx.cobweb` | O | 256×256 PNG | Cobweb overlay for dormant buildings. |

### 3.8 Icons, badges, ranks (2D) → `art/ui/`, `art/badges/`, `art/ranks/`

All **SVG** if possible, otherwise **PNG** at the size given. Flat, bold outlines, readable at 32 px. Medieval heraldic style. Gold rim on badges.

**Icons `ui.icon.<name>` · R · 64×64 · `art/ui/icon.<name>.svg`**

| Name | Meaning |
|---|---|
| `ui.icon.castle` | the Castle tab |
| `ui.icon.town` | the Town tab |
| `ui.icon.badges` | the Badges tab |
| `ui.icon.guild` | the Guild tab |
| `ui.icon.bell` | the Chronicle bell |
| `ui.icon.gas` | gas price / toll |
| `ui.icon.close` | close a sheet |
| `ui.icon.settings` | settings |
| `ui.icon.map` | the Realm Map (later) |

**Badges `badge.<id>` · R · 128×128 · `art/badge/<id>.svg`** (one per medal, 22 total)

`badge.first-steps`, `badge.barter`, `badge.fountain`, `badge.blessed`, `badge.vault`, `badge.borrower`, `badge.paid`, `badge.survived`, `badge.keys`, `badge.patron`, `badge.seafarer`, `badge.harvest`, `badge.favour`, `badge.founder`, `badge.council`, `badge.generous`, `badge.explorer`, `badge.expedition`, `badge.veteran`, `badge.scarred`, `badge.steward`, `badge.hoard`

Each badge is a shield or disc with one clear symbol. Keep them distinct from each other by symbol, not only by colour.

**Ranks `rank.<id>` · R · 128×128 · `art/rank/<id>.svg`** (six)

`rank.wanderer` (level 1) · `rank.squire` (5) · `rank.knight` (10) · `rank.captain` (20) · `rank.lord` (30) · `rank.legend` (45)

Each rank gets a bigger, more ornate frame than the one before, as a steady progression.

**New castle badges (proposed, not yet implemented):** `badge.castle-builder`, `badge.gatehouse-lord`, `badge.gilded`, `badge.full-moat`, `badge.bridge-keeper`. Draw these too, so the set is complete.

**Frame `ui.frame.t0` … `ui.frame.t6` · O · 256×64 · `art/ui/frame.t<n>.svg`**: a border for the bottom sheet, in the tier colour (§1.3).

### 3.9 Scenery (optional for the prototype)

| Name | Req | Size | Notes |
|---|---|---|---|
| `scenery.tree.oak` | O | 2×2×5 | Tree around the island. Pivot at the trunk base. |
| `scenery.tree.pine` | O | 1.5×1.5×5 | |
| `scenery.rock.1` … `.3` | O | 1×1×0.6 | Rocks. Pivot at the base. |
| `scenery.hill` | O | 20×20×4 | Backdrop hill. Pivot at the base centre. |

---

### 3.10 Signature protocol buildings (batch 4) → `models/building/`

One building per well-known protocol, recognisable by shape (no logos or text: the brand colour comes in through `Tint`, the sign through the `sign` point). Same rules as §3.5: **2×2 m footprint** (overhangs up to 0.5 m are fine), 3–5 m tall, front +Z, empties `door` (2 m out from the centre, on the ground) and `sign`. One model per protocol, no tiers: the game shows the tier with `Trim`.

The name uses the protocol **family**, without the version: `aave-v2` and `aave-v3` are both `building.protocol.aave`.

| Name | Category | Idea |
|---|---|---|
| `building.protocol.aave` | lending | A ghostly marble bank: pale stone, tall columns, a vault door |
| `building.protocol.compound` | lending | A walled counting yard with a green-roofed strongroom |
| `building.protocol.maker` | lending | A mint: a forge chimney, coin presses, a stout tower |
| `building.protocol.uniswap` | dex | A round market hall with a unicorn weathervane |
| `building.protocol.curve` | dex | A water mill on a curved race, its wheel turning slowly (clip `idle`) |
| `building.protocol.lido` | staking | A lakeside boathouse with a sail-like roof |
| `building.protocol.rocket-pool` | staking | A fireworks workshop with a rocket on the roof |
| `building.protocol.eigenlayer` | staking | A layered stone ziggurat, three stacked tiers |
| `building.protocol.opensea` | nft | A harbourside gallery with a blue sail awning |
| `building.protocol.ens` | governance | A scribes' hall with a big ledger on a lectern outside |

### 3.12 Signature protocol buildings, second wave (batch 5) → `models/building/`

Same rules as §3.10 (2×2 m, 3–5 m tall, front +Z, `door` and `sign` empties, `Tint` for the brand colour, `Trim` for the tier, no text or logos).

| Name | Category | Idea |
|---|---|---|
| `building.protocol.morpho` | lending | A butterfly-winged pavilion: two blue-grey wing roofs over a small counting room |
| `building.protocol.spark` | lending | A lantern-maker's bank: a stout house with a big glowing (`Glow`) lantern on a bracket |
| `building.protocol.fluid` | lending | A fountain house: a round basin in front with water spilling over its rim |
| `building.protocol.gondi` | lending | A pawnbroker's: a narrow shop with three hanging balls on a bracket and framed pictures in the window |
| `building.protocol.pendle` | staking | A clockmaker's: a tall narrow house with a pendulum clock face on the gable |
| `building.protocol.yearn` | staking | A vineyard press-house: a barrel vault with vines on trellises |
| `building.protocol.balancer` | dex | A weighing house: a big balance scale on a frame by the door |
| `building.protocol.sushiswap` | dex | A fish-market stall house with a curved, low roof and hanging lanterns |
| `building.protocol.1inch` | dex | A unicorn-and-horse stable turned broker's office: stable doors, a horse-head sign bracket |
| `building.protocol.cow` | dex | A dairy barn: a gambrel roof, milk churns by the door |
| `building.protocol.blur` | nft | A painter's atelier: a skylit studio with an easel outside |
| `building.protocol.across` | bridge | A ferry landing: a small house on a jetty with a rope ferry winch |

### 3.11 Town props (batch 4) → `models/prop/`

Small things that make the town lived in. Pivot at the base centre. ≤ 600 triangles each.

| Name | Size (w×d×h) | Notes |
|---|---|---|
| `prop.lamp` | 0.3×0.3×2.4 | Lantern post, the lantern in `Glow` (lit at night) |
| `prop.well` | 1.4×1.4×2 | Stone well with a little roof and a bucket |
| `prop.barrel` | 0.6×0.6×0.9 | |
| `prop.crate` | 0.7×0.7×0.7 | |
| `prop.cart` | 1.2×2.2×1.2 | Hand cart with two wheels, front +Z |
| `prop.fence.segment` | 1×0.1×0.9 | Wooden fence, 1 m along X, tiles end to end |
| `prop.bench` | 1.4×0.5×0.8 | |
| `prop.flowers` | 0.8×0.4×0.5 | Flower box (`Moss` and two flower colours) |
| `prop.market.stall` | 2×1.5×2.2 | A small stall with a `Tint` awning, for busy markets |

### 3.13 Life and states (batch 6)

**Animals `animal.*` → `models/animal/`.** Small, rigged or simply animated, flat colour, ≤ 1 500 triangles, pivot at the feet centre, front +Z. They wander the town and the moat. Clips loop cleanly.

| Name | Size (w×d×h) | Clips | Notes |
|---|---|---|---|
| `animal.chicken` | 0.3×0.4×0.4 | `idle` (pecking), `walk` | |
| `animal.cat` | 0.25×0.6×0.35 | `idle` (tail flick), `walk`, `sit` | |
| `animal.dog` | 0.35×0.8×0.6 | `idle`, `walk` | |
| `animal.duck` | 0.3×0.45×0.3 | `idle` (bobbing), `swim` | Floats: its waterline at y = 0 (the moat surface) |
| `animal.horse` | 0.6×2.2×1.7 | `idle` (head down, grazing), `walk` | Stands in the paddock by the gate |

**Castle details → `models/castle/`, `models/moat/`.**

| Name | Size | Clips | Notes |
|---|---|---|---|
| `castle.flag` | 0.6×0.02×1.6 (pole 1.6, flag 0.6×0.4) | `wave` | A small flag on a pole, for the top of each wallet tower. The flag in `Tint` (the wallet's crest colour). Pivot at the pole's foot. |
| `moat.lily` | 0.5×0.5×0.05 | — | Lily pads with a flower, floating at y = 0 |
| `moat.reeds` | 0.6×0.4×0.9 | — | A clump of reeds for the moat's edge, `Moss` |

**Effects → `art/fx/` (PNG, transparent, as §3.7).**

| Name | Size | Notes |
|---|---|---|
| `fx.refused` | 256×256 | A red wax seal with a cross: a transaction that failed, shown over the barrier as the courier turns back |
| `fx.sparkle` | 128×128 | Gold sparkles, for a badge just earned |

**App icons → `art/app/` (PNG).** No longer used: the installed app, the tab and the top bar show the Zenigard logo from `public/brand/` (`npm run brand` draws its PNGs), the same for every theme. Kept for reference: the castle on a plain background, readable at small sizes.

| Name | Size | Notes |
|---|---|---|
| `app.icon.512` | 512×512 | The castle's keep and a banner, centred, a little margin |
| `app.icon.192` | 192×192 | The same, simplified if needed |
| `app.icon.maskable` | 512×512 | The same with the art inside the central 80% (safe zone), background to the edges |

### 3.15 Signature protocol buildings, third wave, and rain (batch 9)

Same rules as §3.10, textured as §3.14.

| Name | Category | Idea |
|---|---|---|
| `building.protocol.ethena` | staking | A salt-pan works: shallow white pans in front, a small refinery house |
| `building.protocol.convex` | staking | A lens-grinder's: a round workshop with a big convex glass lens over the door |
| `building.protocol.frax` | lending | A two-faced mint: half stone, half timber, with a split roof in two colours |
| `building.protocol.euler` | lending | A geometer's hall: a dome with a ring of numbered sundial marks |
| `building.protocol.stargate` | bridge | A star-gazer's arch: a stone gate arch with a star on top, by a small quay |
| `building.protocol.zora` | nft | A glassblower's gallery: round glowing (`Glow`) orbs in the window |
| `building.protocol.safe` | governance | A vault with many locks: a strong door with several padlocks on a bar |
| `building.protocol.paraswap` | dex | A paraglider's market: a stall house with a canopy like a wing |
| `building.protocol.kyber` | dex | A crystal trader's: green-blue crystals in a display window, a faceted roof |
| `building.protocol.lifi` | bridge | A signal tower: a slim tower with a turning wheel of flags (clip `idle`) |

| Name | Size | Notes |
|---|---|---|
| `fx.rain` | 256×256 PNG, transparent | A few soft rain streaks, tileable vertically; the game scrolls it for a grey market |

### 3.16 The harbour (batch 10): crossings to other chains

Where a bridge transaction leaves for an L2 (Base, Arbitrum, Optimism) or arrives from one. It sits at the town's side on the water; a ship takes the courier's goods across. Textured as §3.14.

| Name | Size (w×d×h) | Clips | Notes |
|---|---|---|---|
| `town.harbour.quay` | 6×3×0.6 | — | A stone quay with mooring posts and a ladder, its +Z edge on the water (y = 0 at the water line) |
| `town.harbour.ship` | 1.6×4×4.5 | `idle` (bobbing), `sail` (sail full, slight roll) | A small cog with one square sail in `Tint` (the realm's colour). Waterline at y = 0, bow +Z |
| `town.harbour.crane` | 1.5×1.5×4 | `idle` (the jib swings a little) | A timber treadwheel crane for the quay |
| `town.harbour.buoy` | 0.4×0.4×0.8 | `idle` (bobbing) | A channel buoy, `Tint` top band |

### 3.14 The texture pass (batch 7, a pilot first)

The look §1.1 asks for: hand-painted, light wear, no baked lighting. Textures on top of the flat colours, same models, same names, same materials.

- **Colour maps only** (no normal or roughness maps yet), painted in the §1.2 palette with soft wear: chipped stone edges, wood grain, plaster stains, moss at the foot of walls, slate and thatch texture.
- **Runtime colours keep working:** `Trim` and `Tint` get a **light greyscale** texture (the game multiplies the tier or brand colour over it); `Glow` and `Water` stay untextured.
- **Size (as piloted in batch 7a):** one small **repeating texture per material** (256 px for Stone, Timber, Plaster, Roof, Thatch; 128 px for Metal, Cloth, Trim, Tint), about 213 px per metre on every model, rather than one atlas per model (an atlas cannot repeat within a region). Images are **WebP** (`EXT_texture_webp`, no PNG fallback), embedded in the `.glb`; `baseColorFactor` white. The pilot added 0.21 MB; the whole theme should stay around 4 MB.
- **Moss at the wall foot:** a thin `Moss` skirt mesh along the base of walls (a repeating texture cannot know where the ground is).
- **UVs:** world-scale where it tiles (stone and planks look the same size on every model: about one stone course per 0.3 m).
- **Pilot (batch 7a):** the castle only: `castle.keep.t0`–`t6`, `castle.wall.segment`, `castle.wall.corner`, `castle.gatehouse`, `castle.tower.wallet` (+ its tiers), `castle.wing.*`, `castle.storehouse`, `castle.tollbooth`, `bridge.drawbridge`. Then stop: the developer checks the look and the size in the game before the rest (town buildings, signature buildings, props, people and animals).

## 4. Delivery

1. Write each asset to `public/themes/medieval-castle/models/<group>/<file>.glb` (or `art/` for 2D), using the names in §1.9.
2. Put the files as you finish them; do not wait for the whole set. Start with the **R** items in the priority order in §2.
3. Keep a list of what you delivered: name, file path, triangle count, clips, and any change from this spec. Send it back as a message to the developer.
4. Tell the developer about any spec you could not meet and why. Do not rename anything.
5. The developer, not you, bumps the theme's version (`public/themes/medieval-castle/theme.json`) and records it (`npm run assets:versions -- write`). Do not edit `theme.json` or files outside the folders above.

## 5. Open questions for the art

- Do you want the tiers as one model with a `Trim` swap, or a separate model per tier? (Spec says the keep and the buildings have one model per tier, the trim is runtime.) Say if the trim alone is not enough to tell tiers apart.
- Preferred polygon budget for a phone? (Spec targets the table in §1.5. We can tighten it after the first test.)
