# Research: more realistic characters, buildings and surroundings in Three.js

*2026-10-08. Input for the theme sandbox and the character and building work. Licences and pack contents below come from vendor pages and aggregators; each pack is verified when downloaded.*

## The short version

1. **Most realism comes from lighting and materials, not polygons.** Our 3D town has no environment map, flat single-colour materials and a flat ground slab. That is why it looks like CG plastic. An HDRI environment (image-based lighting and reflections), PBR texture sets, and weathering variation are the cheapest big wins.
2. **Believable characters need skinned meshes with authored animation.** Hand-made procedural people (our sprites, or the chibi meshes I proposed) will not get there. The web-standard route is a rigged glTF, `AnimationMixer`, cross-faded idle/walk/run, and playback rate matched to speed so the feet don't slide.
3. **The key find: a complete CC0 character ecosystem on one shared skeleton.** Quaternius' *Universal Base Characters*, *Universal Animation Library* (120+ animations) and *Modular Character Outfits* all use the same 65-joint skeleton, so **no retargeting is needed**. Mounts can come from CC0 animated animal packs.
4. **Buildings need depth and wear, not just shapes.** Real buildings have thickness, eaves and overhangs, recessed windows with frames and sills, bevelled edges that catch light, trims, and dirt at the base. There are two routes: a procedural massing + façade grammar with PBR materials and trim sheets, or CC0 modular kits per theme.
5. **A theme is a bundle**: sky/HDRI and grade, terrain materials, a building style (grammar parameters or a kit), characters and outfits, mounts, props and a lexicon. This extends our existing pack system.

## Characters

| Finding | Implication for us |
|---|---|
| Skinned glTF + `AnimationMixer` + `AnimationAction` is the standard pipeline. Clips cross-fade (`crossFadeTo`, `fadeIn/fadeOut`) and blend by weight (idle ↔ walk ↔ run by speed). Additive clips (`makeClipAdditive`) layer things like waving on top. | An animation state machine: idle, walk, run, act (at buildings), mounted. Blend by the agent's speed. |
| Foot sliding happens when movement speed and clip speed don't match. | Scale `timeScale` by agent speed ÷ the clip's native speed; keep in-place clips (no root motion). |
| `SkeletonUtils.retarget/retargetClip` exist, but forum reports say results between different rigs are poor. | **Avoid retargeting.** Use characters and animations that share one skeleton. |
| **Quaternius Universal Base Characters + Universal Animation Library (120+ animations: 8-direction locomotion, emotes, combat, sitting…) + Modular Character Outfits (Fantasy: 12 outfits from 62 parts)**: CC0, glTF available, same 65-joint UE5-style skeleton, Mixamo-compatible naming. | Heroes become base character + class outfit + gear attached to hand bones (shield with crest, staff, lute, bow). Villagers use the same body with simpler outfits. |
| KayKit Adventurers: CC0, stylised, 75 animations, 25+ accessories. | An alternative character style for a "cosy" theme. |
| Quaternius LowPoly Animated Animals: CC0, includes horses, with idle/walk/run/jump/death. | Mounts: donkey and horse. Warhorse = horse + barding mesh. Griffin and dragon still need sourcing (CC0 creature packs to check) or adapting (wings added to a quadruped). |
| Mixamo animations are free to use, but redistribution of raw clips is unclear. | Avoid for a public pack. Prefer CC0. |
| Many skinned meshes are expensive (forum: 20 people / 200 skinned meshes is already slow). An `InstancedSkinnedMesh` approach exists for hundreds. | Budget: full-detail heroes (≤ 10), cheaper villagers (shared material, fewer bones or LOD, frozen animation when far), sprite impostors at a distance. |

**Procedural characters** (Pino-style bones plus generated skin weights) are possible but labour-intensive and look "toy-like". The skills repo's humanoid is a hard-surface robot (890k triangles). Its construction method (named parts, profile curves) suits **gear and props**, not skin.

## Buildings

| Technique | What it adds |
|---|---|
| **PBR texture sets** (albedo, normal, roughness, AO) from CC0 libraries: ambientCG (2,000+ materials) and Poly Haven (~780 textures). 1K–2K for the web. | Stone, timber, plaster, brick, roof tiles, metal panels, concrete and glass that respond to light. |
| **Correct texel density / real-world scale** | The most common tell of amateur scenes. One world scale (1 tile ≈ 2 m) shared by every UV. |
| **Trim sheets**: one texture of horizontal strips (cornices, frames, sills, railings) shared by many parts. | Detail at low memory cost, and consistent style. |
| **Massing → façade grammar → modules** (skills repo `procedural-architecture`; community "procedural buildings and cities" skills: hip roofs and eaves from one profile function, castles, spires) | Our boxes become buildings: storeys, recessed openings, overhangs, chimneys, porches, per-theme rules. |
| **Bevels and real thickness** | Edges catch light; walls and roofs read as solid. |
| **Weathering**: base dirt, edge wear, roughness variation, vertex AO | Breaks the clean CG look. Cheap through masks in the material. |
| **Night**: emissive interiors behind recessed windows (we already have the glow hierarchy) | Realism carries into the night views. |
| **CC0 modular kits**: Kenney Building/City kits (modern), KayKit Medieval Hexagon (200+ pieces), Quaternius Modular Sci-Fi MegaKit (270+ pieces) | A fast route to a theme. The generator assembles kit pieces instead of drawing boxes. |

## Surroundings

