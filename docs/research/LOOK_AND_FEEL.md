# Look and feel: how modern mobile city builders look, and why

Research brief for the Wallet-landia castle-and-town redesign. Written to be turned into a styleguide for a 3D artist (Blender → glTF → three.js on phones). October 2026.

## How to read this

Every claim is tagged:

- **[S]** sourced: a developer, artist, engine vendor or GPU vendor said it. The source is numbered, see **Sources** at the end.
- **[O]** observation: what the shipped games visibly do (from screenshots and play), not confirmed by the developer. Treat it as likely, not certain.
- **[I]** inference: my recommendation or reasoning, not stated by anyone.

**An honest note on the evidence.** The big mobile studios (Supercell, Lilith, Century Games, FunPlus, TiMi, Playrix) publish almost nothing about their in-game art rules. There is no public GDC talk on the Clash of Clans or Boom Beach camera, no published triangle budget for Rise of Kingdoms. What exists: a Supercell artist interview on texturing [1], a Supercell product lead interview on the camera and pre-rendering [2], a Space Ape Games (mobile, makers of a Clash-like game and later part of Supercell) senior artist on stylised mobile 3D [3], engine and GPU vendor guidance [4][5][6], and general stylised-art practice [7][8]. Many specific numbers below are therefore **[O]** or **[I]**. They are still usable as a starting styleguide; verify them with in-engine tests on a mid-range phone.

### The one finding that changes the frame

Most of the reference games are **not real-time 3D in their base view**:

- Clash of Clans: "The game art is pre-rendered 3D" [S 2], made in 3ds Max. Hay Day, also Supercell, works the same way **[O]**.
- Rise of Kingdoms: Unity's own docs cite it as an example of the "pre-rendered 3D" technique (3D models rendered to sprites) [S 9].
- Township: Playrix says "the project's visual style is based on 2D graphics, but we actively use 3D modeling and rendering for its production" [S 10].
- Clash Royale: very likely pre-rendered sprites on an orthographic, screen-aligned board **[O / community, 11]**.
- Forge of Empires, Lords Mobile: 2D sprite cities from 3D renders **[O]**.

So the "modern smartphone game" look the owner has in mind is largely **an offline render look**: high-poly models, raytraced soft light and AO, then baked into sprites. That look is achieved at zero runtime cost because it is a picture. Real-time 3D examples with that look exist (Boom Beach, Brawl Stars, Squad Busters, Whiteout Survival, Last War, Age of Empires Mobile, SimCity BuildIt, Townscaper) **[O]**, and they close the gap by **baking light into the assets** (AO, gradients, painted highlights) and adding a cheap but well-tuned runtime light.

**Consequence for us [I]:** our spec currently says "Do not bake lighting or shadows into textures" (docs/ASSET_SPEC.md §1.1). That rule is the single biggest reason flat-shaded glTF looks "blocky and flat". It must change to "bake AO and soft gradients; let the game add the sun direction and shadows".

---

## 1. Camera

### What the genre does

| Game | Projection | Pitch (approx.) | Rotation | Notes |
|---|---|---|---|---|
| Clash of Clans | pre-rendered, orthographic look | high; "a lot higher than in similar games to make building and editing of your village as easy as possible" [S 2] | none | diamond grid, ~45° yaw **[O]** |
| Hay Day, Township, RoK, Forge, Lords Mobile | pre-rendered sprites, orthographic | ~30–40° **[O]** | none | 2D sprites forbid rotation |
| Clash Royale | orthographic, screen-aligned board | ~50–60° **[O]** | none | "2D Orthographic" [community, 11] |
| Boom Beach | real-time 3D | ~45–55° **[O]** | none | perspective, narrow FOV **[O]** |
| Brawl Stars | real-time 3D | ~60° down | none | community recreation: FOV ≈ 15°, pitch −60°, camera far away [community, 12] |
| Whiteout Survival, Last War, AoE Mobile | real-time 3D | ~40–55° **[O]** | none in city view **[O]** | perspective, narrow FOV, pinch zoom |
| SimCity BuildIt | real-time 3D | adjustable | **full 360° rotation**, pinch zoom [S 13] | "as is common with mobile games, players will be able to pinch, zoom and rotate 360 degrees" |
| Townscaper | real-time 3D, perspective | free orbit | free | a toy, not a game; you look at it from every side **[O]** |

Projection math [S 14]: true isometric pitch is 35.264°; "2:1 dimetric" (the classic pixel-art "iso") is a 30° camera tilt, yaw 45°. Our current camera offset `(18, 20, 18)` in `src/castle/scene/castleView.ts` is yaw 45°, pitch ≈ 38°, orthographic.

### Rules

