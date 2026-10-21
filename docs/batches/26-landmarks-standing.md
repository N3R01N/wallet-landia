# Batch 26: OpenSea, ENS and Gondi as class M landmarks (v2)

The same rules, tools and working arrangement as **[07a](07a-landmarks-xl.md)** and the M class of **[07c](07c-landmarks-m-s.md)**: read both first. Also read `docs/STYLEGUIDE_V2.md` (§3, §4–§5, §7, §8, §8.1, §8.2, §9 and **§10**). References:
- the current buildings you replace: `models/building/protocol.opensea.glb` and `protocol.ens.glb` (batch 7d, class XS), `protocol.gondi.glb` (batch 7c, class S), and their renders in `docs/art-review/building.protocol.<id>/`;
- the 7c class M landmarks (Frax, Yearn, Euler, Balancer) for finish and scale at M.

## Why

Buildings are sized by the value a protocol locks on Ethereum. That is the wrong yardstick for a marketplace, a name registry or an NFT lender: OpenSea locks almost nothing and is one of the great protocols. These three are now sized by their **standing** (10 × a year's fees, `scripts/fetch-tvl.ts`), which puts all three in **class M**. Their old models were made for the smallest plots, so they need new ones at M.

**Keep each one's idea**, grown up: the kiosk becomes a hall, the booth a guildhall, the narrow pawnshop a merchant's house.

## Class M (as 07c)

| Footprint | Height | Tris | Front logo plate |
|---|---|---|---|
| 5 × 5 m, overhangs up to 0.5 m | 8–11 m; the landmark element to about 13 m | 4–8k | 1.2 m (§8.1) |

- No LOD1. Human-scale parts: doors 2.0–2.3 m, storeys 2.4–2.7 m.
- Four finished sides (the camera turns all the way round).
- Empties and nodes as in 07a: `door`, `sign`, `logo` plates, `body` for the `tap` bounce, `tier.2/4/6` parts (§7).
- Clips `idle` and `tap` as in 07a.
- One big roof or cloth element in `Tint` (the brand colour) is allowed.

## The three buildings

| Asset (file, replaces the old one) | Brand | Concept | `idle` | `tap` |
|---|---|---|---|---|
| `building.protocol.opensea` (`protocol.opensea.glb`) | nft, #2081e2 | **The Harbour Gallery**: a two-storey timber-and-plaster gallery hall on a stone quay edge. Big arched ground-floor windows show framed pictures, and a ship's sail in `Tint` is stretched over the front as an awning. A mast with a long pennant rises from the roof ridge as the landmark (to about 13 m). Crates of framed paintings and a small hand-cart sit on the quay at the side | the sail billows gently, the pennant streams | the window shutters flip round to show new pictures (as the old kiosk's did), the sail snaps taut |
| `building.protocol.ens` (`protocol.ens.glb`) | names, #5298ff | **The Hall of Names**: a scribes' guildhall in pale stone with a `Tint` roof. Under a deep porch a giant open ledger rests on a carved lectern. The side wall is a great board of small carved name plaques (blank shapes, no text). A slim tower carries a giant quill as its weathervane (the landmark) | the ledger's pages lift and fall, the quill vane turns slowly | the pages flick through, a row of name plaques flips over, the quill spins |
| `building.protocol.gondi` (`protocol.gondi.glb`) | nft lending, #c9d94a | **The Pawnbroker's House**: a three-storey jettied merchant's townhouse. A big iron bracket over the door carries three golden balls (the landmark, kept from the old model). The ground floor has barred display windows full of curios and small framed pictures (NFTs pledged for loans). A squat stone strongroom wing at one side has an iron vault door. `Tint` awnings over the windows | the three balls sway on their chains | the balls spin, the strongroom door swings open a crack and shuts, a padlock on it jumps |

**Tier parts (§7) for all three:** `tier.2` banners or bunting (cloth clearance, §10). `tier.4` a lamp pair at the door and a richer sign. `tier.6` the landmark element gilded (`Trim`) and one extra flourish of your choosing.

## Checks (as 07a)

- Coplanar checker at rest with each tier combination, and every 0.1 s of `idle` and `tap`.
- Cloth clearance (check_cloth) for sails, banners and awnings.
- The parts that move in `tap` are never hidden inside solids (§10). Check the shutters, plaques and the vault door at their peak.
- The door's sweep stays clear of the `door` empty.

## Delivery

- Files in `public/themes/medieval-castle-v2/models/building/` under the names above, replacing the old ones.
- Renders (§9) in `docs/art-review/building.protocol.<id>/`: iso-0, iso-90, iso-180, each tier, the `tap` peak, and one render beside the old model at the same scale.
- Report: checker results, triangle counts, file sizes, materials, clips and deviations.

Then stop for review.
