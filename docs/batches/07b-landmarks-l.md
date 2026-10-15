# Batch 7b: landmark protocol buildings, L class (v2)

The same rules, tools and working arrangement as **[07a](07a-landmarks-xl.md)**: read that brief first. Then read `docs/STYLEGUIDE_V2.md` (§3, §8.1, §8.2, §9 and §10). References: Aave and the batch 7a landmarks in `public/themes/medieval-castle-v2/models/building/`.

## The L class

- **Size:**
  - **footprint 8 × 8 m**, overhangs up to 1 m;
  - **12–16 m** to the main mass's top; one landmark element may reach about 18 m;
  - human-scale doors and storeys.
- **No LOD1 needed** (only XL has one).
- **Budget:** 8–12k tris, ≤ 6 materials plus `Logo`.
- **Logo plates:** the front plate **1.8–2.5 m**, plus **a high plate** visible from down the avenue (on a gable, tower or roof). Side plates are optional.
- **Brand colour:**
  - one big roof element in `Tint` is allowed (signature buildings), plus cloth;
  - very dark brand colours (Frax and Balancer in later batches) use `Tint` on cloth only.
- **Clips:** `idle` (5–8 s) and `tap` (1.0–1.5 s), as in 07a.
- **Hierarchy:** root `building.protocol.<id>` > `body` > the mesh, animated nodes and logo plates; empties `door` and `sign`.

## The seven buildings

| Asset (file) | Brand | Concept at L | `idle` | `tap` |
|---|---|---|---|---|
| `building.protocol.uniswap` (`protocol.uniswap.glb`) | dex, #ff007a | **A round market hall**: a two-storey rotunda with an arcade of stalls round its foot, a conical roof (`Tint`) and a **unicorn weathervane** on top as the landmark; awnings over the stalls | the unicorn vane swings, awnings ripple | the vane spins round, the stall shutters fly up and down in a wave round the hall |
| `building.protocol.compound` (`protocol.compound.glb`) | lending, #00d395 | **A walled counting yard**: a low crenellated yard wall with a gate, inside a stout **green-roofed strongroom** tower (`Tint`) and a counting house | the yard's banner sways, a lantern swings | the strongroom's iron door swings open, coins (Trim) spill out a little and back |
| `building.protocol.curve` (`protocol.curve.glb`) | dex, #3a6bd6 | **A water mill on a curved race**: a mill house with a big undershot **wheel** in a curved stone channel (water raised above the ground, inside a rim), a sluice gate | the wheel turns slowly (separate node), water ripples along the race | the sluice gate lifts, the wheel spins faster for a moment and slows |
| `building.protocol.rocket-pool` (`protocol.rocket-pool.glb`) | staking, #ff6e30 | **A fireworks workshop**: a timber-and-stone workshop with crates of fireworks, and **a big striped rocket on a launch frame on the roof** as the landmark | a wisp of smoke from the fuse, pennants | the rocket lifts a metre off its frame with a puff and settles back, sparks hop |
| `building.protocol.fluid` (`protocol.fluid.glb`) | lending, #3f7bff | **A fountain house**: an elegant pavilion behind a **round basin** whose water spills over a tiered fountain (water raised, inside its rim) | the fountain's water sheets ripple (moving strips) | jets rise higher for a moment, a spray of drops pops up |
| `building.protocol.pendle` (`protocol.pendle.glb`) | staking, #17c3b2 | **A clockmaker's**: a tall narrow guild house with a **big pendulum clock** on the gable (face, hands and a swinging pendulum in a glazed case), gears in the shop window | the pendulum swings (separate node), the hands tick | the clock hands spin forward, a cuckoo or small bird pops out of a door above the face |
| `building.protocol.convex` (`protocol.convex.glb`) | staking, #3a3cb3 | **A lens-grinder's**: a round workshop with a **big convex glass lens** in a brass ring over the door, telescopes on the roof terrace | a telescope on the roof slowly turns | the big lens flips round once in its ring, a glint (Glow) pops |

## Delivery

As in 07a:
- **Files:** in `public/themes/medieval-castle-v2/models/building/`.
- **Renders:** into `docs/art-review/building.protocol.<id>/`.
- **Report:** checker results, triangle counts, sizes, clips and deviations.

Then stop for review.
