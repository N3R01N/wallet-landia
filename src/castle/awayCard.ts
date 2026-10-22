/**
 * The herald's card on opening your castle (docs/ENGAGEMENT.md A3): what
 * happened while you were away, in a few short lines, with "Watch them"
 * (the replay of just those couriers) and "Later".
 */

import { el } from '../util/dom.js';
import { approxUsd, formatQty } from '../domain/tiers.js';
import { awayFor, type AwaySummary } from './away.js';

/** At most this many tokens in the "came and went" line. */
const NET_SHOWN = 3;
/** At most this many new places named. */
const PLACES_SHOWN = 3;

/** A quantity, short ("0.2", not "0.200"). */
const qty = (q: number) => (q < 1 ? String(Number(q.toPrecision(3))) : formatQty(q));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The card's lines, plain words (pure, for the tests). */
export function awayLines(s: AwaySummary, protocolName: (id: string) => string): string[] {
  const lines: string[] = [];
  const ways = [s.incoming && `${s.incoming} came in`, s.outgoing && `${s.outgoing} went out`, s.inside && `${s.inside} between your wallets`].filter(Boolean);
  lines.push(`${plural(s.errands.length, 'courier')}: ${ways.join(', ')}.`);
  const net = s.net.slice(0, NET_SHOWN).map((t) => `${t.quantity > 0 ? '+' : '−'}${qty(Math.abs(t.quantity))} ${t.symbol}`);
  const nfts = [s.nftsIn && `+${plural(s.nftsIn, 'NFT')}`, s.nftsOut && `−${plural(s.nftsOut, 'NFT')}`].filter(Boolean);
  if (net.length || nfts.length) lines.push(`On balance: ${[...net, ...nfts].join(', ')}.`);
  if (s.newProtocols.length) {
    const names = s.newProtocols.slice(0, PLACES_SHOWN).map(protocolName);
    const more = s.newProtocols.length - names.length;
    lines.push(`Somewhere new: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`);
  }
  const extras = [s.airdrops && plural(s.airdrops, 'airdrop'), s.burns && `${plural(s.burns, 'burn')}`, s.failed && `${s.failed} that failed`].filter(Boolean);
  if (extras.length) lines.push(`Also ${extras.join(', ')}.`);
  // (a label often says its value already)
  const big = s.biggest;
  if (big && big.valueUsd >= 1) lines.push(`The biggest: ${big.label || 'a transaction'}${big.label.includes('$') ? '' : `, ${approxUsd(big.valueUsd)}`}.`);
  return lines;
}

/** The card; `watch` replays those couriers, `later` (or Esc) closes it. */
export function awayCard(s: AwaySummary, protocolName: (id: string) => string, act: { watch: () => void; later: () => void }): HTMLElement {
  const watch = el('button', { class: 'btn away-watch', type: 'button' }, '▶ Watch them');
  const later = el('button', { class: 'btn away-later', type: 'button' }, 'Later');
  const card = el(
    'section',
    { class: 'away-card', role: 'dialog', 'aria-label': 'While you were away', 'data-count': String(s.errands.length) },
    el('h3', {}, `While you were away (${awayFor(s.away)})`),
    ...awayLines(s, protocolName).map((l) => el('p', {}, l)),
    el('div', { class: 'away-actions' }, later, watch),
  );
  const close = () => {
    card.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && card.isConnected) {
      close();
      act.later();
    }
  };
  document.addEventListener('keydown', onKey);
  watch.addEventListener('click', () => {
    close();
    act.watch();
  });
  later.addEventListener('click', () => {
    close();
    act.later();
  });
  return card;
}
