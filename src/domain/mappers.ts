/**
 * Raw Zerion wallets → the Guild. Fixtures and live data take this same path.
 *
 * Rules carried over from v3, because they were right there too:
 * - identity comes from what a thing *is* (fungible id, dapp id), never value or rank;
 * - debt is negative in net worth, but counts toward a building's gross size;
 * - a cross-wallet transaction is joined on chain + hash;
 * - nothing historical is invented (no balance-at-block reconstruction).
 */

import type { RawWallet } from '../data/zerion/endpoints.js';
import type { PositionResource, TransactionResource, TransferResource } from '../data/zerion/types.js';
import { BUILDING_FOR, KNOWN_CONTRACTS, PASS_THROUGH, classifyAsset, classifyProtocol, type ProtocolCategory } from './catalog.js';
import type {
  Goods,
  Guild,
  Hero,
  HeroClass,
  Item,
  Journey,
  JourneyStep,
  PositionKind,
  Protocol,
  Stash,
  StashEntry,
  Target,
  Verb,
} from './model.js';
import { approxUsd, formatQty, tierOf, type Tier } from './tiers.js';
import { heroName } from '../util/rng.js';

export type HistoryWindow = { kind: 'days'; days: number } | { kind: 'count'; count: number };

const CAMP_ID = 'mystery:camp';
const CAMP_NAME = "Wanderers' Camp";
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

function positionProtocol(position: PositionResource): { id: string; name: string } | null {
  const attrs = position.attributes;
  const rel = position.relationships?.dapp?.data.id;
  const name = attrs.application_metadata?.name ?? attrs.protocol ?? null;
  if (rel !== undefined && rel !== '') return { id: rel, name: name ?? rel };
  if (name !== null && name !== '') return { id: slugify(name), name };
  return null;
}

function txProtocol(tx: TransactionResource): { id: string; name: string } | null {
  const rel = tx.relationships?.dapp?.data.id;
  const name = tx.attributes.application_metadata?.name ?? null;
  if (rel !== undefined && rel !== '') return { id: rel, name: name ?? rel };
  if (name !== null && name !== '') return { id: slugify(name), name };
  return null;
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
      existing.usd = (existing.usd ?? 0) + (usd ?? 0);
      existing.tier = tierOf(existing.usd);
      continue;
    }
    byId.set(id, {
      id,
      chainId,
      name: f.name,
      symbol: f.symbol,
      category: classifyAsset(f.symbol, f.name, chainId, isNative),
      quantity: attrs.quantity.float,
      usd,
      tier: tierOf(usd),
      iconUrl: f.icon?.url ?? null,
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
      iconUrl: info?.content?.preview?.url ?? n.attributes.collection_info?.content?.icon?.url ?? null,
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
      iconUrl: attrs.application_metadata?.icon?.url,
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
    };
    const list = byProtocol.get(ident.id) ?? [];
    list.push(entry);
    byProtocol.set(ident.id, list);
  }
  const stashes: Stash[] = [];
  for (const [protocolId, entries] of byProtocol) {
    const netUsd = entries.reduce((s, e) => s + e.usd, 0);
    const grossUsd = entries.reduce((s, e) => s + Math.abs(e.usd), 0);
    stashes.push({
      protocolId,
      entries: entries.sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)),
      netUsd,
      grossUsd,
      tier: tierOf(grossUsd),
      hasRewards: entries.some((e) => e.kind === 'reward' && e.usd >= 1),
      hasDebt: entries.some((e) => e.kind === 'loan'),
    });
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
      return category === 'bridge' ? 'bridge' : 'send';
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
  return {
    symbol: t.nft_info !== undefined ? (t.nft_info.collection_info?.name ?? t.nft_info.name ?? 'NFT') : (t.fungible_info?.symbol ?? '?'),
    quantity: t.quantity.float,
    usd: t.value,
    isNft: t.nft_info !== undefined,
  };
}

