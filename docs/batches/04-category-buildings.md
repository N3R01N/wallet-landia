# Batches 4–6: category buildings by size class (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` fully first, especially:
- **§3** (size classes),
- **§7** (tiers as parts),
- **§8.1** (logo plates),
- **§8.2** (idle and tap),
- **§9** (delivery and checker),
- **§10** (lessons: every row is a mistake already made once).

References: the Aave building (`models/building/protocol.aave.glb`) and the castle pieces (`models/castle/`) in `public/themes/medieval-castle-v2/`, with their renders in `docs/art-review/`.

## What these are

Most protocols have no landmark building of their own. They get their **category's building**, sized by the protocol's real value: a $2M protocol gets an XS shop and a $5B one an XL hall. The game picks the model by the plot's size class and scales it ±25% to fit. **The protocol's own logo goes on the logo plates and its brand colour on the `Tint` cloth**, so one model serves hundreds of protocols. The model must look like *a* lending house, not like a particular brand.

**Seven categories × five classes = 35 models**, in three batches:
- **4a:** class **S**, 7 models;
- **4b:** class **M**, 7 models;
- **5:** classes **XS** and **L**, 14 models;
- **6:** class **XL**, 7 models.

Do one batch at a time, then stop for review.

## Shared rules

| Class | Footprint | Height | Tris | Logo plate (front) |
|---|---|---|---|---|
| XS | 2 × 2 m | 3–4 m | 1.5–3k | ≥ 0.6 m |
| S | 3 × 3 m | 5–7 m | 2–4k | ≥ 0.8 m |
| M | 5 × 5 m | 8–11 m | 4–8k | 1.2 m |
| L | 8 × 8 m | 12–16 m | 8–12k | 1.8–2.5 m, plus a high plate |
| XL | 12 × 12 m | 18–24 m (landmark to 28) | 12–20k + LOD1 | 3–4 m, plus high and side plates |

- **Orientation and empties:**
  - origin at the footprint's centre on the ground; front +Z faces the avenue;
  - `door` 1 m in front of the front wall at the door;
  - `sign` above the door, kept clear of the plates.
- **Hierarchy:** root `building.category.<cat>.<class>` (never animated) > `body` (the tap bounce) > the mesh, animated nodes, logo plates and `tier.2`, `tier.4` and `tier.6`.
- **Tiers (§7):**
  - one model for all tiers; t0 is the plain building;
  - `tier.2`, `tier.4` and `tier.6` add silhouette (examples below), each looking right with and without the parts above it;
  - `Trim` takes the tier colour.
- **Colour:**
  - `Tint` (the protocol's brand colour) **only on cloth**: an awning, banners, pennants, a hanging sign cloth. These buildings never get brand roofs;
  - roofs come from palette v2, varied by category so neighbours differ.
- **Logo plates (§8.1):** at least the front plate at the size above. L and XL also need a high plate, and XL plates on the sides.
- **Clips:**
  - `idle` (4–7 s): cloth sways, plus the category's own small motion;
  - `tap` (1.0–1.3 s): a bounce plus the category's reaction;
  - `tap` never touches the nodes `idle` moves.
- **Bigger classes** are compositions of human-scale parts (§3): more storeys, wings and towers, never a bigger door.

## The categories (the same idea at every class, growing)

| Category | Building | Growing by class | Tier parts (t2 / t4 / t6) | `idle` | `tap` |
|---|---|---|---|---|---|
| `lending` | A counting house: strongbox window with bars, a heavy door with iron studs, scales over the door | XS a counting booth → S house → M two-storey bank → L bank with a vault tower → XL bank hall with a colonnade | a bay window / a corner turret / a gilded dome | a hanging sign swings | the strongbox shutter flips, coins hop out of a chest and back |
| `dex` | A market and trading hall: open arcade, awning (`Tint`), crates, a counter | XS a stall → S shop with awning → M covered market → L trading hall with a clock → XL exchange with a big roof and a tower | a second awning / a loggia / a gilded clock cupola | awnings ripple | crates hop and swap places, the awning snaps |
| `staking` | A granary or barn: thatch or shingle roof, sacks, a hoist | XS a corn crib → S granary → M barn with a silo → L granary complex → XL a great tithe barn with silos | a dovecote / a second silo / a gilded weathervane and roof cresting | the hoist rope sways, a windvane turns | the hoist lifts a sack up and drops it back, the barn doors swing |
| `nft` | A gallery and artists' workshop: tall windows, framed pictures on easels outside, a rooftop studio skylight | XS a painter's stall → S studio → M gallery → L gallery with a glass atelier → XL museum with a rotunda | a big framed window / a skylight lantern / a gilded rotunda roof | a pennant, an easel cloth flutters | the picture frames on the facade flip round once |
| `governance` | A council house: steps, a balcony for speeches, a bell or a horn, banners | XS a notice post with a lectern → S council hut → M council hall → L hall with a belfry → XL a town hall with a tall belfry tower | a balcony / a belfry / a gilded spire | banners sway | the balcony doors open and a horn or bell swings |
| `bridge` | A harbour house: timber on stone, a crane arm, rope coils, a little jetty stub in front (raised off the ground) | XS a ferry booth → S harbour shed → M harbour house with a crane → L warehouse with two cranes → XL a guild of shippers with a lighthouse tower | a crane / a lighthouse lantern / a gilded figurehead | the crane hook sways | the crane swings round and back, a crate hops |
| `other` | A plain shop: bow window, hanging sign, flower boxes | XS a kiosk → S shop → M shop with flats above → L department house → XL arcade with a tower | a dormer / a corner tower / a gilded clock | the sign swings, flowers bob | shutters fly open, a door opens a crack |

## File names

`public/themes/medieval-castle-v2/models/building/category.<cat>.<class>.glb`, for example `category.lending.s.glb`. Renders go into `docs/art-review/building.category.<cat>.<class>/`, plus `tiers.png` (t0, t2, t4 and t6).

## Delivery

For each model, report:
- your checker results: rest, every 0.1 s of every clip, ground, tier parts shown, LOD views for XL;
- triangle count, size and materials;
- the clips;
- any deviations.

Then stop for review.
