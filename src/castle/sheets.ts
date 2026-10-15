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

export function protocolSheet(p: WorldProtocol): HTMLElement {
  const out = el(
    'div',
    { class: 'sheet-content' },
    el('p', {}, CATEGORY_NOTE[p.category]),
    el('p', { class: 'muted' }, `Tier ${p.tier} · ${TIER_NAMES[p.tier] ?? '?'} · ${p.visits} visit${p.visits === 1 ? '' : 's'} in the recent history`),
  );
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
}

/** A wallet's tower or hall: what it is worth, what it holds and keeps where, what it did lately. */
export function walletSheet(d: WalletSheetData, openErrand: (e: Errand) => void, openSettings: () => void): HTMLElement {
  const h = d.hero;
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
