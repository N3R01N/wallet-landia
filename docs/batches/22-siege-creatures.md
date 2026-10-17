# Batch 22: siege units, creatures and mounts (v2)

For the design agent. Read `docs/batches/19-siege-units-pilot.md` first: its game contract holds here too (instanced by the hundred, everything skinned to one skin, in-place clips `idle`, `walk`, `attack` with the strike at 0.4 s, `hit`, `death`, `cheer`, feet never below y = 0, `Unit` + `Tint` plus an optional small `Glow`, one 512 px texture). The reference for look and finish is the pilot and batch 21 in `models/unit/` (`militia`, `paladin.eth`, `archer.oracle`, `knight`, `paladin.staked`), plus the v2 animals in `models/animal/` (`horse.glb`, `dog.glb`).

**What's different:** these units are not people, so they **have their own skeletons** (not the courier's). The game samples whatever skeleton the file has. Keep it to **≤ 32 bones**, one skin, and still in place.

- **Walk clips are made for 1.6 m/s ground speed.** The game plays them faster for fast units, so a horse's trot at 1.6 m/s becomes a gallop-like pace at speed 2.0. Make the cycle look right at 1.6 m/s with no sliding.
- **The team `Tint`** must read from above, at 25–35% of visible pixels: a caparison, a banner, a collar, war paint on a cloth band. **No base colour near the team blue `#3f6fa8` or red `#b84a32`.**
- **Cosy, not grim:** a defeated creature topples or flops over. No gore.

## The cast

Files under `public/themes/medieval-castle-v2/models/unit/` (the name after `unit.`).

| Asset | File | Size | Based on | Who | Attack | Tint on | Budget |
|---|---|---|---|---|---|---|---|
| `unit.titan.bitcoin` | `titan.bitcoin.glb` | 3.5 m tall | new | The Bitcoin Titan (WBTC, cbBTC, tBTC): a slow iron-and-stone giant, riveted plates, glowing orange seams (`Glow`, BTC orange `#f7931a`), a ₿-shaped emboss on the chest | A two-fisted overhead slam (strike at 0.4 s), ground-shaking | A banner sash across the chest, shoulder cloths | 2,500–3,500 tris |
| `unit.golem.stone` | `golem.stone.glb` | 3.0 m | the Titan's skeleton | The Stone Golem (RWA and gold-backed): rough boulders with gold veins (`Glow` in pale gold), moss | A heavy swing of one arm | A cloth wrapped round the waist and one arm | 2,500–3,500 |
| `unit.lancer.lido` | `lancer.lido.glb` | 2.4 m to the rider's helm | `animal.horse` + the Knight | The Lido Lancer (LDO): a knight on a horse, a long lance couched; horse and rider are **one mesh and one skeleton** | A charge-thrust of the lance, the horse rearing a little | The horse's caparison (a cloth over its back and flanks) and the rider's tabard | 2,800–3,500 |
| `unit.rider.name` | `rider.name.glb` | 2.4 m | the Lancer | The Name Rider (ENS): a lighter rider on a smaller horse, with a banner pole instead of a lance and a scroll at the belt | A slash with a short sword from the saddle | Caparison and banner | 2,500–3,200 |
| `unit.pack.shiba` | `pack.shiba.glb` | 0.6 m at the shoulder | `animal.dog` | The Shiba Pack (SHIB): a cheeky shiba-inu-like dog, fox-orange and cream, a little round helmet | A lunge and a bite (a cartoon snap) | A neckerchief and the helmet's crest | 1,200–1,800 |
| `unit.swarm.frog` | `swarm.frog.glb` | 0.7 m | new | The Frog Swarm (PEPE): a round green frog warrior on its hind legs, big eyes, a little wooden spear. It **bursts** on death: a cartoon pop into a puff, then gone (the game adds the puff) | A hop-in jab with the spear | A headband with tails, a waist cloth | 1,000–1,600 |

**The Titan and the Golem** are drawn far fewer times than the small units, so their budget is higher. Make them feel heavy: slow anticipation, a big impact on the strike frame, and a `walk` with weight (the game slows it down for their speed of 0.5–0.6).

**Riders:** the rider's legs are skinned to the horse's barrel bones in the saddle, so horse and rider move as one. Check the coplanar and lowest-point rules with the horse's hooves.

## Delivery

For each unit, as in batch 19: renders (iso views; phone at 30 px for the small ones and 60 px for the Titan, Golem and riders; silhouette; `clips.png`; the crowd render in blue and red), the checker results, and the triangle count, **bone count**, size, materials and strike time. Send each when it's done; I review in batches.
