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
- Fog of war over districts and buildings, revealed by interacting.
- Titles and medals (achievements): "First Barter", "Survived the Bailiffs", "Keeper of Keys" (revoked stale approvals).
- Quests that teach: "Recover your master keys", "Visit the Temple", "Diversify your treasury".
- Guild crest customisation, persistence (local first).
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
5. **Asset-pack slots:** formalise the slot catalogue in code, so the 3D meshes and sprites resolve through packs.

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
  - a cold wallet costs 5; a reload within the TTL costs 0.
  - Pinned by `test/live.test.ts`.
- **Live updates:**
  - On every block, one free RPC batch call reads each shown wallet's nonce and ETH balance (baseline taken at load).
  - Zerion is asked only when one moved, plus a 15-minute catch-up for incoming tokens.
  - New journeys play live without restarting the replay.
- **ENS:** forward and verified reverse lookups over the public RPC, using a small self-written keccak-256 and namehash (`src/util/keccak.ts`, `src/data/ens.ts`). Primary names become hero names.
- **e2e:** `e2e/live.spec.ts` drives the whole live path against a fake Zerion and RPC. It checks the request counts and plays a new transaction when the fake chain moves.
- **Known gap:** while the page stays open, valuations (balances, positions) refresh only on reload or after the TTL on the next load. A periodic valuation refresh can come later.
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
