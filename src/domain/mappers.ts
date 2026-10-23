/**
 * Raw Zerion wallets → the Guild. Fixtures and live data take this same path.
 *
 * Rules carried over from v3, because they were right there too:
 * - identity comes from what a thing *is* (fungible id, dapp id), never value or rank;
 * - debt is negative in net worth, but counts toward a building's gross size;
 * - a cross-wallet transaction is joined on chain + hash;
 * - nothing historical is invented (no balance-at-block reconstruction).
 */

import { linkBridges } from './realms.js';
import type { RawWallet } from '../data/zerion/endpoints.js';
import type { PositionResource, TransactionResource, TransferResource } from '../data/zerion/types.js';
import { txKey } from '../data/zerion/tx.js';
import { BUILDING_FOR, KNOWN_CONTRACTS, PASS_THROUGH, classifyAsset, classifyProtocol, type ProtocolCategory } from './catalog.js';
import {
  summarizeStash,
  type Goods,
  type Guild,
  type Hero,
  type HeroClass,
  type Item,
  type Journey,
  type JourneyStep,
  type PositionKind,
  type Protocol,
  type Stash,
  type StashEntry,
  type Target,
  type Verb,
} from './model.js';
import { approxUsd, formatQty, tierOf, type Tier } from './tiers.js';
import { heroName } from '../util/rng.js';


/**
 * A picture's address from the API, or undefined. Some arrive wrapped in quote
 * marks, which made a relative (and so 404ing) image URL; only https survives.
 */
export function imageUrl(raw: unknown): string | undefined {
  // longer than the image proxy takes anyway; and the trim below stays linear (a trailing-anchored regex was quadratic)
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  const wrap = (c: string | undefined) => c === '"' || c === "'" || (c !== undefined && /\s/.test(c));
  let from = 0;
  let to = raw.length;
  while (from < to && wrap(raw[from])) from++;
  while (to > from && wrap(raw[to - 1])) to--;
  const s = raw.slice(from, to);
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** "Cool Cats #123" -> "Cool Cats": the collection from an NFT's name (no regex: names are on-chain, any length). */
function collectionOf(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const hash = name.indexOf('#');
  return (hash < 0 ? name : name.slice(0, hash)).slice(0, 200).trimEnd();
}

export type HistoryWindow = { kind: 'days'; days: number } | { kind: 'count'; count: number };

const CAMP_ID = 'mystery:camp';
const CAMP_NAME = "Wanderers' Camp";
/** Where burned goods go (sent to a burn address, or burned by their contract): gone for ever. */
export const FURNACE_ID = 'place:furnace';
const FURNACE_NAME = 'The Ember Furnace';

/** Addresses nobody holds the key to: what is sent there is burned. */
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
]);

/** Whether an address is a known burn address. Pure. */
export function isBurnAddress(address: string | undefined): boolean {
  return address !== undefined && BURN_ADDRESSES.has(address.toLowerCase());
}
/** Unknown contracts get their own tent only if visited this often (and only this many). */
const OWN_TENT_MIN_VISITS = 3;
const MAX_OWN_TENTS = 4;

export const DEFAULT_WINDOW: HistoryWindow = { kind: 'count', count: 100 };
export const MAX_TX_PER_HERO = 100;
const DAY_MS = 86_400_000;
const ZERO = '0x0000000000000000000000000000000000000000';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// --- protocols ---------------------------------------------------------------

class ProtocolBook {
  readonly byId = new Map<string, Protocol>();
  readonly #modules = new Map<string, Set<string>>();

  touch(
    id: string,
    name: string,
    meta: { iconUrl?: string | null | undefined; url?: string | null | undefined; module?: string | null | undefined },
  ): Protocol {
    let p = this.byId.get(id);
    if (p === undefined) {
      p = { id, name, iconUrl: null, url: null, category: 'unknown', building: 'tent', visits: 0 };
      this.byId.set(id, p);
    }
    p.iconUrl ??= meta.iconUrl ?? null;
    p.url ??= meta.url ?? null;
    if (meta.module) {
      const set = this.#modules.get(id) ?? new Set<string>();
      set.add(meta.module);
      this.#modules.set(id, set);
    }
    return p;
  }

  readonly #fixed = new Set<string>();

  /** A place whose category we know for certain (address book, token contract). */
  fixed(id: string, name: string, category: ProtocolCategory): Protocol {
    const p = this.touch(id, name, {});
    p.category = category;
    p.building = BUILDING_FOR[category];
    this.#fixed.add(id);
    return p;
  }

  /** A contract nobody recognises: still a place, just a foggy one. */
  mystery(address: string): Protocol {
    const id = `mystery:${address.toLowerCase()}`;
    return this.touch(id, `Unknown contract ${shortAddr(address)}`, {});
  }

  remove(id: string): void {
    this.byId.delete(id);
  }

