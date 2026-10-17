# Siege of the Ledger: mapping note (M0)

The repo audit the spec asks for (`docs/game/SPEC.md`, "Integration"): what exists, which game role it plays, and how unit assets are made.

## Decisions where the spec didn't fit the build (2026-10-17)

| Spec says | The build has | Decision |
|---|---|---|
| React Three Fiber, Zustand | Plain three.js and TypeScript, DOM HUD (`src/castle/shell.ts`) | **Plain three.js.** The game core is pure TS; the render layer and HUD follow `CastleView` and the shell; a small store of our own. |
| A city between two castles, 3 lanes | One castle and one avenue of 16 wallet-driven plots (`src/castle/scene/plan.ts`) | **The town is the battlefield.** A mirrored enemy castle stands past the avenue's end; the lanes are the avenue and one road each side behind the plots. |
| One InstancedMesh per unit type, 600 units at 60 fps | Every person is a skinned clone with its own mixer (`src/castle/scene/figure.ts`) | **Baked animation, instanced.** Units are ordinary skinned glTFs with clips; the game samples each clip's bone matrices into a texture at load and skins instances on the GPU. No new export step for the Blender agents. |
| Import one wallet | The castle is the whole guild (every wallet merged) | **Pick one wallet** of the guild in setup. |
| Position kinds spot/staked/restaked/lp/supplied/borrowed | Zerion's `deposit/loan/staked/reward/locked/investment/other` (`src/domain/model.ts:33`) | deposit at a dex → `lp` (pair from its tokens, else spot); deposit at lending → `supplied`; loan → `borrowed`; staked → `staked`; any position at a restaking protocol → `restaked`; the rest → `spot`. |
| Token categories large-cap / DeFi gov / infra / meme / RWA / AI / misc | Symbol heuristics native/stable/wrapped/governance/meme/lst/receipt/debt/token (`src/domain/catalog.ts:9`) | A static token→category map in `src/game/data/`; gaps filled from ours (meme → memecoins, governance → DeFi governance, the rest → misc). |

## Existing component → game role

| Existing | Where | Game role |
|---|---|---|
| Keep, walls, gatehouse, wallet halls | `castle.*` models, `planCastle` | The player's keep. Damage states are new parts (batch 20). |
| — | — | Enemy keep: the same models, mirrored past the avenue's end, in the opponent's crest colour. |
| Protocol buildings (signature and category) | `building.protocol.<id>`, `building.category.<cat>.<size>` | Battlefield buildings. Bank = lending, Exchange = dex, Temple = staking, Vault = Maker/Sky or a lending building with vault dressing, Oracle Tower = **new** (none exists). Capture ring and owner banner are new (batch 20). |
| Courier timeline, routes, coin/NFT flights | `src/castle/scene/courier.ts`, `plan.ts` `routeTo`, `exchange.ts` | Trade phase only: one courier per action, castle → building → castle. The cap of 3 (`MAX_COURIERS`) rises in game mode. |
| Townsfolk at the doors | `person.npc.*` | Building keepers; the lending one waves the red flag at HF < 1.2. |
| Wanderers, animals | `src/castle/scene/life.ts` | Cleared off the streets during battle. |
| Camera rig (orbit, pan, zoom, follow) | `src/castle/scene/cameraRig.ts`, `CastleView.focusAt` | Overview for Market and Trade; lane-follow during Battle via the existing follow. |
| Data layer (session, Zerion, cache) | `src/data/*`, `src/domain/*` | Wrapped by `game/data/WalletImporter`, unchanged. Mainnet only (already forced, `main.ts:78`). |
| Seeded PRNG (mulberry32, FNV-1a) | `src/util/rng.ts` | One stream per subsystem, derived from the match seed. |
| Worker pattern | `src/castle/player.ts:150`, `player.worker.ts` | The match core runs in a worker the same way, with an inline fallback. |
| Topbar actions | `shell.addTopbarAction` (`main.ts`) | The "⚔ Siege" toggle. |
| Logos (`npm run logos`) | `src/castle/world/logos.ts` | Squad banners show the token's logo. |
| REDESIGN §8's future `GameMode` hook | not built | The siege mode is the first one: the chain view never depends on it. |

## Asset style guide (how the current assets are made)

New assets follow it; the full rules are `docs/STYLEGUIDE_V2.md` and `docs/ASSET_SPEC.md`.

