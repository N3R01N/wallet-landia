# A world that lives: plan and tasks

Started 2026-10-22. Goal: the world feels alive, gives a reason to come back,
and has things to find. Every feature works in every future theme: what
happens is decided in code from the data; how it looks comes from the theme
(with nothing shown when a theme lacks the model).

Seven features in three code tracks that run in parallel (each in its own git
worktree), plus one asset batch for the two Blender agents. After each track:
review in the game, merge, `npm run check`.

## Track A: "While you were away" and the castle that grows

**1. While you were away**
- A1 Remember the last visit per realm and wallet set (local storage), and what the guild was then: its tiers (keep, each wallet), the latest transaction seen.
- A2 A pure summary of what happened since: couriers in and out, the net value moved by token, new protocols visited, burns, airdrops, failed ones, the biggest one. Unit tests.
- A3 A herald card on opening (only when something happened and more than an hour has passed): "While you were away (2 days): 7 couriers…", with **Watch them** (replays exactly those, quicker) and **Later**. Theme-neutral words.
- A4 Browser test: a last visit set in the past shows the card with the right count; Watch starts the replay of those errands; a fresh visit shows none.

**2. The castle grows with you**
- A5 Compare the tiers now with those of the last visit: the keep and each wallet's hall.
- A6 A growth moment for each step up: scaffolding around the piece for a moment, then a ribbon cut, a burst, the medal toast ("Your keep is now Rare"). Uses `fx.scaffold` and `fx.ribbon` (batch 28) when the theme has them, the sparkle burst otherwise.
- A7 Unit test for the tier comparison; browser test: a lower stored tier plays the growth moment.

## Track B: real events become town events

- B1 **Gas jam:** from the bell's block (base fee): high gas makes couriers queue and wait longer at the toll; the toll keeper's bubble grumbles; a low fee makes it brisk. Thresholds in one table, unit tested.
- B2 **Market festival and storm:** a big ETH rise (the existing mood `boom`) dresses the town in bunting and lanterns (`prop.bunting`, `prop.lantern.festival`) with fireworks over the keep at dusk (`fx.firework`); a crash (`crash`) brings the storm already in the sky plus shuttered stalls.
- B3 **Seasons and days:** December snow caps (`prop.snow`, on roofs where the theme supports it) and falling snow; late October pumpkins (`prop.pumpkin`); the anniversary of the guild's first transaction: fireworks and a banner. A pure calendar (`events.ts`), unit tested with fixed dates.
- B4 **Airdrop crate:** an airdrop or mint that arrived since the last visit leaves a crate at the Wayfarers' Gate (`prop.crate.airdrop`) until it is tapped (it opens, shows what came).
- B5 Browser tests for each with forced conditions (`?market=boom`, a stubbed block with a high base fee, a pinned date).

## Track C: lore, secrets and rare moments

**Lore in the NPCs**
- C1 `lore.ts`: two or three short, true lines for each signature protocol (32) and each category, written carefully (no numbers that go stale, no claims we cannot stand behind). A test that every signature protocol has lore.
- C2 Tapping a building's person: one line in four is lore (the rest stays chatter), never the same twice in a row.

**Secrets in the world**
- C3 A secrets registry (id, how it's found, a hint shown once found), kept in local storage; a "Secrets found 2 of 8" line in the Badges tab, with the found ones listed.
- C4 Secrets: tap the well three times (a coin drops in, a wish sound); the old wanderer by the ruin (`person.npc.wanderer`, batch 28) appears only for a guild whose first transaction is over five years old; historic moments in the guild's own history: a transaction in 2016 (the year of The DAO), a claim of the ENS airdrop (Nov 2021), a transaction in the block of the Merge (15537394) or the day of it: each unveils a small monument in town (`prop.monument`, the theme's) and a secret.
- C5 Tests: the registry, the history checks with fixture transactions (unit); tapping the well three times finds the secret (browser).

