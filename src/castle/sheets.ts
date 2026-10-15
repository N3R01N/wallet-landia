/**
 * The bottom sheets for things in the scene: a protocol's building (what it
 * is, what the guild keeps there) and a courier's errand (the transaction:
 * what moved, where, the toll, a link to see it on a block explorer). API
 * strings (token and protocol names) only ever go in as text.
 */

import { el, fmtDate, safeHref, shortAddr } from '../util/dom.js';
import { approxUsd, exactUsd, formatQty } from '../domain/tiers.js';
import { verbText } from '../domain/mappers.js';
import { EXPLORERS, VERB_EXPLAIN } from '../domain/verbs.js';
import type { Goods, Hero, PositionKind } from '../domain/model.js';
import { TIER_NAMES } from './assets/manifest.js';
import { TIER_COLORS } from '../domain/tiers.js';
import { FOCUS_WORD, hallName, nextHall, walletFocus } from './world/halls.js';
import type { Errand, ErrandStep, WorldProtocol } from './world/world.js';

/** What each building category stands for, in plain words. */
const CATEGORY_NOTE: Record<WorldProtocol['category'], string> = {
  lending: 'Lending protocol: the counting house, where coins are lent and borrowed.',
  dex: 'Exchange: the market, where one token is swapped for another.',
  staking: 'Staking: the granary, where coins are put to work for a yield.',
  nft: 'NFT marketplace: the gallery.',
  governance: 'Governance and names: the council hall.',
  bridge: 'Bridge: the harbour, where goods sail to other chains.',
  other: 'A protocol the town has no special building for yet.',
};

const KIND_WORD: Record<PositionKind, string> = {
  deposit: 'deposited',
  loan: 'borrowed',
  staked: 'staked',
  reward: 'reward',
  locked: 'locked',
  investment: 'invested',
  other: 'held',
};

export function protocolSheet(p: WorldProtocol, onMove?: () => void): HTMLElement {
  const out = el(
    'div',
    { class: 'sheet-content' },
    el('p', {}, CATEGORY_NOTE[p.category]),
    el('p', { class: 'muted' }, `Tier ${p.tier} · ${TIER_NAMES[p.tier] ?? '?'} · ${p.visits} visit${p.visits === 1 ? '' : 's'} in the recent history`),
  );
  if (onMove) {
    const move = el('button', { class: 'btn move-building', type: 'button', title: 'Move it to another plot, or swap it with another building' }, '🔨 Move this building');
    move.addEventListener('click', onMove);
    out.append(el('p', {}, move));
  }
  if (p.holdings.length === 0) {
    out.append(el('p', { class: 'muted' }, 'Your guild keeps nothing here now: its couriers only pass through.'));
    return out;
  }
  out.append(el('h3', {}, 'What your guild keeps here'));
  out.append(
    el(
      'ul',
      { class: 'holdings' },
      ...p.holdings.map((h) =>
        el(
          'li',
          { class: h.usd < 0 ? 'debt' : '' },
          el('span', { class: 'holding-name' }, h.label),
          el('span', { class: 'holding-meta muted' }, `${KIND_WORD[h.kind]} · ${shortAddr(h.wallet)}`),
          el('span', { class: 'holding-usd' }, approxUsd(h.usd)),
        ),
      ),
    ),
  );
  if (p.holdings.some((h) => h.usd < 0)) out.append(el('p', { class: 'muted' }, 'Borrowed amounts are debt: they count against what the guild is worth.'));
  return out;
}

const DIRECTION_TEXT: Record<Errand['direction'], string> = {
  out: 'Sent from your guild: the courier crossed the drawbridge and paid the toll at the barrier.',
  in: 'Arrived at your guild: the courier brought it home (whoever sent it paid the toll).',
  inside: 'Between two of your own wallets: carried along the castle walls, it never left the castle.',
};