1. **Perspective with a narrow FOV, not orthographic [I, consistent with O].** The real-time 3D city games use a perspective camera far away with a narrow vertical FOV (roughly 20–35°). That keeps verticals almost parallel (the "iso" read players know) but gives depth: near things a bit larger, the town recedes. Orthographic flattens; it is part of why our scene reads as a board of blocks. A narrow-FOV perspective also makes huge buildings feel huge (they grow towards the camera).
2. **Pitch 40–55° for the town view [I].** Clash's lesson: a higher camera makes the village easy to read and edit [S 2]. Lower pitch (30–35°) shows more façade and is prettier but hides what is behind tall buildings, which matters for us because big protocols will be tall. Recommended: **default pitch ~45°**, allowed range **35°–60°**, and couple pitch to zoom: zoomed in → lower (35–40°, shows façades and people); zoomed out → higher (55–60°, map-like).
3. **Rotation: allowed, but design for it [S 3 + I].** Glen Fox (Space Ape, mobile): users "can rotate scenes freely" so keep objects readable "from many angles" [S 3]. Most competitive city builders do not rotate because of sprites or because a fixed view keeps the base layout legible **[I]**. For us, real-time 3D makes rotation cheap. Recommended:
   - Yaw rotation free (two-finger twist), or snapping to 8 directions on release (45° steps) **[I]**. Snapping keeps the "designed" view angles and makes screenshot-tested views stable.
   - **Every asset has four finished sides.** No unfinished backs. The +Z front keeps the door and sign, but the back gets windows and a back door, the sides get detail.
   - **Occlusion handling:** fade or cut away buildings between the camera and a courier or the tapped building (we already fade the Chronicle tower). With tall protocol buildings this must become general **[I]**.
   - The sun must not rotate with the camera (players need a fixed light to orient), but check that no camera yaw puts everything in its own shadow: a sun from high and slightly to one side (elevation 50–60°) works from all yaws **[I]**.
4. **Zoom range [O + I].** City games allow about 3–4× zoom: closest = a single building fills ~60–70% of the screen width, farthest = the whole base. We have 0.6–3 (5×), fine. With perspective, zoom by **dolly distance** (or FOV change in a small range) and clamp so the camera never goes below the tallest building's top at close zoom.
5. **Portrait phone.** Phones are held upright; the town should extend away from the camera (depth), not sideways **[I]**. The castle in the foreground, the town receding: that layout fits portrait best with perspective.

---

## 2. Proportions and scale

### Character vs building

- Clash of Clans, Boom Beach, Hay Day: people are **oversized relative to buildings**. A troop is roughly half to a third of a mid-level town hall's height; a farmhouse door in Hay Day is barely taller than the farmer **[O]**. Buildings are **compressed**, not people shrunk: fewer storeys, wider and lower massing, oversized doors and windows **[O]**.
- Reason **[I]**: characters must read at a few dozen pixels on a phone; buildings must still fit on a small base. Real proportions (a 1.7 m person against a 10 m house) make the person a dot.

**Rules for us [I]:**

| Ratio | Real world | Mobile-game target |
|---|---|---|
| Door height / person height | ~1.2 (2.05 m / 1.7 m) | **1.1–1.3** (doors slightly bigger than people, never huge) |
| Storey height / person height | ~1.8 (3 m) | **1.3–1.5** (compressed storeys) |
| Window size | ~1 m | **~0.6–0.8× person height**, deep set, big frames |
| Small house (t0) height / person | ~4–5 | **2–2.5** |
| Ordinary building of mid importance | — | **3–5 person heights** |

The current spec (person 1.7 m, buildings 2–6 m on 2×2 m) is already compressed vertically. The problem is not the ratio; it is that there is no hierarchy above that (everything is 2×2 m) **[I]**.

### Chunkiness and roof-to-wall

- Clash: props and buildings "got more of a boxy look" [S 1]. Boxy here means chunky, heavy masses, not a single cube **[O]**: a fat stone base, a wall, a big roof, each a separate readable block.
- **Roof is large.** In Clash, Hay Day, Township, Rise of Kingdoms the roof is about **40–55% of a house's visible height** from the game camera, often with deep overhangs **[O]**. Seen from above at 40–55°, roofs take up most of the screen area of a building, so the roof is where the design and colour go **[I]**.
- **Base / plinth.** Buildings sit on a visible stone plinth or step (10–20% of height) that anchors them to the ground **[O]**.
- **Taper:** walls slightly wider at the bottom, towers that taper, roofs that flare. Nothing perfectly vertical **[O / I]**.

### Showing importance and level by size

