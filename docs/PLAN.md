# Wallet-landia: Project Plan

Solo dev, runs in the browser, as few dependencies as possible. It's a viewer first, then a game, then an interface for interacting with the chain. Ethereum L1 first, with other chains pluggable. See `WORLD_BIBLE.md` for the metaphors.

---

## Guiding principles

1. **The world layer is separate from the data layer and from the renderer.** Domain data → world state → renderer. The 2D and 3D prototypes consume the *same* world state.
2. **One "Journey" pipeline for every transaction**: historical, live pending, and (later) user-initiated. Phase 7 then reuses the same visuals instead of a parallel system.
3. **Every concept needs a fallback visual** (mysterious tent, mysterious errand, odds-and-ends pouch). Unknown data must never crash or disappear.
4. **Chain is a parameter, never an assumption.** Every address, asset and transaction is keyed by `chainId`.
5. **Fixtures first.** Record real API responses for a handful of interesting wallets so all rendering work is offline, fast and repeatable.
6. **Deterministic generation.** Names, crests, layout and building variations come from seeded RNG on addresses, so the same wallet always gives the same world.
7. **Visuals are slots, filled by asset packs.** The world layer emits slot keys (`mount.t3`, `building.bank`) and never concrete art. Packs are data only, and the player's loadout picks a pack per slot (see World Bible §8).
8. **Static site, all logic in the browser.** The server only serves HTML/JS/assets. Each player brings their own free Zerion key. A public RPC provides the live heartbeat. Cache aggressively.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  UI panels (plain DOM/CSS): character sheet, inventory, quest log,  │
│  building interior, timeline, tooltips: renderer-independent        │
├───────────────────────────────┬────────────────────────────────────┤
│  Renderer A: Canvas 2D        │  Renderer B: Three.js (3D)          │
│  (zero deps)                  │  (single dependency)                │
├───────────────────────────────┴────────────────────────────────────┤
│  ASSET LAYER: pack registry · loadout (slot → pack) · fallback to  │
│  default pack · runtime tinting (crest, brand colour, rarity frame)│
├────────────────────────────────────────────────────────────────────┤
│  WORLD LAYER (pure TS, no DOM): tiers, hero look/class, building    │
│  archetypes, district layout, Journey scripts, replay clock, ambient│
├────────────────────────────────────────────────────────────────────┤
│  DOMAIN LAYER (pure TS): Guild, Wallet, Asset, Holding, Position,   │
│  Approval, Protocol, Tx → normalised Verb steps                     │
├────────────────────────────────────────────────────────────────────┤
│  ADAPTERS: PortfolioProvider (indexer, e.g. Zerion) ·               │
│  ChainHeartbeat (JSON-RPC newHeads) · Fixtures · Cache (IndexedDB)  │
├────────────────────────────────────────────────────────────────────┤
│  (Phase 7) ACTION LAYER: intents → tx build → simulate → sign       │
│  via EIP-1193 (window.ethereum), no wallet library needed           │
└────────────────────────────────────────────────────────────────────┘
   everything above runs in the browser; static host serves the files
   browser ──(user's key)──▶ api.zerion.io      browser ──▶ public RPC
```

### Core domain types (sketch)
```ts
type ChainId = 'ethereum' | string;              // pluggable
type Address = `0x${string}`;
interface WalletRef { chainId: ChainId; address: Address; kind: 'eoa'|'safe'|'aa4337'|'eip7702'; relation: 'owned'|'followed'; label?: string; ens?: string }
interface Asset { id: string; chainId: ChainId; symbol: string; name: string; logoUrl?: string; category: AssetCategory; priceUsd?: number; isSpam: boolean }
type AssetCategory = 'native'|'stable'|'wrapped'|'governance'|'meme'|'lst'|'receipt'|'debt'|'nft-art'|'nft-collectible'|'nft-position'|'nft-name'|'nft-lock'|'unknown';
interface Holding { wallet: WalletRef; asset: Asset; amount: number; usd?: number }
interface Position { wallet: WalletRef; protocol: ProtocolRef; kind: 'supply'|'borrow'|'stake'|'lp'|'vault'|'lock'|'reward'|'vesting'; assets: Holding[]; usd?: number; healthFactor?: number; unlockAt?: Date }
interface Approval { wallet: WalletRef; asset: Asset; spender: Address; spenderProtocol?: ProtocolRef; allowance: bigint | 'unlimited' }
interface ProtocolRef { id: string; name: string; category: ProtocolCategory; logoUrl?: string; brandColor?: string; tvlTier?: number }
type Verb = 'send'|'receive'|'swap'|'addLiquidity'|'removeLiquidity'|'stake'|'unstake'|'supply'|'withdraw'|'borrow'|'repay'|'liquidated'|'claim'|'approve'|'revoke'|'wrap'|'unwrap'|'mint'|'burn'|'buyNft'|'sellNft'|'bridge'|'vote'|'delegate'|'deploy'|'airdrop'|'spam'|'unknown';
interface TxStep { verb: Verb; protocol?: ProtocolRef; counterparty?: Address; in: Holding[]; out: Holding[] }
interface Tx { chainId: ChainId; hash: string; time: Date; block: number; status: 'pending'|'confirmed'|'failed'; feeUsd?: number; wallet: WalletRef; steps: TxStep[] }  // >1 step = Expedition
```

### Data access (decided after reviewing v3)

**Model: static site with a bring-your-own key.** v3 proved this works: its Phase 0 spike measured that `api.zerion.io` serves CORS headers, so the browser calls the API directly. The player pastes their own free Zerion key once, and it's stored in `localStorage`. No server is needed. Any static host works (GitHub Pages, Cloudflare Pages, Netlify).

- **Why it works:** every player spends *their own* free quota, so usage scales with players at zero cost to us.
- **Trade-off:** the key is visible in the player's own devtools. That's acceptable because it's their key on their machine. It does make **XSS the main threat**, so:
  - Strict Content-Security-Policy: `script-src 'self'`, no inline scripts, `connect-src` limited to Zerion + RPC.
  - Zero third-party scripts at runtime.
  - Asset packs are data only. Pack SVGs are rendered via `<img>` or canvas, never inlined into the DOM, so they can't execute.
  - All API strings (token names, NFT names, dApp names are attacker-controlled!) go through `textContent`, never `innerHTML`.
- **No key → demo mode** from checked-in fixtures (as in v3), so first-time visitors see a living town immediately.
- **Dev-only proxy** (v3's `VITE_ZERION_TRANSPORT=proxy`) is kept as an option for local work. It isn't part of the deployed product.

**The quota is small, so it drives the design.** The free plan is **300 requests/day** (v3's `budget.ts`, and the API's `RateLimit-Org-Day-Remaining` header is authoritative) at about 1 request/second.
- Cold load per wallet, L1 only (`filter[chain_ids]=ethereum`): portfolio + simple positions + complex positions + 1 transaction page (100) + NFT positions ≈ **5 requests**.
- Reload: valuations cached about 2 minutes. Transaction history is cached **forever**, and only the newer tail is fetched (v3's `history.ts` watermark merge), so a reload ≈ **1 request**.
- **Live updates must not poll Zerion blindly.** v3 polls every 20 s, which is about 180 requests/hour per wallet and burns the day's budget in under 2 hours. v4 gates polling on the free public RPC instead:
  1. Each new block (RPC `newHeads`): check `eth_getTransactionCount` (nonce) + `eth_getBalance` for each owned wallet. This is free and keyless.
  2. If either changed, call Zerion for the transaction tail (1 request).
  3. Do a slow Zerion catch-up (e.g. every 10–15 min while the tab is visible) for incoming token transfers that don't change the nonce or ETH balance.
- The budget is always on screen, in-world as **"the Scribe's ink pot"**, with a precise number in the debug view.

**Zerion capabilities and the gaps we fill ourselves:**
- Provided: decoded `operation_type` (send, receive, trade, approve, revoke, deposit, withdraw, mint, burn, claim, bid, delegate, revoke_delegation, execute, deploy), `transfers[]` with USD values, dApp id + icon, spam flag (`flags.is_trash`), `acts[]` sub-actions, and positions with `protocol_module` / `position_type` (`loan` = debt).
- **Verb refinement layer (new in v4):** borrow/repay/liquidation (from `loan` positions + debt-token transfers), stake vs. supply (from `protocol_module`), wrap/unwrap (WETH contract), airdrop vs. receive, Expeditions (several `acts[]`), and Safe/4337 detection.
- Not provided: health factor (later via the protocol's RPC view call, e.g. Aave `getUserAccountData`), approvals list (later via RPC/logs), and balance-at-block (we never invent historical states; same rule as v3).

**Live heartbeat:** public Ethereum RPC (WebSocket `eth_subscribe newHeads`, with an HTTP polling fallback). The RPC URL is configurable, since public endpoints come and go.

**Logos:** Zerion's icon URLs, loaded as `<img>` (allowed by the CSP `img-src`), cached by the browser. Note trademark use if this ever goes public.

### Reuse from wallet-landia-v3

**Only the Zerion module was taken over** (decision 7). Everything else (cache, data source, world, rendering, UI) is new, and **all art is drawn fresh in code** (no `iso-building-generator`).

| v3 module | In v4 |
|---|---|
| `data/zerion/client.ts`, `pacer.ts`, `budget.ts`, `transport.ts`, `types.ts` + their tests | Copied as-is (with a provenance line). `types.ts` gained `acts[]` and NFT positions. |
| `data/zerion/endpoints.ts` | Rewritten: raw fetchers only, `filter[chain_ids]` (L1 default), NFT positions, `RawWallet` (= fixture format) |
| `scripts/capture-fixtures.ts` | Rewritten for several addresses at once, same key handling (env / `.env.local`, never written to disk) |
| `fixtures/synthetic*.json` | Converted to `fixtures/demo/` as the fallback demo when no real captures exist |

### Tooling (minimal)
- TypeScript + Vite (dev-only), Vitest for the world/domain logic.
- No UI framework at first: plain DOM with small helpers. Reconsider (Preact, 3 kB) only if the panels get painful.
- Runtime deps: none for 2D; `three` for the 3D prototype.

---

## Phases

Each phase ends with something runnable. Durations are rough for a solo dev working part-time.

### Phase 0: Foundations & data spike (~1–2 weeks)
- [ ] Finalise the world bible (open questions below).
- [ ] Project scaffold (Vite + TS + Vitest + ESLint), `.gitignore` including `.env*`, CSP meta tag.
- [ ] **Port the v3 data layer** (table above) with its tests, and get them green in v4.
- [ ] Extend endpoints: chain filter, NFT positions. Extend the capture script to record ~5 reference wallets (last 100 transactions each):
  a simple holder, a DeFi power user (Aave + Lido + Uniswap), an NFT collector, a Safe multisig, and a wallet that was liquidated.
- [ ] Save the raw responses as **fixtures** in the repo.
- [ ] Measure coverage: what share of transactions map cleanly to a Verb, and what ends up as `unknown`?
- [ ] Write the v4 domain types + mappers + **verb refinement**, keeping v3's identity rules.
- [ ] RPC heartbeat module (newHeads + nonce/balance gate), with a configurable endpoint.
- **Exit:** `npm test` turns all fixtures into domain objects, with a coverage report.

### Phase 1: World layer + debug view (~2 weeks)
- [ ] Value-tier function and config (one legend).
- [ ] Hero derivation: mount tier, suggested class plus player override, generated name, crest.
- [ ] Home tier (value), inventory grouping (odds-and-ends pouch, spam midden), keyring.
- [ ] Event intensity (drama scaling) = f(tier, verb).
- [ ] **Slot catalogue + pack manifest schema + loadout resolver**, with a placeholder pack of coloured shapes and labels.
- [ ] Protocol → building archetype and district; seeded layout.
- [ ] Journey script generator: Tx → a list of `{moveTo, act, duration, itemsIn/out}` steps.
- [ ] Replay clock: event time vs. wall-clock time, scrub, speed.
- [ ] **Debug view**: a plain HTML page that lists heroes, buildings and journey scripts, plus a text timeline. Ugly but complete.
- **Exit:** every fixture produces a full, sensible world state, checked with unit tests.

### Phase 2: Twin prototypes: 2D vs 3D (~2 weeks each, timeboxed)
Same scope for both: **the Town view only.**
- [ ] Town layout with districts, and placeholder buildings carrying logo signs and brand colours.
- [ ] Heroes with tiered mounts (simple shapes are fine) idling at home.
- [ ] Live Chronicle bell from the real chain.
- [ ] Replay of 30 days of journeys from fixtures, with caravans sized by tier.
- [ ] Hover tooltips with approximate values.
- **Exit:** a side-by-side comparison, then **decide 2D or 3D** based on feel, performance and how much effort procedural art takes.

### Phase 3: Drill-downs & real data (~3 weeks)
- [ ] Character Sheet / Treasure Room (DOM panel): stats, inventory grid with rarity frames, keyring, stashes abroad, quest log.
- [ ] Building interior panel (positions, Banker's Scale, rewards, history).
- [ ] Quest Replay view (L4) for one transaction, including Expeditions.
- [ ] Chronicle Scroll timeline with scrubbing (30 days / 100 transactions).
- [ ] Connect a wallet (EIP-1193, read address only) → owned hero. Follow any address or ENS name → added to the signpost.
- [ ] **Visiting mode:** travel to a followed wallet's town (read-only) and back.
- [ ] Class picker on the character sheet.
- [ ] Key entry ("Scribe's ink pot" settings), live data direct from Zerion, RPC-gated live updates, IndexedDB cache, and fixture demo mode when no key is set.
- **Exit:** usable as a real viewer for your own wallets.

### Phase 4: Aliveness & art pass (~3 weeks)
- [ ] **Default "Hearth & Harvest" pack** (Stardew-like) filling every slot.
- [ ] Procedural building generator per archetype (roof/body/sign modules × brand colour × logo).
- [ ] Hero sprite/model composition: body × class outfit × mount.
- [ ] Drama-scaled effects, including the tiered liquidation sequence (clerk → bailiffs → siege).
- [ ] Loadout screen: pick a pack per slot (with at least a second test pack to prove mixing works).
- [ ] Weather from price, day/night, crowds from global block activity, idle behaviours, dormant cobwebs.
- [ ] Sound: bell, coins, ambience (optional, muted by default).
- [ ] Town Crier "while you were away" summary.

### Phase 5: Gamification
- [x] Fog of war (opt in, 🎨 Looks → Game): protocols' buildings stay in mist until a hero first visits them as the replay plays (or something arrives from them); the fog lifts with a little rise, and the map is fully charted when the replay ends. Seeking reveals everything before the cursor at once. Homes, the tower and the gate are always known; quest markers (! / IOU) show above the mist. 2D: a pixel-art cloud bank per building; 3D: one instanced mesh of camera-facing puffs (`fogBank.ts`, one draw call).
- [x] Titles and medals (achievements), `domain/feats.ts`: 22 medals, each earned by the first journey that qualifies (or by holdings: a balanced treasury, a dragon's hoard), each with a plain-words lesson and a title it unlocks. The replay announces a medal when the journey that earned it plays; medals are remembered in the browser as the history window moves on; the player picks the title a hero wears.
- [x] Quests that teach, fitted to each hero (only when they mean something for the wallet): recover your master keys (approvals seen vs revoked, with a revoke.cash link), visit the Temple, diversify your treasury, keep the bailiffs away, bring in the harvest, leave the cursed junk alone.
- [x] Crest customisation (a heraldic tincture per hero: banners, shields, caravans, the guild flag), persistence local first.
- Home wear and tear from wallet age.
- **Creator economy:** pack authoring guide/tooling, a community pack gallery, and later selling packs (possibly as NFTs).

### Phase 6: Multi-chain realms
- Realm Map (L0), with L2s as vassal provinces with their own Chronicle towers.
- Harbour and portals for bridges. Journeys can cross realms (two linked transactions).

### Phase 7: Interaction (write path)
- Walk to a building and open its counter UI → build an **intent** (swap, stake, supply…).
- **Simulate first** and show the predicted Journey as a ghost preview *before* signing.
- Sign via EIP-1193 → the hero joins the tower queue (mempool) → bell → confirmed.
- Heavy security review: allow-listed contracts only at first, clear warnings, and never custody keys.

---

## Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Decoding gaps (complex DeFi transactions arrive as `execute`) | Verb refinement layer plus the "Mysterious errand" fallback. Track the coverage metric from Phase 0. |
| Too many assets or protocols to hand-draw | Category archetypes plus logos plus brand colour. Nothing is drawn per token. |
| Spam floods the world | Use the spam flag; spam goes to the midden and stays hidden by default. |
| Missing prices for illiquid tokens | Tier "?" (unpriced) with its own neutral frame. Never guess a value. |
| Key in the browser → XSS would leak it | Strict CSP, no third-party scripts, `textContent` only for API strings, packs rendered via `<img>`/canvas |
| 300 requests/day free quota | RPC-gated polling, history cached forever, valuation TTL, fixture mode for development |
| Vendor lock-in to one indexer | `PortfolioProvider` interface; Zerion is just one adapter. |
| Solo-dev scope creep | Every phase ships something runnable. The world bible is the scope gate. |

---

## Next steps (3D primary)

1. ~~**Housekeeping:**~~ done 2026-10-08. First commit; dev tooling upgraded (vite 8, vitest 5), `npm audit` clean; Playwright smoke tests for all three views (`npm run e2e`).
2. ~~**Phase 3, live data in the browser:**~~ done 2026-10-08 (details below).
   - Key entry ("Scribe's ink pot") stored in `localStorage`; demo mode without a key.
   - Load wallets live from Zerion; cache in IndexedDB (history forever, valuations ~2 min).
   - Add or follow any address or ENS name.
   - RPC-gated live updates: poll Zerion only when a wallet's nonce or balance changes.
3. ~~**Phase 3, drill-down:**~~ done 2026-10-08.
   - **Quest Replay (L4):** any transaction row (quest log, character sheet, building interior) opens a storyboard. It shows the toll, each stop with goods given and received at exact values, a one-line explanation of the action for newcomers, the method, block and an explorer link.
   - The route is drawn in town as a marching line with numbered stops (all three views).
   - "▶ Replay this quest" plays it alone while the timeline holds.
   - Visiting followed towns shipped with live data.
4. ~~**3D polish (Phase 4):**~~ first pass done 2026-10-08, guided by the [Three.js awesome graphics agent skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills) (MIT). See `docs/VISUAL_CONTRACT.md`.
   - Image pipeline: HDR → GTAO (high) → bloom → one tone-map (Neutral) → cozy grade; quality tiers low / medium / high.
   - Rooted wind on trees and grass; street lamps with light pools.
   - Night emissive hierarchy; tinted billboards; lightning in a siege.
   - Swinging bell with a terminal lock.
   - Bigger characters with contact shadows, facing relative to the camera.
   - Damped camera focus, plus follow during Quest Replay.
   - Logo occlusion; pinch and twist on touch.
   - Validation URL params and the `e2e/visual.spec.ts` captures.
   - Original wish list for reference:
   - Characters: bigger, ground shadows, a facing fix when orbiting.
   - Day/night: lit windows, lamps.
   - Bell animation; the drama-scaled liquidation scene.
   - Logo occlusion.
   - Camera focus on click; a mobile/touch check.
5. ~~**Asset-pack slots:**~~ done 2026-10-08. Slot catalogue, data-only pack format with strict validation, registry with a per-slot loadout (specific → general → built-in), 🎨 Looks panel, folder import into IndexedDB (blob: URLs, CSP unchanged for remote origins), glTF models in 3D, the **Ember & Frost** sample pack, and the creator guide `docs/PACKS.md`.
6. **Also done:** valuations stay fresh while the page is open. A wallet that moved re-measures its tokens (2 requests) or, after a protocol interaction, everything (4). Portfolio totals refresh hourly for price drift, only while more than 150 requests are left.

7. ~~**Road-true movement (Plan B):**~~ done 2026-10-08.
   - **Root cause found:** path points were tile *corners*, not centres, so people walked along building edges. Paths now use tile centres, and each building has a door point at the centre of its door tile.
   - **Footpaths:** every door gets one, carved to the nearest road.
   - **Road-favouring costs:** grass costs 40× a road step, so walks stay on road, plaza or path (0% off-street on the captured wallets, was 20%).
   - **Keep-right lanes:** walkers keep 0.2 tiles to the right.
   - **Corners rounded by a fixed small cut:** every route is verified by sampling along its whole length, falling back to an unrounded route if needed.
   - **Real flights:** griffins, dragons and ravens climb within 0.45 tiles of a door to 8.5 tiles (above the tower), cruise, and land at the destination door.
   - **Waiting spots:** each arrival claims a free spot on the door tile.
   - **Layout fixes:** three building slots that covered other doors were removed.
   - **Tests:** the layout table, door connectivity, ~2,200 routes sampled point by point, roof clearance for flights, and a long simulation with no walker inside a building.
8. **Realism & themes** (research: `docs/RESEARCH_REALISM.md`). Decisions 2026-10-08: stylised realism; CC0 assets for characters, animations and animals; generated buildings and terrain (kits as alternatives); ≤ 15 MB per theme; WebGL now, WebGPU later.
   - ~~Phase 1, look sandbox~~ done: `sandbox.html`.
     - Theme picker (baseline "Hearth & Harvest"; medieval, sci-fi and modern listed as planned, with their needs).
     - Idle/walk/run on a track; hero tier; sky by hour or pinned; hour slider; quality; views final/no-post/AO/no-grade/wireframe/normals; camera bookmarks; live perf panel.
     - Every control is also a URL parameter.
     - HDRI image-based lighting from four CC0 Poly Haven skies (`public/env`).
     - `BuildingFactory`, `buildPropMeshes` and `buildGrassWhere` extracted for reuse.
   - ~~Phase 3a, rigged characters~~ first pass done (medieval theme in the sandbox).
     - `npm run assets:quaternius` turns the CC0 downloads in `assets-src/quaternius` into `public/themes/medieval` (6.3 MB): WebP textures ≤ 1024 px, a 16-clip animation subset, meshopt compression, simplified meshes (~5–25k triangles a person), repaired texture references.
     - Runtime: base body (head cut out by bone weights) + outfit + hair on one skeleton; idle/walk/run cross-fades with speed-matched playback; turning towards travel; horse mounts per tier with the rider seated.
     - Riding: the rider sits on the measured back (behind the withers), legs straddling (a pose fix on top of the sitting clip); horse clips matched by exact name.
     - Class gear built in code (`gear.ts`) and hung on bones in the bind pose: paladin sword and shield, ranger bow and quiver, bard lute, monk staff, merchant satchel and purse, adventurer sword and pack, sleeper lantern.
     - Open: real griffin/dragon (wings are placeholders); more outfits (free kit: Peasant and Ranger); FBX→GLB for the horse.
   - ~~Phase 4, building grammar v2 + PBR~~ first pass done for the medieval theme (sandbox only).
     - `npm run assets:textures` fetches 12 CC0 ambientCG materials (stone, plaster, timber, planks, roof tiles/slate, thatch, cobbles, grass, dirt, cloth) into `public/themes/medieval/materials` (2.8 MB, WebP colour/normal/roughness).
     - `src/render/three/grammar/`: `MaterialLibrary` (world-scale UVs in metres), `MeshWriter` (quads, boxes, slabs, cylinders, cones → one mesh per material), `medieval.ts` (storeys, plinths, half-timbering on bays, framed windows with sills and shutters, plank doors, gable/hip/crenellated/cone roofs with thickness and overhang, jetties, chimneys, quoins, hanging signs).
     - Recipes for all 18 kinds and homes t0–t6 (bedroll → tent → thatched cottage → townhouse → jettied manor → keep → castle). Brand colours tint roof textures; plaster washes vary by seed. The bell keeps its pivot.
     - Each building is about 7–12 meshes including the sign. Lit windows and the forge fire glow at night.
     - Open: herald cart wheels are spokes only.
   - ~~Phase 5, terrain and surroundings~~ first pass done for the medieval theme (sandbox only).
     - A theme can dress a `Site` (flat town area, taken ground, wear, lamps, footprints): `src/render/three/grammar/surroundings.ts`.
     - `terrain.ts`: heightfield flat under the town, hills and ridges around it, a gentler open meadow to the south; four PBR layers (grass, dirt, rock, forest floor) splatted per vertex by slope, wear and woods; two-scale grass and a macro tint against tiling.
     - `vegetation.ts`: procedural oaks, birches and firs (bark tubes + canvas-painted leaf/needle cards with crown-spherical normals), bushes, wildflowers; instanced, swaying, with cut-out shadows.
     - `props.ts`: well, barrels, crates, hay, woodpiles, post-and-rail fences and dry-stone walls that follow the ground, a signpost, boulders, timber lantern posts with night pools.
     - Added CC0 ambientCG bark, rock and forest-floor textures; the medieval theme is now 11 MB.
     - Trails wander from the town's edges into the woods (worn dirt that trees and flowers avoid); a pond lies in a hollow in the meadow with rippling water (`water.ts`) and bushes on its muddy shore.
     - A river (`grammar/river.ts`) comes down from the north-east hills, flows into the harbour and out again south through the meadow. Its water only runs downhill (level from the lowest ground met, pinned to the harbour's), the terrain is cut into a channel with banks that steepen into a gorge where the hills stand higher, and the grid is finer along its course. Flowing ripples (two-phase flow along the course), shallows lighter at the banks, shrubs and stones on muddy banks, field walls broken where they would cross, and a footbridge (plank, or concrete and steel) wherever a trail crosses.
   - ~~Phase 2, theme bundle format~~ done: pack format 2 adds a `theme` block (docs/PACKS.md, `src/assets/theme.ts`).
     - Materials by role with real-world sizes (UVs in metres), ground, building and surroundings parameters, characters (files, outfits per class, clips, speeds) and mounts per tier (model incl. FBX, height, tint, clips, seat bones, wings).
     - `extends` with field-by-field overrides and `use` for reusing another role's textures; validated and unit-tested; problems are reported, never fatal.
     - `public/themes/medieval/pack.json` now drives everything the medieval theme used to hard-code; `public/themes/highland` is a variant with no files of its own. The sandbox lists bundled themes and imported packs that carry one.
     - Open: only the `ue5-universal` rig exists; the Looks panel does not preview themes.
   - ~~Phase 7, into the town~~ first pass done for the 3D view.
     - **🎨 Looks → World theme (3D view)** picks a bundle (saved in prefs; `?theme=` for tests). `Renderer3D.setTheme(bundle)` swaps the whole look.
     - `townSite.ts` turns the town plan into a site: map flat, roads/paths/plaza/water/buildings taken, worn verges, the plan's own tree and rock spots planted as real trees. Roads and plaza are paved, paths and sand trodden, water glossy, all with the theme's materials.
     - Buildings come from the theme's grammar, with signs, logos and the Chronicle bell intact. Woods, meadow, props and lanterns surround the town; an HDRI sky lights it by the hour (the theme's daytime sky by day).
     - Heroes and villagers are rigged people with their tier's mounts once the files load (the sprites stand in until then). Speed and heading come from how each agent moves; invisible proxies keep heroes clickable.
     - Ravens are 3D birds (sci-fi: drones), heralds and bailiffs rigged people (dressed as a bard and a paladin), caravans 3D carts, covered wagons, vans, lorries or hover pods by style and load (`grammar/companions.ts`). Chimneys and stacks smoke (one GPU point cloud, `smoke.ts`); themed water ripples.
     - Open: the 2D views keep the pixel art (baked sprites from the 3D look later); town walkers move at about 6 m/s, so people mostly jog.
   - ~~Phase 6, sci-fi and modern bundles~~ first pass done.
     - `public/themes/modern` and `public/themes/scifi` extend medieval: 9 and 12 CC0 ambientCG materials (0.95 MB and 1.15 MB), their own building grammar (`grammar/modern.ts`, `grammar/scifi.ts`; `builder.ts` picks the style), props (urban, colony), lamps (post, beacon) and skies (day, a sunset-lit dusty world).
     - Modern: shopfronts with brand-coloured awnings, offices, a glass bank tower, a concrete church, a container port with a gantry crane, a works with a sawtooth roof, a clock-and-mast Chronicle Tower; homes from a cardboard shelter to a glass skyscraper with a helipad.
     - Sci-fi: panelled modules with glowing seams, domed habs and tubes, a vault, a spire, a spaceport, a comms mast for the bell; homes from a sleeping capsule to an arcology spire.
     - Vehicle mounts built in code (`grammar/vehicles.ts`): bicycle, scooter, motorbike, helicopter, jet; hover scooter, hoverbike, heavy hoverbike, skiff, starship. Riders straddle bikes and sit in cockpits; wheels and rotors spin, hover craft bob.
     - Format: `asphalt` role, `plaza` ground, styles `modern`/`scifi`, `beacon` lamps, vehicle mounts, partial `characters` with `extends`.
     - Open: modern and sci-fi people still wear the medieval outfits (no CC0 outfits for these on the universal skeleton yet; the base body alone is underwear); vehicles are simple primitives; no smoke or exhaust effects.

   - ~~Performance pass~~ done (themed town, near camera, all passes: 1,436 → 356 draw calls, 1.32M → ~0.7M triangles; the built-in look 1,011 → ~230 calls).
     - Buildings: every static part merged per material into a few meshes; invisible footprint boxes keep hover, click and sign occlusion.
     - People: rigged models within 70 tiles of the camera, at most 20, the nearest first (sprites beyond, no animation updates); real shadows for the nearest 8 only; each character's parts merged per material and bind pose (16 → 7–8 skinned meshes; quantisation offsets baked in); the horse's flat-colour materials baked into vertex colours.
     - Woods: low-detail trees (one trunk, big leaf cards) without shadows beyond 10 tiles from town; fewer bark sides near; boulders cast no shadows.
     - `Renderer3D.stats()` and an e2e budget (< 800 calls, < 1.2M triangles) guard it.

### Player feedback round (2026-10-09)
- Griffins and dragons keep to the roads, hovering ~1 m up, instead of flying over the roofs; caravans roll on the ground ~1.4 tiles behind on a trail kept by distance (it used to be a few frames back, so a fast mount carried its cart underneath).
- A loading veil (three little houses raising themselves) until the town, the 3D view or a theme is ready; it never hides a failed load.
- Treasure and gallery slots show the token's logo or the NFT's picture big, with the category icon as a corner badge.
- The quest log folds to its title (remembered).
- Portraits follow the chosen theme: its rigged character photographed head and shoulders (`portrait.ts`, a small studio with its own WebGL context); the pixel portrait otherwise.
- The Guild panel lists the town's heroes with portraits; each opens the character sheet.
- Heroes can be renamed (✎ on the sheet or in the Guild panel); names are remembered; an empty name restores the town's.

### The Chronicle Tower shows how busy the chain is (2026-10-09)
- From the block feed already polled for the bell (no Zerion requests): fullness (gas used / limit), base fee, tx count. `world/chain.ts` smooths fullness over blocks and reads the toll: gwei, a plain transfer's cost in USD (ETH price from the guild's holdings), heat (log scale, $0.02 cool … $5 hot) and trend (▲ over half full, ▼ under).
- **Queue:** townsfolk line up on the road from the tower door, 2 when calm up to 18 when blocks are full; each sealed block lets the front in (more when it was full), newcomers walk up from the gate and the streets.
- **Toll board** by the door: base fee with its trend and a transfer's cost, coloured by level; painted wood (built-in, medieval), an LED panel (modern) or a hologram (sci-fi) in 3D; a pixel board in 2D.
- **Beacon** on the spire: a brazier fire, green when cheap through amber to red, bigger and brighter (and stronger at night) as the toll rises.

### Ideas for what comes next
- Effects, sky/ground and UI-skin slots; pack previews in the Looks panel.
- Approvals as a keyring (needs RPC/log reads), and the health factor for lending.
- Phase 5 gamification: fog of war, titles and medals, teaching quests.
- Phase 6 multi-chain realms.

## Live data (done 2026-10-08)

- **⚙ Guild panel:**
  - Zerion key, stored only in `localStorage`.
  - Your wallets and followed towns, each added by address, ENS name or "Connect wallet" (EIP-1193).
  - The day's ink, i.e. requests left (also shown in the top bar).
  - "Clear cached data".
- **`Session`** (`src/data/session.ts`) decides the source:
  - key + wallets → live;
  - otherwise captured fixtures, else the synthetic demo.
  - Visiting a followed town is a separate read-only mode with "⌂ Return home".
- **`LiveLoader`** (`src/data/live.ts`) on the ported Zerion client and daily budget, cached in IndexedDB (`src/data/cache.ts`):
  - history kept forever, newest tail fetched (1 request);
  - valuations refetched after 5 minutes (4 requests);
  - a cold wallet costs 5; a reload within the TTL costs 0;
  - **fingerprint-gated revisits (2026-10-09):** before loading, the free RPC gives each wallet's nonce and ETH balance, stored with the cache entry. Unmoved: served from the cache, the tail re-checked after 30 min (1) and a full re-measure hourly (4). Moved: the tail (1) plus tokens (2) after plain transfers, or a full re-measure (4) after anything touching a protocol. Visiting a town again, or coming home, is usually free. "↻ Refresh this town now" in the Guild panel forces the tail and a full measure.
  - Pinned by `test/live.test.ts`.
- **Live updates:**
  - On every block, one free RPC batch call reads each shown wallet's nonce and ETH balance (baseline taken at load).
  - Zerion is asked only when one moved, plus a 15-minute catch-up for incoming tokens.
  - New journeys play live without restarting the replay.
- **ENS:** forward and verified reverse lookups over the public RPC, using a small self-written keccak-256 and namehash (`src/util/keccak.ts`, `src/data/ens.ts`). Primary names become hero names.
- **e2e:** `e2e/live.spec.ts` drives the whole live path against a fake Zerion and RPC. It checks the request counts and plays a new transaction when the fake chain moves.
- ~~Known gap: valuations only refresh on reload.~~ Fixed: re-measured after a wallet moves, plus an hourly drift refresh (see Next steps 6).
- Default view for new visitors is now 3D.

## Decisions log

| # | Decision | Date |
|---|---|---|
| 1 | Home size = **value tier**. Wallet age may later show as wear and tear (deferred). | 2026-10-08 |
| 2 | Hero class is **auto-suggested** from behaviour; the **player can override** it. | 2026-10-08 |
| 3 | **Static site, all logic in the browser, bring-your-own Zerion key** (stored in `localStorage`, called directly, CORS verified in v3). No server. Public RPC for blocks and to gate polling. | 2026-10-08 |
| 7 | **Reuse only v3's Zerion module** (client, pacer, budget, transport, types). Everything else is new. | 2026-10-08 |
| 8 | **All art is new, drawn in code** as pixel art (the default pack). No `iso-building-generator`. | 2026-10-08 |
| 9 | Build **both a top-down and an isometric 2D prototype** from the same world state; choose later. | 2026-10-08 |
| 10 | Default history window: **last 100 transactions**. | 2026-10-08 |
| 14 | **Asset packs are data only** (JSON + images + glTF). Imported packs live in IndexedDB and are served from blob: URLs, so `connect-src` gains only `blob:`/`data:`, never arbitrary origins. | 2026-10-08 |
| 13 | Three.js upgraded to 0.186. 3D polish follows the awesome-graphics skills where they fit a stylized diorama (pipeline, bloom, grading, shadows, wind, animation, camera, validation); realism-only systems (oceans, clouds, planets, cascaded shadows, auto-exposure) skipped. | 2026-10-08 |
| 12 | **3D is the primary view.** Top-down and isometric stay as working fallbacks, but new visual work targets 3D first. | 2026-10-08 |
| 11 | Add a **3D view** (Three.js, the only runtime dependency, lazy-loaded): low-poly buildings from the same style table, pixel-art characters as billboards (HD-2D). All three views implement `WorldView` over the same Sim. | 2026-10-08 |
| 4 | Default tone **Stardew-like**, but all visuals are **swappable slots filled by asset packs**, to enable player-made (and later sold) packs. | 2026-10-08 |
| 5 | Followed wallets are **visited as separate towns**, not shown in your town. | 2026-10-08 |
| 6 | Losses are **dramatic, scaled by value tier** (clerk → bailiffs → town-wide siege). | 2026-10-08 |

## Status (2026-10-08)

**Phases 0–2 have a first runnable cut:** `npm run dev`
- Zerion module ported (65 tests), v4 domain + verb refinement, town layout, simulation, both projections, panels.
- Live Chronicle bell from mainnet via a public RPC.
- 83 tests passing, typecheck and lint clean.
- Runs on the synthetic demo data until real captures exist.

**Real data (5 captured wallets):** 425 journeys in the last-100-tx window, **96% mapped to a verb** (16 opaque `execute` calls remain "Mysterious errand"). Fixes from the first look:
- the window is applied before mapping, so only places actually visited appear;
- approvals go to the spender (`approvals[].sender`), not the token;
- guild addresses are homes, never tents;
- a small address book (CryptoPunks, ENS, OpenSea, Permit2, routers, WETH) plus naming contracts after their NFT/token;
- unknown or one-off contracts share the **Wanderers' Camp** (own tent only at ≥3 visits, max 4);
- NFT floor value counts toward net worth (shown separately: floors are rough);
- a full town shares the camp instead of dropping places.
- **sends/receives that pass through a contract** (Zerion files e.g. Gondi loans as plain `send`/`receive` with no dApp) go to that contract's building. A transfer is person-to-person only if the called contract is a party or the token itself. Contract → dApp pairs are learned from transactions where Zerion does name the dApp, and new lender verbs `lend` / `loanRepaid` were added. Transfer helpers and guild-internal transfers stay home to home.

**3D view:** `three` is loaded only when the 3D view opens (~137 kB gzipped; the 2D app is ~34 kB). Protocol logo hosts send no CORS headers, so WebGL cannot texture them; logos are drawn on the 2D overlay at the sign's projected position instead (the emblem stays as fallback).

**Next:** see "Next steps (3D primary)" above.
3. Phase 3: key entry + live loading in the browser, an IndexedDB cache, RPC-gated polling, visiting followed towns.

## Open questions
