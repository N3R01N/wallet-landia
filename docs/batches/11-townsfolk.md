# Batch 11: townsfolk (v2)

For the design agent. Read `docs/STYLEGUIDE_V2.md` first:
- **§6** characters;
- **§8.2** animation;
- **§10** lessons: the courier's cap and shoes rows above all.

**The reference is the v2 courier**, `public/themes/medieval-castle-v2/models/courier/base.glb`:
- its skeleton, proportions and finish;
- its renders in `docs/art-review/courier.base/` and `docs/art-review/round5/courier-feet.png`.

The townsfolk share **the courier's 16-bone skeleton**, so they stand beside him as one cast.

## How the game uses them

Every protocol building has one person. It waits inside, hidden.
1. When a courier arrives at the door, the person **steps out** (`emerge`).
2. It **takes the goods** (`receive`).
3. It **goes back in** (`return`).
4. Between those it stands at the door in `idle`.

**Where it stands:** in front of its building's door, facing out (+Z), about 1–3 m from the courier.

**Which person:** the game picks `person.npc.<category>` for the building's category, else `person.npc.base`.

**Tap:** later the game will play `tap` when a visible person is tapped, so make it now.

## Shared rules

- **Size:** 1.75 m tall, **3–3.5 heads**; head, hands and feet 1.3–1.5× oversized.
  - The feet are **one boot or shoe shape with a thin sole band** (§10). Check them from the top, side and front, and at 40 px.
  - Hats sit **on the crown**, skinned to `head`.
- **Rig:** the courier's 16-bone skeleton (the same bone names) and the same rest pose, pivot at the feet, front +Z.
- **Colour blocking:** 2–3 large areas, the main one saturated and unlike the ground and the courier (no red-orange tunic: that's the courier's).
  - One area is **`Tint`** (an apron, a sash or a hat band) in the protocol's brand colour.
  - One **identifying prop**, from the table below.
- **Budget:** about **3–4.5k tris** each (the courier is 6.3k because of its boots; aim lower), one 512 px texture, ≤ 4 materials.
- **Clips** (snappy and exaggerated, §6). All but `idle` end at rest, and **feet never below y = 0** (check the lowest point per clip).

| Clip | Length | What it shows |
|---|---|---|
| `idle` | 3–4 s, seamless | Breathing, a weight shift, a glance round, the prop used now and then |
| `emerge` | 1.0 s | Starts 1.2 m behind its rest spot (inside the door, −Z) and steps forward to rest, a small wave or nod at the end |
| `receive` | 1.0 s | Reaches forward with both hands, takes something, tucks it under an arm or into the prop, a happy nod |
| `return` | 1.0 s | Turns and steps back 1.2 m (into the door); ends turned away, hidden by the door (the game hides it after) |
| `tap` | 1.0–1.3 s | A reaction in character, from the table below |

## The cast

| Asset (file under `models/person/`) | Who | Prop | `tap` |
|---|---|---|---|
| `person.npc.base` (`npc.base.glb`) | a villager, plain clothes with an apron (`Tint`) | a basket | a cheerful wave |
| `person.npc.lending` (`npc.lending.glb`) | a banker in a long coat and a soft velvet cap, a `Tint` sash | a ledger and a quill, spectacles | adjusts the spectacles and taps the ledger |
| `person.npc.dex` (`npc.dex.glb`) | a merchant with a waistcoat and a `Tint` headscarf | a balance scale | weighs something, a thumbs-up |
| `person.npc.staking` (`npc.staking.glb`) | a farmer in a smock and a straw hat with a `Tint` band | a pitchfork or a sack | leans on the pitchfork, wipes the brow |
| `person.npc.nft` (`npc.nft.glb`) | a painter in a smock with paint spots and a `Tint` beret | a palette and a brush | a flourish with the brush |
| `person.npc.governance` (`npc.governance.glb`) | a councillor in a robe with a chain of office and a `Tint` stole | a scroll | unrolls the scroll and nods |
| `person.npc.bridge` (`npc.bridge.glb`) | a ferryman in an oilskin, boots and a `Tint` neckerchief | a coiled rope or an oar | tips the hat |
| `person.npc.other` (`npc.other.glb`) | a shopkeeper in shirt sleeves with a `Tint` apron | a broom | a quick sweep and a bow |

## Delivery

For each person:
- **renders (§9):** iso views, phone (40 px), silhouette, `walk.png` replaced by **`clips.png`** (two frames of each clip), `tap.png`, and a feet sheet (side, front, top);
- **checker results:** rest, every 0.1 s of every clip, and the lowest point per clip;
- **triangle count, size and materials.**

Then stop for review.
