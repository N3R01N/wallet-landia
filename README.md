# Wallet-landia

Your Ethereum wallets as a castle, and the chain as the town in front of it.

- **The castle** grows with your guild: one **tower** per wallet (at that wallet's value tier), the **keep** at what all your wallets are worth together, a **wing** for each kind of protocol you use.
- **The town** is the chain: a **building** per protocol you hold value in or use (32 protocols have their own building; the rest get one for their kind), the **bell tower** in the middle rings on every real mainnet block, and the paths light up.
- **Every transaction is a courier**: the drawbridge lowers, the courier crosses the moat, pays the toll (the gas fee) at the border post, walks to the protocol's door, and the person inside comes out to take the goods. What arrives comes the other way; a failed transaction is turned back at the barrier; goods between your own wallets go along the castle walls.

Plan and decisions: [`docs/REDESIGN.md`](docs/REDESIGN.md). The assets (names, sizes, style) every theme provides: [`docs/ASSET_SPEC.md`](docs/ASSET_SPEC.md).

## Run it

```sh
npm install
npm run dev
```

This opens the castle with whatever is in `fixtures/`. If there are no real captures, it falls back to the synthetic demo in `fixtures/demo/`. `/assets.html` is the asset gallery: every asset the theme provides, with its spec.

- **Castle / Town**: the scene; drag to pan, pinch or wheel to zoom, tap a building (what your guild keeps there) or a courier (its transaction). **📜 Chronicle** lists the recent transactions.
- **Badges**: your level and rank from all your wallets' history, the castle's badges and the medals.
- **Guild**: your free Zerion key (kept only in this browser), your wallets (address, ENS name or "Connect wallet"), the history file, the Ethereum node.
- `?hour=23` shows the castle at night.

## Captured fixtures (for development)

Put your free Zerion key in `.env.local` (gitignored) as `ZERION_API_KEY=zk_...`, then:

```sh
npm run capture -- 0xabc... 0xdef...   # ~5 requests per wallet, of 300/day on the free plan
npm run inspect                        # text check: wallets, protocols, verb coverage
```

The key is read from the environment and is never written to the fixtures.

## Layout

```
src/
  castle/     the castle page: the shell (tabs, sheets), the scene (plan, couriers, the 3D view),
              the world (wallets, protocols, errands from the guild), badges, the asset contract
  data/       Zerion client, the lifetime ledger, fixtures, the RPC heartbeat, the session
  domain/     tiers, protocol classification, raw → Guild (wallets, protocols, journeys), the player
  audio/      the sounds, made with Web Audio
public/themes/medieval-castle/   the theme: models, art, theme.json (its version)
```

`npm run check` (typecheck, unit and browser tests) · `npm run lint` · `npm run build` (static files in `dist/`)

Captured wallets in `fixtures/*.json` are gitignored; only the synthetic demo is committed.
