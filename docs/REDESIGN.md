# Castle redesign: plan (branch `castle-redesign`)

Status: **draft, first answers in.** No code yet. Items marked **(suggestion)** are my proposals where the brief left a gap.

**Decided (2026-10-14):**
- Renderer: **3D isometric** (three.js, orthographic camera, Blender `.glb` models).
- Wallets: **one tower per wallet** on the castle walls.
- Repo: **stay in this repo** on `castle-redesign`; remove old views after parity.
- Castle size: driven by **dollar value** (tiers); wallet count adds towers; protocols add wings.

- Incoming transactions walk **into** the castle as well as outgoing ones walk out.
- Protocol buildings: **one per protocol**, with a **fallback generic building per category** for protocols without their own model.
- Standins: **coloured shapes** (cubes, cylinders, capsules).
- Blender: **4.x, glTF `.glb`**, Y-up, modifiers applied, one file per asset, origin at base centre, 1 unit = 1 m.

- Mobile **and** desktop layouts are both required (phones first).
- Badges and ranks: **rework** for the castle (keep the system, redesign the set and the look).
- Old theme packs (highland, modern, sci-fi): **remove** now.
- Game mode: **ignored for now**. Focus is the look and feel.

- Naming scheme in §4.1: **accepted** (can still change later).

The interview is complete. Next: the look and feel, starting with the mobile and desktop shell and the standins.

---

## 1. What changes, what stays

| Brief | Now | Redesign |
|---|---|---|
| Look and feel | Stardew-like town, heroes on mounts, 2D + 3D views, realm map | **Clash-of-Clans-style base**: one home castle, a town in front, touch-first |
| Heroes | Every wallet is a hero with a mount | **Gone.** Wallets are part of the castle |
| Home | A tent to a castle by value | **One castle that grows** with wallet count and $ value |
| Transactions | Walkers and flights on roads | A **figure crosses the drawbridge** from the castle to the town |
| Blockchain | Town gates and roads | **The town in front of the castle** holds the protocol buildings |
| Tower / bell | Chronicle tower rings per block | **Same**, in the middle of the town |
| Paths | Light up with activity | **Same** |
| Badges and ranks | 22 medals, player levels, ranks | **Kept**, reskinned, plus new castle-related ones |
| Themes | Medieval, modern, sci-fi, highland via pack bundles | **Medieval only for now**, behind a theme contract (§5) |
| Game mode | None | **Hook points** for a future mode (§8) |

Kept as-is: the data layer (`src/data/`: Zerion client, pacer, budget, ledger, backfill, RPC heartbeat), the domain layer (`src/domain/`: mappers, tiers, feats, player, realms), fixtures, and the test suite. These are the parts worth keeping.

---

## 2. The screen (mobile first)

**Suggestion:** one screen, no page scroll. Pinch and drag to pan the island, tap to select.

```
┌──────────────────────────────┐
│ ☰  Guild name  Lv 12 ⚜      │  ← top bar: level/rank, sync, settings
├──────────────────────────────┤
│                              │
│     [ castle, moat,          │  ← the castle sits at the back (top)
│       drawbridge ]           │
│   ─────────────────────────  │  ← drawbridge crosses the moat
│     [ town: protocol         │  ← the town fills the middle
│       buildings, tower,      │     (protocols = buildings, people inside)
│       lit paths ]            │
│                              │
├──────────────────────────────┤
│ [Castle] [Town] [Badges] [⋯] │  ← bottom tab bar (thumb reach)
└──────────────────────────────┘
  tap a building → bottom sheet with details; the person comes out
```

- **Bottom sheet** for every detail (building, wallet, transaction, badge). Replaces the current DOM panels.
- **Landscape** and tablets: same layout, wider.
- **Performance budget (suggestion):** 60 fps on a mid-range phone, under 15 MB of first download per theme (current medieval theme is 11 MB, so most of it may need trimming), works offline after first load (existing `sw.js`).

---

## 3. Concept mapping

### 3.1 The castle (home)

- **Keep (suggestion):** the castle is the player's **guild** (all wallets). Each wallet is a **tower** on the castle walls: **one tower per wallet**, so the castle grows with the number of wallets.
- **Growth by dollar value (decided 2026-10-14):** the castle's **size and stage** follow the guild's total $, on the existing 0–6 tier scale (`docs/WORLD_BIBLE.md` §0): each tier adds a ring of wall, a bigger keep and more space in the bailey. Material follows the same tier (wood → stone → fortified → gilded).
- **Wallet count (suggestion):** adds **towers** on the walls, one per wallet, so the skyline shows how many wallets there are even when the value is small. Each tower can upgrade by its own wallet's value.

