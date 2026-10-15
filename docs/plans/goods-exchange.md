# Plan: goods changing hands (coins, NFTs), logos, the toll keeper

From the user (2026-10-15):
- **Logos:** OpenSea and Stella have none.
- **Toll keeper:** stands too close to the barrier.
- **Coins:** when coins change hands, show them going from the courier, wallet, building or person to the other side. Fun and obvious, with a sound.
- **NFTs:** show the actual picture if possible, else a stylised one, carried by the courier and handed over or received with an animation and a sound.

## How games show it (references)

- **Clash of Clans, Hay Day (collecting resources):**
  - a burst of 6–12 coins pops out of the source in a fountain arc, hangs a beat, then streams to the target (a counter or a storage);
  - each coin landing plays a short "tink" whose pitch rises through the stream;
  - the target squashes (bounces) when the last one lands.
- **Coin Master, Royal Match (rewards):**
  - coins fly on curved paths with a sparkle trail, slightly staggered;
  - a floating "+250" rises and fades where they land;
  - big amounts mean more coins and a bigger sound, never a slower one.
- **Animal Crossing, Stardew (an item handed over):**
  - the item is held up over the head with a short jingle;
  - then it arcs to the other character with a sparkle, and the receiver reacts.
- **Shared rules:**
  - **Readable direction:** the stream always runs from giver to taker.
  - **Count shows size:** the number of coins scales with value (log-ish), capped.
  - **Short:** under a second per exchange.
  - **Audible:** rising "tinks" when receiving, lower "clinks" when paying.
  - **A visible reaction** at the receiver.

## What we build

1. **Logos for every protocol a wallet touches.** The bundled snapshot covers the common ones. Any other protocol uses the icon Zerion gives it (`Protocol.iconUrl`), fetched through our own `/api/image` (already the proxy for NFT pictures). The dev server gets the same proxy (a Vite middleware running `api/image.ts`).
2. **The toll keeper** stands beside the booth's road-side window, clear of the barrier's post and arm.
3. **Coins**, at each exchange:
   - **Toll:** a few coins from the courier to the toll keeper (by fee size), low clinks; the keeper plays `toll`.
   - **Hand-over at a building:**
     - what the courier gives (`step.give`) streams courier → the building's person;
     - what it gets (`step.get`) streams person → courier.
   - **Arriving home** (an incoming errand, or the goods brought back): coins stream courier → the wallet's hall, a bright rising chime, and the hall bounces.
   - **Inside the castle:** hall → courier at the start, courier → hall at the end.
   - **Floating label:** "+0.52 ETH" or "−1,200 USDC" rises where the coins land (green for in, gold for out).
   - **Count:** coins = clamp(round(log10(usd + 1) × 3), 3, 14). Gold coins; a stablecoin silver; the token's own logo on the coin face when we have it.
4. **NFTs:**
   - the courier carries a framed picture (the NFT's own image through `/api/image`, else a stylised painting);
   - at the exchange the frame lifts, spins once and arcs to the receiver with sparkles and a shimmering chime;
   - the receiver holds it up briefly (`receive`).
5. **Sounds** (Soundscape):
   - `coinStream(n, incoming)`: n tinks over the stream, pitch rising (incoming) or falling (paying);
   - `nftShimmer()`: a soft glissando and a bell;
   - `stampLand()`: a small thump for the receiver's bounce.

## Assets (batch 16, design agent): `docs/batches/16-exchange.md`

- **`fx.coin`:** a chunky gold coin with a raised rim and a `Logo` face (token logo at runtime); a silver variant through `Tint`. ≤ 200 tris.
- **`fx.nft.frame`:** a small gilt picture frame with a `Picture` face (0–1 UVs, the NFT image at runtime) and a carrying handle. ≤ 400 tris.
- **`fx.sparkle.burst`:** a little star burst (3D, flat cards, alpha-test) for arrivals. ≤ 100 tris.
- **The courier's `carry` pose:** an arms-up hold for frames (the clip `carry`), plus the existing `hand-over`.

Until they arrive the game builds simple stand-ins (a gold cylinder coin, a framed plane) so the effect works now.

## Order of work

1. Logos (fallback and dev proxy), the toll keeper's place: quick.
2. The exchange system (`scene/exchange.ts`): streams, labels, sounds, with stand-ins.
3. NFT frames with real pictures.
4. Swap in the batch 16 models when delivered; review in the game; show the user.
