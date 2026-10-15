# Batch 12: cargo, animals, props and scenery (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first: §4–§6, §8.2 and §10. References:
- the v2 courier and townsfolk (`models/courier/`, `models/person/`);
- the castle and town pieces in `public/themes/medieval-castle-v2/models/`.

**Small things, many of them:** at about 25–60 px on a phone each must read at once (silhouette and one clear colour). They are dressing: calm colours, never brighter than the buildings.

Two parts; deliver and stop after each:
- **12a:** cargo and animals.
- **12b:** props and scenery.

## 12a: cargo and animals

### `courier.cargo.t0` … `t6` (`models/courier/cargo.t<N>.glb`)
- **What it is:** the goods a courier carries, by the transaction's value tier. The game parents the model to the courier's **`hand` bone**, origin at the grip, so it hangs from or sits in the right hand while walking.
- **Look per tier:**
  - t0: a small coin pouch;
  - t1: a fat pouch;
  - t2: a bundle in cloth;
  - t3: a sack;
  - t4: a bound parcel;
  - t5: a small iron-bound chest;
  - t6: a gilded chest with a gem on the lid.
- **Size:** from 0.15 m (t0) to 0.45 m (t6). The chest is carried by its handle, so it hangs below the hand.
- **Colour:** `Trim` on the metal fittings (the tier colour).
- **Budget:** ≤ 400 tris each. No clips.
- **Check:** at the courier's walk, nothing passes through his leg. Test on `courier.base` with the `walk` clip.

### Animals (`models/animal/<name>.glb`)
- **Look:** stylised, readable and a little chunky (the same family as the people). Pivot at the feet centre, front +Z, feet never below y = 0 in any clip.
- **Colour:** dog and horse carry one `Tint` area (a collar; a saddle cloth or bridle), which the game paints in the guild's crest colour.

| Asset | Size (w × d × h) | Clips | Notes |
|---|---|---|---|
| `animal.chicken` | 0.3 × 0.4 × 0.4 | `idle` (pecks, 3 s), `walk` (0.6 s), `tap` (flaps up, clucks, 1 s) | white with a red comb |
| `animal.cat` | 0.25 × 0.6 × 0.35 | `idle` (tail flick, 4 s), `walk` (0.8 s), `sit` (loop), `tap` (arches its back, 1 s) | ginger tabby |
| `animal.dog` | 0.35 × 0.8 × 0.6 | `idle` (pants, tail wags, 3 s), `walk` (0.7 s), `tap` (sits and wags hard, 1.2 s) | brown and white, `Tint` collar |
| `animal.duck` | 0.3 × 0.45 × 0.3 | `idle` (bobs, 3 s), `swim` (paddles, 1 s), `tap` (quacks with wings up, 1 s) | floats with its waterline at y = 0.02, so its belly is underwater (the exception to the ground rule; the water tile is at 0) |
| `animal.horse` | 0.6 × 2.2 × 1.7 | `idle` (grazes, head down, ears flick, 5 s), `walk` (1.2 s), `tap` (rears a little and neighs, 1.4 s) | bay, `Tint` saddle cloth |

- **Budget:** 800–2,500 tris (horse up to 3,500), one 512 px texture each.
- **Rig:** bones or object nodes, your choice; skinned is better for the horse, the dog and the cat.

## 12b: props and scenery

| Asset (file) | Size | Notes | Clips |
|---|---|---|---|
| `prop.lamp` (`models/prop/lamp.glb`) | 0.3 × 0.3 × 2.4 | iron lantern post with a glass lantern (`Glow` inside) | `idle`: the lantern sways slightly |
| `prop.well` (`models/prop/well.glb`) | 1.4 × 1.4 × 2.2 | stone well with a little shingle roof, winch and bucket; water inside raised 0.4 m | `idle`: the bucket rope sways; `tap`: the bucket drops and winds up |
| `prop.barrel` | 0.6 × 0.6 × 0.9 | oak barrel with iron hoops | — |
| `prop.crate` | 0.7 cube | planked crate with stencilled marks (no text) | — |
| `prop.cart` | 1.2 × 2.2 × 1.2 | hand cart with two big wheels and a load of sacks, front +Z | — |
| `prop.fence.segment` | 1.0 × 0.1 × 0.9 | split-rail fence, posts at x = −0.5 only, so segments tile end to end with no doubled post (no faces at x = +0.5) | — |
| `prop.bench` | 1.4 × 0.5 × 0.8 | timber bench on stone legs | — |
| `prop.flowers` | 0.8 × 0.4 × 0.5 | a planter box with mixed flowers | `idle`: the flowers bob |
| `prop.market.stall` | 2.0 × 1.5 × 2.2 | stall with a striped awning (`Tint`), produce in crates | `idle`: the awning ripples; `tap`: the awning snaps, an apple hops |
| `scenery.tree.oak` (`models/scenery/tree.oak.glb`) | 3 × 3 × 5 | round, chunky crown in two or three clumps (closed meshes, no alpha cards), a stylised trunk | `idle`: the crown sways (slow, 6 s) |
| `scenery.tree.pine` | 2 × 2 × 6 | tiered cone crown in four stacked skirts | `idle`: slow sway |
| `scenery.rock.1` … `.3` | about 1 × 1 × 0.6 | three different boulders, mossy tops | — |
| `scenery.hill` (`models/scenery/hill.glb`) | 20 × 20 × 4 | a soft grassy hill for the backdrop behind the castle, with a few rocks and bushes; its base sinks 0.1 m below 0 | — |

- **Budgets:** props ≤ 1,000 tris; trees ≤ 1,200; the hill ≤ 1,500.
- **Repetition:** the trees repeat about 80 times round the town, so keep them light.
- **File names:** `prop.X` goes to `models/prop/X.glb`, `scenery.X` to `models/scenery/X.glb`. `prop.fence.segment` → `models/prop/fence.segment.glb`, `prop.market.stall` → `models/prop/market.stall.glb`.

## Delivery

For each part:
- renders (iso views and phone; clips for anything animated);
- checker results;
- triangle counts and sizes.

Then stop for review.