| Technique | Notes |
|---|---|
| **HDRI image-based lighting**: Poly Haven skies (CC0, 1K–2K for the web) through `RGBELoader`/`HDRLoader` + `PMREMGenerator`. | Sky, ambient light and reflections from one file. **Our biggest single missing piece.** One HDRI per time of day or theme. |
| **Terrain**: gentle height variation; splat material (grass/dirt/stone/path) blended by masks, slope and height; triplanar on slopes. | Replaces the flat green slab. Roads and footpaths become textures in the splat. |
| **Instanced grass with wind and LOD** (we have rooted wind); a WebGPU-compute version with a WebGL2 fallback exists. | Density falloff with distance; translucency. |
| **Varied vegetation and props**: tree models, fences, barrels, carts, flowers, lamp types per theme. | Scatter rules per district. |
| **Water** with reflections and an absorption colour (skills repo `water-optics`). | The harbour. |
| **Fog / aerial perspective** | Depth for the far views. |
| **Shadows**: CSM on WebGPU, 3 cascades × 1024 ≈ 2 ms GPU. Our town is bounded, so a single map stays fine unless we zoom very close. | |
| **Tone mapping**: AgX (less hue shift, more desaturation), ACES, Neutral (current). Always with physically consistent intensities and an envMap. | Pick per theme in the grade. |
| **Compression**: KTX2/Basis textures, meshopt/Draco geometry, lazy-loaded per theme. | Keeps a theme to a few MB. |

## The sandbox as an inspection tool (visual-validation skill)

Fixed camera bookmarks; theme switcher; animation state switcher (idle/walk/run/mounted/act); time-of-day slider; quality tiers; no-post and debug views (normals, AO, wireframe, texel density, materials); a live performance panel (FPS, draw calls, triangles, texture memory); deterministic seeds; screenshot capture.

## Decisions needed

1. **How realistic?** CC0 kits are *stylised low-poly realism* (believable proportions, simple shapes). Photorealism (Poly Haven scanned models) means heavy downloads and uncanny people. **Recommendation: stylised realism**: real lighting and materials, stylised but believable characters.
2. **Third-party CC0 assets, or all generated?** Generated rigged animated characters are the weakest option. **Recommendation:** CC0 characters, animations and animals; generated buildings and terrain (PBR textures + grammar), with CC0 kits as an alternative style per theme.
3. **Download budget per theme** (suggest ≤ 15 MB, lazy-loaded) and whether to move to WebGPU (TSL) now or later (suggest later; stay on WebGL2 + post).

## Sources
- Three.js forum: [separate glTF models and animations](https://discourse.threejs.org/t/recommended-setup-for-separate-gltf-models-and-animations/22066), [rules and standards for modelling](https://discourse.threejs.org/t/rules-and-standards-for-modeling-in-three-js/61801), [Pino procedural skeleton](https://discourse.threejs.org/t/pino-a-procedurally-generated-and-moved-skeleton-figure/36184), [fixing SkeletonUtils retargeting](https://discourse.threejs.org/t/fixing-skeletonutils-retarget-and-retargetclip-functions/65149), [CSM on WebGPU](https://discourse.threejs.org/t/cascaded-shadow-maps-csm-on-webgpu/84235)
- [InstancedSkinnedMesh for hundreds of characters](https://dev.to/sagacheng/using-instancedskinnedmesh-in-threejs-enabling-the-rendering-of-hundreds-of-3d-characters-on-screen-simultaneously-15gm), [SkeletonUtils docs](https://threejs.org/docs/pages/module-SkeletonUtils.html), [threejs animation skill notes](https://skills.sh/zocomputer/skills/threejs-animation)
- Quaternius: [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), [Universal Base Characters](https://quaternius.itch.io/universal-base-characters), [Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy), [LowPoly Animated Animals](https://quaternius.itch.io/lowpoly-animated-animals)
- KayKit: [Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), [Medieval Hexagon](https://kaylousberg.itch.io/kaykit-medieval-hexagon), [Character Animations](https://opengameart.org/content/kaykit-character-animations); Kenney: [Building Kit](https://kenney-assets.itch.io/building-kit)
- Overviews: [free rigged characters (2026)](https://app.cinevva.com/guides/free-rigged-3d-character-models), [free textures, materials and HDRIs (2026)](https://app.cinevva.com/guides/free-textures-hdris-materials), [universal characters in a browser open world](https://app.cinevva.com/de/blog/2026-05-10-open-world-browser-part-25-universal-characters), [budgeting the pretty](https://app.cinevva.com/blog/2026-02-25-open-world-browser-part-05-budgeting-the-pretty)
- Buildings and materials: [texel density and trim sheets](https://www.studiomatrx.org/students/real-time-vr-for-architecture/textures-uvs-and-real-world-scale), [procedural buildings and cities skill](https://www.skills.sh/linegel/threejs-complete-set-of-skill/threejs-procedural-buildings-and-cities), [procedural architecture skill](https://moltchat-agent-commons.onrender.com/wiki/threejs-procedural-architecture_skill_(Threejs-Awesome-Graphics-Agent-Skills))
- Lighting: [Three.js Journey: realistic render](https://threejs-journey.com/lessons/realistic-render), [lighting & PBR for photorealism](https://slicker.me/three_js/lighting_pbr.htm), [stylised nature scene with TSL](https://threejs-journey.com/lessons/webgpu-tsl/stylized-nature-scene), [procedural grass](https://skills.cat/skills/ck42bb/procedural-grass-threejs)
