# The landing page (zenigard.cc)

The front door: `zenigard.cc` shows the landing page, `app.zenigard.cc` the game. One Vercel project serves both: `middleware.ts` sends `/` on the host `zenigard.cc` to `/landing.html` (a vercel.json rewrite cannot: the existing index.html wins), and `www.zenigard.cc` redirects to `zenigard.cc` (vercel.json). Anywhere else (the dev server, `zenigard.vercel.app`) the app is at `/` and the landing page at `/landing.html`.

## What it offers, in this order

1. **Build my castle** (the main action, in the hero): opens the app at `app.zenigard.cc/#start`. The card says what is needed (your wallet and a free Zerion key) and links to dashboard.zerion.io for the key.
2. **Walk around the demo castle**: a plain link under it, for the curious.
3. **Visit a famous castle**: picture cards (vitalik.eth, ENS DAO, XCOPY, the Poly Network story). No key needed.

Then: how it works (three steps, and what the castle shows), questions (funds, the key, cost, chains, phones), one last "Build my castle", and the footer (legal page, not financial advice, not affiliated).

Why this shape: game front pages that work lead with one clear action above the fold, show the real game, and keep the choices to two or three.

## Into the app: `#start`

The landing page asks for nothing and carries nothing over: the key is only ever typed in the app. `#start` tells the app the player came to set up their own castle (`showStart` in `src/castle/main.ts`): once the first town is in, a player with no key or no wallet yet gets the Guild tab, the cursor in the key field (with a key already saved, in the wallet field), and no tour over it. With both already saved, `#start` is just home. The hash is wiped from the address bar at once.

Old links to castles on the front page (`zenigard.cc/#famous=…`, `#visit=…`) go on to the app. Analytics on both pages drop queries and hashes.

## Files

- `landing.html`, `src/landing/main.ts`, `src/landing/landing.css`
- `public/landing/`: the pictures, taken from the running app by `npm run landing:pictures` (start `npx vite --port 5199` first). `og.jpg` is the link preview.
- `public/brand/`: the logo, its PNGs (`npm run brand`) and the Marcellus font (OFL, licence beside it).
- Tests: `test/landingAppBase.test.ts`, `e2e/landing.spec.ts`.
