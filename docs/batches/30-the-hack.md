# Batch 30: the hack (v2)

For the design agents. Read `docs/STYLEGUIDE_V2.md` (§4, §5, §8 and **§10**). Rules as in batches 23 and 28 for effects: opaque, transforms only, a one-shot ends at scale 0 on its last frame.

## Why

Famous castles get a story: a guided replay of what happened, beat by beat. The first one is the Poly Network exploiter (`#famous=poly-exploiter`). On 10 August 2021 he tricked Poly Network's bridge into paying out about $273M on Ethereum in 36 minutes, then talked with the world in messages written into his transactions, and over two weeks gave almost all of it back.

In the town, Poly Network is a **bridge** building (`category.bridge.*`, the harbour house). When the story reaches the hack, that building is hit: a blast, fire on the roof, smoke, rubble at its foot, and it stays damaged until the money comes back. His messages are pinned on a **notice board** in the square.

## What

### blender-b5: fire and ruin (effects, reusable on any building)

1. **`fx.blast`** (`fx/blast.glb`), one-shot `pop`, 1.6 s, about 4 × 4 × 4 m. A flash (Glow, white-yellow), an orange fireball that swells and darkens to grey smoke, a low shockwave ring along the ground, 10–14 chunks of debris (Timber and Stone shards) thrown out in arcs and falling. Origin on the ground at the centre. Everything at scale 0 on the last frame. ≤ 900 tris.
2. **`fx.fire`** (`fx/fire.glb`), loop `idle`, 1.5 s, seamless. A cluster of flames about 1 m across and 1.4 m high, made to sit on a roof ridge or a ledge: 5–7 flame tongues (Glow in orange and yellow, COLOR_0), each flickering in height and sway at its own phase, a few embers rising and fading. Origin at the base. The game places several, scaled 0.6–1.5. ≤ 400 tris.
3. **`fx.smoke.column`** (`fx/smoke.column.glb`), loop `idle`, 4 s, seamless. A leaning column of dark grey puffs (6–8 rounded blobs, matte, not Glow) rising about 6 m, each growing and drifting, recycled at the bottom. Origin at the base. ≤ 600 tris.
4. **`prop.rubble`** (`prop/rubble.glb`), no clips. Three heaps in one file as nodes `rubble.s`, `rubble.m`, `rubble.l` (about 0.8, 1.4 and 2.2 m across): broken planks, stones, a cracked roof tile or two, a little ash on top (dark Plaster). Each node's origin at its bottom centre, all at the file's origin. ≤ 300 tris per node.
5. **`fx.scorch`** (`fx/scorch.glb`), no clips. A ground mark: an irregular soot-dark disc 3 m across, 1 cm above the ground (never coplanar), with a lighter rim. One material. ≤ 120 tris.

### blender-93: the notice board, the damaged harbour house, frozen coins

6. **`prop.notice.board`** (`prop/notice.board.glb`), clips `idle` (2.5 s loop) and `pin` (0.8 s one-shot). The town crier's board in the square: two posts, a small shingled roof, a cork-and-timber board about 1.8 × 1.2 m facing +Z, 1.8 m high to the board's top. Eight paper notes on it as nodes `note.0`–`note.7` (parchment, slightly curled, a red wax seal or a nail each), **all at scale 0 at rest**. `idle`: the visible notes' corners lift a little in the wind (move only a corner sub-node, `note.N.corner`, so the game can scale `note.N` freely). `pin`: a hand-sized hammer node `hammer` taps twice at the board's centre, ending hidden (scale 0). The game scales a note to 1 when a message arrives and plays `pin`. Origin at the ground between the posts. ≤ 1,200 tris.
7. **`<asset>.ruin.glb` beside each harbour house**, as batch 29 did with `.snow`: for `models/building/category.bridge.xs|s|m|l|xl.glb`, a file `category.bridge.xs.ruin.glb` (and so on) that holds **only the damage**, in the building's own coordinates, laid on it by the game as a child:
   - holes punched through the roof with splintered rafter ends sticking up (dark, charred Timber around the holes),
   - soot streaks above windows and doors (thin dark slabs 1–2 cm off the wall, never coplanar),
   - a few roof tiles and planks lying askew on the roof and ledges,
   - a broken, hanging shutter or sign,
   - three to five **empties** named `fire.0`–`fire.4` where the game will set `fx.fire` (on the ridge and in the roof holes), and one empty `smoke` where it sets `fx.smoke.column`.
   - Budget: at most 20% of the building's triangles (and at most 1,500); materials from the building plus `Soot` (new, matte near-black). No clips. Root named like the file (`building.category.bridge.m.ruin`).
8. **`fx.ice`** (`fx/ice.glb`), no clips. A block of ice, 0.32 × 0.32 × 0.2 m, rough and faceted, pale blue and a little lighter at the edges (COLOR_0, the `Snow` family; opaque), with a hollow inside where a coin (`fx.coin`, 0.22 m) sits. Origin at the bottom centre. For the USDT that Tether froze. ≤ 200 tris.

## Checks

- Coplanar checker 0 for everything; for each `.ruin` file, with the building laid under it and with each tier part shown.
- One-shots end at scale 0; loops seamless (first and last frame equal).
- Renders in `docs/art-review/hack/`: per agent a contact sheet; for `fx.blast` a filmstrip of 8 frames; for each harbour house, the building with its ruin and `fx.fire` placed on the `fire.*` empties, from 45° above.

Report per item as you go (triangles, file sizes, empties, anything you changed and why), then stop for review. Don't change `theme.json` or game code; the game wires these by the names above.