- Clash: the Town Hall is the largest single footprint in a base (4×4 tiles vs 3×3 for most defences, 2×2 for small buildings, 1×1 walls) **[O]**. Levels add mass and ornament, but **the footprint does not change with level** (gameplay grid) **[O]**.
- Rise of Kingdoms, Whiteout Survival, Last War: the central building (City Hall / Furnace / HQ) is the landmark, roughly **2–3× the height** of ordinary buildings, positioned centrally, often with a unique silhouette (spire, chimney, tower) **[O]**.
- Landmarks get: a unique silhouette element visible at the farthest zoom (spire, dome, giant chimney, flag), more saturated accent colour, light sources (glowing windows, fire), animated parts **[O]**.

### Huge value differences: compress, then explain

Linear scaling is impossible: Aave (~$10–30 B) vs a $1 M castle is 10⁴×. Readers also systematically **underestimate** large size differences in areas; cartography's answer is to scale symbols by a power of the value, roughly value^0.5 for area, value^0.57 to compensate perception (Flannery) [S 15]. For a 3D height or a 3D volume the exponent should be smaller still **[I]**.

**Rule [I]:** map value V to a building "size" s (uniform scale of a size class), with a compressive power law:

```
s = clamp( (V / V_ref) ^ k , s_min, s_max )     k ≈ 0.2 (height) … 0.25
```

| Value | ×$1 M | s (k = 0.2) | s (k = 0.25) |
|---|---|---|---|
| $1 M | 1 | 1.0 | 1.0 |
| $100 M | 100 | 2.5 | 3.2 |
| $1 B | 1 000 | 4.0 | 5.6 |
| $10 B | 10 000 | 6.3 | 10 |

With k ≈ 0.2 a $10 B protocol is about 6× the castle's height: it clearly dwarfs it, yet it still fits on screen. Use **discrete size classes** (e.g. 5–6 models: stall, house, hall, guild hall, cathedral-scale landmark, citadel) rather than continuous scaling of one model: scaling a small house up 6× makes its doors 6× too big and the scene looks like a toy **[I]**. The artist builds each class with **human-scale details** (doors, windows, stairs stay person-sized) and more storeys, towers, wings; continuous scaling only fine-tunes within a class (±20%).

Always pair the compressed size with **the real number on tap** (and a ranking): compression makes "how much bigger" unreadable on its own **[I]**.

**Tension with the owner's wish, see §10.**

---

## 3. Shape language and silhouettes

- **Silhouette first.** Unity: "focus on large shapes and parts that contribute to the silhouette" because of small screens [S 4]. Glen Fox: "I only model in detail where it will matter and be noticeable, focusing a lot on the silhouettes of objects" [S 3].
- **Bevel everything.** "Bevel edges where possible to soften the mesh"; smoothed vertices cost nothing if there is no UV split ("2 smoothed verts are as expensive as a single split-normal vertex") [S 3]. Sharp 90° box edges with flat shading are the "blocky low-poly" look the owner dislikes **[I]**.
  - **Rule [I]:** bevel width ≈ 3–8% of the piece's smallest dimension (a 0.3 m wall gets ~1–2 cm; a 1 m stone block ~4–6 cm), 1–2 segments, **weighted or custom normals** (Blender "Weighted Normal" modifier, or "Shade Auto Smooth" with harden normals) so large faces stay flat and edges catch a highlight. Both silhouette edges and the creases between big masses get bevels.
- **Exaggerate a few features** **[O]**: thick walls, fat roof tiles, big chimneys, oversized doors and hinges, chunky window frames, roof ridges with end caps, stones at the corners (quoins) as separate bulges, slightly leaning or bulging walls.
- **Break the straight line** **[O / I]**: rooflines with a slight sag or upward flare, irregular stone courses at the corners, beams with slight bends. A perfectly straight cube reads as CAD.
- **Overhangs** **[O]**: roofs overhang 15–30% of wall height; upper storeys jut out (jettying for timber frame). Overhangs make shadows, and shadows are what make shapes read from above.
- **Detail grading** **[I]**: three levels of shape size (large: mass and roof; medium: windows, doors, chimneys, towers; small: beams, shutters, sacks, lanterns). Ratio of areas roughly 70/20/10. Small shapes cluster near the door and the focal point, with calm areas between ("breathing room around dense clusters and around focal points" [S 3]).
- **Readability test:** the squint test, "If a scene isn't reading properly when you're squinting at it, something must not be working" [S 3]. Practical test **[I]**: render every building at 64 px tall, in silhouette (black), and check it is still identifiable and distinct from its neighbours.

---

## 4. Materials and textures

### What Supercell says (Clash of Clans / Clash Royale hi-res art) [S 1]

- "We use the PBR workflow but break the PBR in many ways."
- "Keeping the albedo simple with just a couple of color variations."
- "We also tend to make materials rougher than in real life" (including metals), "to get a nicer color gradient". Roughness is the main detail channel: "By adding one or two layers just for roughness can give you that nice extra detail."
- "Subtle changes in the color and value with gradients will drive the viewer's eye."
- Curvature map for edge variation; wear placed where it would happen (corners).

