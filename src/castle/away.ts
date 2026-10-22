/**
 * While you were away (docs/ENGAGEMENT.md A1–A3): the last visit to your own
 * castle, kept per realm and set of wallets, and what happened since: the
 * couriers that came and went, what that moved, the new places they went.
 * The summary is pure; the storage is guarded like settings.ts (it can throw,
 * and then nothing is remembered).
 */

import type { CastleWorld, Errand } from './world/world.js';

const VISITS_KEY = 'wallet-landia-v4/castle/visits';
/** At most this many castles remembered (the oldest visit goes). */
const MAX_VISITS = 12;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The card shows only after this long away. */
export const AWAY_MIN_MS = HOUR;

/** A visit to your own castle: when, the latest transaction then, and how far each piece had grown. */
export interface LastVisit {
  at: number;
  /** The newest transaction seen then (null: none was). */
  latest: { time: number; key: string } | null;
  /** The highest tier each piece has reached: the keep, and each wallet's hall by address. */
  tiers: { keep: number; wallets: Record<string, number> };
}

/** Which castle a visit belongs to: the realm and the wallets, in any order. */
export function visitScope(realm: string, wallets: readonly string[]): string {
  return `${realm}|${[...wallets].map((w) => w.toLowerCase()).sort().join(',')}`;
}

/** This visit, to remember: the newest transaction and the tiers (never lower than those reached before). */
export function visitOf(world: Pick<CastleWorld, 'errands' | 'tier' | 'walletIds' | 'walletTiers'>, before: LastVisit | null, now: number): LastVisit {
  let latest = before?.latest ?? null;
  for (const e of world.errands) if (!latest || e.time > latest.time) latest = { time: e.time, key: e.key };
  const wallets: Record<string, number> = { ...(before?.tiers.wallets ?? {}) };
  world.walletIds.forEach((a, i) => {
    const key = a.toLowerCase();
    wallets[key] = Math.max(wallets[key] ?? 0, world.walletTiers[i] ?? 0);
  });
  return { at: now, latest, tiers: { keep: Math.max(before?.tiers.keep ?? 0, world.tier), wallets } };
}

/** What happened while you were away. */
export interface AwaySummary {
  /** How long since the last visit (ms). */
  away: number;
  /** The couriers since, oldest first. */
  errands: Errand[];
  incoming: number;
  outgoing: number;
  /** Between your own wallets. */
  inside: number;
  failed: number;
  burns: number;
  airdrops: number;
  /** What came in less what went out, by token (not NFTs), the largest in value first. */
  net: { symbol: string; quantity: number; usd: number }[];
  nftsIn: number;
  nftsOut: number;
  /** Places the couriers went that they had not before (protocol ids, as they first went). */
  newProtocols: string[];
  /** The one that moved the most. */
  biggest: Errand | null;
}

/** The errands since the last visit: newer than the newest seen then (or than the visit, when none was). */
export function errandsSince(errands: readonly Errand[], visit: LastVisit): Errand[] {
  const after = visit.latest?.time ?? visit.at;
  return errands.filter((e) => e.time > after).sort((a, b) => a.time - b.time);
}

/** The summary of everything since the last visit. Pure. */
export function awaySummary(errands: readonly Errand[], visit: LastVisit, now: number): AwaySummary {
  const since = errandsSince(errands, visit);
  const fresh = new Set(since);
  // the places couriers had been before (as far as the loaded history shows)
  const known = new Set(errands.filter((e) => !fresh.has(e) && e.protocolId !== null).map((e) => e.protocolId));
  const newProtocols: string[] = [];
  const net = new Map<string, { symbol: string; quantity: number; usd: number }>();
  let nftsIn = 0;
  let nftsOut = 0;
  for (const e of since) {
    if (e.protocolId !== null && !e.failed && !known.has(e.protocolId)) {
      known.add(e.protocolId);
      newProtocols.push(e.protocolId);
    }
    // goods passed between your own wallets stay yours; a failed one moved nothing
    if (e.failed || e.direction === 'inside') continue;
    for (const st of e.steps)
      for (const [goods, sign] of [[st.get, 1], [st.give, -1]] as const)
        for (const g of goods) {
          if (g.isNft) {
            if (sign > 0) nftsIn++;
            else nftsOut++;
            continue;
          }
          const t = net.get(g.symbol) ?? { symbol: g.symbol, quantity: 0, usd: 0 };
          t.quantity += sign * g.quantity;
          t.usd += sign * (g.usd ?? 0);
          net.set(g.symbol, t);
        }
  }
  const biggest = since.reduce<Errand | null>((b, e) => (!e.failed && e.valueUsd > (b?.valueUsd ?? 0) ? e : b), null);
  return {
    away: Math.max(0, now - visit.at),
    errands: since,
    incoming: since.filter((e) => e.direction === 'in').length,
    outgoing: since.filter((e) => e.direction === 'out').length,
    inside: since.filter((e) => e.direction === 'inside').length,
    failed: since.filter((e) => e.failed).length,
    burns: since.filter((e) => !e.failed && e.verb === 'burn').length,
    airdrops: since.filter((e) => !e.failed && e.verb === 'airdrop').length,
    net: [...net.values()].filter((t) => Math.abs(t.quantity) > 1e-12).sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd) || a.symbol.localeCompare(b.symbol)),
    nftsIn,
    nftsOut,
    newProtocols,
    biggest,
  };
}

/** Whether the card is worth showing: something happened, and you were gone a while. */
export function worthTelling(s: AwaySummary): boolean {
  return s.errands.length > 0 && s.away > AWAY_MIN_MS;
}

/** "3 hours", "2 days", "5 weeks", "4 months". */
export function awayFor(ms: number): string {
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  if (ms < DAY) return n(Math.max(1, Math.floor(ms / HOUR)), 'hour');
  if (ms < 14 * DAY) return n(Math.floor(ms / DAY), 'day');
  if (ms < 60 * DAY) return n(Math.floor(ms / (7 * DAY)), 'week');
  return n(Math.floor(ms / (30 * DAY)), 'month');
}

// --- kept in the browser -------------------------------------------------------

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): Record<string, LastVisit> {
  try {
    const raw = storage()?.getItem(VISITS_KEY);
    const all: unknown = raw ? JSON.parse(raw) : {};
    return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, LastVisit>) : {};
  } catch {
    return {};
  }
}

/** A stored visit as it should be, or null (an old or broken entry is forgotten). */
export function parseVisit(v: unknown): LastVisit | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<LastVisit>;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  const latest = o.latest && typeof o.latest.time === 'number' && typeof o.latest.key === 'string' ? { time: o.latest.time, key: o.latest.key } : null;
  const t = o.tiers;
  const keep = t && typeof t.keep === 'number' ? t.keep : 0;
  const wallets: Record<string, number> = {};
  if (t && t.wallets && typeof t.wallets === 'object') for (const [a, n] of Object.entries(t.wallets)) if (typeof n === 'number') wallets[a] = n;
  return { at: o.at, latest, tiers: { keep, wallets } };
}

/** The last visit to this castle, or null (the first, or storage unavailable). */
export function loadVisit(scope: string): LastVisit | null {
  return parseVisit(readAll()[scope]);
}

/** Remembers this visit (the oldest castles' are forgotten past MAX_VISITS). */
export function saveVisit(scope: string, visit: LastVisit): void {
  const all = { ...readAll(), [scope]: visit };
  const kept = Object.entries(all)
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .slice(0, MAX_VISITS);
  try {
    storage()?.setItem(VISITS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // storage unavailable or full: this visit is not remembered
  }
}