function describeGoods(list: Goods[]): string {
  if (list.length === 0) return '';
  const g = list.slice().sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  if (g === undefined) return '';
  const more = list.length > 1 ? ` +${list.length - 1}` : '';
  return g.isNft ? `${g.symbol}${more}` : `${formatQty(g.quantity)} ${g.symbol}${more}`;
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
      learned.set(to, { id: ident.id, name: ident.name, iconUrl: tx.attributes.application_metadata?.icon?.url ?? undefined });
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
  const known = KNOWN_CONTRACTS[addr];
  if (known !== undefined) return ctx.book.fixed(known.id, known.name, known.category);
  const learned = ctx.learned.get(addr);
  if (learned !== undefined) {
    const p = ctx.book.touch(learned.id, learned.name, { iconUrl: learned.iconUrl });
    if (p.category === 'unknown') {
      p.category = classifyProtocol(p.id, p.name);
      p.building = BUILDING_FOR[p.category];
    }
    return p;
  }
  const named = ctx.book.byId.get(`contract:${addr}`);
  if (named !== undefined) return named;
  const chainId = raw.relationships?.chain?.data.id;
  for (const t of raw.attributes.transfers) {
    if (t.nft_info?.contract_address?.toLowerCase() === addr) {
      const collection = t.nft_info.collection_info?.name ?? t.nft_info.name?.replace(/\s*#.*$/, '') ?? 'NFT';
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

  const ident = txProtocol(raw);
  let protocol: Protocol | null = null;
  // Approvals are sent to the token, but the key goes to the spender.
  const spender = a.approvals?.[0]?.sender;
  const isKey = a.operation_type === 'approve' || a.operation_type === 'revoke';
  if (ident === null && isKey && spender !== undefined) protocol = contractPlace(spender, raw, ctx);
  if (ident !== null) {
    protocol = ctx.book.touch(ident.id, ident.name, {
      iconUrl: a.application_metadata?.icon?.url,
      url: a.application_metadata?.url,
    });
  }
  // Classification has to be known before refining the verb.
  if (protocol !== null && protocol.category === 'unknown' && !protocol.id.startsWith('mystery:')) {
    protocol.category = classifyProtocol(protocol.id, protocol.name);
    protocol.building = BUILDING_FOR[protocol.category];
  }

  const ins = a.transfers.filter((t) => t.direction === 'in');
  const outs = a.transfers.filter((t) => t.direction === 'out');
  const protocolId = protocol?.id;
  const stash = protocolId === undefined ? undefined : hero.stashes.find((s) => s.protocolId === protocolId);
  const loanSymbols = new Set((stash?.entries ?? []).filter((e) => e.kind === 'loan').map((e) => e.symbol.toUpperCase()));

  // Without a dApp, the contract itself is the place — resolve it first, since
  // its category (an NFT market, a lending pool) shapes what the hero did there.
  const other = (initiated ? a.sent_to : a.sent_from).toLowerCase();
  const transferish = a.operation_type === 'send' || a.operation_type === 'receive';
  let place: Protocol | null = null;
  if (protocol === null && a.operation_type !== 'deploy') {
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
    }
  }

  const verb = refineVerb(a.operation_type, {
    wallet,
    category: (protocol ?? place)?.category ?? null,
    initiated,
    ins,
    outs,
    loanSymbols,
  });

  // Counterparty: for sends/receives, the other side of the biggest transfer.
  let counterparty: string | null = null;
  const main = [...a.transfers].sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0];
  if (main !== undefined) counterparty = (main.direction === 'out' ? main.recipient : main.sender).toLowerCase();
  if (counterparty === wallet) counterparty = initiated ? a.sent_to.toLowerCase() : a.sent_from.toLowerCase();
  const counterpartyHero = counterparty !== null && ctx.guild.has(counterparty) && counterparty !== wallet ? counterparty : null;

  // Where does the hero go? Anything contract-shaped without a known dApp is a
  // mysterious tent, never a guess.
  let target: Target;
  if (place !== null && transferish && protocol === null) {
    protocol = place;
    target = { kind: 'building', protocolId: place.id };
  } else if (verb === 'send' || verb === 'receive' || verb === 'airdrop') {
    if (protocol !== null && verb === 'airdrop') target = { kind: 'building', protocolId: protocol.id };
    else target = counterpartyHero !== null ? { kind: 'home', address: counterpartyHero } : { kind: 'gate' };
  } else if (protocol !== null) {
    target = { kind: 'building', protocolId: protocol.id };
  } else if (verb === 'deploy') {
    // A foundation stone laid in the Wilds.
    protocol = ctx.book.fixed(CAMP_ID, CAMP_NAME, 'unknown');
    target = { kind: 'building', protocolId: protocol.id };
  } else {
    protocol = place;
    if (protocol !== null) target = { kind: 'building', protocolId: protocol.id };
    else if (ctx.guild.has(other) && other !== wallet) target = { kind: 'home', address: other };
    else target = { kind: 'gate' };
  }
  if (protocol !== null) protocol.visits++;

  const steps: JourneyStep[] = [];
  const acts = a.acts ?? [];
  if (acts.length > 1 && a.transfers.some((t) => t.act_id !== undefined)) {
    // An Expedition: one waypoint per sub-action, in order.
    for (const act of acts) {
      const actTransfers = a.transfers.filter((t) => t.act_id === act.id);
      const actName = act.application_metadata?.name;
      let actTarget = target;
      if (actName !== undefined && actName !== '') {
        const p = ctx.book.touch(slugify(actName), actName, { iconUrl: act.application_metadata?.icon?.url });
        if (p.category === 'unknown') {
          p.category = classifyProtocol(p.id, p.name);
          p.building = BUILDING_FOR[p.category];
        }
        actTarget = { kind: 'building', protocolId: p.id };
      }
      steps.push({
        verb: refineVerb(act.type ?? a.operation_type, {
          wallet,
          category: protocol?.category ?? null,
          initiated,
          ins: actTransfers.filter((t) => t.direction === 'in'),
          outs: actTransfers.filter((t) => t.direction === 'out'),
          loanSymbols,
        }),
        target: actTarget,
        give: actTransfers.filter((t) => t.direction === 'out').map(goods),
        get: actTransfers.filter((t) => t.direction === 'in').map(goods),
      });
    }
  } else {
    steps.push({ verb, target, give: outs.map(goods), get: ins.map(goods) });
  }

  const sumIn = ins.reduce((s, t) => s + (t.value ?? 0), 0);
  const sumOut = outs.reduce((s, t) => s + (t.value ?? 0), 0);
  const valueUsd = Math.max(sumIn, sumOut);
  const tier = tierOf(valueUsd);

  const give = describeGoods(outs.map(goods));
  const get = describeGoods(ins.map(goods));
  const where = protocol !== null && target.kind === 'building' && protocol.id !== CAMP_ID ? ` at ${protocol.name}` : '';
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
  if (a.status === 'failed') label = `Failed: ${label}`;
  if (valueUsd > 0) label += ` (${approxUsd(valueUsd)})`;

  return {
    key: a.hash === '' ? raw.id : `${chainId}:${a.hash}`,
    hash: a.hash,
    chainId,
    hero: wallet,
    time,
    status: a.status,
    feeUsd: a.fee?.value ?? null,
    initiated,
    verb,
    steps,
    valueUsd,
    tier,
    drama: dramaFor(verb, tier, a.status),
    counterparty,
    counterpartyHero,
    label,
  };
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
      const j = mapJourney(tx, hero, { book, guild, names, learned });
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