### What mobile stylised artists do [S 3, 7, 8]

- Start from flat colour or a gradient, then "soft highlights on edges to suggest bevel reflections, then cavity dirt and occlusion" [S 3]. Paint "the larger/chunkier details, rather than … individual little rivets" [S 3].
- Multiply a saturated (coloured, not grey) AO into the albedo; use a top-down position gradient as a focal device [S 8].
- Gradients usually "top-down, from light to dark"; but too many gradients make the colour "dirty" [S 7].
- Per-building gradient, not a whole-city gradient [S 7].
- Unity's mobile advice: **"bake ambient occlusion and small specular highlights into the diffuse map to avoid expensive shaders"** [S 4].

### Rules for us [I unless tagged]

1. **Bake AO into the asset.** Either into vertex colour (cheap, no extra texture) or into a glTF `occlusionTexture`. AO is what makes chunky shapes read: creases under roofs, where walls meet the ground, between stones. Use a coloured AO (warm brown-purple, not black) multiplied into albedo at 40–70% strength.
2. **Top-down gradient per object**: albedo ~10–20% lighter at the top of each wall and roof than at the bottom. Ground contact darker. This is the cheapest and strongest "not flat" trick.
3. **Edge highlights**: a light, 1–3 px-at-game-size painted (or curvature-masked) highlight on convex edges, plus bevelled geometry so the runtime light also catches them.
4. **Roughness 0.6–0.9 almost everywhere** (rougher than real, per [S 1]); metals metallic 0.6–1.0 but roughness ≥ 0.4; no mirror materials. Vary roughness slightly with a mask (worn stone smoother on edges).
5. **Albedo values**: avoid pure black and pure white; keep albedo between ~sRGB 30 and 240 **[I]**. Saturated but not neon (see §5).
6. **Value contrast between horizontal and vertical surfaces**: roofs and ground must not have the same value as walls, so "walls don't merge into floors" [S 3].
7. **Texel density** [S 16 for general figures + I]: third-person games use ~512 px/m [S 16]. For a camera ~25–60 m away on a phone, **~128–256 px/m** is enough for buildings; **~256–512 px/m** for characters; ground tiles ~128 px/m tiling. Keep it **consistent** across assets [S 3]: a big landmark does not get a sharper texture per metre than a small house.
8. **Atlases**: one shared atlas per asset family (castle, town buildings, people, props), not one per model; "atlas most textures" [S 3]. Unity: POT sizes, ASTC compression, 1024 albedo with 512 roughness/metal maps as a sensible pairing [S 4]. For three.js: KTX2 / Basis (UASTC for normals, ETC1S for albedo) uses 4–8× less GPU memory than PNG/JPEG [S 6].
9. **Trim sheets** for repeating parts (stone courses, beams, roof tiles, planks) on large buildings: big landmarks would blow any unique-UV atlas budget **[I]**.
10. **Alpha sparingly**: "texture alpha is the devil" on mobile [S 3]. Leaves, banners, fences: model them or use alpha-test (mask), never alpha blend.
11. **Normal maps**: optional. Stylised mobile art often skips them and puts the detail in geometry bevels + painted light [S 3, 8]. A small tiling detail normal for stone and wood is fine if the material count stays low.

### How they avoid the "flat low-poly" look (summary)

Bevelled edges with custom normals + baked coloured AO + per-object top-down gradient + painted edge highlights + roughness variation + an environment map (see §5) + a real sun shadow. Each alone is small; together they are the difference between "flat-colour Blender blocks" and "Clash-like".

---

## 5. Colour and lighting

### Palette

- Supercell games are known for a "bright, saturated aesthetic" [S 17]. Clash/Hay Day use saturated, warm mid-tones; greens are yellow-greens, skies cyan-blue, roofs strong reds/blues **[O]**.
- "Establish the palette early … the biggest and most important task when texturing a scene"; "a small colour band for most elements and reserve accents for focal points"; "separate colour groups per building so the scene doesn't merge into one mass" [S 3].
- **Rule [I]**: 70% of screen area in muted, warm mid-tones (stone, earth, grass), 20% in each building's own colour group (roofs mostly), 10% saturated accents (banners, protocol brand colour, gold, glowing windows). Protocol brand colours belong on roofs, banners and signs: the roof is the largest surface seen from above.
- Our current palette (ASSET_SPEC §1.2) is **too grey and too dark** for the genre: stone `#a8a193`, slate roof `#3d3a40`, timber `#6b4a2b` **[I]**. Shift stone warmer and lighter (e.g. `#c9bba0`), roofs to saturated reds/blues/teals, grass to a yellow-green (`#7fae4a`-ish), keep timber warm.

