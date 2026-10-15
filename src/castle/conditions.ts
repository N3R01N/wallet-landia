/**
 * The realm's conditions, at a glance and on request: how busy the road is
 * (the chain: how full the last blocks were, and the base fee, the toll every
 * courier pays) and how the market moved (ETH now against the player's last
 * visit). A chip in the top bar shows both as signs, never numbers: a
 * three-step road gauge and an arrow for the price, up to two arrows for a
 * big move. Tapping it opens a sheet with the numbers.
 */

import { el, fmtDate } from '../util/dom.js';
import type { BlockBeat } from '../data/rpc.js';
import type { PriceMove } from '../domain/risk.js';
import { factsTable } from './sheets.js';

/** How many recent blocks the road gauge averages. */
const BLOCKS = 10;

export type RoadLevel = 'quiet' | 'busy' | 'crowded';

/** The road from recent blocks' fullness (EIP-1559 aims for half full: above that the toll rises). */
export function roadLevel(fullness: number): RoadLevel {
  return fullness < 0.45 ? 'quiet' : fullness < 0.75 ? 'busy' : 'crowded';
}

const ROAD_WORD: Record<RoadLevel, string> = { quiet: 'Quiet', busy: 'Busy', crowded: 'Crowded' };
const ROAD_NOTE: Record<RoadLevel, string> = {
  quiet: 'Few couriers on the road: the toll is low and steady.',
  busy: 'A steady stream: blocks are about as full as the chain aims for.',
  crowded: 'The road is packed: blocks are fuller than the chain aims for, so the toll climbs with each one.',
};
/** The price's arrow: up to two for a big move, a dash for a small one. */
const ARROW: Record<PriceMove['mood'], string> = { boom: '▲▲', up: '▲', flat: '▬', down: '▼', crash: '▼▼' };
const MOOD_WORD: Record<PriceMove['mood'], string> = { boom: 'Up a lot', up: 'Up a little', flat: 'About the same', down: 'Down a little', crash: 'Down a lot' };

export class Conditions {
  readonly chip = el('button', { class: 'btn conditions-chip', type: 'button', 'aria-label': 'Market and road', title: 'Market and road: the chain and the ETH price' });
  #beats: BlockBeat[] = [];
  #price: { nowUsd: number; move: PriceMove | null } | null = null;

  constructor(open: () => void) {
    this.chip.addEventListener('click', open);
    this.#draw();
  }

  /** A new block (from the heartbeat). */
  block(beat: BlockBeat): void {
    this.#beats.push(beat);
    if (this.#beats.length > BLOCKS) this.#beats.shift();
    this.#draw();
  }

  /** ETH's price now, and how it moved since the last visit (null: no earlier visit to compare). */
  price(nowUsd: number, move: PriceMove | null): void {
    this.#price = { nowUsd, move };
    this.#draw();
  }

  /** The recent blocks' average fullness (null: no block yet). */
  get fullness(): number | null {
    if (!this.#beats.length) return null;
    return this.#beats.reduce((t, b) => t + b.busy, 0) / this.#beats.length;
  }

  #draw(): void {
    const full = this.fullness;
    const level = full === null ? null : roadLevel(full);
    const steps = level === null ? 0 : level === 'quiet' ? 1 : level === 'busy' ? 2 : 3;
    const gauge = el('span', { class: `road-gauge ${level ?? 'unknown'}`, 'aria-hidden': 'true' }, ...[1, 2, 3].map((i) => el('i', { class: i <= steps ? 'on' : '' })));
    const mood = this.#price?.move?.mood ?? null;
    const arrow = el('span', { class: `price-arrow ${mood ?? 'none'}`, 'aria-hidden': 'true' }, mood ? ARROW[mood] : '·');
    this.chip.replaceChildren(el('span', { class: 'chip-label' }, '⛽'), gauge, el('span', { class: 'chip-label' }, 'Ξ'), arrow);
    const words = [level ? `Road: ${ROAD_WORD[level]}` : 'Road: waiting for a block', mood ? `ETH since your last visit: ${MOOD_WORD[mood]}` : 'ETH: no earlier visit to compare'];
    this.chip.setAttribute('aria-label', `Market and road. ${words.join('. ')}.`);
    this.chip.title = words.join(' · ');
  }

  /** The sheet with the numbers. */
  sheet(): HTMLElement {
    const full = this.fullness;
    const last = this.#beats[this.#beats.length - 1];
    const level = full === null ? null : roadLevel(full);
    const out = el('div', { class: 'sheet-content conditions-sheet' });
    out.append(el('h3', {}, 'The road (Ethereum)'));
    if (level === null || !last) out.append(el('p', { class: 'muted' }, 'Waiting for the next block…'));
    else {
      out.append(
        el('p', {}, `${ROAD_WORD[level]}. ${ROAD_NOTE[level]}`),
        factsTable([
          [`Blocks full (last ${this.#beats.length})`, `${Math.round(full! * 100)}%`],
          ['Base fee (the toll)', last.baseFeeGwei === null ? '—' : `${last.baseFeeGwei < 1 ? last.baseFeeGwei.toFixed(3) : last.baseFeeGwei.toFixed(1)} gwei`],
          ['Latest block', `#${last.number.toLocaleString('en-US')} · ${last.txCount} transactions`],
        ]),
      );
    }
    out.append(el('h3', {}, 'The market (ETH)'));
    const p = this.#price;
    if (!p) out.append(el('p', { class: 'muted' }, 'No ETH in the guild to read a price from.'));
    else {
      const m = p.move;
      out.append(
        factsTable([
          ['ETH now', `$${Math.round(p.nowUsd).toLocaleString('en-US')}`],
          m ? ['At your last visit', `$${Math.round(m.thenUsd).toLocaleString('en-US')} · ${fmtDate(m.since)}`] : null,
          m ? ['Change', `${ARROW[m.mood]} ${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}% · ${MOOD_WORD[m.mood]}`] : null,
        ]),
      );
      out.append(el('p', { class: 'muted' }, p.move ? 'The sky follows it too: sun when it rose, rain when it fell, a storm for a big drop.' : 'Come back later: the next visit compares against today.'));
    }
    return out;
  }
}
