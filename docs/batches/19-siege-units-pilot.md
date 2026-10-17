# Batch 19: siege units, the pilot (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first: **§6** characters, **§8.2** animation, **§10** lessons (the courier's cap and shoes rows above all). Background for the whole game mode: `docs/game/MAPPING.md` and the spec `docs/game/SPEC.md`.

**The reference is the v2 courier**, `public/themes/medieval-castle-v2/models/courier/base.glb`, and the townsfolk in `models/person/` (batch 11): their skeleton, proportions and finish. Units are the same cast in arms, so they must look like they live in this town. **Cosy and toy-like, not grim:** no blood, no gore; a defeated unit topples over and that's all.

## What the game does with them

A new game mode turns the wallet into an army: each token is a squad of little soldiers that march down the town's avenue and fight the enemy's squads, then hit the enemy keep.

- **Many at once:** up to 600 units on screen, drawn as one instanced mesh per unit type. The game samples every clip's **bone matrices** into a texture at load and skins all instances on the GPU. So:
  - **everything moves by bones**: weapons, shields and props are **skinned rigidly to a bone** (weight 1.0 to `hand.R`, `hand.L` or `spine`…), no object animation, no shape keys, no separate animated nodes;
  - **one skinned mesh per file** (one skin), and the clips must be **in place** (no root travel: the game moves the units). The lowest point of every clip stays at y ≥ 0 except `death`, which ends lying on the ground (y ≥ 0 still).
- **Seen small and from above:** a unit is about **20–45 px** tall on a phone, in a crowd. The silhouette and the weapon must say "spearman" or "archer" at 30 px.
- **Team colour:** `Tint` is the army's colour (blue for you, red for the enemy). Put it on large cloth areas: a tabard or surcoat and a shoulder cape or helmet plume, about **25–35% of the visible surface**, so two armies mixed in a melee read apart. Everything else in the unit's own palette.

## Shared rules

- **Size:** 1.75 m, 3–3.5 heads, head, hands and feet 1.3–1.5× (§6). Feet are one boot shape with a thin sole band (§10).
- **Rig:** the courier's skeleton (the same bone names, the same rest pose), pivot at the feet, front +Z.
- **Budget (tighter than townsfolk, they are instanced by the hundred):** **1,500–2,200 tris** including the weapon, **one 512 px texture**, **two materials only**: `Unit` (everything) and `Tint` (team cloth, light greyscale texture 86–96% white, §1).
- **Bevel and bake** as §4: coloured AO and the top-down gradient in `COLOR_0`. Soft rounded forms.

## Clips (all in place, 30 fps)

| Clip | Length | Loop | What it shows |
|---|---|---|---|
| `idle` | 2–3 s | seamless | Ready stance, weapon held, a breath and a shift of weight |
| `walk` | 0.8–1.0 s | seamless | A brisk **march**, a bounce, weapon carried; the feet plant (no sliding at a walk speed of 1.6 m/s for 1.0 speed units) |
| `attack` | **1.0 s** | seamless (the game loops it: units hit once a second) | Wind-up, strike (or release) at **0.4 s**, recover; exaggerated and readable at 30 px |
| `hit` | 0.3 s | one-shot, ends at rest | A small flinch backwards |
| `death` | 1.0 s | one-shot, holds the last frame | Topples over sideways or backwards with a little bounce, ends lying flat |
| `cheer` | 1.5 s | seamless | Weapon raised, a hop: victory and a captured building |

Name the strike time in the delivery note (the game times hit sparks to it).

## The pilot cast

These three set the look, the clips and the budget for the other fifteen units. Build them one after another and stop after the first (Militia) for a quick look, then do the other two.

| Asset | File under `public/themes/medieval-castle-v2/models/unit/` | Who | Kit | `Tint` on |
|---|---|---|---|---|
| `unit.militia` | `militia.glb` | A villager called to arms (based on `person.npc.base`): padded jerkin, leather cap on the crown | A pitchfork held like a spear; attack is a two-handed jab | A sash and the cap's band, a short tabard |
| `unit.paladin.eth` | `paladin.eth.glb` | The Ether Paladin: a stout knight in rounded silver-blue plate (`#8fa3c8` base, steel highlights), open helm with a crest | A short sword and a round shield bearing the **ETH diamond** (an embossed shape, not a logo plate); attack is a sword chop behind the shield | Surcoat, helmet crest |
| `unit.archer.oracle` | `archer.oracle.glb` | The Oracle Archer (Chainlink): a lean hooded archer, leather and dark blue (`#2a5ada` accents) | A longbow and a quiver; attack is draw and release at 0.4 s (the arrow is the game's) | Hood lining, short cape |

## Delivery

For each unit:
- **renders (§9):** iso views, phone at **30 px** (not 40), silhouette, `clips.png` (two frames of each clip), and a **crowd render**: 12 copies in a loose group, six with `Tint` blue `#3f6fa8`, six red `#b84a32`, at phone size;
- **checker results:** coplanar pairs at rest and every 0.1 s of every clip, the lowest point per clip, and **confirm every vertex is skinned** (no unweighted vertex, max 4 influences);
- **triangle count, bone count, file size, materials**, and the `attack` strike time.

Then stop for review.