### Light

- Warm key, cool shadow is the standard stylised setup; shadow colour comes mainly from the fill/ambient [S 18]. Key light warm (≈ 5500–6500 K for day), fill cooler and 30–50% of key [S 19, weak source].
- Clash/Hay Day/Township renders: a warm sun from upper left/front, soft long-ish shadows falling down-right, strong sky-blue fill, heavy contact AO **[O]**.
- Night/time of day: glowing windows and lanterns carry the scene at night; city builders mostly stay in eternal daytime with occasional events **[O]**.

### Shadows

- Pre-rendered games have raytraced soft shadows baked in **[O]**. Real-time mobile city games use one directional shadow map for buildings and blob (decal) shadows under characters **[O]**.
- three.js: shadow map 512–1024 on mobile, enable `castShadow` only on large objects, `shadow.autoUpdate = false` for static scenes [S 6]. PCFSoftShadowMap is gone in r186 (falls back to PCF), so retune bias [S 6].

### Tone mapping and grading (three.js)

- ACES Filmic in three.js lowers contrast and saturation and shifts hues (a common complaint) [S 20]. Khronos PBR Neutral is hue-preserving and only compresses highlights [S 20].
- **Rule [I]**: for an art-directed saturated palette, use **`NeutralToneMapping`** (or AgX and compensate saturation), exposure ~1.0, and grade only lightly (a slight saturation and warmth lift). Test both on a fixed set of screenshots.

---

## 6. Ground, terrain, roads, density and spacing

- Clash: a grass base on a 44×44 tile grid with the buildable area inside a border of trees and rocks; buildings occupy roughly 40–60% of the inner area in a mature base; walls and paths fill much of the rest **[O]**.
- Hay Day / Township: farms and towns with **lots of negative space**: fields, paths, open grass between building clusters; decoration (trees, flowers, fences) is player placed **[O]**.
- Rise of Kingdoms / Whiteout / Last War: a dense centre (HQ + key buildings), lower-density ring, rich decorated borders (forest, mountains, snow, water) that frame the playable area **[O]**.
- Ground is never flat colour **[O]**: grass with painted colour variation (large blotches, 2–3 hues), paths with worn edges blending into grass, small decoration scattered (rocks, flowers, tufts). Terrain usually flat in the play area with relief at the border.

**Rules for us [I]:**

1. **Spacing**: gap between buildings ≥ 0.5–1× the smaller building's footprint width; landmarks get a plaza ≥ 1× their footprint around them. Total built footprint in the town ≈ 35–50% of the area, the rest roads, plazas, gardens, trees.
2. **Clusters, not a grid**: group buildings by category (a market quarter, a banking quarter) with roads between quarters. Big protocols at the far end (they are visible from far away, act as a skyline) and on plazas; small ones near the castle.
3. **Roads**: wide main road from the drawbridge (3–4 m, carts fit), narrower lanes (1.5–2 m). Roads with curved, non-tiling edges (decals or a road mesh), not 1 m square tiles: square path tiles read as a board game.
4. **Ground texture**: one large tiling grass with a low-frequency colour variation map or vertex colour on the terrain mesh (macro variation is what kills tiling).
5. **Decoration density**: per 10×10 m of open ground, ~3–8 small props (bush, rock, flowers, barrel) and 1–2 trees; denser at borders and around landmarks, sparse on plazas. Use instancing for these.
6. **Frame the scene**: forest, hills, river or sea at the edge; no visible end of the world at max zoom.

---

## 7. Characters

- Supercell-style chibi: big heads, hands, feet; short legs. Typical stylised mobile characters are **2.5–4 heads tall** **[O]**; chibi generally 2–4 heads [S 21]. Clash troops ≈ 3–3.5 heads; Squad Busters ≈ 2–2.5 heads [O; 17 calls it chibi].
- They must read in a fraction of a second; silhouette, colour and a single prop carry the identity (Brawl Stars: role, silhouette, personality must read "almost instantly") [S 22].
- **Rules [I]:**
  - Proportion **3–3.5 heads** for couriers and townsfolk (the town is "more realistic but stylised"; 2-head chibi would be too toyish next to large buildings).
  - Oversize **hands, feet, the head and one identifying prop** (satchel, scroll, hat) ×1.3–1.5.
  - Strong colour blocking: 2–3 large colour areas, the main one saturated and distinct from the ground (no green couriers on grass).
  - A blob shadow (soft dark disc, ~1.2× body width) under each character: it anchors them more than any real shadow at this scale.
  - Polygons: 1 500–5 000 triangles is the commonly quoted mobile range [S 23, weak]; 5 000 for characters [S 8]. Our spec allows 6 000; target **2 000–3 500** with one 512 px texture (256 px is enough at our camera distance) **[I]**.
  - Animation: snappy, exaggerated, few frames of anticipation, big arm swing, a bounce in the walk; walk cycles ~0.8–1 s per cycle, 15–30 fps sampled is fine **[O / I]**. ~15–25 bones.