/** One stop of the Quest Replay: what was done where, goods given and received at exact amounts. */
function stepRow(step: ErrandStep, n: number): HTMLElement {
  const goods = (list: Goods[], sign: '−' | '+') =>
    list.map((g) =>
      el(
        'li',
        { class: sign === '−' ? 'give' : 'get' },
        `${sign} ${formatQty(g.quantity)} ${g.isNft ? (g.name ?? g.symbol) : g.symbol}`,
        el('span', { class: 'muted' }, ` ${g.usd === null ? '' : exactUsd(g.usd)}`),
      ),
    );
  const moved = [...goods(step.give, '−'), ...goods(step.get, '+')];
  return el(
    'li',
    { class: 'replay-step' },
    el('span', { class: 'replay-n', 'aria-hidden': 'true' }, String(n)),
    el(
      'div',
      {},
      el('strong', {}, verbText(step.verb)),
      el('span', { class: 'muted' }, ` · ${step.where}`),
      moved.length ? el('ul', { class: 'replay-goods' }, ...moved) : el('p', { class: 'muted' }, 'Nothing changed hands here.'),
    ),
  );
}

export function errandSheet(e: Errand, protocolName: string | null, onReplay?: () => void): HTMLElement {
  const out = el('div', { class: 'sheet-content' });
  if (e.failed) out.append(el('p', { class: 'failed' }, 'It failed: turned back at the barrier. The toll (the fee) was still paid; nothing else moved.'));
  out.append(el('p', {}, VERB_EXPLAIN[e.verb] ?? 'A transaction.'));
  out.append(el('p', { class: 'muted' }, DIRECTION_TEXT[e.direction]));
  const rows: [string, string][] = [
    ['When', fmtDate(e.time)],
    ['Where', protocolName ?? (e.direction === 'inside' ? 'Inside the castle' : 'Someone outside the town')],
    ['Value', approxUsd(e.valueUsd)],
    ['Toll (fee)', e.feeUsd === null ? '—' : approxUsd(e.feeUsd)],
    ['Wallet', shortAddr(e.wallet)],
  ];
  out.append(el('table', { class: 'facts' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v))))));
  // the Quest Replay: every stop, in order
  if (e.steps.length) {
    out.append(el('h3', {}, e.steps.length === 1 ? 'What happened' : `Step by step · ${e.steps.length} stops`));
    out.append(el('ol', { class: 'replay' }, ...e.steps.map((st, i) => stepRow(st, i + 1))));
  }
  const details = [e.method ? `Method: ${e.method}` : null, e.block !== null ? `Block ${e.block.toLocaleString('en-US')}` : null].filter((x): x is string => x !== null);
  if (details.length) out.append(el('p', { class: 'muted' }, details.join(' · ')));
  if (onReplay) {
    const replay = el('button', { class: 'btn replay-btn', type: 'button' }, '▶ Replay this courier');
    replay.addEventListener('click', onReplay);
    out.append(el('p', {}, replay));
  }
  const base = EXPLORERS[e.chainId];
  const href = base ? safeHref(base + e.hash) : null;
  if (href) out.append(el('p', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'explorer' }, 'See it on the block explorer ↗')));
  return out;
}

/** How many transactions the chronicle lists. */
export const CHRONICLE_LENGTH = 40;

/** The chronicle: the guild's recent transactions, newest first; a row opens its sheet. */
export function chronicleSheet(errands: readonly Errand[], openErrand: (e: Errand) => void): HTMLElement {
  const recent = [...errands].sort((a, b) => b.time - a.time).slice(0, CHRONICLE_LENGTH);
  if (recent.length === 0) return el('div', { class: 'sheet-content' }, el('p', { class: 'muted' }, 'No transactions yet.'));
  const arrow: Record<Errand['direction'], string> = { out: '↗', in: '↙', inside: '↔' };
  return el(
    'div',
    { class: 'sheet-content' },
    el(
      'ul',
      { class: 'chronicle' },
      ...recent.map((e) => {
        const row = el(
          'button',
          { class: `chronicle-row${e.failed ? ' failed' : ''}`, type: 'button', 'data-errand': e.key },
          el('span', { class: 'chronicle-dir', 'aria-hidden': 'true' }, arrow[e.direction]),
          el('span', { class: 'chronicle-label' }, e.label || 'A transaction'),
          el('span', { class: 'chronicle-meta muted' }, `${fmtDate(e.time)}${e.failed ? ' · failed' : ''}`),
          el('span', { class: 'chronicle-usd' }, approxUsd(e.valueUsd)),
        );
        row.addEventListener('click', () => openErrand(e));
        return el('li', {}, row);
      }),
    ),
  );
}

/** A small table of facts (label, value), as the errand's sheet shows them. */
export function factsTable(rows: readonly ([string, string] | null)[]): HTMLElement {
  return el('table', { class: 'facts' }, el('tbody', {}, ...rows.filter((r): r is [string, string] => r !== null).map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v)))));
}

