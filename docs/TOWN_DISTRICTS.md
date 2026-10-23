# The town in districts (branch `town-districts`)

## Why

Every protocol stood on the one avenue, side by side whatever it was, and the town ran on for a long way. With districts the town reads at a glance (the lending protocols together on Bankers' Row, the DEXs on Market Street, OpenSea and the art markets on Gallery Lane) and it is shorter.

## The layout

- **The plaza is the centre of town.** A ring road runs round the bell tower. The avenue comes in to it from the castle and goes on from it to the Wayfarers' Gate.
- **Two streets leave the ring**, left and right, for the town's first two districts. Their buildings stand on both sides of the street, past the square.
- **Crossroads A**, between the castle and the plaza, takes the next two districts. Their buildings stand towards the castle.
- **Crossroads B**, past the plaza, takes the next two. Their buildings stand towards the gate. A seventh or eighth district gets one more crossroads past B.
- **The square's four corners** keep the well, two benches, the monuments and the notice board, all clear of the ring and the streets.
- **Order:** the districts come in the order of their first protocol (the town's order: what the guild holds most first), so the guild's main districts are at the centre.
- **Doors:** on a street, each door is at the street's edge (1.5 m from its middle, as on the avenue), with a one-tile step from the street to it.
- **Couriers:** up the avenue, round the ring to a plaza street, or on to their crossroads, along the street, and to the door.

| District | Street | Categories |
|---|---|---|
| market | Market Street | dex (DEXs, aggregators) |
| bankers | Bankers' Row | lending |
| temple | Temple Lane | staking (staking, restaking, yield) |
| gallery | Gallery Lane | nft (NFT markets, mints, art) |
| harbour | Harbour Road | bridge |
| council | Council Lane | governance (DAOs, names) |
| commons | Wanderers' Lane | other (unknown contracts, the furnace, airdrops) |

## In code

- **`src/castle/scene/plan.ts`:**
  - `layStreets` lays the ring, the streets and their plots.
  - `planCastle(world, arranged, layout, districts)` uses it when `districts` is set.
  - A building's `street` names its row and district; `plan.streets` lists the streets.
  - `avenue.ring` describes the ring road; `plan.plazaSpots` gives the square's spots.
  - `routeTo` goes round the ring.
- **Which castle:** the v2 castle (layout 2) has districts (`districtsFor` in castleView.ts); the first themes keep the avenue.
- **Build mode:** swaps two buildings within a street only; there are no free plots.
- **Followed along:**
  - paving and cobbles;
  - lanterns (none across a street's mouth);
  - door walkways and pumpkins;
  - bunting (none across a street);
  - monuments and the notice board on the square;
  - the Siege battlefield, whose flank lanes run outside the streets.
- **Tests:** `test/townDistricts.test.ts`.

## Next (needs art)

- A signpost at each street's mouth with its name (`prop.street.sign`, a `Logo`-style name plate): a batch for the Blender agents.
- A district's look: bunting or lamps in its colour along its street.