| Guild value tier | Castle stage (suggestion) |
|---|---|
| 0 Dust | Palisade and one keep |
| 1–2 | Stone curtain wall, gatehouse |
| 3–4 | Second wall ring, bailey |
| 5–6 | Fortified castle, outer walls, gilded roofs |
- **Growth by protocols and tokens (suggestion):** each protocol category adds a **wing** to the castle (lending: vault wing; staking: granary; NFTs: gallery; governance: council hall). The wing's size reflects how many positions are in that category. Tokens with no protocol go in a **storehouse** (the "odds-and-ends pouch" from the world bible).
- **Moat:** surrounds the whole castle. Water colour can reflect gas price or network activity (suggestion; cheap and readable).
- **Spam and dust:** a **midden** outside the walls, hidden by default (existing spam rule).

### 3.2 The drawbridge and the transaction

- **Every outgoing transaction** from any owned wallet: the **drawbridge lowers**, a **courier figure** leaves the castle, crosses the bridge, and walks into the town to the target building.
- **Figure:** one figure per transaction. **Suggestion:** the figure's look (courier, knight, merchant, etc.) comes from the wallet's tower type; its load (cargo) shows the value tier (the existing caravan tiers become cargo sprites).
- **Incoming transactions** (suggestion): the courier walks **from the town into the castle**, drawbridge lowered again, to the wallet's tower.
- **Wallet to wallet** (internal): stays inside the castle, no bridge needed (same rule as the old guild hall).
- **Pending transactions:** the drawbridge stays half-lowered until confirmed (suggestion, it's a readable state).
- **Tollbooth (added 2026-10-14):** between the drawbridge and the town there is a **tollbooth / border post**. Every courier stops here and **pays the transaction fee** (gas) before it enters the town (outgoing), and before it returns to the castle (incoming). The toll amount reflects the gas price at that moment (`courier.toll` plays the payment; the booth's toll board shows the current gas price, as the province towers do now).
  - Outgoing: bridge → **tollbooth** (pay gas) → town.
  - Incoming: town → **tollbooth** (fee shown as paid by the sender, so nothing is charged here) → bridge → castle. (suggestion: the booth only charges on outgoing, so incoming couriers just stamp through.)
  - Failed transactions (suggestion): the courier is turned back at the booth, and the bridge raises again.
  - Assets: `castle.tollbooth` (building between the bridge and the town, with a barrier arm `castle.tollbooth.barrier` that lifts on payment), `courier.toll` (the coin payment clip, `fx.coins` reused).

### 3.3 The town and protocols

- The town is the **blockchain**: **one town per realm** (Ethereum, and L2s later). Realm switching stays as now.
- **Protocol buildings (decided):** each protocol with activity gets **its own building** (`building.protocol.<id>`, e.g. `building.protocol.aave`), with its brand sign. A protocol with no model of its own uses the **generic building for its category** (`building.category.<cat>.t<n>`: lending = bank, DEX = market, staking = granary, NFT = gallery, bridge = harbour, other = shop). The brand colour tints the roof either way.
- **Person in each building:** an **NPC** stands at the door. When the courier arrives, the NPC **comes out** and meets the courier; they exchange cargo, then both go back in. This is the "interaction" animation.
- **Building growth (suggestion):** the building's size and floors reflect how much value the guild has in that protocol (tier scale). Dormant buildings (no activity in 30 days) get cobwebs, as in the existing sleeper rule.

### 3.4 The tower and bell

- Keep the **Chronicle tower** in the middle of the town. It **rings** on every new block (volume and length by block fullness, as now in `src/audio/soundscape.ts`).
- The bell swing animation and the block number board stay.

### 3.5 Paths

- Paths between buildings and to the drawbridge.
- They **light up** when a transaction travels them, and fade out over a few seconds (same as now). Implementation idea: each path segment is a tile with an "energy" value; the tile sets its emissive glow from it.

### 3.6 The player: badges and ranks

- **Kept:** the 22 medals (`src/domain/feats.ts`), the level and rank curve (`src/domain/player.ts`: Wanderer → Legend), and the medal tiers.
- **Suggestion, new castle badges:** "Castle Builder" (first tower), "Gatehouse Lord" (8 wallets), "Gilded" (keep reached tier 6), "Full Moat" (all protocol wings lit), "Bridge Keeper" (1,000 transactions through the bridge).
- **Display:** the badge case moves into the Castle tab; the rank shows as a banner over the castle gate.

---

## 4. Asset list (what you make in Blender)

### 4.1 Naming rules (suggestion)

- Lowercase, dot-separated: `<group>.<thing>[.<variant>][.<state>]`. Example: `building.lending.t2`, `bridge.drawbridge.down`.
- Variant tiers are numbered `t0`–`t6` to match the value tiers.
- Every asset has a **standard name** that every theme must provide (the contract). The name is what the code asks for; the theme decides what it looks like.
- Models are **glTF (.glb)**, one file per asset, origin at the **base centre** (y = 0 on the ground), 1 unit = 1 metre, +Z facing the viewer's default direction.
- Animations are named clips inside the same file (`open`, `close`, `idle`, `walk`, etc.).
- Textures: WebP, 1024 px max (existing budget).

### 4.2 The asset list

**Castle group `castle.*`**

| Name | What | Standin (prototype) |
|---|---|---|
| `castle.keep.t0`–`t6` | Main keep, one per value tier | Cube 4×4×4, colour by tier |
| `castle.wall.segment` | 1 m wall section (tiled) | Cube 2×1×0.3 |
| `castle.wall.corner` | Wall corner | Cube 0.6×1×0.6 |
| `castle.gatehouse` | Gate tower over the drawbridge | Cube 3×4×3 |
| `castle.tower.wallet` | One tower per wallet, stackable | Cylinder r 0.8, h 3 |
| `castle.tower.wallet.t0`–`t6` | Tower tiers (optional, or use material swap) | Same, coloured |
| `castle.wing.lending` | Wing per protocol category | Cube 3×2×3 |
| `castle.wing.staking` | | Cube |
| `castle.wing.dex` | | Cube |
| `castle.wing.nft` | | Cube |
| `castle.wing.governance` | | Cube |
| `castle.wing.other` | Fallback wing | Cube |
| `castle.storehouse` | Holds tokens with no protocol | Cube 2×2×2 |
| `castle.banner` | Guild banner (tinted by crest colour) | Plane 1×1.5 |

**Moat and bridge `moat.*`, `bridge.*`**

| Name | What | Standin |
|---|---|---|
| `moat.water` | Water surface, tiling | Plane, blue |
| `moat.edge` | Stone lip, tiling | Thin box |
| `bridge.drawbridge` | Bridge deck, with `down` and `up` clips | Box 3×0.2×2, pivot at the hinge |
| `bridge.chain` | Raising chain (optional) | Thin cylinder |
| `castle.tollbooth` | Tollbooth / border post between bridge and town (added 2026-10-14) | Cube 2×2.5×2 |
| `castle.tollbooth.barrier` | Barrier arm; clip `lift` on payment, `drop` after | Thin box 2×0.1×0.1, pivot at the post |
| `bridge.wood.t0`–`t6` | Bridge material per tier (optional) | Colour only |

**Town `town.*`, `path.*`**

| Name | What | Standin |
|---|---|---|
| `town.ground` | Town ground tile, tiling | Plane, green |
| `town.tower.chronicle` | The bell tower in the middle | Cylinder r 1, h 8 |
| `town.tower.bell` | Bell (swings on `ring` clip) | Sphere r 0.3 |
| `path.tile.straight` | Path tile, lit by `energy` | Plane 1×1, tan |
| `path.tile.corner` | | Plane |
| `path.tile.junction` | | Plane |
| `path.tile.lit` | Glow overlay, emissive | Plane, yellow |

**Protocol buildings `building.*`**: `building.protocol.<id>` is optional per protocol (added as you make them); the generic per-category fallback below is required.

| Name | What | Standin |
|---|---|---|
| `building.lending.t0`–`t6` | Bank / counting house | Box 2×2×2, colour by tier |
| `building.dex.t0`–`t6` | Market stall → trading hall | Box |
| `building.staking.t0`–`t6` | Granary / farm | Box |
| `building.nft.t0`–`t6` | Gallery | Box |
| `building.governance.t0`–`t6` | Council hall | Box |
| `building.bridge.t0`–`t6` | Harbour | Box |
| `building.other.t0`–`t6` | Generic shop | Box |
| `building.dormant` | Cobweb overlay, shown when inactive | Plane, grey |
| `building.sign.<category>` | Sign and brand plate (tinted by brand colour) | Plane |

Seven categories × seven tiers = 49 buildings. **Suggestion:** start with the tier-0 and tier-3 versions and let tiers reuse the same model at a larger scale until they are made. That's 14 buildings instead of 49.

**People `person.*`, `courier.*`**

| Name | What | Standin |
|---|---|---|
| `courier.base` | The transaction figure. Clips: `walk`, `idle`, `hand-over`. | Capsule, white |
| `courier.cargo.t0`–`t6` | Load carried (pouch → chest), by value tier | Small cube, coloured |
| `courier.look.<class>` | Look per hero class (optional, later) | Capsule |
| `person.npc.base` | Townsperson at a building door. Clips: `idle`, `emerge`, `receive`, `return`. | Capsule, brown |
| `person.npc.<category>` | Category-specific NPC (banker, merchant, farmer, etc.) | Capsule |
| `person.guard` | Guards at the drawbridge (optional) | Capsule, grey |

**Effects `fx.*`**

| Name | What | Standin |
|---|---|---|
| `fx.bell.ring` | Ring wave around the tower | Ring sprite |
| `fx.path.glow` | Path glow (shared with `path.tile.lit`) | Overlay |
| `fx.splash` | Moat splash when the courier crosses (optional) | Circle |
| `fx.dust` | Dust puff on building arrival | Circle |
| `fx.coins` | Coin burst on exchange | Small cubes |
| `fx.cobweb` | Cobweb overlay | Plane |

**UI and badges `ui.*`, `badge.*`, `rank.*`**

| Name | What | Standin |
|---|---|---|
| `ui.icon.<name>` | Icons for tabs, buttons, sheet headers (castle, town, badges, settings, bell, etc.) | 64×64 square |
| `badge.<id>` | One per medal (22 today, plus new castle badges) | 128×128 disc |
| `rank.<id>` | Six ranks (Wanderer → Legend) | 128×128 shield |
| `ui.frame.<tier>` | Tier frames for the bottom sheet (0–6) | Border |

**Terrain and scenery `scenery.*`** (suggestion, optional for prototype)

| Name | What |
|---|---|
| `scenery.tree.<kind>` | Trees around the island |
| `scenery.rock.<n>` | Rocks |
| `scenery.hill` | Hill backdrop |

### 4.3 Counts

| Group | Names (base) | With tiers |
|---|---|---|
| Castle | 13 | ~20 with tiers |
| Moat and bridge | 5 | ~12 |
| Town and paths | 9 | 9 |
| Buildings | 7 categories | 49 (14 if tiers reuse models) |
| People | 6 | 12 |
| Effects | 6 | 6 |
| UI, badges, ranks | 3 groups | ~40 |
| Scenery | 3 | optional |

**Total for the prototype:** about 60 named assets with standins. **Total for a finished theme:** about 150 files. Mostly repetition of the same building kit.

---

## 5. Theme contract (modular, plug-in)

**Suggestion:** a theme is a folder with a manifest that maps standard asset names to files:

```
public/themes/medieval/
  theme.json          # id, name, version, author, license, sky, lighting, palette
  assets/             # glb, webp, svg files
```

`theme.json` (sketch, not code):

```jsonc
{
  "id": "medieval",
  "name": "Medieval",
  "version": "1.0.0",
  "format": "wallet-landia-theme/1",
  "assets": {
    "castle.keep.t0": "assets/castle/keep-t0.glb",
    "moat.water": "assets/moat/water.webp",
    "courier.base": "assets/people/courier.glb"
  },
  "palette": { "guildCrest": "#...", "moat": "#...", "path": "#..." },
  "lighting": { "sky": "day", "hour": 14 }
}
```

- **Missing asset → fall back to the standin.** A theme can be partial. The standins are the built-in theme, so the game always renders.
- **Each theme declares its own version.** Bump the version when a file changes (the existing rule in `CLAUDE.md`).
- **The contract is one file in the repo** (`src/theme/contract.ts` or similar): the list of required and optional asset names, with types (`glb`, `webp`, `svg`), which clips each model must have, and expected sizes. A checker test fails when a theme misses a required asset.
- **What exists now:** `src/assets/` (pack registry, slots, theme bundles, format 2, validation, versions in `asset-versions.json`) already does most of this, with a different naming scheme (slot keys like `building.bank`). **Suggestion:** reuse the registry, loader, validation and versioning code; replace the slot list with the names above. The old packs can be kept as an example of the format or retired.

---

## 6. Code architecture (new layers)

Reuse the existing layers and put the new view on top:

```
UI (mobile shell): top bar, bottom tabs, bottom sheet          NEW
Castle view + Town view (scene graph)                          NEW (one renderer)
Scene model: castle state, town state, couriers, bell, paths   NEW (pure TS, testable)
Theme loader + contract + standins                             ADAPT (src/assets)
Game modes (hooks)                                             NEW (§8)
World / journeys (courier per tx, route, timing)               ADAPT (src/world/sim, chain)
Domain (tiers, feats, player, realms, mappers)                 KEEP
Data (Zerion, ledger, backfill, RPC, cache)                    KEEP
```

- **Scene model first, renderer second.** The scene state (what exists, what's lit, who's walking where) is pure data and unit-testable. Renderers only draw it. This also gives a path to a 2D fallback.
- **One renderer.** Question 1 below: 3D orthographic or 2D sprites. **Suggestion:** isometric 3D with `three.js` (orthographic camera), since Blender models are the goal and the three.js rules in `.claude/skills/three-best-practices` already apply. A 2D sprite version is a second renderer on the same scene model, if phones struggle.

---

## 7. Repo strategy: keep, or start fresh?

**Suggestion: stay in this repo, on this branch, and remove what the new design doesn't use.**

Reasons:
- The data layer, domain layer, tests and fixtures (about half the code by line count) are the hard parts and they're already working and tested.
- The asset registry, versioning and service worker are reusable as-is.
- A new repo means re-porting all of that, plus CI, deploy and docs, with no gain.

**Removal candidates (to verify before deleting):**
- Canvas 2D renderer and its sprite art (`src/render/renderer.ts`, `pixel.ts`, `buildings.ts`, `characters.ts`, `ground.ts`, `overlay.ts`, `view.ts`, `room2d.ts`, `roomScene.ts`, `roomShell.ts`, `roomHelpers.ts`, `roomLayout.ts`, `roomTalk.ts`, `icons.ts`) if the new view replaces them.
- The old 3D town view and its grammar builders (`src/render/three/` beyond the parts reused for the scene), the sandbox (`src/sandbox/`, `sandbox.html`), the look sandbox e2e and the 3D look tests.
- Heroes, mounts and their gear (`src/render/three/gear.ts`, `rigged.ts`, `characters.ts`), walkers and flights (`src/world/townsfolk.ts`, `agents.ts`, `route.ts`, `farmPlan.ts`, `heroNow.ts`, `townLayout.ts`, `layout.ts`, `townShare.ts`).
- The realm map UI (`src/ui/realmMap.ts`), the tour (`src/ui/tour*.ts`), the guild panel and looks panel, replaced by the bottom sheet and the Castle tab.
- The "Hearth & Harvest" and medieval-specific grammar (`src/render/three/grammar/`), unless reused as the medieval theme's assets.
- Only ~1/3 of the old modules will survive; decide the exact list after the answers below. I'll check each one with the import graph before removing anything.

**Option B: a new repo.** Worth it only if you want a clean start with no history from the old view and docs. Then copy `src/data`, `src/domain`, `src/util`, `test/` and `fixtures/`, plus the build config. My recommendation is still option A, since a new repo is a week of setup for no gain.

---

## 8. Game mode: prepare the hooks now

**Suggestion:** a `GameMode` interface that the scene calls, with no mode active by default:

- `onBlock(block)`: the bell rings (already happens).
- `onTransaction(tx)`: a courier is spawned (already the plan).
- `onRealmChange(realm)`.
- `onTick(dt)`: time-based rules (e.g. raids, quest timers).
- `getHud()`: extra top-bar stats.
- `getSheet(target)`: extra bottom-sheet content.

The **default mode** is the current view (observe the chain). A future game mode (e.g. raids on protocol buildings, defend the castle, quests) plugs in with the same hooks and gets its own state, so the chain view never depends on it. The **player** data (`src/domain/player.ts`) stays shared between modes.

---

## 9. Milestones (suggestion)

1. **Shell and standins.** Mobile layout, top bar, tabs, bottom sheet. The castle, moat, town, tower, paths and couriers as cubes and shapes, driven by the **demo fixtures**. Scene model with unit tests.
2. **Live data into the scene.** Wallets → towers, transactions → couriers across the drawbridge, buildings per protocol category, bell and paths wired to the chain (existing data layer).
3. **Growth rules.** Castle stages by wallet count, value tiers, protocol wings and storehouse. Unit-tested rules.
4. **Badges and ranks** in the new Castle tab; new castle badges.
5. **Theme contract** and loader, with the standins as the built-in theme. Checker test.
6. **Medieval theme.** Swap in your Blender models one by one; the standins fall back until each is done.
7. **Remove old code** (§7) once the new view reaches parity.
8. **Game mode hooks** (§8), no mode yet.

---

## 10. Gaps I filled with suggestions (quick list)

- Wallet = tower on the castle. The brief said "no heroes", so I used towers for wallets and couriers for transactions.
- One courier per transaction, with cargo for the value.
- Incoming transactions walk into the castle.
- Pending transactions leave the drawbridge half-lowered.
- Protocol category → building type and castle wing.
- Dormant buildings get cobwebs.
- Moat water colour reflects gas price.
- Spam goes to a midden outside the walls.
- Asset names: dotted, lowercase, tiered `t0`–`t6`, origin at base centre, 1 unit = 1 m.
- Fallback to the standin when a theme misses an asset.
- Mobile: one screen, bottom sheet, bottom tabs, 60 fps target, first download under 15 MB per theme.
- Tests: scene model and growth rules unit-tested; theme contract checker.

---

## 11. Questions for you (interview)

**Answer these first; the rest can follow.**

1. **Renderer:** isometric 3D (three.js, Blender glb models) or 2D sprites? *(Suggestion: 3D, since you're modelling in Blender.)*
2. **Wallets as towers:** does one tower per wallet work, or should wallets be something else (a house per wallet, a banner on the walls)?
3. **Courier per transaction:** one figure per transaction, or should several transactions share a figure (e.g. a batch per block)? Are you OK with a busy wallet making many couriers?
4. **Incoming transactions:** should the courier walk **into** the castle, or only outgoing ones cross the bridge?
5. **Protocol buildings:** should each protocol (Aave, Uniswap…) be its own building with a brand sign, or should buildings be per category (bank, market…) with the protocol name only on hover?
6. **Castle growth:** which should drive the castle's size most: wallet count, $ value, or protocol count? (My suggestion: count sets the size, value sets the material, protocols add wings.)
7. **Repo:** stay in this repo on `castle-redesign` (recommended), or a new repo?
8. **Old code:** remove the old views once the new one reaches parity (recommended), or keep the 2D view as a fallback for weak phones?
9. **Mobile target:** what is the minimum phone to support (e.g. "iPhone 12 / Android from 2021")? Should the layout also work on desktop, or is a desktop view not needed?
10. **Badges:** keep all 22 medals and the level and rank system, or rework them for the castle? Are the new castle badges I suggested in §3.6 fine?
11. **Existing theme packs:** do you want the old theme bundles (highland, modern, sci-fi) kept in the repo for later, or removed now?
12. **Standins:** should they be coloured cubes and shapes (as you said), or do you want them to look like the final layout (e.g. flat coloured tiles on a grid)?
13. **Blender:** what file format and tools do you use (Blender version, glTF export)? Any tri budget per building or person?
14. **Naming:** OK with the dotted names in §4, or do you want a different scheme?
15. **Game mode:** any idea of its shape yet (raids, quests, defending the castle, PvP between guilds)? This affects which hooks to build first.

---

## 12. Next step

Once you answer §11 (at least 1–7 and 12), I will:
1. Confirm the list of removal candidates against the import graph (§7).
2. Write the standins and the mobile shell (milestone 1), still on this branch.
3. Run `npm run check` after each change, as in `CLAUDE.md`.

Nothing is committed yet. The branch `castle-redesign` was created from `main`, and it currently carries the uncommitted changes that were already in the working tree (see `git status` at the start of the session). Tell me if you want those committed or stashed before the redesign starts.

---

## 13. Progress (2026-10-14)

- **Shell** (`castle.html`, `src/castle/shell*.ts`): phone layout (bottom tabs, bottom sheet) and desktop layout (side rail, docked sheet).
- **Asset contract** (`src/castle/assets/manifest.ts`, spec `docs/ASSET_SPEC.md`): every asset name with size, clips, attach points and standin. Missing files fall back to the nearest tier, then to the standin.
- **Asset gallery** (`assets.html`): every asset, its spec, and whether its file exists yet.
- **Medieval assets** from the Blender design agent in `public/themes/medieval-castle/` (76 models, 49 SVG, 5 PNG, 1.8 MB, flat colours, no textures yet).
- **Castle scene** (`src/castle/scene/`): the layout (`plan.ts`), the courier's errand (`courier.ts`) and the view (`castleView.ts`). Castle on its island, moat, drawbridge, border post beside the road with a barrier, road to the bell tower, protocol buildings with doors and side paths, woods and hills. The courier lowers the bridge, pays at the barrier, walks to a door, and the building's person comes out and takes the goods. The bell rings and the paths glow. The tower fades while it hides someone. Drag to pan, pinch or wheel to zoom, tap a building for its sheet.
- **Theme manifest** `public/themes/medieval-castle/theme.json` (version 0.2.0, recorded in `asset-versions.json`); every model and art URL carries `?v=<version>`; `theme.json` itself is fetched fresh (`_headers`, `vercel.json`).
- **Real data** (`src/castle/world/world.ts`): the same session as the town (demo, captured, or live with the player's key) → `buildGuild` → the castle's world: a tower per wallet, the keep at the guild's value tier, a building per protocol held or used (most valuable first, up to 10; signature buildings by protocol family, else the category building at the tier held), an errand per transaction (out when a wallet signed, in otherwise; none for failed ones or sends between the guild's own wallets). New transactions jump the queue; the bell rings for each block (and keeps 12 s time by itself while offline).
- **Signature buildings and props** (batch 4): Aave, Compound, Maker, Uniswap, Curve, Lido, Rocket Pool, EigenLayer, OpenSea, ENS; lamps, well, barrels, crates, cart, fences, benches, flowers, market stall.

- **Signature buildings, second wave** (batch 5): Morpho, Spark, Fluid, Gondi, Pendle (swinging pendulum), Yearn, Balancer, SushiSwap, 1inch, CoW, Blur, Across. Theme 0.3.1.
- **Guild tab** (`src/castle/guildTab.ts`): the Zerion key (saved only in this browser, refused with a reason when malformed), your wallets (address, ENS name, or the connected wallet), where the data comes from, requests left today. Shared with the town (same storage).
- **Badges tab** (`src/castle/badgesTab.ts`): level, rank (with the rank shield), XP to the next level, all 22 medals with the theme's art (bronze/silver/gold rings; locked ones greyed with how to earn them); a badge's sheet says what it teaches and when and with which wallet it was earned. The top bar shows level and rank. Worked out off the main thread by the town's PlayerController.
- **Colours at runtime**: `Tint` in the protocol's brand colour (`BRAND_COLORS` by protocol family), `Trim` in the tier colour (a building's own tier; the castle's pieces the guild's). Buildings' own `idle` clips play (Curve's wheel, Pendle's pendulum).

Open:
- The session's status line still says "⚙ Guild" (its wording comes from the shared session).
- Failed transactions (turned back at the barrier) and sends between the guild's own wallets are not shown yet.
- The props are not placed yet; the five proposed castle badges have art but no rules yet (the badge rework).
- Visiting followed wallets' castles, and the realm (L2) switch, are not in the castle view yet.

Next: removing the old views (after deciding what the castle view still lacks from them), the badge rework, placing props.

---

## 13b. Progress (2026-10-14, later)

- **Assets complete:** all 214 names in the manifest have files (165 models, 49 SVG, 7 PNG), textured (hand-painted colour maps, WebP), 5.1 MB. Theme 0.8.0. Batches since: life and states (animals, tower flags, lilies, reeds, refusal and sparkle effects, app icons), the texture pass (7a–7c), in-between tiers (buildings, towers, cargo t1/t2/t4/t5), a third wave of signature buildings (Ethena, Convex, Frax, Euler, Stargate, Zora, Safe, ParaSwap, Kyber, LI.FI; 32 in all), rain, and the harbour (quay, ship, crane, buoy; not placed yet: for the realm switch).
- **Couriers:** failed transactions are turned back at the barrier under a red seal; sends between the guild's own wallets go along the wall-walk from tower to tower. Tap a courier for its transaction (what, where, value, toll, explorer link).
- **Buildings:** a building's sheet lists what the guild keeps there. Every wallet's tower is at that wallet's tier. Brand colours on Tint, tier colours on Trim; decorations' Tint coloured too.
- **Town life:** lanterns, a well and benches, stalls, a cart, crates and barrels, a fence along the moat, animals, ducks and lilies on the moat; buildings' and animals' own clips play.
- **Chronicle:** the recent transactions, newest first, from a button over the scene.
- **Badges:** the five castle badges have rules (towers, keep, wings, crossings) and show with progress.
- **Guild tab:** also the history file (save, load in another browser) and the Ethereum node.
- **Sound:** off until switched on (kept, shared with the town): the bell for each block, coins at the toll.
- **Sky:** day and night by the local hour (`?hour=` pins it); rain and a grey veil when ETH fell since the last visit.
- **Installable:** `castle.webmanifest` with the theme's app icons.

## 14. The old app vs the castle: what to port, what to drop (for decision)

The castle page (`castle.html`) now covers the core: wallets, value, protocols, every transaction as a courier, the block bell, the player's level and badges, the key and wallet list. The old app (`index.html`) still does more. Proposal per feature; **nothing is deleted until you decide**.

| Old app feature (where) | Castle has it? | Proposal |
|---|---|---|
| Live data, key, wallets, ENS, connect wallet (`ui/guildPanel.ts`, `data/*`) | Yes (Guild tab, same data layer) | Keep the data layer; drop the old panel with the old app |
| Player level, badges, titles (`domain/player.ts`, `ui/playerController.ts`) | Level, rank, badges: yes. Titles: no (titles were per hero; there are no heroes) | Keep; drop titles |
| Quest Replay: one transaction's storyboard, explorer link (`ui/panels.ts` questPanel) | No | **Port** as a sheet: tap a courier → what it carries, where, the toll, the explorer link |
| Quest log / Chronicle Scroll: the recent transactions list, replay speed and scrubbing (`ui/app.ts`, `world/sim.ts`) | No (couriers replay the last 12 on their own) | **Port** a simple log as a sheet or a Town-tab drawer; drop the scrubbing timeline |
| Building interior: positions held, rewards, debt, health (`ui/panels.ts` buildingPanel) | A sheet with category and tier only | **Port** the holdings list into the building sheet |
| Rooms: 2D/3D house interiors with tokens, coin heaps, NFT pictures (`ui/room*.ts`, `render/three/room3d*.ts`) | No | Decide: a "treasury" inside the keep could reuse it later; drop for now |
| Hero character sheets, classes, mounts, gear (`ui/panels.ts`, `render/three/rigged.ts`, `gear.ts`, `wardrobe.ts`) | No heroes by design | **Drop** |
| Visiting followed wallets' towns, sharing a town link (`session.visit`, `world/townShare.ts`) | No | **Port** visiting (another guild's castle, read-only); drop town designs and sharing with build mode |
| Build mode: placing buildings, land, designs (`ui/buildMode.ts`, `world/townLayout.ts`, `landStakes.ts`) | No (the castle lays itself out) | **Drop** (the future game mode may bring building back) |
| Realm Map and L2 province towns (`ui/realmMap.ts`, `domain/realms.ts`) | No (Ethereum only) | **Port later** as a harbour or a realm switch; keep `domain/realms.ts` |
| Sound: bell, coins, ambience (`audio/soundscape.ts`) | No | **Port** (the bell per block, coins at the toll); small |
| Day/night, weather from price, clouds, smoke, fog of war (`render/three/dayNight.ts`, `clouds.ts`, `smoke.ts`, `fogBank.ts`) | No | Port day/night and weather later (look and feel); drop fog of war |
| First-visit tour (`ui/tour*.ts`) | No | Port a short castle tour later |
| Looks panel, asset packs, theme bundles (`ui/looksPanel.ts`, `assets/*`, `public/packs`, `public/themes/{highland,modern,scifi}`) | Theme contract instead | **Drop** (you asked to remove the old theme packs); keep `public/themes/medieval-castle` |
| 2D views: top-down and iso pixel art (`render/renderer.ts`, `pixel.ts`, `buildings.ts`, `characters.ts`, `ground.ts`, `overlay.ts`) | No | **Drop** |
| 3D town and its grammar, sandbox page (`render/three/*`, `src/sandbox`, `sandbox.html`, the vehicle sandboxes) | No (the castle has its own view) | **Drop**, after checking nothing in `src/castle` imports it |
| Lifetime history save/load file, the walk back (`data/ledger*.ts`, `data/backfill.ts`) | Walk back: yes (the session runs it). Save/load file: no | Keep; **port** save/load into the Guild tab |
| RPC node setting, L2 chain choice (Guild panel) | No | Port the node setting into the Guild tab; chains with the realm switch |

**Suggested order:** port Quest Replay and the building holdings (sheets), the transaction log, visiting, sound and the history file; then make `castle.html` the main page and delete the rest in one change (old views, their tests and assets, the old themes and packs).

### 14b. Decided (2026-10-14)

**Keep and port to the castle:** visiting followed wallets' castles, following wallets, sharing a castle link; teaching quests, the first-visit tour, the full Quest Replay, the replay timeline; crest customisation, build mode, titles (as a player title); Vercel Web Analytics on the castle page.

**Drop:** other chains for now (Ethereum only: no realm switch or realm map; the harbour assets wait), fog of war, the house interiors (rooms), heroes and their sheets, mounts and gear, the 2D views, the old 3D town and its grammar, the look and vehicle sandboxes, the old theme packs and the Looks panel.

**Order:** delete first (the state before is commit `bc06046`), then port the kept features onto the castle code; the old implementations are read from git when porting.

### 14c. Cleanup done (2026-10-14)

The castle is the app: `index.html` opens it (with the service worker and Vercel Web Analytics), `assets.html` is the asset gallery. Deleted: the old views (2D, the 3D town and its grammar, rooms, the sandboxes), heroes, the old simulation and town layout, the Looks panel, packs and the old themes (`highland`, `medieval`, `modern`, `scifi`), the HDRI skies, the asset import scripts and their packages, and their tests and docs (`PACKS.md`, `VISUAL_CONTRACT.md`, `RESEARCH_REALISM.md`; `PLAN.md` and `WORLD_BIBLE.md` are marked historical). The sounds, the player's level and the DOM helper moved to the castle's side. The history file no longer carries town designs. The castle loads Ethereum only. The service worker is `wl-4`, so devices drop the old themes' stored files. `assets-src/` (785 MB of git-ignored source downloads) is left for the developer to remove.

**Next (the kept features, §14b):** visiting followed wallets' castles, following, sharing a link; teaching quests, the first-visit tour, the full Quest Replay, the replay timeline; crest customisation, build mode, a player title. The old implementations are in commit `bc06046`.
