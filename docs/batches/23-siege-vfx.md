# Batch 23: siege effects (v2)

For the design agents. The battle's effects (spec: "VFX: hit sparks, detonation, siege impacts, event weather"). Read `docs/STYLEGUIDE_V2.md` §4, §8 and §10. The reference for how an effect is made and played is the existing `public/themes/medieval-castle-v2/models/fx/sparkle.burst.glb`: a small model with a one-shot `pop` clip that the game plays where it's needed, ending invisible.

## Shared rules

- **Chunky and cosy, not grim:** stylised shapes (stars, puffs, chunky stones, cartoon flames), as in a phone strategy game. No blood, no gore.
- **No alpha blending** (§4): effects are opaque shapes that grow, spin and shrink to nothing (scale to 0 at the clip's end). Use `Glow` (emissive) for bright parts; `Smoke` and `Stone` as in batch 20.
- **Animate with object transforms only** (no shape keys, no material animation): each piece a node, scaled, rotated and moved in the clip.
- **Ends invisible:** at the last frame of `pop`, every piece is at scale 0. The game removes the instance after.
- **Origin** where the effect happens, on the ground (y = 0) unless the table says otherwise; front +Z.
- **Neutral colours:** effects are seen by both armies, so no team blue or red.
- **Budgets:** small, they play many at once: ≤ 300 tris for sparks and projectiles, ≤ 1,200 for the big bursts. One material set, no textures beyond a small atlas (or flat colours in `COLOR_0`).
- Files under `public/themes/medieval-castle-v2/models/fx/`, names as in the table (the file is the name after `fx.`).

## The effects

| Asset | File | Agent | Size | Clip | What |
|---|---|---|---|---|---|
| `fx.hit.spark` | `hit.spark.glb` | blender-a4 | 0.5 m across, origin at its centre (the game puts it at chest height) | `pop` 0.35 s | A melee hit: 4–6 chunky star sparks flying out and shrinking, a quick white-yellow flash in `Glow` |
| `fx.arrow` | `arrow.glb` | blender-a4 | 0.8 m long, origin at its middle, pointing +Z | — (static; the game flies it) | An arrow: shaft, iron head, white fletching; reads at 20 px |
| `fx.bolt` | `bolt.glb` | blender-a4 | 0.4 m orb plus a 0.6 m tail along −Z, origin at the orb | `idle` 0.5 s, seamless (a spin and a pulse) | A mage's spell bolt: a glowing orb (`Glow`, pale gold) with a short swirl tail |
| `fx.puff` | `puff.glb` | blender-a4 | 0.8 m, origin on the ground | `pop` 0.6 s | A cartoon pop of white-grey puffs: the frog's burst, a unit vanishing (a Flash Loan's units) |
| `fx.detonation` | `detonation.glb` | blender-de | 2.5 m radius, origin on the ground | `pop` 1.0 s | A liquidated squad blowing up: a big cartoon "boom", an orange-yellow fireball in `Glow`, a ring of dust, coins and chunks flying out |
| `fx.siege.impact` | `siege.impact.glb` | blender-de | 3 m, origin on the ground at a wall's foot, the wall towards −Z | `pop` 1.0 s | Survivors hitting the keep: stones and dust bursting off a wall, a few chunks tumbling to the ground |
| `fx.lightning` | `lightning.glb` | blender-de | 12 m tall, origin on the ground where it strikes | `pop` 0.6 s | The Slashing event's strike on the Temple: a zig-zag bolt in `Glow` (pale blue-white), a flash ring on the ground |

## Delivery

For each: renders of four frames of its clip (iso-0) at game size and close up, the coplanar checker at every 0.1 s of the clip, the last frame confirmed empty (every piece at scale 0), triangle count, size and materials. Send each when done; I review in a batch.