**Rare moments**
- C6 **Golden courier:** the courier of the guild's biggest transaction in the loaded history walks in gold, with a sparkle trail.
- C7 **Ghost courier:** a failed transaction at night walks pale and glowing (no alpha: an emissive pale material).
- C8 **Shooting star:** when a followed wallet moves (live), a star crosses the sky (`fx.shooting.star`).
- C9 Tests: which errand is the biggest, the night check (unit); a golden courier's material in the scene (browser hook).

## Track D (with A when it is merged): notifications

Wallet-landia is a static site: real Web Push needs a push server that keeps
the players' subscriptions, which we don't have (and would hold data we chose
not to keep). What works without one:
- D1 **In the background tab:** while the page is open but hidden, a new courier for your own wallets shows a notification ("A courier brought you 0.5 ETH"). Opt-in in the Guild tab (the browser asks permission only after that click).
- D2 **Installed app, Chromium:** Periodic Background Sync (about twice a day at the browser's choosing) has the service worker check each own wallet's nonce and balance through the public node (no Zerion key needed) and notify when one changed. Feature-detected; elsewhere the option says it isn't available.
- D3 Tests: the opt-in flow and the message text (unit and browser, the Notification API stubbed).

## Assets: batch 28 (the Blender agents)

| Asset | For | Agent |
|---|---|---|
| `fx.scaffold`, `fx.ribbon` | the castle grows | blender-74 |
| `prop.bunting`, `prop.lantern.festival`, `fx.firework` | festival | blender-74 |
| `prop.pumpkin`, `prop.snow` (roof snow caps for the town's buildings, a few sizes), `fx.snowfall` | seasons | blender-e0 |
| `prop.crate.airdrop` (opens on `open`) | airdrop crate | blender-e0 |
| `person.npc.wanderer` (an old cloaked wanderer with a lantern and a staff) | secret | blender-e0 |
| `prop.monument` (a small plinth with a plaque, `Logo` plate for a picture, `Tint` banner) | secrets | blender-74 |
| `fx.shooting.star` | rare moment | blender-74 |

## Order and checks

1. Tracks A, B and C start together; batch 28 starts together with them.
2. Each track: unit tests and its own browser tests in its worktree (`--workers=2`, the machine is shared), then the developer reviews it in the game, merges (squash) and runs `npm run check`.
3. Track D after A is merged (they share the last-visit state).
4. The assets land when they are checked; each feature already works without them.

## Status (2026-10-22)

All four tracks and batch 28 are built, checked in the game and merged; `npm run check` passes (525 unit tests, 67 browser tests).

| Feature | Where | State |
|---|---|---|
| While you were away | `src/castle/away.ts`, `awayCard.ts` | done |
| The castle grows | `src/castle/world/growth.ts`, `scene/growth.ts` | done |
| Real events (gas, festival, crash, seasons, anniversary, airdrop crate) | `src/castle/world/gas.ts`, `world/events.ts`, `scene/festive.ts` | done; December is weak (below) |
| Lore | `src/castle/world/lore.ts` | done; the lines checked |
| Secrets | `src/castle/world/secrets.ts`, `domain/moments.ts`, `townSecrets.ts` | done |
| Rare moments | `src/castle/world/rare.ts`, `scene/wonders.ts` | done |
| Notifications | `src/castle/notify.ts`, `notifications.ts`, `public/sw.js` | done; the installed app's background check is untested in a real browser |

Dev switches for looking at them: `?market=boom|crash`, `?date=YYYY-MM-DD`, `?hour=H`, `?demo` (the demo wallets even where captures exist), `?landmarks=all`; in the console `townSecrets.sendBiggest()`, `castleView.setGas('jammed')`.

### Open

- **December:** the snowfall works, but landmark roofs (in `Tint`) stay coloured and the ground patches read as stray clouds. Better: `snow` points on the buildings' roofs (a small asset batch) and a winter look for the grass.
- **Background check (installed app):** try it on a production build installed in Chrome (DevTools → Application → Periodic Background Sync → `wl-watch`).
- **Followed wallets** are only watched while you visit them, so the shooting star shows only then.
