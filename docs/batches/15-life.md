# Batch 15: life in the world (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` first (§6 characters, §8.2 animation, **§10 lessons**: caps, shoes, feet never below 0, nothing from nowhere). References:
- the v2 courier, townsfolk and animals: `models/courier/`, `models/person/`, `models/animal/`.

**The aim:** the world feels lived in.
- birds over the town;
- sheep and cows in the fields, deer at the forest edge, fish jumping in the moat;
- a toll keeper who takes the toll;
- villagers walking about.

The game moves them along paths and in flocks. The models only need good clips.

## Assets

| Asset (file) | Size | Clips | Notes |
|---|---|---|---|
| `person.tollkeeper` (`models/person/tollkeeper.glb`) | 1.75 m, the courier's 16-bone rig | `idle` (3–4 s: stands at the booth's counter, counts coins), `toll` (1.0 s: holds out a hand, takes a coin, drops it in the box, nods; ends at rest), `tap` (1.2 s: tips the hat), `refuse` (1.0 s: shakes the head, palm up: the game plays it when a transaction fails) | A toll keeper in a tabard with a `Tint` stripe (the guild's crest colour), a coin purse at the belt. Stands at the tollbooth's road-side window |
| **Walk clips for the townsfolk** (`models/person/npc.*.glb`, all 9 incl. base) | — | add `walk` (0.9–1.0 s, seamless, in place: the game moves them) | Same rig and style as the courier's walk, each in character (the banker stately, the farmer heavier). Feet never below 0 |
| `animal.bird` (`models/animal/bird.glb`) | 0.35 m wingspan | `fly` (0.5 s flap loop), `glide` (2 s, wings out, a slight bob), `idle` (perched, pecks) | A stylised dove or gull, white and grey, readable as a dark-edged V at 15 px. The game flocks 6–12 of them over the town |
| `animal.crow` | 0.4 m | `fly`, `glide`, `idle` | Dark, for variety; they circle the ruin and the fields |
| `animal.sheep` | 0.5 × 1.0 × 0.8 | `idle` (grazes), `walk` (0.8 s), `tap` (a hop and a baa) | Fluffy white wool lumps (closed), a dark face |
| `animal.cow` | 0.7 × 1.9 × 1.4 | `idle` (grazes, tail swish), `walk` (1.2 s), `tap` (moos, head up) | Brown and white patches, a bell on a `Tint` collar |
| `animal.deer` | 0.4 × 1.4 × 1.5 | `idle` (grazes, ears flick), `walk`, `run` (0.6 s, bounding) | Shy: the game sends it bounding into the forest when the camera comes close |
| `animal.fish` | 0.4 m | `jump` (1.2 s: leaps out of the water in an arc and back in, starting and ending below y = 0; the one model allowed below 0), plus a `splash` node (white ring and droplets) that shows at entry and exit | Silver-orange carp |
| `animal.butterfly` | 0.12 m | `fly` (0.3 s flutter) | Bright wings (3 colour variants via `Tint`, wings only) |

**Budgets:** people 3–4.5k tris; birds ≤ 400; sheep, deer and cow ≤ 1,800; fish ≤ 300; butterfly ≤ 100.

## Delivery

Per asset: renders with a `clips.png`, checker results (feet and lowest point per clip), and triangle counts. Then stop for review.
