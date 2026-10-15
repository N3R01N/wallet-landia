# Batch 14: the world around the town, and the sky (v2)

For a design agent. Read `docs/STYLEGUIDE_V2.md` first (§4–§6, §8.2 and **§10 lessons**). References:
- the v2 trees, rocks and hill in `models/scenery/`;
- the castle and town pieces in `public/themes/medieval-castle-v2/models/`.

**Why:** zoomed out, the castle and town sit in a flat green sheet with three hills behind and a band of trees. It should feel like a real game world: varied land with a story, things to discover at the edges, and weather you can see.

The camera looks down at 25–75° and zooms out to show about 75 m across, so the world beyond the town is seen from above at a distance. Everything here is **background**:
- calm colours, a little cooler and lighter with distance (aerial perspective is the game's job, but keep the palette slightly desaturated);
- **cheap**: many of these repeat, so stay at low triangle counts.

## Assets (`models/scenery/<name>.glb` unless noted)

| Asset | Size (w × d × h) | Look | Clips | Tris |
|---|---|---|---|---|
| `scenery.mountain.1`, `.2`, `.3` | 40–70 m across, 18–35 m high | Stylised rocky mountains with grass skirts and snow caps on the tallest; layered ledges, a few pines on the slopes. Three distinct silhouettes so a ridge of them never repeats. Base sinks 0.5 m below 0 | — | ≤ 2,500 |
| `scenery.forest.patch` | 12 × 12 m, 7 m | A dense clump of 12–18 oaks and pines merged into one mesh (crowns as closed lumps, trunks only at the edge), dark undergrowth. Replaces rows of single trees at a distance | `idle`: slow sway of the whole crown mass | ≤ 3,000 |
| `scenery.field.wheat`, `scenery.field.crops` | 10 × 8 m, 0.8 m | Farm fields with rows: golden wheat with a few poppies; green and brown vegetable rows. A low timber or stone edge | wheat `idle`: a wind wave rolling across | ≤ 1,200 |
| `scenery.farmhouse` | 6 × 5 m, 6 m | A farmstead: house, small barn, hay stack, fence and gate | `idle`: chimney smoke (white, §10) | ≤ 3,000 |
| `scenery.windmill` | 5 × 5 m, 11 m | A stone tower windmill with four lattice sails | `idle`: the sails turn (one turn per 8 s, seamless) | ≤ 2,500 |
| `scenery.river.straight`, `scenery.river.bend` | 6 m wide × 6 m long tiles (the bend turns 90° within a 6 × 6 tile) | A river with grassy, stony banks; water surface at y = 0.02, banks rising to 0.3. Tiles join end to end and through the bend | `idle`: ripples drift along (texture or ripple strips moving one period per loop) | ≤ 600 |
| `scenery.bridge.stone` | 4 × 8 m, 3 m | An arched stone bridge over the 6 m river, the road running over it | — | ≤ 1,500 |
| `scenery.ruin` | 6 × 6 m, 8 m | An old broken watchtower on a rise, ivy, fallen stones | — | ≤ 2,000 |
| `scenery.camp` | 5 × 5 m, 3 m | Travellers' camp: two tents, a cart and a campfire | `idle`: the fire flickers (a flame mesh scaling), white smoke | ≤ 1,500 |
| `scenery.meadow` | 8 × 8 m, 0.4 m | A patch of wild flowers and tall grass tufts (closed meshes), to break up the green | `idle`: gentle sway | ≤ 800 |
| `scenery.lake` | 16 × 12 m | A small lake with reed edges, lily pads and a little jetty; water at 0.02 | `idle`: ripples | ≤ 1,200 |
| `scenery.cloud.1`, `.2`, `.3` | 8–14 m long, 3–5 m tall | Soft stylised cumulus clouds: puffy lobes, white with a slightly blue-grey underside (vertex colour), no texture. The game floats them about 25 m up, so they drift across and cast soft shadows | — | ≤ 600 |
| `scenery.cloud.rain` | 14 m long | A darker grey storm cloud | — | ≤ 600 |

**General rules:**
- closed meshes, single-sided (§8);
- no faces at y = 0 except where noted (water at 0.02);
- the §10 lessons: white smoke, no holes, nothing from nowhere;
- `Tint` not used.

## Delivery

Per asset:
- the renders (iso views and phone, plus clips);
- checker results;
- triangle counts.

Plus `docs/art-review/world/scene.png`: a 120 × 120 m arrangement as the game might lay it out (mountains behind, river, fields and farm, windmill, forests, lake, ruin, camp, clouds above), seen from the game camera zoomed out.

Then stop for review.
