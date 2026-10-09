# Wallet-landia v4: working instructions

A static, browser-only RPG view of Ethereum wallets. See `docs/PLAN.md` for
status and design, `docs/PACKS.md` for the theme/pack format.

## Testing

- After every change: `npm run check` (typecheck, unit tests, the fast browser
  tests; about a minute).
- The slow browser tests (`npm run e2e:slow`: themed 3D towns, the look
  sandbox, visual captures; about 5 minutes) only after asking the user, usually
  right before a commit. They may have more changes to batch first.
- Commits only when the user asks; end messages with the co-author line.

## Asset versions: bump them when files change

Players' devices keep theme, pack and sky files until their version changes
(service worker `public/sw.js`, cache headers `public/_headers`, `?v=` in the
file URLs). Changing a file without changing its version means players keep
the old one.

- **Changed files in `public/themes/<id>/` or `public/packs/<id>/`**
  (textures, models, animations, art): bump `version` in that folder's
  `pack.json`.
- **Changed sky images in `public/env/`**: bump `SKY_VERSION` in
  `src/render/three/environment.ts`.
- Then run `npm run assets:versions -- write` to record it in
  `asset-versions.json`.
- `npm run check` fails (test/assetVersions.test.ts) and names what to bump if
  this was missed. When you change such files, bump and record in the same
  change, and tell the user you did.
- Changing only `pack.json` data (no files) needs no bump: it is fetched fresh.
- Changing how `public/sw.js` stores things: bump its `VERSION` so old stored
  files are dropped.
