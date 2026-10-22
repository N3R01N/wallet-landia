/**
 * What a notification says when couriers come and go for your own wallets
 * while the tab is in the background (docs/ENGAGEMENT.md D1): one line for a
 * courier ("A courier brought you 0.5 ETH"), one notification for a burst
 * ("3 couriers came and went"). Pure.
 */

import type { Goods } from '../domain/model.js';
import type { Errand } from './world/world.js';
import { goodsLabel } from './scene/exchange.js';

export interface Note {
  title: string;
  body: string;
}

/** Lines listed under a burst's title; the rest are counted. */
const BURST_LINES = 3;

/** What a courier carried one way, the most valuable first (a loan's collateral is not the courier's to tell). */
function carried(e: Errand, incoming: boolean): Goods[] {
  const all = e.steps.flatMap((s) => (incoming ? s.get : s.give)).filter((g) => !g.collateral);
  return all.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

/** "0.5 ETH", "1,200 USDC": as the coins' labels word them (exchange.ts), without the sign or trailing zeros. */
function goodsWords(g: Goods): string {
  if (g.isNft || !g.symbol || g.quantity >= 1) return goodsLabel(g, true).replace(/^\+/, '');
  return `${g.quantity.toLocaleString('en-US', { maximumSignificantDigits: 2 })} ${g.symbol}`;
}

/** "0.5 ETH", "1,200 USDC and 2 more". */
function amount(goods: Goods[]): string {
  const first = goods[0];
  if (!first) return '';
  const label = goodsWords(first);
  return goods.length > 1 ? `${label} and ${goods.length - 1} more` : label;
}

/** One courier, in a line. `place`: a protocol's name from its id. */
export function courierLine(e: Errand, place: (id: string) => string): string {
  const where = e.protocolId !== null ? place(e.protocolId) : null;
  if (e.failed) return where ? `A courier was turned back on the way to ${where}` : 'A courier was turned back';
  const give = amount(carried(e, false));
  const get = amount(carried(e, true));
  if (e.direction === 'inside') return give || get ? `A courier carried ${give || get} between your wallets` : 'A courier went between your wallets';
  if (e.direction === 'in') {
    if (get) return `A courier brought you ${get}${where ? ` from ${where}` : ''}`;
    return where ? `A courier came from ${where}` : 'A courier came in';
  }
  if (give && get) return `A courier traded ${give} for ${get}${where ? ` at ${where}` : ''}`;
  if (give) return where ? `A courier took ${give} to ${where}` : `A courier took ${give} away`;
  if (get) return `A courier brought back ${get}${where ? ` from ${where}` : ''}`;
  return where ? `A courier went to ${where}` : 'A courier went out';
}

/** A burst's title: "3 couriers came in", "2 couriers went out", "4 couriers came and went". */
export function burstTitle(errands: readonly Errand[]): string {
  const n = errands.length;
  const ways = new Set(errands.map((e) => e.direction));
  if (ways.size === 1 && ways.has('in')) return `${n} couriers came in`;
  if (ways.size === 1 && ways.has('out')) return `${n} couriers went out`;
  if (ways.size === 1 && ways.has('inside')) return `${n} couriers went between your wallets`;
  return `${n} couriers came and went`;
}

/**
 * The one notification for these couriers (oldest first), or null for none.
 * One: its line, and the wallet it was for. More: how many, and the first
 * few lines.
 */
export function courierNote(errands: readonly Errand[], place: (id: string) => string, walletName: (address: string) => string): Note | null {
  const list = [...errands].sort((a, b) => a.time - b.time);
  const only = list[0];
  if (!only) return null;
  if (list.length === 1) return { title: courierLine(only, place), body: walletName(only.wallet) };
  const lines = list.slice(0, BURST_LINES).map((e) => courierLine(e, place));
  if (list.length > BURST_LINES) lines.push(`and ${list.length - BURST_LINES} more`);
  return { title: burstTitle(list), body: lines.join('\n') };
}
