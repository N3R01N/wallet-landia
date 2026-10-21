# Batch 25: the Ember Furnace, its stoker, the burn effect (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first: §3 (sizes), §4–§5 (surface, palette), §6 (characters), §7 (tier parts), §8, §8.1 and §8.2 (technical, empties, clips), §9 (delivery) and **§10 (lessons)**. References:
- the category buildings (batch 4) and landmarks (batch 7): the furnace is a town building like them, with a door, an `npc` spot and a sign;
- the townsfolk (batch 11) and the toll keeper (batch 15): the stoker joins that cast and its rig;
- the siege effects (batch 23) and `models/fx/sparkle.burst.glb`: how a one-shot effect is made; the fire and smoke of batch 20 (keep burning state) for the flame and smoke colours.

## Why

When a token or an NFT is burned (sent to a known burn address such as `0x…0000` or `0x…dEaD`, or burned by its contract), it is gone for ever. Today it looks like any send to a stranger. The player should see **the goods destroyed**: the courier carries them to a glowing furnace, a stoker takes them with tongs and throws them into the fire, and a burst of flame and sparks shoots up the chimney.

The furnace is the opposite of the Wayfarers' Gate (batch 24): the gate means "from or to the outside, still out there"; the furnace means "gone, no way back".

**Still cosy:** a village smelter's kiln, warm and a little dramatic, not hellish. No skulls, no demonic shapes; the fire is a toy fire.

## How the game uses it

- A fixed building in the town (like the deploy camp in the Wilds): it appears once the guild has burned something. It stands on a plot beside the avenue like the other buildings, **front (+Z) to the road**.
- A courier carrying the burned goods walks to the `door` empty. The stoker plays `emerge`, then `receive` (takes the goods with the tongs), then `cast` (turns and throws them into the mouth). The game flies the goods (coins, an NFT frame) into the `mouth` empty, plays the furnace's `roar` and the effect `fx.burn` at `mouth`, and the goods vanish. The stoker plays `return`.
- It grows with how much the guild has burned in all: `tier.2/4/6` as in §7.

## Assets