  finish(): void {
    for (const p of this.byId.values()) {
      if (p.id.startsWith('mystery:') || this.#fixed.has(p.id)) continue;
      p.category = classifyProtocol(p.id, p.name, [...(this.#modules.get(p.id) ?? [])]);
      p.building = BUILDING_FOR[p.category];
    }
  }
}

/** A dApp by Zerion's id for it, else by its name (slugged), else none. */
function dappIdent(rel: string | undefined, name: string | null): { id: string; name: string } | null {
  if (rel !== undefined && rel !== '') return { id: rel, name: name ?? rel };
  if (name !== null && name !== '') return { id: slugify(name), name };
  return null;
}

function positionProtocol(position: PositionResource): { id: string; name: string } | null {
  const attrs = position.attributes;
  return dappIdent(position.relationships?.dapp?.data.id, attrs.application_metadata?.name ?? attrs.protocol ?? null);
}

function txProtocol(tx: TransactionResource): { id: string; name: string } | null {
  return dappIdent(tx.relationships?.dapp?.data.id, tx.attributes.application_metadata?.name ?? null);
}

/** A place met by name only: its category from the classifier, unless already known. */
function ensureClassified(p: Protocol): Protocol {
  if (p.category === 'unknown') {
    p.category = classifyProtocol(p.id, p.name);
    p.building = BUILDING_FOR[p.category];
  }
  return p;
}

// --- holdings ----------------------------------------------------------------

function displayable(p: PositionResource): boolean {
  const f = p.attributes.flags;
  return f === undefined || (f.displayable !== false && f.is_trash !== true);
}

function mapItems(raw: RawWallet): { items: Item[]; spam: number } {
  const byId = new Map<string, Item>();
  let spam = 0;
  for (const position of raw.simple) {
    if (!displayable(position)) {
      spam++;
      continue;
    }
    const attrs = position.attributes;
    const f = attrs.fungible_info;
    if (f === undefined) continue;
    const chainId = position.relationships?.chain?.data.id ?? 'unknown';
    const impl = f.implementations?.find((i) => i.chain_id === chainId);
    const isNative = impl !== undefined && (impl.address === null || impl.address === undefined || impl.address === '');
    const id = `${chainId}:${f.id ?? f.symbol.toLowerCase()}`;
    const usd = attrs.value ?? null;
    const existing = byId.get(id);
    if (existing !== undefined) {
      existing.quantity += attrs.quantity.float;
      // unpriced + unpriced stays unpriced (null), not $0
      existing.usd = existing.usd === null && usd === null ? null : (existing.usd ?? 0) + (usd ?? 0);
      existing.tier = tierOf(existing.usd);
      continue;
    }
    byId.set(id, {
      id,
      chainId,
      name: f.name,
      symbol: f.symbol,
      category: classifyAsset(f.symbol, f.name, isNative),
      quantity: attrs.quantity.float,
      usd,
      tier: tierOf(usd),
      iconUrl: imageUrl(f.icon?.url) ?? null,
      address: impl?.address ? impl.address.toLowerCase() : null,
    });
  }
  const items = [...byId.values()].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return { items, spam };
}

function mapNfts(raw: RawWallet): { nfts: Item[]; spam: number } {
  const nfts: Item[] = [];
  let spam = 0;
  for (const n of raw.nfts) {
    const info = n.attributes.nft_info;
    if (info?.flags?.is_spam === true) {
      spam++;
      continue;
    }
    const usd = n.attributes.value ?? null;
    const collection = n.attributes.collection_info?.name ?? 'Unknown collection';
    nfts.push({
      id: n.id,
      chainId: n.relationships?.chain?.data.id ?? 'unknown',
      name: info?.name ?? collection,
      symbol: collection,
      category: 'nft',
      quantity: Number(n.attributes.amount ?? '1') || 1,
      usd,
      tier: tierOf(usd),
      iconUrl: imageUrl(info?.content?.preview?.url) ?? imageUrl(n.attributes.collection_info?.content?.icon?.url) ?? null,
    });
  }
  return { nfts: nfts.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)), spam };
}

function positionKind(type: string | null | undefined): PositionKind {
  switch (type) {
    case 'deposit':
    case 'loan':
    case 'staked':
    case 'reward':
    case 'locked':
    case 'investment':
      return type;
    default:
      return 'other';
  }
}

function mapStashes(raw: RawWallet, book: ProtocolBook): Stash[] {
  const byProtocol = new Map<string, StashEntry[]>();
  for (const position of raw.complex) {
    if (!displayable(position)) continue;
    const ident = positionProtocol(position);
    if (ident === null) continue;
    const attrs = position.attributes;
    book.touch(ident.id, ident.name, {
      iconUrl: imageUrl(attrs.application_metadata?.icon?.url),
      url: attrs.application_metadata?.url,
      module: attrs.protocol_module,
    });
    const kind = positionKind(attrs.position_type);
    const value = attrs.value ?? 0;
    const entry: StashEntry = {
      name: attrs.name,
      symbol: attrs.fungible_info?.symbol ?? '?',
      kind,
      module: attrs.protocol_module ?? null,
      quantity: attrs.quantity.float,
      usd: kind === 'loan' ? -Math.abs(value) : value,
      chainId: position.relationships?.chain?.data.id ?? 'unknown',
      address: contractOf(attrs.fungible_info, position.relationships?.chain?.data.id),
    };
    const list = byProtocol.get(ident.id) ?? [];
    list.push(entry);
    byProtocol.set(ident.id, list);
  }
  const stashes: Stash[] = [];
  for (const [protocolId, entries] of byProtocol) {
    const totals = summarizeStash(entries); // (summed in the order met, then sorted biggest first)
    entries.sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
    stashes.push({ protocolId, ...totals });
  }
  return stashes.sort((a, b) => b.grossUsd - a.grossUsd);
}

// --- verbs -------------------------------------------------------------------

interface TxContext {
  wallet: string;
  category: ProtocolCategory | null;
  initiated: boolean;
  ins: TransferResource[];
  outs: TransferResource[];
  /** Symbols this wallet currently owes in this protocol, if any. */
  loanSymbols: Set<string>;
}

const isDebt = (t: TransferResource): boolean => /debt/i.test(t.fungible_info?.symbol ?? '') || /debt/i.test(t.fungible_info?.name ?? '');
const sym = (t: TransferResource): string => (t.fungible_info?.symbol ?? '').toUpperCase();

/**
 * Zerion's operation_type is coarse: borrow, repay, stake, liquidity and
 * liquidation all arrive as deposit/withdraw/execute. The protocol category and
 * the shape of the transfers decide what the hero actually did.
 */
export function refineVerb(op: string, ctx: TxContext): Verb {
  const { category, ins, outs, initiated } = ctx;
  const nftIn = ins.some((t) => t.nft_info !== undefined);
  const nftOut = outs.some((t) => t.nft_info !== undefined);
  const debtIn = ins.some(isDebt);
  const debtOut = outs.some(isDebt);
  const receivedOwed = ins.some((t) => ctx.loanSymbols.has(sym(t)));
  const paidOwed = outs.some((t) => ctx.loanSymbols.has(sym(t)));

  if (category === 'lending') {
    // Peer-to-peer lending as the lender: funds go straight to a borrower
    // through the protocol, and come back the same way.
    if (op === 'send' && initiated && outs.length > 0 && ins.length === 0 && !debtOut && !paidOwed) return 'lend';
    if (op === 'receive' && !initiated && ins.length > 0 && outs.length === 0 && !debtIn && !receivedOwed) return 'loanRepaid';
    if (!initiated && outs.length > 0 && op !== 'receive') return 'liquidated';
    if (debtIn || (op === 'withdraw' && receivedOwed) || (op === 'receive' && receivedOwed)) return 'borrow';
    if (debtOut || (op === 'deposit' && paidOwed) || (op === 'execute' && paidOwed)) return 'repay';
  }

  switch (op) {
    case 'trade':
      if (nftIn) return 'buyNft';
      if (nftOut) return 'sellNft';
      return 'swap';
    case 'send':
      if (category === 'bridge') return 'bridge';
      // everything that left went to a burn address: burned, not given
      if (outs.length > 0 && outs.every((t) => isBurnAddress(t.recipient))) return 'burn';
      return 'send';
    case 'receive':
      if (category === 'bridge') return 'bridge';
      if (category === 'airdrop') return 'airdrop';
      if (ins.some((t) => t.sender.toLowerCase() === ZERO) && !initiated) return 'airdrop';
      return 'receive';
    case 'deposit':
      switch (category) {
        case 'dex':
          return 'addLiquidity';
        case 'staking':
        case 'restaking':
          return 'stake';
        case 'lending':
          return 'supply';
        case 'bridge':
          return 'bridge';
        case 'wrapper':
          return 'wrap';
        default:
          return 'deposit';
      }
    case 'withdraw':
      switch (category) {
        case 'dex':
          return 'removeLiquidity';
        case 'staking':
        case 'restaking':
          return 'unstake';
        case 'bridge':
          return 'bridge';
        case 'wrapper':
          return 'unwrap';
        default:
          return 'withdraw';
      }
    case 'claim':
      return category === 'airdrop' ? 'airdrop' : 'claim';
    case 'approve':
      return 'approve';
    case 'revoke':
    case 'revoke_delegation':
      return 'revoke';
    case 'mint':
      return 'mint';
    case 'burn':
      return 'burn';
    case 'deploy':
      return 'deploy';
    case 'delegate':
      return 'delegate';
    case 'bid':
      return 'bid';
    case 'execute': {
      if (category === 'wrapper') return outs.some((t) => sym(t) === 'ETH') ? 'wrap' : 'unwrap';
      if (category === 'bridge') return 'bridge';
      if (ins.length > 0 && outs.length > 0) return nftIn ? 'buyNft' : nftOut ? 'sellNft' : 'swap';
      // Offers, bids and listings move nothing until they are taken.
      if (category === 'nft-market' && ins.length === 0) return 'bid';
      return 'unknown';
    }
    default:
      return 'unknown';
  }
}

const VERB_TEXT: Record<Verb, string> = {
  send: 'Send',
  receive: 'Receive',
  swap: 'Swap',
  addLiquidity: 'Pour into the fountain',
  removeLiquidity: 'Draw from the fountain',
  stake: 'Stake',
  unstake: 'Unstake',
  supply: 'Deposit',
  withdraw: 'Withdraw',
  borrow: 'Borrow',
  repay: 'Repay',
  liquidated: 'Liquidated!',
  claim: 'Claim rewards',
  approve: 'Hand over a key',
  revoke: 'Take back a key',
  wrap: 'Crate gold (wrap)',
  unwrap: 'Uncrate gold (unwrap)',
  mint: 'Commission (mint)',
  burn: 'Burn',
  buyNft: 'Buy at auction',
  sellNft: 'Sell at auction',
  bid: 'Bid or list at auction',
  bridge: 'Set sail (bridge)',
  delegate: 'Lend your seal (delegate)',
  deploy: 'Lay a foundation (deploy)',
  airdrop: 'Gift from the Herald',
  deposit: 'Deposit',
  lend: 'Lend',
  loanRepaid: 'Loan repaid to you',
  unknown: 'Mysterious errand',
};

export function verbText(v: Verb): string {
  return VERB_TEXT[v];
}

function goods(t: TransferResource): Goods {
  const nft = t.nft_info;
  const g: Goods = {
    symbol: nft !== undefined ? (nft.collection_info?.name ?? nft.name ?? 'NFT') : (t.fungible_info?.symbol ?? '?'),
    quantity: t.quantity.float,
    usd: t.value,
    isNft: nft !== undefined,
  };
  const icon = nft === undefined ? imageUrl(t.fungible_info?.icon?.url) : undefined;
  if (icon !== undefined) g.icon = icon;
  if (nft !== undefined) {
    const name = nft.name ?? (nft.token_id !== undefined ? `${g.symbol} #${nft.token_id}` : undefined);
    if (name !== undefined) g.name = name;
    const preview = imageUrl(nft.content?.preview?.url);
    const full = imageUrl(nft.content?.detail?.url);
    const image = preview ?? full;
    if (image !== undefined) g.image = image;
    if (full !== undefined && full !== image) g.imageFull = full;
  }
  return g;
}

function describeGoods(list: Goods[]): string {
  if (list.length === 0) return '';
  const g = list.slice().sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  if (g === undefined) return '';
  const more = list.length > 1 ? ` +${list.length - 1}` : '';
  return g.isNft ? `${g.name ?? g.symbol}${more}` : `${formatQty(g.quantity)} ${g.symbol}${more}`;
}

function dramaFor(verb: Verb, tier: Tier, status: string): 0 | 1 | 2 | 3 {
  if (verb === 'liquidated') return tier <= 2 ? 1 : tier <= 4 ? 2 : 3;
  if (status === 'failed') return 1;
  if (tier <= 1) return 0;
  if (tier <= 3) return 1;
  if (tier <= 5) return 2;
  return 3;
}

// --- journeys ----------------------------------------------------------------

interface BuildCtx {
  book: ProtocolBook;
  guild: Set<string>;
  names: Map<string, string>;
  /** Contract → dApp, learned from transactions where Zerion did name the dApp. */
  learned: Map<string, { id: string; name: string; iconUrl: string | undefined }>;
  /** Addresses a story names (a famous castle's): each is a place, people included. */
  labels?: ReadonlyMap<string, PlaceLabel>;
}

/** The id prefix of the places a story names (famous.ts parseFamousStory). */
export const STORY_PLACE = 'story:';

/** A named address: where it stands in town. Several addresses may share an id (one protocol, many contracts). */
export interface PlaceLabel {
  id: string;
  name: string;
  category: ProtocolCategory;
}

/** The labelled place for an address, or null. */
function labelled(address: string, ctx: BuildCtx): Protocol | null {
  const l = ctx.labels?.get(address);
  return l === undefined ? null : ctx.book.fixed(l.id, l.name, l.category);
}

/**
 * Zerion names the dApp on some transactions to a contract and not on others
 * (Gondi loans arrive as plain sends). Whatever it names once, we remember.
 */
function learnContracts(raws: readonly RawWallet[]): BuildCtx['learned'] {
  const learned: BuildCtx['learned'] = new Map();
  for (const raw of raws) {
    for (const tx of raw.transactions) {
      const ident = txProtocol(tx);
      const to = tx.attributes.sent_to.toLowerCase();
      if (ident === null || to === '' || learned.has(to)) continue;
      learned.set(to, { id: ident.id, name: ident.name, iconUrl: imageUrl(tx.attributes.application_metadata?.icon?.url) });
    }
  }
  return learned;
}

/**
 * Name a contract the hero visited, best effort and never invented:
 * a known address, else the NFT or token it governs, else a mystery tent.
 * Returns null for addresses in the guild — those are homes, not places.
 */
function contractPlace(address: string, raw: TransactionResource, ctx: BuildCtx): Protocol | null {
  const addr = address.toLowerCase();
  if (addr === '' || ctx.guild.has(addr)) return null;
  const label = labelled(addr, ctx);
  if (label !== null) return label;
  const known = KNOWN_CONTRACTS[addr];
  if (known !== undefined) return ctx.book.fixed(known.id, known.name, known.category);
  const learned = ctx.learned.get(addr);
  if (learned !== undefined) return ensureClassified(ctx.book.touch(learned.id, learned.name, { iconUrl: learned.iconUrl }));
  const named = ctx.book.byId.get(`contract:${addr}`);
  if (named !== undefined) return named;
  const chainId = raw.relationships?.chain?.data.id;
  for (const t of raw.attributes.transfers) {
    if (t.nft_info?.contract_address?.toLowerCase() === addr) {
      const collection = t.nft_info.collection_info?.name ?? collectionOf(t.nft_info.name) ?? 'NFT';
      return ctx.book.fixed(`contract:${addr}`, `${collection} (NFT contract)`, 'mint');
    }
    const impl = t.fungible_info?.implementations?.find((i) => i.chain_id === chainId);
    if (impl?.address?.toLowerCase() === addr && t.fungible_info) {
      return ctx.book.fixed(`contract:${addr}`, `${t.fungible_info.symbol} token contract`, 'mint');
    }
  }
  return ctx.book.mystery(addr);
}

function mapJourney(raw: TransactionResource, hero: Hero, ctx: BuildCtx): Journey | null {
  const a = raw.attributes;
  const time = Date.parse(a.mined_at);
  if (Number.isNaN(time)) return null;
  const wallet = hero.address;
  const chainId = raw.relationships?.chain?.data.id ?? 'unknown';
  const initiated = a.sent_from.toLowerCase() === wallet;

  // (the order matters: each of these may name a place in the book, and the first to name it decides its details)
  const named = resolveProtocol(raw, ctx);
  const ins = a.transfers.filter((t) => t.direction === 'in');
  const outs = a.transfers.filter((t) => t.direction === 'out');
  const protocolId = named?.id;
  const stash = protocolId === undefined ? undefined : hero.stashes.find((s) => s.protocolId === protocolId);
  const loanSymbols = new Set((stash?.entries ?? []).filter((e) => e.kind === 'loan').map((e) => e.symbol.toUpperCase()));
  const { place, other, transferish } = resolvePlace(raw, named, wallet, initiated, ctx);

  const verb = refineVerb(a.operation_type, {
    wallet,
    // a place a story names is where the money came from or went to, not what was done there (a receive from a bridge is no crossing)
    category: named === null && place?.id.startsWith(STORY_PLACE) ? null : ((named ?? place)?.category ?? null),
    initiated,
    ins,
    outs,
    loanSymbols,
  });
  const { counterparty, counterpartyHero } = resolveCounterparty(raw, wallet, initiated, ctx);
  const { target, protocol } = resolveTarget({ verb, named, place, transferish, counterpartyHero, other, wallet }, ctx);
  if (protocol !== null) protocol.visits++;
  const steps = buildSteps(raw, { verb, target, protocol, wallet, initiated, loanSymbols, ins, outs }, ctx);

  const sumIn = ins.reduce((s, t) => s + (t.value ?? 0), 0);
  const sumOut = outs.reduce((s, t) => s + (t.value ?? 0), 0);
  const valueUsd = Math.max(sumIn, sumOut);
  const tier = tierOf(valueUsd);

  return {
    key: txKey(raw),
    hash: a.hash,
    chainId,
    hero: wallet,
    time,
    status: a.status,
    feeUsd: a.fee?.value ?? null,
    feeNative: a.fee?.quantity?.float ?? null,
    block: a.mined_at_block ?? null,
    method: a.application_metadata?.method?.name ?? (a.acts ?? []).map((x) => x.application_metadata?.method?.name).find((m) => m !== undefined) ?? null,
    initiated,
    verb,
    steps,
    valueUsd,
    tier,
    drama: dramaFor(verb, tier, a.status),
    counterparty,
    counterpartyHero,
    label: buildLabel({ verb, ins, outs, protocol, target, counterparty, counterpartyHero, status: a.status, valueUsd }, ctx),
  };
}

/** The dApp Zerion names for the transaction (or, for a key handed over or taken back, the spender), classified. */
function resolveProtocol(raw: TransactionResource, ctx: BuildCtx): Protocol | null {
  const a = raw.attributes;
  const ident = txProtocol(raw);
  let protocol: Protocol | null = null;
  // Approvals are sent to the token, but the key goes to the spender.
  const spender = a.approvals?.[0]?.sender;
  const isKey = a.operation_type === 'approve' || a.operation_type === 'revoke';
  if (ident === null && isKey && spender !== undefined) protocol = contractPlace(spender, raw, ctx);
  if (ident !== null) {
    protocol = ctx.book.touch(ident.id, ident.name, {
      iconUrl: imageUrl(a.application_metadata?.icon?.url),
      url: a.application_metadata?.url,
    });
  }
  // Classification has to be known before refining the verb.
  if (protocol !== null && !protocol.id.startsWith('mystery:')) ensureClassified(protocol);
  return protocol;
}

/**
 * Without a dApp, the contract itself is the place — resolved before the
 * verb, since its category (an NFT market, a lending pool) shapes what the
 * hero did there. `other`: the other side of the transaction.
 */
function resolvePlace(raw: TransactionResource, named: Protocol | null, wallet: string, initiated: boolean, ctx: BuildCtx): { place: Protocol | null; other: string; transferish: boolean } {
  const a = raw.attributes;
  const other = (initiated ? a.sent_to : a.sent_from).toLowerCase();
  const transferish = a.operation_type === 'send' || a.operation_type === 'receive';
  let place: Protocol | null = null;
  if (named === null && a.operation_type !== 'deploy') {
    if (!transferish) place = contractPlace(other, raw, ctx);
    else {
      // A send/receive is only person-to-person if the contract called is the
      // other party or the token itself. Otherwise the money moved *through* a
      // contract (a loan, a sale, a payout) and that contract is the place.
      const called = a.sent_to.toLowerCase();
      const parties = new Set(a.transfers.flatMap((t) => [t.sender.toLowerCase(), t.recipient.toLowerCase()]));
      const tokens = new Set(
        a.transfers.flatMap((t) => [
          ...(t.fungible_info?.implementations ?? []).map((i) => (i.address ?? '').toLowerCase()),
          (t.nft_info?.contract_address ?? '').toLowerCase(),
        ]),
      );
      // Between two of your own wallets it is always home to home.
      const internal = [...parties].some((x) => x !== wallet && ctx.guild.has(x));
      if (called !== '' && called !== wallet && !internal && !PASS_THROUGH.has(called) && !ctx.guild.has(called) && !parties.has(called) && !tokens.has(called)) {
        place = contractPlace(called, raw, ctx);
      }
      // a person the story names is a place too (the multisig the money went back to)
      place ??= [...parties].reduce<Protocol | null>((found, x) => found ?? (x !== wallet ? labelled(x, ctx) : null), null);
    }
  }
  return { place, other, transferish };
}

/** Counterparty: for sends/receives, the other side of the biggest transfer (and the guild hero it is, if one). */
function resolveCounterparty(raw: TransactionResource, wallet: string, initiated: boolean, ctx: BuildCtx): { counterparty: string | null; counterpartyHero: string | null } {
  const a = raw.attributes;
  let counterparty: string | null = null;
  const main = [...a.transfers].sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0];
  if (main !== undefined) counterparty = (main.direction === 'out' ? main.recipient : main.sender).toLowerCase();
  if (counterparty === wallet) counterparty = initiated ? a.sent_to.toLowerCase() : a.sent_from.toLowerCase();
  const counterpartyHero = counterparty !== null && ctx.guild.has(counterparty) && counterparty !== wallet ? counterparty : null;
  return { counterparty, counterpartyHero };
}

/**
 * Where does the hero go, and which place is the journey's? Anything
 * contract-shaped without a known dApp is a mysterious tent, never a guess.
 */
function resolveTarget(
  o: { verb: Verb; named: Protocol | null; place: Protocol | null; transferish: boolean; counterpartyHero: string | null; other: string; wallet: string },
  ctx: BuildCtx,
): { target: Target; protocol: Protocol | null } {
  const { verb, named, place, counterpartyHero, other, wallet } = o;
  if (verb === 'burn') {
    // into the fire: one furnace for every burn, whoever made the token
    const furnace = ctx.book.fixed(FURNACE_ID, FURNACE_NAME, 'unknown');
    return { target: { kind: 'building', protocolId: furnace.id }, protocol: furnace };
  }
  if (place !== null && o.transferish && named === null) return { target: { kind: 'building', protocolId: place.id }, protocol: place };
  if (verb === 'send' || verb === 'receive' || verb === 'airdrop') {
    if (named !== null && verb === 'airdrop') return { target: { kind: 'building', protocolId: named.id }, protocol: named };
    return { target: counterpartyHero !== null ? { kind: 'home', address: counterpartyHero } : { kind: 'gate' }, protocol: named };
  }
  if (named !== null) return { target: { kind: 'building', protocolId: named.id }, protocol: named };
  if (verb === 'deploy') {
    // A foundation stone laid in the Wilds.
    const camp = ctx.book.fixed(CAMP_ID, CAMP_NAME, 'unknown');
    return { target: { kind: 'building', protocolId: camp.id }, protocol: camp };
  }
  if (place !== null) return { target: { kind: 'building', protocolId: place.id }, protocol: place };
  if (ctx.guild.has(other) && other !== wallet) return { target: { kind: 'home', address: other }, protocol: null };
  return { target: { kind: 'gate' }, protocol: null };
}

/** The journey's waypoints: one per sub-action for an Expedition (several acts), else the one. */
function buildSteps(
  raw: TransactionResource,
  o: { verb: Verb; target: Target; protocol: Protocol | null; wallet: string; initiated: boolean; loanSymbols: Set<string>; ins: TransferResource[]; outs: TransferResource[] },
  ctx: BuildCtx,
): JourneyStep[] {
  const a = raw.attributes;
  const acts = a.acts ?? [];
  if (!(acts.length > 1 && a.transfers.some((t) => t.act_id !== undefined))) return [{ verb: o.verb, target: o.target, give: o.outs.map(goods), get: o.ins.map(goods) }];
  const steps: JourneyStep[] = [];
  for (const act of acts) {
    const actTransfers = a.transfers.filter((t) => t.act_id === act.id);
    const actName = act.application_metadata?.name;
    let actTarget = o.target;
    let actProtocol = o.protocol;
    if (actName !== undefined && actName !== '') {
      const p = ensureClassified(ctx.book.touch(slugify(actName), actName, { iconUrl: imageUrl(act.application_metadata?.icon?.url) }));
      actTarget = { kind: 'building', protocolId: p.id };
      actProtocol = p;
    }
    steps.push({
      // the act's own protocol decides its verb (an aggregator-routed Aave deposit is a supply)
      verb: refineVerb(act.type ?? a.operation_type, {
        wallet: o.wallet,
        category: actProtocol?.category ?? null,
        initiated: o.initiated,
        ins: actTransfers.filter((t) => t.direction === 'in'),
        outs: actTransfers.filter((t) => t.direction === 'out'),
        loanSymbols: o.loanSymbols,
      }),
      target: actTarget,
      give: actTransfers.filter((t) => t.direction === 'out').map(goods),
      get: actTransfers.filter((t) => t.direction === 'in').map(goods),
    });
  }
  return steps;
}

/**
 * ETH's price and 24-hour change from the wallets' own native ETH positions
 * (as fresh as the last measure), or null: the fallback when Zerion's market
 * read is not to be had (no key, the fixtures, a failed request).
 */
export function ethMarketOf(raws: readonly RawWallet[]): { usd: number; pct1d: number } | null {
  for (const raw of raws) {
    for (const p of raw.simple) {
      const a = p.attributes;
      const f = a.fungible_info;
      if (f === undefined || f.symbol.toUpperCase() !== 'ETH') continue;
      const chainId = p.relationships?.chain?.data.id;
      const impl = f.implementations?.find((i) => i.chain_id === chainId);
      if (impl === undefined || (impl.address ?? '') !== '') continue;
      const pct1d = a.changes?.percent_1d;
      if (a.price !== undefined && a.price > 0 && typeof pct1d === 'number') return { usd: a.price, pct1d };
    }
  }
  return null;
}

/** The quest's one line: "Swap 1.2 ETH → 3,000 USDC at Uniswap ($3.0k)". */
function buildLabel(
  o: { verb: Verb; ins: TransferResource[]; outs: TransferResource[]; protocol: Protocol | null; target: Target; counterparty: string | null; counterpartyHero: string | null; status: string; valueUsd: number },
  ctx: BuildCtx,
): string {
  const { verb, protocol, counterparty, counterpartyHero } = o;
  const give = describeGoods(o.outs.map(goods));
  const get = describeGoods(o.ins.map(goods));
  const where = protocol !== null && o.target.kind === 'building' && protocol.id !== CAMP_ID ? ` at ${protocol.name}` : '';
  const who = counterpartyHero !== null ? (ctx.names.get(counterpartyHero) ?? shortAddr(counterpartyHero)) : counterparty !== null ? shortAddr(counterparty) : '';
  let label: string;
  switch (verb) {
    case 'swap':
      label = `Swap ${give || '?'} → ${get || '?'}${where}`;
      break;
    case 'send':
      label = `Send ${give} to ${who}${where}`;
      break;
    case 'receive':
      label = `Receive ${get} from ${who}${where}`;
      break;
    case 'lend':
      label = `Lend ${give} to ${who}${where}`;
      break;
    case 'loanRepaid':
      label = `${who} repaid ${get}${where}`;
      break;
    case 'approve':
    case 'revoke':
      label = `${VERB_TEXT[verb]}${where}`;
      break;
    default:
      label = `${VERB_TEXT[verb]} ${give || get}${where}`.replace(/\s+/g, ' ').trim();
  }
  if (o.status === 'failed') label = `Failed: ${label}`;
  if (o.valueUsd > 0) label += ` (${approxUsd(o.valueUsd)})`;
  return label;
}

// --- classes -----------------------------------------------------------------

const CLASS_OF_VERB: Partial<Record<Verb, HeroClass>> = {
  swap: 'merchant',
  addLiquidity: 'merchant',
  removeLiquidity: 'merchant',
  stake: 'monk',
  unstake: 'monk',
  claim: 'monk',
  deposit: 'monk',
  supply: 'paladin',
  lend: 'paladin',
  loanRepaid: 'paladin',
  withdraw: 'paladin',
  borrow: 'paladin',
  repay: 'paladin',
  liquidated: 'paladin',
  buyNft: 'bard',
  sellNft: 'bard',
  mint: 'bard',
  bid: 'bard',
  send: 'ranger',
  receive: 'ranger',
  bridge: 'ranger',
};

export function suggestClass(counts: Partial<Record<Verb, number>>): HeroClass {
  const score = new Map<HeroClass, number>();
  let total = 0;
  for (const [verb, n] of Object.entries(counts) as [Verb, number][]) {
    total += n;
    const c = CLASS_OF_VERB[verb];
    if (c !== undefined) score.set(c, (score.get(c) ?? 0) + n);
  }
  if (total === 0) return 'sleeper';
  const ranked = [...score.entries()].sort((x, y) => y[1] - x[1]);
  const top = ranked[0];
  if (top === undefined || top[1] / total < 0.4) return 'adventurer';
  return top[0];
}

// --- guild -------------------------------------------------------------------

export interface GuildOptions {
  /** Primary ENS names; a hero with one is called by it. */
  names?: ReadonlyMap<string, string>;
  /** Named addresses (a famous castle's story): they become places in town. */
  labels?: ReadonlyMap<string, PlaceLabel>;
}

export function buildGuild(raws: readonly RawWallet[], window: HistoryWindow = DEFAULT_WINDOW, options: GuildOptions = {}): Guild {
  const book = new ProtocolBook();
  const learned = learnContracts(raws);
  const guild = new Set(raws.map((r) => r.address.toLowerCase()));
  const names = new Map<string, string>();
  const heroes: Hero[] = [];

  for (const raw of raws) {
    const address = raw.address.toLowerCase();
    const { items, spam } = mapItems(raw);
    const { nfts, spam: nftSpam } = mapNfts(raw);
    const stashes = mapStashes(raw, book);
    const computed =
      items.reduce((s, i) => s + (i.usd ?? 0), 0) + stashes.reduce((s, x) => s + x.netUsd, 0);
    const tokenWorth = raw.portfolio?.attributes.total?.positions ?? computed;
    const nftWorth = nfts.reduce((s, n) => s + (n.usd ?? 0), 0);
    const netWorth = tokenWorth + nftWorth;
    const name = options.names?.get(address) ?? heroName(address);
    names.set(address, name);
    heroes.push({
      address,
      label: raw.label,
      name,
      netWorth,
      tokenWorth,
      nftWorth,
      tier: tierOf(netWorth),
      items,
      nfts,
      spamCount: spam + nftSpam,
      stashes,
      suggestedClass: 'sleeper',
      verbCounts: {},
      lastActiveAt: null,
    });
  }
  book.finish();

  const windowEnd = Math.max(...raws.map((r) => r.capturedAt), 0);
  const windowStart = window.kind === 'days' ? windowEnd - window.days * DAY_MS : -Infinity;
  const perHero = window.kind === 'count' ? window.count : MAX_TX_PER_HERO;

  const byKey = new Map<string, Journey>();
  raws.forEach((raw, i) => {
    const hero = heroes[i];
    if (hero === undefined) return;
    // Filter to the window *before* mapping, so places only appear in town if
    // someone actually went there in the window.
    const recent = raw.transactions
      .filter((t) => t.attributes.flags?.is_trash !== true && Date.parse(t.attributes.mined_at) >= windowStart)
      .sort((x, y) => Date.parse(y.attributes.mined_at) - Date.parse(x.attributes.mined_at))
      .slice(0, perHero);
    for (const tx of recent) {
      const j = mapJourney(tx, hero, { book, guild, names, learned, ...(options.labels ? { labels: options.labels } : {}) });
      if (j === null) continue;
      hero.lastActiveAt = Math.max(hero.lastActiveAt ?? 0, j.time);
      hero.verbCounts[j.verb] = (hero.verbCounts[j.verb] ?? 0) + 1;
      // A transfer between two guild heroes appears in both feeds. Draw it once,
      // from the side that set out (the sender walks it over).
      const existing = byKey.get(j.key);
      if (existing === undefined || (!existing.initiated && j.initiated)) byKey.set(j.key, j);
    }
  });
  for (const hero of heroes) hero.suggestedClass = suggestClass(hero.verbCounts);

  const journeys = [...byKey.values()].sort((x, y) => x.time - y.time);
  consolidateMysteries(book, journeys);
  // crossings between realms: each side of a bridge knows the other
  linkBridges(journeys);
  const first = journeys[0];
  return {
    heroes,
    protocols: book.byId,
    journeys,
    windowStart: Number.isFinite(windowStart) ? windowStart : (first?.time ?? windowEnd),
    windowEnd,
  };
}

/**
 * A town of forty identical tents is unreadable. The most-visited unknown
 * contracts keep their own tent; everything else shares the Wanderers' Camp.
 */
function consolidateMysteries(book: ProtocolBook, journeys: Journey[]): void {
  // A mystery seen before its contract was named (e.g. an approval earlier in
  // the feed than the deposit) belongs to the named place.
  for (const p of [...book.byId.values()]) {
    if (!p.id.startsWith('mystery:') || p.id === CAMP_ID) continue;
    const named = book.byId.get(`contract:${p.id.slice('mystery:'.length)}`);
    if (named === undefined) continue;
    named.visits += p.visits;
    book.remove(p.id);
    for (const j of journeys)
      for (const step of j.steps)
        if (step.target.kind === 'building' && step.target.protocolId === p.id) step.target = { kind: 'building', protocolId: named.id };
  }
  const mysteries = [...book.byId.values()].filter((p) => p.id.startsWith('mystery:') && p.id !== CAMP_ID);
  const keep = new Set(
    mysteries
      .filter((p) => p.visits >= OWN_TENT_MIN_VISITS)
      .sort((x, y) => y.visits - x.visits || x.id.localeCompare(y.id))
      .slice(0, MAX_OWN_TENTS)
      .map((p) => p.id),
  );
  // Contracts we could only name after their token are not worth a building of
  // their own unless the guild keeps coming back.
  const minorContracts = [...book.byId.values()].filter((p) => p.id.startsWith('contract:') && p.visits < OWN_TENT_MIN_VISITS);
  const merged = [...mysteries.filter((p) => !keep.has(p.id)), ...minorContracts];
  if (merged.length === 0) return;
  const camp = book.fixed(CAMP_ID, CAMP_NAME, 'unknown');
  camp.name = `${CAMP_NAME} (${merged.length} lesser-known contracts)`;
  const mergedIds = new Set(merged.map((p) => p.id));
  for (const p of merged) {
    camp.visits += p.visits;
    book.remove(p.id);
  }
  for (const j of journeys) {
    for (const step of j.steps) {
      if (step.target.kind === 'building' && mergedIds.has(step.target.protocolId)) step.target = { kind: 'building', protocolId: CAMP_ID };
    }
  }
}

/** A token's contract on a chain, lower case (null: native, or not listed). */
function contractOf(f: { implementations?: { chain_id?: string; address?: string | null }[] } | undefined, chainId: string | undefined): string | null {
  const a = f?.implementations?.find((i) => i.chain_id === chainId)?.address;
  return a ? a.toLowerCase() : null;
}
