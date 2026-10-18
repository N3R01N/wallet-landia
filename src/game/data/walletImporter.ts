/**
 * WalletImporter: one wallet the visualization already loaded (a domain Hero)
 * → a read-only Portfolio snapshot (spec: "Import and edit"). Ethereum mainnet
 * only; the data layer is wrapped, not changed.
 *
 * Tokens the data files know become sim assets (valued at sim prices); the
 * rest become custom assets in a fallback category at their real price.
 * Positions map onto the game's kinds as docs/game/MAPPING.md says.
 */

import type { AssetCategory } from '../../domain/catalog.js';
import type { Hero, Protocol, StashEntry } from '../../domain/model.js';
import { BASE_ASSETS } from '../core/catalog.js';
import { protocolFamily } from '../../castle/assets/manifest.js';
import { qtyFor } from '../core/fixed.js';
import type { Asset, AssetId, Category, NftHolding, Portfolio, Position, ProtocolFn } from '../core/types.js';

const BY_ADDRESS = new Map(BASE_ASSETS.filter((a) => a.address).map((a) => [a.address!, a]));
const BY_SYMBOL = new Map(BASE_ASSETS.map((a) => [a.symbol.toLowerCase(), a]));

/** Our domain's token categories → the game's fallback categories. */
const CATEGORY: Partial<Record<AssetCategory, Category>> = {
  stable: 'stable',
  meme: 'meme',
  governance: 'defi-gov',
  lst: 'lst',
  native: 'largecap',
  wrapped: 'largecap',
  token: 'misc',
};

/** Protocols that are stable vaults (mint stablecoins against collateral). */
const VAULTS = new Set(['maker', 'sky', 'makerdao', 'liquity', 'crvusd']);

export interface ImportResult {
  portfolio: Portfolio;
  customAssets: Asset[];
  /** What was left out, and why ("3 tokens on other chains"). */
  notes: string[];
}