- **Modelling:** glTF 2.0 binary from Blender, made by design agents in briefed batches (`docs/batches/`), checked with the shared checkers (coplanar faces, cloth clearance, lowest point per clip). No procedural geometry in code except stand-ins (`src/castle/assets/standin.ts`). No third-party packs in v2.
- **Look:** "stylised realism", a phone city builder: bevelled chunky forms, coloured AO and a top-down gradient baked into `COLOR_0`, edge highlights, no baked sun. Cosy, not grim: no gore.
- **Palette:** STYLEGUIDE_V2 §5 (warm stone `#c9bba0`, timber `#7a5233`, roof red `#b84a32`, grass `#7fae4a`, gold `#d9a93a`). 70/20/10 mid-tones / own group / accents.
- **Materials:** PBR, roughness 0.6–0.9, single-sided. Named `Stone, Timber, Plaster, Roof, Metal, Cloth, Trim, Tint, Glow…`; `Tint` (team or brand colour) and `Trim` are multiplied in at runtime over a light greyscale texture. WebP textures ≤ 1024 px.
- **Budgets:** buildings 1.5k–20k tris by class; people 2k–3.5k tris, one 512 px texture; props ≤ 1k.
- **Scale:** metres, Y-up, front +Z, origin at the footprint centre on the ground. A person is 1.75 m, 3–3.5 heads.
- **Rig:** all people share the courier's skeleton (`courier/base.glb`, 15 joints); clips at 30 fps, bones or object transforms, no shape keys.
- **Files:** `public/themes/medieval-castle-v2/models/<group>/<name>.glb`, names from `src/castle/assets/manifest.ts`; version bump in `theme.json` plus `npm run assets:versions -- write` on every change.
- **Export:** meshopt compression at build time (`scripts/compress-models.ts`).

## Unit reuse map

No soldiers exist, so every unit is at least a variant. Humanoids are variants of the townsfolk (same skeleton and finish, new outfit, weapon and combat clips); creatures start from the animals.

| Unit | Source | Base asset | Changes |
|---|---|---|---|
| Militia (misc) | variant | `person.npc.base` | Leather cap, pitchfork, padded jerkin; combat clips |
| Knight (large-cap) | variant | Militia | Plate armour, sword and kite shield |
| Ether Paladin (ETH) | variant | Knight | Silver-blue armour, ETH diamond on the shield, halo-like glow trim |
| Staked Paladin (LSTs) | variant | Ether Paladin | Teal cloak, shield rim in `Glow` (the shield ability) |
| Vault Warden (MKR/SKY) | variant | Knight | Bulky, tower shield, Sky/Maker colours |
| Oracle Archer (LINK) | variant | `person.npc.base` | Hood, longbow, quiver; blue Chainlink trim |
| Scout Archer (infra) | variant | Oracle Archer | Lighter kit, short bow |
| Swap Mage (UNI) | variant | `person.npc.governance` | Pink robe, unicorn-horn staff |
| Battle Mage (DeFi gov) | variant | Swap Mage | Plain robe, orb staff |
| Ghost Lender (AAVE) | variant | `person.npc.lending` | Pale violet hooded robe, hovering hem, lantern (opaque, no alpha) |
| Construct (AI/gaming) | variant | person skeleton | Clockwork body, brass and timber |
| Goblin Swarm (memecoins) | variant | person skeleton at 0.6× | Big ears, scrap armour, club |
| Lido Lancer (LDO) | new composite | `animal.horse` + Knight | Rider and horse in one skin, lance, Lido teal caparison |
| Name Rider (ENS) | variant | Lido Lancer | ENS blue caparison, banner instead of lance |
| Shiba Pack (SHIB) | variant | `animal.dog` | Shiba colours, little helmet |
| Frog Swarm (PEPE) | new | — | Small frog warrior, own small rig |
| Bitcoin Titan (BTC) | new | — | 3.5 m iron-and-stone giant, BTC orange |
| Stone Golem (RWA/gold) | variant | Bitcoin Titan | Rough stone, gold veins |

**Token identity:** the curated unit itself, plus the squad banner with the token's logo (from the logo set). `Tint` on a unit is the **team colour**, so both armies read at a glance.

**Placeholders for M3:** Militia for every humanoid and the dog for packs, until each unit lands.

## Asset batches

| # | Batch | Agent |
|---|---|---|
| 19 | Unit pilot: Militia, Ether Paladin, Oracle Archer (sets the combat clips and the instancing budget) | blender-a4 |
| 20 | Siege dressing: keep and wall damage states, capture ring, owner banner | blender-de |
| 21+ | The remaining units, the Oracle Tower, VFX (hit sparks, detonation, siege impact), event weather | after the pilot is approved |
