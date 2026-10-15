# Batch 17: a wallet's hall by its worth and what it holds (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` (§4, §5, §7, §8, **§10 lessons**) and `docs/batches/01-castle-core.md` (the castle's grid and the hall contract, §2).

From the user (2026-10-15): each wallet's building should look different by how much the wallet holds. Today every wallet has the same hall (`castle.hall.wallet`), with a few extra parts at tiers 2, 4 and 6. This batch gives **each tier its own building**: a player sees at a glance which wallet is the poor one and which the rich one, and has a reason to grow a wallet into the next look.

**A second axis (the user, same day): what the wallet mostly holds.** A wallet that is mostly NFTs looks different from one mostly in DeFi positions, and both differ from one that mostly holds tokens. The building stays the tier's; its **dressing** changes. The difference is subtle, but obvious at a glance, and fits the castle.

This is an exception to §7's "one model for all tiers": the halls are the player's own buildings, so the tier is told by the building itself, not by trim alone.

## The tiers (the game's one value scale, `src/domain/tiers.ts`)

| Tier | Name | Wallet's net worth | Building | Height to the top |
|---|---|---|---|---|
| t0 | Dust | under $10 | **Lean-to**: a squatter's shelter against the wall | 4.2–4.6 m |
| t1 | Common | $10–100 | **Cottage**: wattle-and-daub, thatched | 5.2–5.6 m |
| t2 | Uncommon | $100–1k | **Townhouse**: half-timbered, two storeys | 6.4–6.8 m |
| t3 | Rare | $1k–10k | **Stone hall**: dressed stone, slate, arched windows | 7.4–7.8 m |
| t4 | Epic | $10k–100k | **Tower house**: a square tower rising from the wall | 8.8–9.2 m |
| t5 | Legendary | $100k–1M | **Great tower**: round, a tall conical roof, a balcony | 10.2–10.8 m |
| t6 | Mythic | $1M and more | **Palace spire**: white stone and gold, a gilded spire | 11.6–12.2 m |

The keep (about 13 m) stays the tallest piece in the castle. Heights rise in even steps, so neighbouring halls of different tiers read as a ladder.

## The three focuses: dressing parts in every hall

Each hall carries **three dressing sets**, nodes `focus.tokens`, `focus.defi` and `focus.nft` under `body`. The game shows exactly one (a wallet's focus: tokens, DeFi positions or NFTs, whichever holds the most value) and hides the other two. Rules:
- The building looks complete with any one set shown and the other two hidden: no holes, no bare brackets, and no shared pieces between sets.
- The sets must not overlap one another's space (they never show together, but keep them apart so the checker stays clean with all three shown), nor the building.
- **Same scale per tier:** a lean-to's set is a couple of small props; a palace spire's is a whole facade feature. Each set reads from the game camera at 45° and from outside the walls.
- **Each set has a crest emblem** on the main Tint banner: a plate in `Trim` on the cloth, cut as a closed slab 1 cm proud of the banner. **Coin** (tokens), **key** (DeFi), **picture frame** (NFTs). On t0 it is painted on the rag pennant, in the same shapes.

| Focus | The idea | Props (pick by tier, more and grander as it rises) | Its idle and tap touch |
|---|---|---|---|
| `focus.tokens` | **A counting house**: money kept at home | iron-banded coin chests and a strongroom door; coin sacks (Trim coins spilling); a hanging gold coin sign on a bracket; a balance scale in a window; at t5–t6 a gilded coin dome finial or a treasury balcony with chests | the coin sign swings; on tap a coin flips out of a chest and lands back in it |
| `focus.defi` | **A working guild**: money put to work | a hoist beam with sacks on a rope (yield coming in); a small brass gear-and-chain mechanism on the wall (a clockwork works); a ledger lectern by the door; a key-plate over the door; at t5–t6 a turning brass orrery or water-clock on the roof | the gears turn slowly; on tap the hoist lifts a sack up and back down, and the gears spin faster |
| `focus.nft` | **A gallery**: things collected for their beauty | framed paintings on the courtyard wall (painted panels; vary the pictures, real paint-like colours, no logos or text); a statue on a plinth at the door; a painter's easel; a stained-glass rose window; at t5–t6 a gallery loggia with a row of framed pictures, and a marble bust on the balcony | a lantern lights the paintings with a soft glow pulse (a glow card's scale); on tap the easel's cloth lifts to show the picture and drops back (cloth visible at rest) |