/** What a wallet's sheet needs: the wallet (a hero of the guild), its name and crest, its recent errands. */
export interface WalletSheetData {
  hero: Hero;
  name: string;
  crest: string;
  errands: readonly Errand[];
  /** Protocol names, by id (for its positions). */
  protocolName(id: string): string;
  /** Loans' collateral this wallet holds now (kept in its hall with its NFTs). */
  collateral?: readonly { key: string; goods: Goods }[];
  /** A collateral tile tapped: its sheet. */
  openCollateral?: (key: string) => void;
}

/** NFT tiles shown in a wallet's gallery at most (the rest counted). */
const GALLERY_SHOWN = 24;

/** An NFT tile: its picture (or a framed blank), its name, the tier's colour round it; a padlock for a loan's collateral. */
function nftTile(o: { name: string; collection: string; image: string | null; tier: number | null; collateral: boolean }): HTMLElement {
  const tile = el('div', { class: `nft-tile${o.collateral ? ' collateral' : ''}`, title: o.collateral ? `${o.name} (${o.collection})\nCollateral for a loan you lent: held while it runs` : `${o.name} (${o.collection})` });
  if (o.tier !== null) tile.style.borderColor = TIER_COLORS[o.tier] ?? '';
  const src = o.image && (o.image.startsWith('data:image/') ? o.image : safeHref(o.image));
  if (src) {
    const img = el('img', { class: 'nft-tile-picture', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.src = src;
    img.addEventListener('error', () => img.replaceWith(el('span', { class: 'nft-tile-blank', 'aria-hidden': 'true' }, '🖼')));
    tile.append(img);
  } else tile.append(el('span', { class: 'nft-tile-blank', 'aria-hidden': 'true' }, '🖼'));
  if (o.collateral) tile.append(el('span', { class: 'nft-tile-lock', 'aria-label': 'Collateral' }, '🔒'));
  tile.append(el('span', { class: 'nft-tile-name' }, o.name));
  return tile;
}

/** A wallet's tower or hall: what it is worth, what it holds and keeps where, what it did lately. */
export function walletSheet(d: WalletSheetData, openErrand: (e: Errand) => void, openSettings: () => void): HTMLElement {
  const h = d.hero;
  const next = nextHall(h.netWorth, h.tier);
  const out = el(
    'div',
    { class: 'sheet-content wallet-sheet' },
    el(
      'div',
      { class: 'wallet-head' },
      el('span', { class: 'crest-dot', style: `background:${d.crest}`, 'aria-hidden': 'true' }),
      el('div', {}, el('strong', {}, d.name), el('div', { class: 'muted' }, shortAddr(h.address))),
    ),
    factsTable([
      ['Worth', approxUsd(h.netWorth)],
      ['Tier', `${h.tier} · ${TIER_NAMES[h.tier] ?? '?'}`],
      ['Hall', `${hallName(h.tier)} · mostly ${FOCUS_WORD[walletFocus(h)]}`],
      ['Next hall', next ? `${next.name}: ${approxUsd(next.needUsd)} more` : 'None: a palace spire is the top'],
      ['Tokens and positions', approxUsd(h.tokenWorth)],
      h.nftWorth > 0 ? ['NFTs (floor)', approxUsd(h.nftWorth)] : null,
      ['Last active', h.lastActiveAt ? fmtDate(h.lastActiveAt) : '—'],
    ]),
  );
  const coins = [...h.items].filter((i) => (i.usd ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 6);
  if (coins.length) {
    out.append(el('h3', {}, 'In the treasury'));
    out.append(el('ul', { class: 'holdings' }, ...coins.map((i) => el('li', {}, el('span', { class: 'holding-name' }, i.symbol), el('span', { class: 'holding-meta muted' }, formatQty(i.quantity)), el('span', { class: 'holding-usd' }, approxUsd(i.usd ?? 0))))));
  }
  // the gallery: the NFTs it holds, and loans' collateral kept with them (as the old town's gallery had it)
  const held = d.collateral ?? [];
  if (h.nfts.length || held.length) {
    out.append(el('h3', {}, `Gallery (${h.nfts.length + held.length})`));
    const tiles: HTMLElement[] = [];
    for (const c of held) {
      const t = nftTile({ name: c.goods.name ?? c.goods.symbol, collection: c.goods.symbol, image: c.goods.image ?? null, tier: null, collateral: true });
      if (d.openCollateral) {
        const b = el('button', { class: 'nft-tile-button', type: 'button', 'aria-label': `Collateral: ${c.goods.name ?? c.goods.symbol}` }, t);
        b.addEventListener('click', () => d.openCollateral!(c.key));
        tiles.push(b);
      } else tiles.push(t);
    }
    for (const n of h.nfts) tiles.push(nftTile({ name: n.name, collection: n.symbol, image: n.iconUrl, tier: n.tier, collateral: false }));
    out.append(el('div', { class: 'nft-gallery' }, ...tiles.slice(0, GALLERY_SHOWN)));
    if (tiles.length > GALLERY_SHOWN) out.append(el('p', { class: 'muted' }, `and ${tiles.length - GALLERY_SHOWN} more`));
    if (held.length) out.append(el('p', { class: 'muted small' }, '🔒 Collateral for loans you lent at Gondi: kept here while each loan runs, taken back when it ends.'));
  }
  const stashes = [...h.stashes].sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)).slice(0, 6);
  if (stashes.length) {
    out.append(el('h3', {}, 'Kept in the town'));
    out.append(el('ul', { class: 'holdings' }, ...stashes.map((st) => el('li', { class: st.netUsd < 0 ? 'debt' : '' }, el('span', { class: 'holding-name' }, d.protocolName(st.protocolId)), el('span', { class: 'holding-meta muted' }, st.hasDebt ? 'with a loan' : st.hasRewards ? 'earning rewards' : ''), el('span', { class: 'holding-usd' }, approxUsd(st.netUsd))))));
  }
  const recent = [...d.errands].reverse().slice(0, 5);
  if (recent.length) {
    out.append(el('h3', {}, 'Lately'));
    const list = el('ul', { class: 'chronicle' });
    for (const e of recent) {
      const arrow = e.direction === 'out' ? '↗' : e.direction === 'in' ? '↙' : '↔';
      const row = el(
        'button',
        { class: `chronicle-row${e.failed ? ' failed' : ''}`, type: 'button' },
        el('span', { class: 'chronicle-dir', 'aria-hidden': 'true' }, arrow),
        el('span', { class: 'chronicle-label' }, e.label || 'A transaction'),
        el('span', { class: 'chronicle-meta muted' }, fmtDate(e.time)),
        el('span', { class: 'chronicle-usd' }, approxUsd(e.valueUsd)),
      );
      row.addEventListener('click', () => openErrand(e));
      list.append(el('li', {}, row));
    }
    out.append(list);
  }
  const edit = el('button', { class: 'btn', type: 'button' }, '⚙ Name, crest colour, remove…');
  edit.addEventListener('click', openSettings);
  out.append(el('p', {}, edit));
  return out;
}

/** What the keep's sheet needs: the guild and its wallets, and the player's standing. */
export interface GuildSheetData {
  wallets: { name: string; crest: string; worth: number; tier: number; address: string }[];
  worth: number;
  tier: number;
  protocols: number;
  errands: number;
  level: string | null;
  xp: string | null;
}

/** The keep: the guild as a whole (its worth, its wallets) and the player's standing. */
export function guildSheet(d: GuildSheetData, openWallet: (index: number) => void, openBadges: () => void): HTMLElement {
  const out = el(
    'div',
    { class: 'sheet-content guild-sheet' },
    factsTable([
      ['The guild is worth', approxUsd(d.worth)],
      ['Tier', `${d.tier} · ${TIER_NAMES[d.tier] ?? '?'}`],
      ['Wallets', String(d.wallets.length)],
      ['Protocols in town', String(d.protocols)],
      ['Recent transactions', String(d.errands)],
      d.level ? ['Your standing', d.level] : null,
    ]),
  );
  if (d.xp) out.append(el('p', { class: 'muted' }, d.xp));
  out.append(el('h3', {}, 'The wallets'));
  const list = el('ul', { class: 'chronicle' });
  d.wallets.forEach((w, i) => {
    const row = el(
      'button',
      { class: 'chronicle-row', type: 'button' },
      el('span', { class: 'chronicle-dir' }, el('span', { class: 'crest-dot', style: `background:${w.crest}`, 'aria-hidden': 'true' })),
      el('span', { class: 'chronicle-label' }, w.name),
      el('span', { class: 'chronicle-meta muted' }, `Tier ${w.tier} · ${TIER_NAMES[w.tier] ?? ''}`),
      el('span', { class: 'chronicle-usd' }, approxUsd(w.worth)),
    );
    row.addEventListener('click', () => openWallet(i));
    list.append(el('li', {}, row));
  });
  out.append(list);
  const badges = el('button', { class: 'btn', type: 'button' }, 'Badges and quests');
  badges.addEventListener('click', openBadges);
  out.append(el('p', {}, badges));
  return out;
}

/** A townsperson's sheet: an NPC (not a player), whose building, and what they just said. */
export function personSheet(who: { role: string; building: string | null }, line: string | null, openBuilding?: () => void): HTMLElement {
  const out = el(
    'div',
    { class: 'sheet-content person-sheet' },
    el('p', {}, el('span', { class: 'npc-tag' }, 'NPC'), ' A townsperson of the game, not a player or a wallet.'),
    el('p', {}, who.building ? `Belongs to ${who.building}.` : 'A villager: belongs to no building.'),
  );
  if (line) out.append(el('blockquote', { class: 'person-line' }, `“${line}”`));
  if (openBuilding && who.building) {
    const go = el('button', { class: 'btn', type: 'button' }, `Open ${who.building}`);
    go.addEventListener('click', openBuilding);
    out.append(el('p', {}, go));
  }
  out.append(el('p', { class: 'muted' }, 'Their talk follows the chain: the ETH price since your last visit, how busy the road is, and their own trade. Tap again to hear more.'));
  return out;
}

/** Decimal places of the tokens Gondi lends in. */
const PRINCIPAL_DECIMALS: Record<string, [string, number]> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': ['WETH', 18],
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': ['USDC', 6],
  '0x6b175474e89094c44da98b954eedeac495271d0f': ['DAI', 18],
  '0xdac17f958d2ee523a2206206994597c13d831ec7': ['USDT', 6],
};

