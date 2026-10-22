# Batch 28: a world that lives (v2)

For the design agents. Read `docs/STYLEGUIDE_V2.md` (§4–§8, §8.2 and **§10**) and the plan these serve, `docs/ENGAGEMENT.md`. Effects are made like batch 23's (`docs/batches/23-siege-vfx.md`): opaque shapes that grow, spin and shrink, object transforms only, every piece at scale 0 on the last frame of a one-shot. People as batch 11 (the courier's 16-bone rig). Files under `public/themes/medieval-castle-v2/models/` at the paths below. Cosy, chunky, readable at game zoom. Renders in `docs/art-review/<asset>/`, the checker at rest and every 0.1 s of each clip, then a report and stop for review.

## blender-74

| Asset (file) | Size | Look | Clips | Tris |
|---|---|---|---|---|
| `fx.scaffold` (`fx/scaffold.glb`) | 1 × 1 × 1 m, the game scales it to the piece it wraps | Timber scaffolding (poles, two plank decks, a ladder, cross-braces) on all four sides of a box, open in the middle; a pulley with a bucket at the top | `rise` 1.2 s: grows up from the ground deck by deck; `fall` 0.8 s: comes apart and sinks, ends at scale 0 | ≤ 1,200 |
| `fx.ribbon` (`fx/ribbon.glb`) | 2.4 m wide, posts 1.6 m | A ribbon in `Tint` across two gilded posts with a big bow in the middle | `cut` 1.0 s: the bow pops, the two halves flutter down and shrink to nothing; ends with only the posts, which then sink (scale 0 at the end) | ≤ 600 |
| `prop.bunting` (`prop/bunting.glb`) | 6 m span, 3.2 m high at the posts, sagging to 2.6 m | A string of pennants between two poles, the pennants alternating `Tint` and white | `idle` 3 s: the pennants sway | ≤ 600 |
| `prop.lantern.festival` (`prop/lantern.festival.glb`) | 0.4 m, hangs from its top | A round paper lantern, `Tint` paper over a `Glow` heart | `idle` 2.5 s: a gentle swing | ≤ 200 |
| `fx.firework` (`fx/firework.glb`) | bursts 4 m across, origin at the burst | A rocket trail rising 3 m into a chunky star burst of 16–24 pieces in `Glow` (the game tints), falling sparks | `pop` 1.6 s; scale 0 at the end | ≤ 600 |
| `prop.monument` (`prop/monument.glb`) | 1.2 × 1.2 m, 2.2 m tall | A small stone plinth with a bronze plaque (`Logo`, 0–1 UVs, for a picture) on its front and a short `Tint` banner on a pole beside it | `idle` 3 s: the banner sways; `tap` 1 s: a bounce and the banner snaps | ≤ 900 |
| `fx.shooting.star` (`fx/shooting.star.glb`) | 0.5 m star with an 8 m tail along −Z | A chunky five-pointed star in `Glow` (pale gold) with a tapering trail of small stars | `pop` 1.5 s: the tail grows then everything shrinks; scale 0 at the end (the game moves it across the sky) | ≤ 400 |

## blender-e0

| Asset (file) | Size | Look | Clips | Tris |
|---|---|---|---|---|
| `prop.pumpkin` (`prop/pumpkin.glb`) | 0.5 m | A carved pumpkin with a friendly face, a `Glow` candle inside showing through the face | `idle` 2 s: the candle flickers | ≤ 400 |
| `prop.snow` (`prop/snow.glb`) | three nodes `snow.s`, `snow.m`, `snow.l`: soft snow caps 3, 5 and 8 m across | Rounded snow cushions to lay over roofs and ground (white, a faint blue in the hollows, vertex colour); the game places and scales them | none | ≤ 300 each |
| `fx.snowfall` (`fx/snowfall.glb`) | 12 × 12 m, 8 m tall | 60–80 chunky snowflakes (little six-armed stars) | `idle` 6 s, seamless: they drift down and wrap round to the top | ≤ 1,500 |
| `prop.crate.airdrop` (`prop/crate.airdrop.glb`) | 0.8 m cube | A wooden crate with iron corners, a `Tint` ribbon tied round it and a little parachute on top (cloth in `Tint`) | `idle` 3 s: the parachute breathes; `open` 1.2 s: the lid flips open, the parachute falls away, a burst of sparkles (ends open) | ≤ 900 |
| `person.npc.wanderer` (`person/npc.wanderer.glb`) | 1.75 m, the courier's 16-bone rig | An old wanderer in a long patched cloak and a wide brimmed hat, a long white beard, a staff with a little `Glow` lantern hanging from it | `idle` 4 s (leans on the staff, the lantern sways); `tap` 1.2 s (raises the lantern, a slow nod); `emerge` 1.0 s (steps out from behind something) | 3–4.5k |
