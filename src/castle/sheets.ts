/**
 * The bottom sheets for things in the scene: a protocol's building (what it
 * is, what the guild keeps there) and a courier's errand (the transaction:
 * what moved, where, the toll, a link to see it on a block explorer). API
 * strings (token and protocol names) only ever go in as text.
 */

import { el, fmtDate, safeHref, shortAddr } from '../ui/dom.js';
import { approxUsd } from '../domain/tiers.js';
import { EXPLORERS, VERB_EXPLAIN } from '../domain/verbs.js';
import type { PositionKind } from '../domain/model.js';
import { TIER_NAMES } from './assets/manifest.js';
import type { Errand, WorldProtocol } from './world/world.js';

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

export function errandSheet(e: Errand, protocolName: string | null): HTMLElement {
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
