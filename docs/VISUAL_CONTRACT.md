# 3D visual contract

Written before tuning, as the `threejs-visual-validation` skill asks (from [threejs-awesome-graphics-agent-skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills), MIT). Every invariant here can be checked in a capture.

## Subject
A cosy fantasy diorama of a town built from Ethereum wallets: low-poly buildings in protocol brand colours, pixel-art people as billboards (HD-2D), a living street at day and night.

## Identity (what must survive every change)
- Buildings read as **archetypes** (bank, temple, bazaar, tower…) from silhouette alone, roof colour = protocol brand.
- Characters stay **pixel-crisp** (nearest filtering) and face the direction they walk *on screen*, including while orbiting.
- The **Chronicle Tower** is the tallest landmark; its bell visibly swings on every block.

## Camera envelope (bookmarks: `?cam=near|design|far`)
| Bookmark | Distance | Must read |
|---|---|---|
| near | 16 | sprites, signs and logos, grass blades, window frames |
| design | ~52 (fit) | every building and district label, heroes with name tags, lamps |
| far | 110 | district layout, the tower, day/night state |

## Lighting envelope (`?hour=12` / `?hour=22`)
- **Day:** a warm sun from the south-west with soft shadows. Lit surfaces stay below the bloom threshold, so nothing blooms by day except fire.
- **Night:** a dim moonlit fill. Emissive hierarchy: **fire > lamp bulbs > windows > lit surfaces**. Lamps cast warm pools on the ground, and billboards are tinted to the night.
- **Storm (siege):** darker sky, stronger wind, brief lightning.

## Invariants
1. **No-post baseline reads:** with `?debug=nopost`, the town, the night windows and the lamps are all visible. Bloom only adds glow; it is never the only signal.
2. **Tone mapping happens once:** the scene renders into a half-float target, and `OutputPass` (Neutral) is the only tone-map and sRGB stage. The `low` tier renders straight to screen, where the renderer tone-maps once instead.
3. **Ambient occlusion never sees billboards:** sprites, contact shadows and lamp pools are hidden from the GTAO pass and always restored (try/finally).
4. **Wind is rooted:** foliage bends with height above the ground. Roots and trunks never move. Shadows sway with the foliage (patched depth material).
5. **The bell comes to rest exactly** after each swing (terminal lock, not endless residual motion).
6. **Camera moves are frame-rate independent:** one exponential damping stage toward a goal, while user input applies immediately.
7. **Logos hide behind buildings:** they are drawn on the 2D overlay (no CORS for WebGL), so a ray test every 10 frames hides the ones that are occluded.
8. **Deterministic placement:** lamps, grass, trees and buildings come from seeded generators, so the same town always gets the same scenery.

## Quality tiers (they change the mechanism, not a label)
| Tier | Pipeline | Shadows | Pixel ratio |
|---|---|---|---|
| low | direct render, no post | 1024² | 1 |
| medium (default) | HDR → bloom → output → grade | 2048² | ≤2 |
| high | + GTAO before bloom | 2048² | ≤2 |

## Debug views
`?debug=final|nopost|ao|nograde` · `?hour=0–24` · `?freeze` (pause the replay) · `?cam=near|design|far`

## Known compromises
- Bloom is threshold-based, not a selective layer pass: one render, cheap, and calibrated so only emissives cross the threshold.
- Logo occlusion is tested at the sign centre, every 10 frames.
- Wind moves foliage vertices, but the shadow lookup on the receiving side uses the unbent position (small mismatch, not visible at diorama scale).
- Billboard sprites cast no real shadow map shadow; they use contact-shadow discs instead.