/** A loan's collateral the guild holds (a Gondi loan it lent): what NFT, against how much, since when, what happens next. */
export function collateralSheet(d: {
  loan: { collection: string; tokenId: string; borrower: string; principal: string; amount: string };
  goods: Goods;
  since: number | null;
  wallet: string;
}, all: readonly { key: string; name: string; current: boolean }[] = [], open?: (key: string) => void): HTMLElement {
  const [symbol, decimals] = PRINCIPAL_DECIMALS[d.loan.principal] ?? ['tokens', 18];
  const amount = Number(BigInt(d.loan.amount) / 10n ** BigInt(Math.max(0, decimals - 4))) / 1e4;
  const out = el(
    'div',
    { class: 'sheet-content collateral-sheet' },
    el('p', {}, `${d.goods.name ?? 'An NFT'} stands for a loan you lent at Gondi.`),
  );
  if (d.goods.image) out.append(el('img', { class: 'collateral-picture', src: d.goods.image.startsWith('data:') ? d.goods.image : `/api/image?u=${encodeURIComponent(d.goods.image)}`, alt: d.goods.name ?? 'The NFT', loading: 'lazy' }));
  out.append(
    factsTable([
      ['Collection', d.goods.symbol],
      ['Token', `#${d.loan.tokenId}`],
      ['You lent', `${amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${symbol}`],
      ['Borrower', shortAddr(d.loan.borrower)],
      ['Lent from', d.wallet],
      d.since ? ['Since', fmtDate(d.since)] : null,
    ]),
    el('p', { class: 'muted' }, 'Gondi keeps the NFT in escrow while the loan runs. When the borrower repays, it goes back to them; if they don’t repay in time, it becomes yours.'),
  );
  const link = safeHref(`https://opensea.io/assets/ethereum/${d.loan.collection}/${d.loan.tokenId}`);
  if (link) out.append(el('p', {}, el('a', { href: link, target: '_blank', rel: 'noopener' }, 'See it on OpenSea ↗')));
  // every loan running now (the courtyard shows as many as fit)
  if (all.length > 1 && open) {
    out.append(el('h3', {}, `All your collateral (${all.length})`));
    out.append(
      el(
        'div',
        { class: 'collateral-list' },
        ...all.map((c) => {
          const row = el('button', { class: `chronicle-row${c.current ? ' current' : ''}`, type: 'button' }, `🔒 ${c.name}`);
          row.addEventListener('click', () => open(c.key));
          return row;
        }),
      ),
    );
  }
  return out;
}