export function importWallet(hero: Hero, protocols: ReadonlyMap<string, Protocol>): ImportResult {
  const custom = new Map<AssetId, Asset>();
  const positions: Position[] = [];
  const notes: string[] = [];
  let offChain = 0;

  /**
   * The asset a token is (spec: AssetId = its Ethereum contract): a known
   * contract first; by symbol only for a token without one (native ETH, or
   * data that lacks it), so a look-alike token under a known symbol isn't
   * taken for the real one.
   */
  const assetFor = (symbol: string, category: AssetCategory | null, price: number, address?: string | null, icon?: string | null): AssetId | null => {
    const contract = address ? address.toLowerCase() : null;
    const known = contract ? BY_ADDRESS.get(contract) : BY_SYMBOL.get(symbol.toLowerCase());
    if (known) return known.id;
    if (category === 'receipt' || category === 'debt' || category === 'nft') return null;
    if (!(price > 0)) return null;
    const id = `x:${contract ?? symbol.toLowerCase()}`;
    if (!custom.has(id)) {
      const cat = CATEGORY[category ?? 'token'] ?? 'misc';
      custom.set(id, {
        id,
        symbol,
        category: cat,
        priceClass: cat === 'stable' ? 'stable' : cat === 'meme' ? 'meme' : cat === 'lst' ? 'eth' : cat === 'defi-gov' ? 'defi' : 'largecap',
        isStable: cat === 'stable',
        collateral: cat !== 'meme',
        price,
        ...(contract ? { address: contract } : {}),
        ...(icon ? { icon } : {}),
        ...(cat === 'lst' ? { follows: 'eth', curatedUnit: 'paladin.staked' } : {}),
      });
    }
    return id;
  };

  for (const item of hero.items) {
    if (item.chainId !== 'ethereum') {
      offChain++;
      continue;
    }
    if (!(item.quantity > 0) || !(item.usd !== null && item.usd > 0)) continue;
    const id = assetFor(item.symbol, item.category, item.usd / item.quantity, item.address, item.iconUrl);
    if (id) positions.push({ asset: id, qty: qtyFor(item.quantity, 1), kind: 'spot' });
  }

  for (const stash of hero.stashes) {
    const protocol = protocols.get(stash.protocolId);
    const fn = protocolFn(stash.protocolId, protocol?.category);
    const entries = stash.entries.filter((e) => {
      if (e.chainId !== 'ethereum') offChain++;
      return e.chainId === 'ethereum' && e.quantity > 0 && e.usd !== 0;
    });
    // a pool: two deposits at an exchange
    const deposits = entries.filter((e) => e.kind === 'deposit');
    if (fn === 'dex' && deposits.length === 2) {
      const [a, b] = deposits as [StashEntry, StashEntry];
      const ia = assetFor(a.symbol, null, Math.abs(a.usd) / a.quantity, a.address);
      const ib = assetFor(b.symbol, null, Math.abs(b.usd) / b.quantity, b.address);
      if (ia && ib && ia !== ib) {
        positions.push({ asset: ia, qty: qtyFor(a.quantity, 1), kind: 'lp', protocol: 'dex', pairWith: ib, pairQty: qtyFor(b.quantity, 1), venue: venueOf(stash.protocolId) });
        for (const e of entries) if (e !== a && e !== b) pushEntry(e);
        continue;
      }
    }
    for (const e of entries) pushEntry(e);

    function pushEntry(e: StashEntry): void {
      const id = assetFor(e.symbol, null, Math.abs(e.usd) / e.quantity, e.address);
      if (!id) return;
      const qty = qtyFor(e.quantity, 1);
      const venue = venueOf(stash.protocolId);
      if (e.kind === 'loan') positions.push({ asset: id, qty, kind: 'borrowed', protocol: fn === 'vault' ? 'vault' : 'lending', venue });
      else if (fn === 'restaking') positions.push({ asset: id, qty, kind: 'restaked', protocol: 'restaking', venue });
      else if (e.kind === 'staked' || fn === 'staking') positions.push({ asset: id, qty, kind: 'staked', protocol: 'staking', venue });
      else if (e.kind === 'deposit' && (fn === 'lending' || fn === 'vault')) positions.push({ asset: id, qty, kind: 'supplied', protocol: fn, venue });
      else positions.push({ asset: id, qty, kind: 'spot' });
    }
  }

  // one holding per collection, at its floor (the most valuable piece stands in)
  const nfts = new Map<string, NftHolding>();
  for (const n of hero.nfts) {
    if (n.chainId !== 'ethereum') {
      offChain++;
      continue;
    }
    const collection = nftCollectionKey(n.id, n.symbol);
    const floor = n.usd ?? 0;
    const prev = nfts.get(collection);
    if (!prev || floor > prev.floor) nfts.set(collection, { collection, floor });
  }

  if (offChain > 0) notes.push(`${offChain} holding${offChain === 1 ? '' : 's'} on other chains left out (Ethereum mainnet only).`);
  return { portfolio: { positions: mergeSpot(positions), nfts: [...nfts.values()], relics: [null, null, null] }, customAssets: [...custom.values()], notes };
}

/** A protocol's family name ('aave-v3' → 'aave'): what the curated abilities are named after. */
function venueOf(id: string): string {
  return protocolFamily(id);
}

function protocolFn(id: string, category: Protocol['category'] | undefined): ProtocolFn | null {
  if (VAULTS.has(id.toLowerCase())) return 'vault';
  switch (category) {
    case 'lending':
      return 'lending';
    case 'dex':
    case 'aggregator':
      return 'dex';
    case 'staking':
      return 'staking';
    case 'restaking':
      return 'restaking';
    default:
      return null;
  }
}

/** An NFT's collection: the contract from Zerion's id (`<chain>:<contract>:<token>`), else its collection name. */
export function nftCollectionKey(id: string, name: string): string {
  const contract = id.split(':').find((p) => /^0x[0-9a-f]{40}$/i.test(p));
  return contract ? contract.toLowerCase() : name;
}

function mergeSpot(positions: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of positions) {
    const same = p.kind === 'spot' ? out.find((o) => o.kind === 'spot' && o.asset === p.asset) : undefined;
    if (same) same.qty += p.qty;
    else out.push(p);
  }
  return out;
}
