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
import type { Goods, PositionKind } from '../domain/model.js';
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
