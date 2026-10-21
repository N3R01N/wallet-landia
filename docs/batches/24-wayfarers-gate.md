# Batch 24: the Wayfarers' Gate, the road beyond, the stranger (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first: §3 (sizes), §4–§5 (surface, palette), §6 (characters), §7 (tier parts), §8 and §8.2 (technical, clips), §9 (delivery) and **§10 (lessons)**. References:
- the gatehouse and tollbooth from batch 1 (`models/castle/gatehouse.glb`, `models/castle/tollbooth.glb`): the gate should look like their country cousin;
- the townsfolk from batch 11 (`models/person/npc.*.glb`) and the courier (`models/courier/base.glb`): the stranger joins that cast;
- the path tiles from batch 18 (`models/path/tile.*.glb`) and the forest patch from batch 14.

## Why

Anything that comes into a wallet from outside the known world (a transfer from a stranger's address, an airdrop or a mint, funds bridged in from somewhere unknown) sends the courier to the far end of the avenue. Today there is nothing there: he stops at the last road tile and the coins rise out of the lawn. The world bible already has a **Town Gate for travellers** at that end, and "a hooded traveller" as the stranger.

The player should feel that **something arrived from beyond the map**: the gate opens, mist spills out of a road that leads off into the unknown, a traveller steps through and hands over the goods. Sends to strangers use the same gate the other way (the traveller takes the goods out).

## How the game uses it

- The gate stands across the avenue at its far end (the road runs **through** it along Z). Its **front (+Z) faces the town**; the outside is −Z. The game turns it to fit.
- A courier walks up to the `door` empty. The game plays `open`, the stranger plays `emerge` (from behind the doors, out of the mist) and then `give` (an arrival) or `receive` (a send to a stranger), the courier takes or hands over the goods, the stranger plays `return`, the gate plays `close`.
- At rest the doors are closed; `idle` plays all the time.
- The gate grows with how much has come in from outside: `tier.2/4/6` as in §7.
- Behind it, `scenery.road.beyond` continues the road out of the town into the haze.

## Assets

| Asset | File under `public/themes/medieval-castle-v2/models/` | Size | Look |
|---|---|---|---|
| `town.gate` | `town/gate.glb`, plus `town/gate.lod1.glb` (far copy, ≤ 30% tris) | Class M: about 6 m wide (across the road) × 4 m deep, 8–10 m tall. The opening ≥ 2.6 m wide × 3.0 m high, centred on x = 0 | A country town gate: two squat round stone towers with slate-blue conical roofs (`Roof` #3f6fa8 family), a timber-and-stone arch between them with a walkway, two big studded timber doors. A lantern on an iron bracket by the opening, a weathered signpost at the front-left with arms pointing out ("to far lands": shapes only, no text), a worn milestone. Inside the opening, behind the doors, **chunky mist puffs** (pale cool grey-white, #e6ecec → #cfd8d8, vertex colour, opaque, no alpha) fill the arch so an open gate shows fog, not the grass behind |
| `scenery.road.beyond` | `scenery/road.beyond.glb` | 3 m road (the avenue's width) running 12 m out along −Z from the gate's back, 10 m wide with its verges | The road leaving town: the same cobbles and kerb as the path tiles near the gate, turning to a dirt track, then lost in banks of mist. Low fog banks along both sides, thickening and getting taller and paler with distance, a few dark pine silhouettes half in the fog. Vertex colour fades everything towards a haze (#dfe6e4) at the far end, so it reads as "the map ends, the world goes on" from above |
| `person.npc.stranger` | `person/npc.stranger.glb` | 1.75 m, **the courier's 16-bone rig**, rest pose and pivot as in batch 11 | A hooded wayfarer: a long travelling cloak with a deep hood (main colour a dusky plum or indigo, #4b3f6b family, unlike the grass, the courier's red-orange and the townsfolk), the face in shadow but with a friendly glint (two small eyes and a nose tip catch the light), a walking staff, a satchel. One area in **`Tint`** (the cloak's lining and a scarf): the game recolours it by kind (ochre for a stranger, gold for an airdrop, sea-blue for a bridge). Props as **separate nodes** under the right hand bone, the game shows one: `prop.sack` (a tied sack of goods, shown at rest), `prop.chest` (a small open chest with a gold glint, for airdrops and mints), `prop.lantern` (a small ship's lantern in `Glow`, for bridged funds) |

### Nodes and empties on the gate

- `body` with the towers, the arch and everything that bounces on `tap`.
- `door.l`, `door.r`: the doors, **each pivoting at its hinge** (the outer edge of the opening), closed at rest. They open **outwards (towards −Z, away from the town)** so they never sweep the courier.
- Empties (§8): `door` at the road centre **1 m in front of the arch (+Z)**, where the courier stops; `npc` at the road centre 0.4 m inside the arch, where the stranger stands after `emerge`; `sign` on the signpost.
- `mist`: the mist puffs in the opening, its own node so `idle` can breathe it.
- `tier.2`: banners on both towers (`Tint`, double-sided in their own material, §10 cloth clearance). `tier.4`: an iron brazier at each side of the road with a `Glow` fire. `tier.6`: a carved crest over the arch, ivy on the towers, a small watchtower roof on one of them.
- No logo plates (the gate is no protocol's).

### Clips

| On | Clip | Length | What |
|---|---|---|---|
| gate | `idle` | 4–8 s, seamless | The lantern's flame flickers (scale/rotation), the banners sway (tier 2+), the brazier fires flicker (tier 4+), the mist puffs swell and drift a little |
| gate | `open` | 0.8 s | Both doors swing out to about 100°, ending open; the mist puffs push forward 0.5 m through the opening as they part |
| gate | `close` | 0.8 s | The reverse, ending at the rest pose |
| gate | `tap` | 1.0–1.5 s | The doors open a crack and shut again, a bounce on `body` |
| stranger | `idle` | 3–4 s, seamless | Leans on the staff, the hood turns to look round, the satchel shifts |
| stranger | `emerge` | 1.0 s | Starts 1.5 m behind its rest spot (in the mist, −Z) and walks forward to rest, a small bow at the end |
| stranger | `give` | 1.0 s | Holds the right-hand prop out with both hands at chest height, lets go, a nod (the game streams the goods from it) |
| stranger | `receive` | 1.0 s | Reaches out, takes something, tucks it into the satchel, a nod |
| stranger | `return` | 1.0 s | Turns and walks 1.5 m back into the mist; ends turned away (the game hides it) |
| stranger | `tap` | 1.0–1.3 s | Lifts the hood's brim with a finger, a mysterious nod |
| road.beyond | `idle` | 6–10 s, seamless | The fog banks drift slowly along the road |

All character clips but `idle` end at rest, feet never below y = 0 (check the lowest point per clip).

## Budgets

- `town.gate`: 4–8k tris with its tier parts, ≤ 6 materials (`Stone`, `Timber`, `Roof`, `Metal`, `Tint`, `Glow`, mist in vertex colour on `Plaster` or its own `Mist` material).
- `town.gate.lod1`: ≤ 30% of that, the doors closed, no tier parts beyond tier.2's banners.
- `scenery.road.beyond`: ≤ 1,500 tris.
- `person.npc.stranger`: 3–4.5k tris, one 512 px texture, ≤ 4 materials.

## Checks

- Coplanar checker (§9) on the gate at rest, with each tier combination, and every 0.1 s of `open`, `close` and `tap` (the doors against the arch and the mist).
- The doors' sweep stays clear of the `door` empty and the road in front (+Z).
- The opening is free from y = 0 to 3.0 m across 2.6 m (the courier and the stranger fit through).
- Cloth clearance for the banners (check_cloth).
- The stranger's feet at every 0.1 s of every clip; the props in the hand at every 0.1 s of `give` and `receive`.
- The road beyond joins the path tile at the gate's back without a seam (check_join or check_path_joins).

## Delivery

- Renders (§9) under `docs/art-review/town.gate/`, `docs/art-review/scenery.road.beyond/`, `docs/art-review/person.npc.stranger/`: the gate from iso-0, iso-90, iso-180 at rest and fully open, each tier, the far copy beside the full one; the road beyond from above at game zoom with the gate in place; the stranger in each clip (four frames) and with each of the three props.
- Checker results, triangle counts, file sizes, materials, clips, and any deviations from this brief.

Then stop for review.
