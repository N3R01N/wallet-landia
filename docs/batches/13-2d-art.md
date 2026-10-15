# Batch 13: 2D art in the v2 style

For a design agent. The 3D world is now in the v2 style (`docs/STYLEGUIDE_V2.md`). The 2D art still comes from the first theme, `public/themes/medieval-castle/art/`, drawn in the old flat style. This batch redraws it to match.

Read first:
- `docs/STYLEGUIDE_V2.md` §5 (palette v2) and §7 (tiers);
- `docs/ASSET_SPEC.md` §3.7–§3.8 (names, sizes, what each one means);
- the current files in `public/themes/medieval-castle/art/` (what each one shows today).

The game shows the art on a cream UI (#f3ead6, cards #e8dcc0, borders #c9a24a, text #2b2433).

## Look

**The 2D counterpart of the 3D world:** a modern mobile strategy game's UI art, such as Rise of Kingdoms or Clash of Clans badges and icons. Rendered, not flat:
- soft volume with light from the top left;
- a clear dark outline of 2–3 px at 128 px;
- a gilded rim on badges and ranks;
- gentle gradients;
- one small highlight;
- palette v2 colours.

**Readable at 32 px:**
- one clear symbol per item;
- a silhouette that reads in grey;
- no text or letters;
- no thin details under 2 px at the target size.

**Recommended way to make them:** render each symbol in Blender as a small 3D object (shield, coin, key, ship, sheaf…) with the v2 materials, lit as in the review renders, orthographic, then composite onto the badge or rank frame. That keeps the 2D and 3D in one style. Painted SVG with gradients is also fine.

## Files

Write them to `public/themes/medieval-castle-v2/art/`, with the same sub-folders and names as the first theme. Formats:
- **Icons:** `ui/icon.<name>.svg`, 64 × 64 viewBox, **flat SVG is right for icons**: one colour #2b2433 with a gold (#c9a24a) accent, a simple shape, 3 px strokes. They sit in the tab bar next to text.
- **Badges:** `badge/<id>.svg`, a 128 × 128 viewBox. A rendered picture goes inside the SVG as an embedded 256 × 256 PNG (`<image href="data:image/png;base64,…" width="128" height="128"/>`), because the game loads badges and ranks by their `.svg` name. Keep each file under 120 KB.
  - All 27 in `art/badge/`, one symbol each.
  - The current SVGs show what each one means. Keep the meaning, redraw the look.
- **Ranks:** `rank/<id>.svg`, a 128 × 128 viewBox, embedding a 256 × 256 PNG as for badges. Six, each frame more ornate than the one before:
  - wanderer: wood;
  - squire: iron;
  - knight: steel with a sword;
  - captain: silver with a banner;
  - lord: gold with a crown;
  - legend: gold with gems and wings.
- **Frames:** `ui/frame.t0.svg` … `t6`, 256 × 64. A bottom-sheet border in the tier colours (§7: t0 timber … t6 gold), with ornament that grows by tier.
- **Effects:** `fx/<name>.png`, transparent, sizes as in ASSET_SPEC §3.7.
  - `bell.ring`, `dust`, `coins`, `splash`, `cobweb`, `refused` (a red seal over the road), `sparkle`, `rain`.
  - `rain` is a tiling 256 × 256 streak texture.
  - Soft and in the palette, no hard black.
- **App icons:** `app/icon.512.png`, `icon.192.png`, `icon.maskable.png`. The v2 keep (render it from `models/castle/keep.glb`) on a sky gradient, with the maskable variant's safe zone respected.

**Important:** a theme takes **all** its 2D art from one folder. So deliver the complete set: every file the first theme has, with exactly the same names and extensions. I then switch the v2 theme to its own art.

## Delivery

- **The files.**
- **A contact sheet** `docs/art-review/2d/sheet.png`: every item at 128 px and at 32 px, on the cream UI colour.
- **A list:** each file, its size, and what it shows.

Then stop for review.
