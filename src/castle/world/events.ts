/**
 * The town's calendar and its occasions (docs/ENGAGEMENT.md B2–B4): what the
 * town dresses for today. The market's mood (a big rise: a festival; a crash:
 * shuttered stalls under the storm), the season (December's snow, late
 * October's pumpkins), the guild's own day (the anniversary of its first
 * transaction: fireworks and a toast), and an airdrop or mint that came lately
 * (a crate at the Wayfarers' Gate). Pure: dates in, flags out; the scene
 * (scene/festive.ts) dresses the town from them.
 */

import type { PriceMood } from '../../domain/risk.js';
import type { Errand } from './world.js';

export interface Occasions {
  /** ETH rose a lot: bunting, lanterns, fireworks at dusk. */
  festival: boolean;
  /** ETH fell a lot: the stalls shut (the storm is the sky's). */
  storm: boolean;
  /** December: snow on the roofs and falling. */
  snow: boolean;
  /** Late October: pumpkins by the doors. */
  pumpkins: boolean;
  /** The guild's day: how many years since its first transaction (null: not today). */
  anniversary: number | null;
}

export const NO_OCCASIONS: Occasions = { festival: false, storm: false, snow: false, pumpkins: false, anniversary: null };

/** Pumpkins from this day of October to its end. */
const PUMPKINS_FROM = 20;

/** The season's dressing on a date (the player's local calendar). */
export function seasonOn(date: Date): { snow: boolean; pumpkins: boolean } {
  const month = date.getMonth();
  return { snow: month === 11, pumpkins: month === 9 && date.getDate() >= PUMPKINS_FROM };
}

/**
 * Whole years since the guild's first transaction when today is its day (null
 * otherwise, or in its first year). One first made on 29 February is kept on
 * the 28th in other years.
 */
export function anniversaryOn(date: Date, firstTx: number | null): number | null {
  if (firstTx === null || !Number.isFinite(firstTx)) return null;
  const first = new Date(firstTx);
  const years = date.getFullYear() - first.getFullYear();
  if (years < 1) return null;
  let day = first.getDate();
  const month = first.getMonth();
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (month === 1 && day === 29 && !leap(date.getFullYear())) day = 28;
  return date.getMonth() === month && date.getDate() === day ? years : null;
}

/** Everything the town dresses for: the market's mood, the date, the guild's first transaction (ms). */
export function occasionsFor(o: { date: Date; mood: PriceMood | null; firstTx: number | null }): Occasions {
  return { festival: o.mood === 'boom', storm: o.mood === 'crash', ...seasonOn(o.date), anniversary: anniversaryOn(o.date, o.firstTx) };
}

/** A pinned day (`?date=2026-12-24`, for looking at an occasion), at local noon; null when not a real date. */
export function pinnedDate(param: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(param ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** The guild's first transaction in the loaded history (ms; null: none). */
export function firstTxTime(errands: readonly Pick<Errand, 'time'>[]): number | null {
  const times = errands.map((e) => e.time).filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.min(...times) : null;
}

/** An airdrop or mint this many days before the latest transaction still has its crate. */
export const DROP_DAYS = 3;

/**
 * The airdrop or mint that leaves a crate at the gate: the latest one that
 * arrived within DROP_DAYS of the guild's latest transaction, and not opened
 * yet (`opened`: errand keys). Null when there is none.
 */
export function freshDrop(errands: readonly Errand[], opened: ReadonlySet<string>, days = DROP_DAYS): Errand | null {
  if (!errands.length) return null;
  const latest = Math.max(...errands.map((e) => e.time));
  const since = latest - days * 86_400_000;
  const drops = errands.filter((e) => (e.verb === 'airdrop' || e.verb === 'mint') && !e.failed && e.direction !== 'inside' && e.time >= since && !opened.has(e.key));
  return drops.reduce<Errand | null>((best, e) => (!best || e.time > best.time ? e : best), null);
}

/** What came in the crate, in a few words: "An airdrop: 1,250 OP", "Freshly minted: Pudgy Penguin #12". */
export function dropLine(errand: Pick<Errand, 'verb' | 'steps'>): string {
  const got = errand.steps.flatMap((s) => s.get);
  const words = got.slice(0, 2).map((g) => (g.isNft ? (g.name ?? g.symbol) : `${amount(g.quantity)} ${g.symbol}`.trim()));
  const what = words.length ? words.join(', ') + (got.length > 2 ? '…' : '') : 'a surprise';
  return `${errand.verb === 'mint' ? 'Freshly minted' : 'An airdrop'}: ${what}`;
}

/** The crates opened (errand keys), kept on this device so an opened one stays opened. */
const OPENED_KEY = 'zenigard/castle/crates-opened';
const OPENED_KEPT = 50;

export function openedCrates(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberCrate(key: string): void {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify([...openedCrates(), key].slice(-OPENED_KEPT)));
  } catch {
    // no storage (a private window): it opens again next time
  }
}

/** A token amount, short: whole numbers from 100, up to four significant digits below. */
function amount(q: number): string {
  if (!Number.isFinite(q) || q <= 0) return '';
  return q >= 100 ? Math.round(q).toLocaleString('en-US') : Number(q.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
