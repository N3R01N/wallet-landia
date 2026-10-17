# Batch 21: siege units, the humanoids (v2)

For the design agent. **Everything in batch 19 applies** (`docs/batches/19-siege-units-pilot.md`): the rig, the in-place clips (`idle`, `walk`, `attack` with the strike at 0.4 s, `hit`, `death`, `cheer`), everything skinned, one skin, Unit + Tint, 1,500–2,200 tris, one 512 px texture, the renders including the crowd render, and the checks. The three pilot units (`models/unit/militia.glb`, `paladin.eth.glb`, `archer.oracle.glb`) are the reference for look and finish. Your notes from the pilot (ASSET_RULES §24) hold.

**The lessons of the pilot, as rules now:**
- The team `Tint` must read from above: about 25–35% of visible pixels, on cloth that shows from the top (shoulders, a hood or cap, a cape, a tabard).
- **No base colour near the team colours** (blue `#3f6fa8`, red `#b84a32`): bodies and armour in neutral steel, leather, umber, cream, brass, stone. A token's own colour goes on small accents and the shield or weapon.
- Weapons and props are skinned rigidly to a hand bone or the spine.
- A third material, `Glow` (emissive, for a glowing rim, eye or lantern), is allowed where the table names one. Keep it to small parts.

## The cast

File names under `public/themes/medieval-castle-v2/models/unit/`. Build them in this order and send each as it is done (no need to stop between them).

| Asset | File | Based on | Who | Kit and attack | Own accent (small) |
|---|---|---|---|---|---|
| `unit.knight` | `knight.glb` | the Paladin | A plain knight of the large-cap tokens: steel plate, a kite shield | Sword chop behind the shield | Brass trim on the shield |
| `unit.paladin.staked` | `paladin.staked.glb` | the Paladin | The Staked Paladin (stETH and other LSTs): the Paladin with a cape-like back panel and a shield rim that glows (`Glow`, teal `#3fc1c9`) for its battle shield | As the Paladin | Lido teal on the shield rim and the ETH diamond |
| `unit.warden.vault` | `warden.vault.glb` | the Knight | The Vault Warden (MKR/SKY): bulky (torso ×1.2), a big rectangular tower shield, a mace | Shield bash then mace; its `idle` plants the shield (it taunts) | Sky/Maker teal-green on the shield's boss |
| `unit.archer.scout` | `archer.scout.glb` | the Oracle Archer | The Scout Archer (infra tokens): lighter, a short bow, a feathered cap | Quick draw and release at 0.4 s | A green feather |
| `unit.mage.swap` | `mage.swap.glb` | `person.npc.governance` | The Swap Mage (UNI): a robed mage with a staff topped by a unicorn horn | Staff thrust, a spell released at 0.4 s (the bolt is the game's) | Uniswap pink `#ff007a` on the staff's gem and the robe's hem |
| `unit.mage.battle` | `mage.battle.glb` | the Swap Mage | The Battle Mage (DeFi governance): a plain robe, an orb staff | As the Swap Mage | An amber orb |
| `unit.lender.ghost` | `lender.ghost.glb` | `person.npc.lending` | The Ghost Lender (AAVE): a pale, hooded spectre in a long robe whose hem hovers above the ground, a lantern (opaque, no alpha; pale lilac and white robe, not the team colours) | Lantern swung forward, a drain at 0.4 s | Aave purple-pink on the lantern's glass (`Glow`) |
| `unit.swarm.goblin` | `swarm.goblin.glb` | the person skeleton at **0.6×** (1.05 m) | The Goblin Swarm (memecoins): big ears, a grin, scraps of armour, a club | Wild overhead club swing | A pot helmet |
| `unit.construct` | `construct.glb` | the person skeleton | The Construct (AI and gaming tokens): a clockwork automaton of brass and timber with a glowing eye (`Glow`) and a wind-up key on its back | Piston punch | Brass and a cyan eye |

The game derives each file from its name, everything after `unit.`: `unit.swarm.goblin` → `swarm.goblin.glb`, `unit.paladin.staked` → `paladin.staked.glb`.

## Delivery

For each unit, as in batch 19: renders (iso views, phone at 30 px, silhouette, `clips.png`, the crowd render in blue and red), the checker results, and the triangle count, bone count, size, materials and strike time. Send each when it's done; I review in batches.
