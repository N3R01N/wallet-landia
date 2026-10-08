# Wallet-landia

Ethereum wallets as a cosy fantasy town. Each wallet is a **hero** whose mount and home show what it's worth. Protocols are **buildings** (Uniswap is the Bazaar, Aave the Counting House, Lido the Temple). Transactions are **journeys** the heroes walk, paying a toll at the **Chronicle Tower** (the blockchain), whose bell rings on every real mainnet block.

The design lives in [`docs/WORLD_BIBLE.md`](docs/WORLD_BIBLE.md) (every metaphor) and [`docs/PLAN.md`](docs/PLAN.md) (architecture, phases, decisions).

## Run it

```sh
npm install
npm run dev
```

This opens the town with whatever is in `fixtures/`. If there are no real captures, it falls back to the synthetic demo in `fixtures/demo/`.

- **Top-down / Isometric / 3D**: three views of the same world (keys `t` / `i` / `3`). In 3D, right-drag or shift-drag orbits, and `q` / `e` rotate.
- **Drag** to pan, **wheel** to zoom, `0` to fit, **space** to pause.
- **Hover** anything for an approximate value; **click** a hero or home for the character sheet, or a building for its interior with exact values.
- The bar at the bottom replays the window (last 30 days / last N transactions) in compressed event time, then goes **LIVE**.

## Live wallets (in the browser)

Open **⚙ Guild**, paste your free Zerion key (stored only in this browser), and add your wallets by address, ENS name or "Connect wallet". The town goes live: cached in IndexedDB, and updated when the chain shows one of your wallets changed. Follow other addresses to visit their towns. The ✒ counter shows Zerion requests left today (300 on the free plan).

## Looks (asset packs)

**🎨 Looks** restyles the town with asset packs: heroes, townsfolk, caravans, treasure icons, 2D and 3D buildings, scenery, and place names. Packs are data only (images, glTF models, words). Try the bundled **Ember & Frost** pack with "Use everywhere", or import your own pack folder. To make one, see [`docs/PACKS.md`](docs/PACKS.md).

## Captured fixtures (for development)

Put your free Zerion key in `.env.local` (gitignored) as `ZERION_API_KEY=zk_...`, then:

```sh
npm run capture -- 0xabc... 0xdef...   # ~5 requests per wallet, of 300/day on the free plan
npm run inspect                        # text check: heroes, protocols, verb coverage
```

The key is read from the environment and is never written to the fixtures.

## Layout

```
src/
  data/       Zerion client (ported from v3), fixtures, the RPC heartbeat
  domain/     tiers, asset/protocol classification, raw → Guild (heroes, protocols, journeys)
  world/      town layout + pathfinding, the simulation (replay clock, agents, effects)
  render/     pixel-art sprites drawn in code, ground, the 2D renderer (two projections), three/ for 3D
  ui/         app shell, character sheet, building interiors
```

`npm test` · `npm run e2e` (browser smoke tests, all three views) · `npm run typecheck` · `npm run lint` · `npm run build` (static files in `dist/`)

Captured wallets in `fixtures/*.json` are gitignored; only the synthetic demo is committed.