| Asset | File under `public/themes/medieval-castle-v2/models/` | Size | Look |
|---|---|---|---|
| `town.furnace` | `town/furnace.glb`, plus `town/furnace.lod1.glb` (far copy, ≤ 30% tris) | Class M: 5 × 5 m footprint, 8–10 m tall with the chimney | A squat round stone kiln (darker, soot-warmed stone: #9a8c76 at the top fading to #6e6458 at the foot, coloured AO), a big round-arched **mouth** facing +Z with an iron grate and a deep `Glow` fire inside (orange to yellow, chunky cartoon flames), a tall tapering brick-and-stone chimney with an iron cap, a pair of big leather bellows on a timber frame at one side, an ash heap and a quench trough at the other, a stack of iron tongs and pokers. An iron sign on a bracket with a flame emblem cut out (no text, no logo plate) |
| `person.npc.furnace` | `person/npc.furnace.glb` | 1.75 m, **the courier's 16-bone rig**, rest pose and pivot as in batch 11 | A stoker: rolled sleeves, a thick leather apron with a **`Tint`** band, big padded gloves, a soot smudge on the cheek, goggles pushed up on the forehead, sturdy boots (§10 boot rule). Main colour a warm tan leather and a slate-grey shirt (unlike the courier's red-orange and the grass). Holds long iron **tongs** (a node under the right hand bone, `prop.tongs`) |
| `fx.burn` | `fx/burn.glb` | about 1.2 m across, 2 m tall, origin at its base (the game puts it at `mouth`) | The moment something is destroyed: a tongue of flame leaping up, 12–20 chunky embers and star sparks flying up and out, a puff of warm grey ash and smoke (#8a8580…#c9c6bf, as in batch 20) rising, all shrinking to nothing |

### Nodes and empties on the furnace

- `body` with the kiln, the chimney and everything that bounces on `tap`.
- `fire`: the flame meshes inside the mouth (its own node, for `idle` and `roar`).
- `bellows`: the bellows' moving top board, hinged at its back.
- `smoke`: two or three smoke puffs at the chimney top for `idle` (white-grey, §10) and a bigger set for `roar`.
- Empties (§8): `door` 1 m in front of the mouth, on the ground (where the courier stops); `npc` beside the mouth, 1.2 m to the courier's left, facing +Z (the stoker's rest spot; it emerges from behind the kiln's side); **`mouth`** at the centre of the fire, inside the arch (where the goods fly to and `fx.burn` plays); `sign` on the iron sign.
- `tier.2`: a cart of firewood and a second, smaller flue. `tier.4`: two iron brazier pillars at the front with `Glow` fires, a stack of slag ingots. `tier.6`: the chimney taller with a flared bell top and an iron weathervane flame, a `Tint` banner (double-sided, its own material, cloth clearance).

### Clips

| On | Clip | Length | What |
|---|---|---|---|
| furnace | `idle` | 4–6 s, seamless | The flames in the mouth flicker (scale, rotation), the bellows breathe slowly, smoke puffs rise from the chimney and shrink (looping), embers glow (brazier fires at tier 4+) |
| furnace | `roar` | 1.2 s | The burn: the bellows press down hard, the flames leap up and forward to the mouth's edge, a burst of bigger smoke puffs and sparks from the chimney top; ends at the rest pose |
| furnace | `tap` | 1.0 s | A bellows pump and a puff of flame, a bounce on `body` |
| stoker | `idle` | 3–4 s, seamless | Leans on the tongs, wipes the brow, pokes the fire now and then |
| stoker | `emerge` | 1.0 s | Starts 1.2 m behind its rest spot (behind the kiln's side, −Z) and steps forward to rest, a nod |
| stoker | `receive` | 1.0 s | Reaches out with the tongs, grips something at chest height, lifts it |
| stoker | `cast` | 1.0 s | Turns to the mouth and tosses what the tongs hold into it with a flourish, steps back from the heat, shields the face for a moment; ends at rest |
| stoker | `return` | 1.0 s | Turns and steps back 1.2 m behind the kiln's side; ends turned away (the game hides it) |
| stoker | `tap` | 1.0–1.3 s | Pushes the goggles up and gives a sooty thumbs-up |
| fx.burn | `pop` | 1.2 s | One shot as described; **every piece at scale 0 on the last frame** |

All character clips but `idle` end at rest, feet never below y = 0.

## Rules for the effect (as batch 23)

- No alpha blending; opaque shapes that grow, spin and shrink to nothing. `Glow` for the bright parts.
- Object transforms only (no shape keys, no material animation).
- ≤ 1,200 tris, flat colours in `COLOR_0` or a small atlas.

## Budgets

- `town.furnace`: 4–8k tris with its tier parts, ≤ 6 materials (`Stone`, `Timber`, `Metal`, `Cloth` for the bellows, `Tint`, `Glow`).
- `town.furnace.lod1`: ≤ 30% of that.
- `person.npc.furnace`: 3–4.5k tris, one 512 px texture, ≤ 4 materials.

## Checks

- Coplanar checker (§9) on the furnace at rest with each tier combination, and every 0.1 s of `idle`, `roar` and `tap` (the flames inside the mouth's arch, the bellows boards).
- The flames stay inside the mouth at rest and in `idle`; in `roar` they may lick past the arch but never through the stone.
- The `mouth` empty is inside the fire and reachable in a straight line from the `door` empty at chest height (the goods fly that way) without passing through the grate's bars.
- The stoker's feet at every 0.1 s of every clip; the tongs in the hand at every 0.1 s of `receive` and `cast`; the tongs' tip points at `mouth` at the release frame of `cast` when the stoker stands at `npc`.
- `fx.burn`'s last frame confirmed empty.

## Delivery

- Renders (§9) under `docs/art-review/town.furnace/`, `docs/art-review/person.npc.furnace/`, `docs/art-review/fx.burn/`: the furnace from iso-0, iso-90, iso-180 at rest and at the peak of `roar`, each tier, the far copy beside the full one; the stoker in each clip (four frames); `fx.burn` at four frames, at game size and close up.
- Checker results, triangle counts, file sizes, materials, clips, and any deviations from this brief.

Then stop for review.