Per tier, for example:
- **t0:** tokens: a coin pouch and a padlocked box; DeFi: a tally stick and a seed sack on a hook; NFTs: a charcoal sketch pinned to the wall and a little clay figure.
- **t3:** tokens: a strongroom door with iron straps and two chests at the porch; DeFi: the hoist beam with sacks and gears by the porch; NFTs: three framed paintings under the porch roof and a statue by the steps.
- **t6:** tokens: a treasury balcony with gold chests and a coin dome finial; DeFi: an orrery turning on the roof terrace; NFTs: a loggia with a row of paintings and a marble statue.

The idle and tap gags of the focus sets are **part of the hall's `idle` and `tap` clips** (animate every set's nodes; the hidden ones simply aren't seen).

## Shared contract (all seven)

- **Files:** `models/castle/hall.wallet.t0.glb` … `hall.wallet.t6.glb`, root nodes `castle.hall.wallet.t0` … `.t6`.
- **Footprint:** exactly **4.0 m (x, along the wall) × 4.0 m (z)**, including the 1 m curtain wall at the back. Nothing may stick out past x = ±2.0 at any height up to 3.8 m (the neighbouring wall segments sit there). Above 3.8 m, overhangs up to 0.3 m over the wall's top are fine; never past z = −2.0 (the moat side).
- **Wall line (the same as `castle.hall.wallet`):**
  - the outer face (−Z) is the curtain wall: walkway at 3.0 m, merlons up to 3.8 m, 1 m thick;
  - side faces end flush at x = ±2.0 up to 3.8 m, **with no end faces** where the wall segments meet them;
  - check it with `wall-join.png` (hall, segment, corner, as the game places them).
  - The t0 lean-to stands **inside** the wall: the wall itself (with merlons) is part of the model, and the lean-to's roof leans against its inner face below the walkway.
