# Going public: plan, decisions and status

Turning Zenigard (zenigard.cc) into a public site: 100 daily players within a month of
launch, more later. Research and interview on 2026-10-21.

## Decisions (2026-10-21)

- **The operator lives in Austria.** §25 MedienG disclosure applies to every
  website; a small one needs name, place of residence and purpose.
- **Donations only, for now.** Vercel Hobby is non-commercial only (ads, sales,
  affiliate links need Pro); donations are allowed.
- **Players keep bringing their own Zerion key.** Besides costing the site
  nothing, this is a privacy choice: with the player's own key, which wallets a
  player looks up and how they connect stay between the player and Zerion. The
  site holds no key of its own, so it has no list of lookups to count, cache or
  keep; the proxy (`api/zerion.ts`) only forwards a request because Zerion
  refuses browsers that aren't on localhost, and logs or stores nothing. A
  site-held key would mean the server sees, meters and is responsible for
  every player's wallets. Open question: Zerion's API license does not clearly
  cover end users with their own keys; ask Zerion before a big launch.
- **Budget under €25 a month.** Hobby while small. Before any launch push, move
  to Vercel Pro ($20, flat-rate CDN with 1 TB) or Cloudflare Pages (the
  `public/_headers` file already works there; `api/` would need porting to
  Workers): over a limit, Hobby pauses the whole site.

## Status

| Step | State |
|---|---|
| Legal page (`legal.html`) and the Guild tab's About box | **Shelved, not live-ready**: see below |
| Famous castles: snapshots of public wallets, no key needed (`npm run famous`, list in `scripts/famous.json`, files in `public/famous/`, links `#famous=<slug>`). Snapshots keep positions worth $1 or more (vitalik.eth: 5.4 MB → 1 MB). Zerion refuses some old wallets as "untrackable" (the Ethereum Foundation's) | Done: vitalik, ens-dao, xcopy (2026-10-21). Refresh with `npm run famous` |
| "Get a free key in about a minute" guide in the Guild tab, with why your own key is private | Done |
| Zerion's day limit: was fixed at 300 (cut players off with 1,700 of 2,000 left); now read from `RateLimit-Org-Day-Limit` | Done |
| Share cards (Open Graph tags, a picture of the castle) | Later |
| Smaller first load (the default theme is ~22 MB built) | Later |
| Rate limits and CDN caching on `/api/*` | Later |
| Error monitoring, a no-WebGL fallback screen | Later |

## Missing: the legal page (shelved 2026-10-21)

`legal.html` is written (site owner, disclaimer, privacy, terms) and linked from
the Guild tab, but it is **not ready to go live**:

- The operator's full name, town and contact email are placeholders
  (`[YOUR FULL NAME]`, `[YOUR TOWN]`, `[YOUR CONTACT EMAIL]`, marked
  `data-operator` in the page). §25 MedienG requires name and place of
  residence; leaving them out can be fined up to €20,000.
- The text needs the operator's read-through; it describes what the code does
  as of 2026-10-21 and is not legal advice. When the data flows change (a new
  host, analytics, a server-held key), the privacy section changes with them.
