# Wallet-landia v4: working instructions

A static, browser-only view of Ethereum wallets as a castle (the wallets) and
a town (the chain). See `docs/REDESIGN.md` for the plan, status and decisions,
`docs/ASSET_SPEC.md` for the asset contract every theme provides.

## Testing

- After every change: `npm run check` (typecheck, unit tests, the fast browser
  tests; about a minute).
- The slow browser tests (`npm run e2e:slow`: specs named `*.slow.spec.ts`,
  for picture captures and the like) only after asking the user, usually right
  before a commit. They may have more changes to batch first.
- Commits only when the user asks; end messages with the co-author line.

## Asset versions: bump them when files change

Players' devices keep a theme's files until its version changes (service
worker `public/sw.js`, cache headers `public/_headers` and `vercel.json`, `?v=`
in the file URLs). Changing a file without changing its version means players
keep the old one.

- **Changed files in `public/themes/<id>/`** (models, art): bump `version` in
  that folder's `theme.json`.
- Then run `npm run assets:versions -- write` to record it in
  `asset-versions.json`.
- `npm run check` fails (test/assetVersions.test.ts) and names what to bump if
  this was missed. When you change such files, bump and record in the same
  change, and tell the user you did.
- Changing how `public/sw.js` stores things: bump its `VERSION` so old stored
  files are dropped.