---

## 8. Upgrade / progression visuals

What the genre does **[O]**:

- **Same footprint, more stuff.** Clash buildings keep their grid footprint; each level adds material upgrades (wood → stone → stone with metal → dark stone with gold), more ornaments, then at high levels a new silhouette element (spire, glowing crystal, flames) and finally an idle animation or particle.
- **Material ladder**: wood/thatch → stone/slate → dressed stone + metal trim → marble/gold/glow.
- **Colour ladder**: low levels earthy, high levels saturated with signature accent (Clash: gold, then purple/dark+lava at the top).
- **Height and mass grow modestly** (≈ +10–20% per few levels), silhouette changes at milestones (every 3–5 levels).
- **Life**: high levels get animation (flags, smoke, glowing runes) and light.

Our 7 tiers (t0–t6) fit this exactly **[I]**. Milestone silhouette changes at t2, t4, t6. Note: **tier (wallet quality/size) and protocol scale are two different axes**. Protocol economic size → size class (§2). Tier → finish and ornament. Do not let both drive size, or a top-tier small protocol competes with a huge one.

---

## 9. Technical budgets on mobile

| Item | Number | Source |
|---|---|---|
| Draw calls per frame, mobile three.js | **< 100** (and < 100 000 vertices "if you can") | Don McCurdy via [S 6] |
| Pixel ratio cap | `min(devicePixelRatio, 2)` (consider 1.5 on low-end) | [S 6] |
| Shadow map | 512–1024 mobile | [S 6] |
| Dynamic lights | ≤ 3 | [S 6] |
| Texture max | ≤ 2048 except hero assets; KTX2 4–8× less VRAM | [S 6] |
| Texture pairing | 1024 albedo + 512 mask maps; POT; ASTC | [S 4] |
| LOD step | −50% triangles per LOD | [S 4] |
| Mobile asset triangles | 1 500–5 000 typical asset | [S 23, weak] |
| Characters | < 5 000 tris, 1024 textures (Blizzard-style, not mobile) | [S 8] |
| Mobile stylised castle kits | 10–3 000 polys per piece, one 1024 atlas | [S 24, store listings] |
| Frame time | 33 ms at 30 fps, 16.6 ms at 60 fps | [S 5] |
| Post-processing | half-res AO 2–4× faster; depth-aware upsampling ~1 ms | [S 25] |

**Proposed budgets for us [I]** (one scene ≈ castle + 20–40 buildings + 3–10 people + props):

| Asset | Triangles LOD0 | LOD1 | Texture |
|---|---|---|---|
| Small building (stall/house) | 1 500–3 000 | 50% | shared town atlas |
| Mid building (hall) | 3 000–6 000 | 50% | shared atlas + trim sheet |
| Landmark (multi-billion protocol) | 8 000–15 000 | 40% | trim sheets + 1 unique 1024 |
| Castle (whole, all parts) | 15 000–25 000 | — | castle atlas 2048 or 2× 1024 |
| Character | 2 000–3 500 | 1 000 | 512 (people atlas) |
| Prop / decoration | 50–500 | — | shared atlas, **instanced** |
| Total visible | ≈ 250–400 k triangles | | |

Triangles are cheap on modern phones; **draw calls and fill rate are the limit** [S 6]. So: few materials per model (2–4), shared atlases, `InstancedMesh`/`BatchedMesh` for repeats [S 6], no transparency, mipmaps on.

---

## 10. Recommendations for Wallet-landia

### 10.1 Where the owner's wishes clash with the genre or our setup

1. **"Aave must dwarf the castle"** vs genre convention: in every city builder **the player's own building is the focal hero** (largest, central, most saturated) **[O]**. Making the player's castle small next to protocols inverts that. It works if (a) the castle stays the **framed foreground hero** (camera starts on it, it is the most detailed and most saturated, it has the people and life), and (b) giant protocols act as **a distant skyline** (cathedral-like silhouettes on the horizon), not as neighbours that crush it. Linear scale is impossible (10⁴×); use compressed size classes (§2) and show the real number on tap.
2. **"More realistic"** vs readability: realistic proportions shrink people to dots and make tall buildings hide everything. Stay stylised in proportion (compressed storeys, oversized doors and people, 3–3.5-head characters); get "realistic" from materials and light (AO, gradients, roughness, soft shadows, environment reflections).
3. **Rotatable camera** vs the genre: most references do not rotate. Rotation is fine (SimCity BuildIt, Townscaper), but it costs: four finished sides per asset, occlusion fading, no "fake" one-sided detail, and the tollbooth/drawbridge path must read from all angles. Consider 45°-snapping.
4. **"No baked lighting" in our spec** contradicts how the look is made. Change it (see 10.3).
5. **Tiles of 2×2 m for every building, 1 m path tiles**: the genre has a grid, but with **multiple footprint sizes** and roads that don't look tiled. Our single 2×2 slot cannot hold a size hierarchy.
6. **Reference games are mostly pre-rendered sprites.** Expect real-time three.js on phones to reach the Boom Beach / Whiteout level, not the polished offline-render level of Clash of Clans marketing art.