- **Orientation:** the outer face at −Z, the courtyard and the door at +Z.
- **Door:** human scale (2.1–2.3 m; the lean-to's opening may be lower, 1.9 m), on the +Z face. Empty `door` on the ground 1 m in front of it.
- **Materials:**
  - `Tint`: the wallet's crest colour, on the crest cloth (closed slabs, §10). It must show from outside the walls (−Z) **and** from the courtyard.
  - `Trim`: the tier colour (the game paints it), on ridges, window frames and finials.
  - The rest from palette v2, following §7's material ladder: timber and thatch (t0–t1) → timber on stone, tile (t2) → stone and slate (t3–t4) → dressed stone, metal and gold (t5) → white stone, gold and glow (t6).
- **No `tier.N` parts:** each file is one tier.
- **Focus parts:** `focus.tokens`, `focus.defi` and `focus.nft`, each a node under `body` (see above).
- **Budget** (all three focus sets included): t0–t2 up to 5k tris, t3–t4 up to 7k, t5–t6 up to 9k.
- **Clips:** `idle` (5–8 s, seamless) and `tap` (1.0–1.4 s: a bounce plus that building's own gag, below). The usual §8.2 rules apply: nothing appears from nowhere, doors open outward, smoke rises out of an open flue.
- The game keeps the old `castle.hall.wallet` as the fallback for a tier that isn't delivered yet.

## The seven halls

### t0 Dust: the lean-to
- **Look:**
  - a patched timber lean-to against the inner face of the wall;
  - a sagging plank roof with a canvas patch;
  - a rag curtain for a door (Tint, a closed slab);
  - a crate, a cracked pot and a little fire ring in front (stones and ash, no flame);
  - the wall behind is plain, with a few missing merlon caps;
  - the crest is a **small rag pennant** (Tint) on a stick lashed to the merlons, showing over the wall's top from outside.
- **Idle:** the rag curtain and the pennant flutter; a wisp of smoke from the ash (white Smoke, from the ring).
- **Tap:** bounce; the curtain flips aside and back; a loose roof plank lifts and drops.

### t1 Common: the cottage
- **Look:**
  - a one-storey whitewashed wattle-and-daub cottage with a timber frame;
  - a thick thatched roof, ridge along the wall, a small dormer in the thatch;
  - a plank door with a latch, two small shuttered windows, a water butt and a woodpile;
  - the crest is a **short banner** (Tint) on a pole over the wall.
- **Idle:** chimney smoke (open flue), the banner sways.
- **Tap:** bounce; both shutters bang open and shut; a hen pecks out from behind the woodpile and back (or a log rolls off the pile and back up).

### t2 Uncommon: the townhouse
- **Look:**
  - two storeys, a stone ground floor and a jettied half-timbered upper floor;
  - a red-brown tile roof with a chimney;
  - flower boxes under the upper windows, a lantern by a panelled door, a bench;
  - the crest is a **tall banner** (Tint) hanging from under the eaves over the outer wall, as on today's hall.
- **Idle:** the banner sways; the lantern swings a little; chimney smoke.
- **Tap:** bounce; the upper shutters fly open and shut; the door opens a crack.

### t3 Rare: the stone hall
- **Look:**
  - a dressed-stone guildhall with a steep slate roof and tall pointed-arch windows (warm glass glow, emissive kept low);
  - a stone porch with steps, a small bell-cote on the ridge with a bell;
  - the crest on **two banners** (Tint), outside and over the porch.
- **Idle:** the banners sway; the bell swings slightly.
- **Tap:** bounce; the bell rings (a full swing); the porch doors open outward and close.

### t4 Epic: the tower house
- **Look:**
  - a square stone tower rising from the wall to about 9 m, three storeys;
  - a crenellated top with a small corner turret (conical cap, Trim);
  - an oriel window on the courtyard face, arrow slits low and real windows high;
  - a stair to a raised door;
  - a **crest shield** (Tint) on the tower face, and a big banner on the outer face.
- **Idle:** a pennant on the turret waves; the banner sways; a torch by the door flickers (scale and wobble, no material animation).
- **Tap:** bounce; the door swings open and bangs shut; the pennant snaps out straight once.

### t5 Legendary: the great tower
- **Look:**
  - a round tower in dressed stone with buttresses, rising to about 10.5 m;
  - a tall conical roof in deep slate, a gold finial (Trim), and a ring of small dormers;
  - a balcony with a stone balustrade on the courtyard side, with a glowing stained-glass window behind it (emissive, low);
  - **long twin banners** (Tint) down the outer face, and a crest medallion over the door.
- **Idle:** the banners sway in turn; a flag on the finial waves; a faint glow pulse in the stained glass (a slight scale on a glow card, no material animation).
- **Tap:** bounce; the balcony doors open, a little trumpet banner unfurls from the balcony (from a roll that is visible at rest), then rolls back.

### t6 Mythic: the palace spire
- **Look:**
  - white stone with gold (Trim) on every edge;
  - a slender main tower with a gilded onion dome or crown, and a needle spire to about 12 m;
  - two small flanking turrets with gold caps;
  - tall windows glowing warm;
  - a gold crest medallion with the crest (Tint) inlaid;
  - **three banners** (Tint) on the outer face, and gold pennants on the turrets.
- **Idle:**
  - the pennants and banners wave;
  - a slow shimmer: two or three small gold star cards orbit the spire slowly (closed shapes, double-sided only on the stars, §10);
  - the glow windows breathe (a scale on glow cards).
- **Tap:** bounce; the crown spins a quarter turn and back; the stars burst out and return; the main doors swing open.

## Checks (the usual)

- check_coplanar **TOTAL 0**, in the rest pose and in every clip frame;
- check_cloth for every banner and curtain (clearance from walls and eaves);
- two of each next to a wall segment and a corner (`wall-join.png`), with no faces meeting where they join;
- feet of anything moving never below 0;
- single-sided everywhere except the t6 stars.

## Delivery

- Per hall: renders (§9: iso views, phone, silhouette, the idle and tap frames), checker results, tris and file size.
- `focus.png`: per hall, the three focuses side by side (the same view, one set shown each).
- `ladder.png`: **all seven side by side** in a row along a wall, in tier order, from the game's camera (45° pitch), and once from the outside (moat side). This is how the player compares them.
- Then stop for review. Build them in the order t0, t3, t6 first (to fix the range), then t1, t2, t4, t5. Report after the first three so the developer can check the range in the game before you build the rest.

## What the game does

- Each wallet's hall is `castle.hall.wallet.t<its tier>` (`src/castle/scene/plan.ts`), falling back to `castle.hall.wallet` with its tier parts while a tier is missing.
- The focus (`src/castle/world/halls.ts`, `walletFocus`) is whichever is biggest by value: tokens in the wallet, positions in protocols (gross: debt counts toward the size), or NFTs at floor price; ties and empty wallets get tokens. The game shows that `focus.*` set and hides the others.
- The wallet's sheet names its hall ("Rare stone hall · mostly DeFi positions") and how far the wallet is from the next one.