### 10.2 Camera (code, `src/castle/scene/castleView.ts`) [I]

- Replace `OrthographicCamera` with `PerspectiveCamera`, **vertical FOV 28–32°** (narrow; keeps verticals nearly parallel), far plane fitted to the scene.
- Spherical rig around `#focus`: **yaw** free (default 45°, two-finger twist rotates, optional snap to 45° steps on release), **pitch** 35°–60° mapped from zoom (close → 35–40°, far → 55–60°; default 45°), **distance** = zoom (dolly), clamped.
- Keep the "fit the castle on a narrow phone" logic by solving distance from the FOV and the required width.
- Keep the sun fixed in world space as the camera rotates.
- Generalise the Chronicle tower fade to any building between the camera and the selected building or a courier.

### 10.3 Lighting and rendering (code) [I, numbers to tune by eye]

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;          // default, keep
renderer.toneMapping = THREE.NeutralToneMapping;            // or AgXToneMapping; compare
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;               // PCFSoft is gone in r186

// Fill: cool sky, warm bounce from the ground. Lower than today's 1.7.
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a6e4b, 0.8–1.2);

// Key: warm sun, high and to one side, works from every camera yaw.
const sun = new THREE.DirectionalLight(0xffe2b8, 2.5–3.5);  // elevation ~50–60°
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);                         // 2048 on desktop
// fit sun.shadow.camera tightly to the visible area; update when the camera moves far
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;    // tune
// static buildings: sun.shadow.autoUpdate = false; renderer.shadowMap.needsUpdate on change

// The step that removes the "flat" look of MeshStandardMaterial: an environment map.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3–0.6;                        // or a small sky HDR/equirect from public/env
```

- **Environment map**: without one, `MeshStandardMaterial` has no reflections at all and every face of one colour looks identical except for the diffuse falloff. A low-intensity PMREM environment gives soft sheen on bevels and roofs; this is a large visual gain for almost no cost **[I]**.
- **Shadows**: real sun shadows from buildings and the castle only (`castShadow` on buildings, not props or people); **blob shadows** (a soft transparent disc, one shared texture, instanced) under people, animals and small props.
- **AO**: bake it (vertex colour or `aoMap`) in Blender. Screen-space AO (N8AO, `halfRes: true`) only as an optional high-quality setting on desktop/high-end phones: it is a full-screen pass, and our budget on phones is fill rate [S 25].
- **Fog/atmosphere**: light, warm-blue distance fog (`THREE.Fog`, start beyond the town centre) so distant giant protocols read as "far away" and the horizon softens **[I]**.
- **Grading**: if a post chain is added, a tiny saturation (+5–10%) and warm lift; set `renderer.toneMapping = NoToneMapping` and tone-map in the last pass [S 6]. Without post-processing, do the "grade" in the palette and lights.
- **Outlines (optional)**: inverted-hull outlines, thicker on large shapes and none on small ones [S 3]. Cheap (one extra draw per outlined mesh). Only if the look calls for it; Clash-like games mostly do without **[O]**.

### 10.4 For the artist: changes to docs/ASSET_SPEC.md [I]

1. Replace "Do not bake lighting or shadows" with: **bake AO (coloured, 40–70%) and a top-down value gradient into vertex colour or the albedo; no baked directional sun or cast shadows** (the game adds them).
2. Bevel all hard edges (3–8% of the smallest dimension) with weighted normals.
3. Size classes by economic size (§2), each designed at human scale; footprints 2×2, 3×3, 4×4, 6×6, 8×8+ m.
4. Roof ≈ 40–55% of visible height, plinth 10–20%, overhangs 15–30%.
5. Doors 1.1–1.3× and storeys 1.3–1.5× person height; characters 3–3.5 heads.
6. Four finished sides (rotating camera).
7. Palette lighter, warmer and more saturated; one colour group per building; brand colour on the roof and banners.
8. Roughness 0.6–0.9, no mirror metal; consistent texel density (~128–256 px/m buildings, 256–512 px/m characters); shared atlases + trim sheets.
9. Budgets from §9; an LOD1 at 50% for anything over 3 000 triangles.
10. A readability check: each building rendered at 64 px tall from the default camera, and in silhouette.

---

## Sources

1. Adobe Substance 3D Magazine, "Supercell Helsinki: creating stylized content for Clash of Clans and Clash Royale" (Kalle Väisänen). https://www.adobe.com/products/substance3d/magazine/supercell-helsinki-creating-stylized-content-for-clash-of-clans-and-clash-royale.html
2. PocketGamer.biz, "Chart Rush: Making of Clash of Clans" (Lasse Louhento, Supercell). https://www.pocketgamer.biz/chart-rush-making-of-clash-of-clans/
3. 80.lv, "Tips on Creating Stylized 3D Content" (Glen Fox, Space Ape Games). https://80.lv/articles/tips-on-creating-stylized-3d-content
4. Unity, "Mobile game optimization tips, part 1" (art). https://unity.com/how-to/mobile-game-optimization-tips-part-1
5. Unity, "Mobile game optimization tips, part 2". https://unity.com/how-to/mobile-game-optimization-tips-part-2
6. Utsubo, "100 Three.js Tips That Actually Improve Performance (2026)" (includes Don McCurdy's mobile draw-call figure). https://www.utsubo.com/blog/threejs-best-practices-100-tips
7. 80.lv articles on stylised production and gradients: "Stylized Production: Tips and Tricks" https://80.lv/articles/stylized-production-tips-and-tricks , "Stylized take on Environment Building" https://80.lv/articles/stylized-take-on-environment-building
8. 80.lv, "Optimization of Stylized Game Assets" (Julian Elwood). https://80.lv/articles/optimization-of-stylized-game-assets
9. Unity Manual, 2D game art style reference (Rise of Kingdoms as pre-rendered 3D). https://docs.unity3d.com/Manual/2d-game-art-syle-reference.html
10. Playrix job posting, 3D Generalist (Township). https://hitmarker.net/jobs/playrix-3d-generalist-2845761
11. Unity Discussions, "What camera perspective does Clash Royale use" (community). https://discussions.unity.com/t/what-camera-perspective-does-clash-royale-use-w-image/192895
12. Godot Forum, "How to get camera perspective view like Brawl Stars?" (community). https://forum.godotengine.org/t/how-to-get-camera-perspective-view-like-brawl-stars/23689
13. GameSpot, "EA Reveals SimCity BuildIt for Android and iPhone". https://www.gamespot.com/articles/ea-reveals-simcity-buildit-for-android-and-iphone/1100-6422226/
14. Wikipedia, "Isometric video game graphics". https://en.wikipedia.org/wiki/Isometric_video_game_graphics
15. Proportional symbol scaling, Flannery exponent: tmap docs https://www.rdocumentation.org/packages/tmap/versions/4.1/topics/tm_seq ; Brewer & Campbell, Cartographic Perspectives https://cartographicperspectives.org/index.php/journal/article/download/cp28-brewer-campbell/pdf/3396
16. 80.lv, Anthony O'Donnell texel density tutorial https://80.lv/articles/anthony-o-donnell-s-new-tutorial-on-texel-density ; Polycount stylised street (~512 px/m) https://polycount.com/discussion/220137
17. Pocket Tactics, Squad Busters review. https://www.pockettactics.com/squad-busters/review
18. Polycount, lighting discussion (shadow colour from fill/ambient). https://polycount.com/discussion/comment/2781815
19. TWHL, "Lighting Theory" and related lighting guides. https://twhl.info/wiki/page/Tutorial:_Lighting_Theory_-_An_Introduction_to_Lighting_Design
20. three.js forum, "ACESFilmicToneMapping leading to low-contrast textures". https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484
21. Clip Studio Tips, chibi body ratio. https://tips.clip-studio.com/es-es/articles/4806
22. Game Developer, "Go inside the design of Supercell's Brawl Stars at GDC 2019"; GameDev.net, "Making of a Brawler". https://www.gamedeveloper.com/design/go-inside-the-design-of-supercell-s-new-hit-game-i-brawl-stars-i-at-gdc-2019- , https://gamedev.net/news/making-of-a-brawler-character-creation-for-brawl-stars-clip-3-r4113/
23. Neural4D polygon count guide (vendor, weak) https://blog.neural4d.com/user-guide/polygon-count-for-3d-game-assets/ ; Polycount character poly count thread https://polycount.com/discussion/comment/723354
24. Mobile stylised castle kits (store listings): https://leartesstudios.gumroad.com/l/mythiccastle_unity , https://berari.itch.io/low-poly-stylized-castle
25. N8AO (three.js AO) docs. https://github.com/N8python/n8ao
26. Wikipedia, Boom Beach. https://en.wikipedia.org/wiki/Boom_Beach
27. Arm, Mali best practices. https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/arm-mali-best-practices
