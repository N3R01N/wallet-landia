/**
 * Realms (Phase 6): each chain is a realm. Ethereum is the kingdom; the L2s
 * that settle on it are its vassal provinces, each with a town of its own.
 * A hero is the same person everywhere (their mount and home come from all
 * they own); what differs per realm is what they keep there, which
 * protocols stand in that town, and which quests happened on that chain.
 *
 * Bridges join realms: a hero sends goods through a bridge on one chain and
 * they arrive on another. The two transactions are linked here, so each side
 * can point at the other.
 */

import { summarizeStash, type Goods, type Guild, type Hero, type Journey, type Stash } from './model.js';

export interface Realm {
  id: string;
  name: string;
  /** "The Kingdom of Ethereum", "The Province of Base". */
  title: string;
  kind: 'kingdom' | 'province';
  /** Banner colour on the Realm Map. */
  color: string;
  /** One line for newcomers: what this chain is. */
  about: string;
}

export const REALMS: Record<string, Realm> = {
  ethereum: { id: 'ethereum', name: 'Ethereum', title: 'The Kingdom of Ethereum', kind: 'kingdom', color: '#7b8fd9', about: 'The main chain. Its blocks settle everything; the provinces write their records back to it.' },
  base: { id: 'base', name: 'Base', title: 'The Province of Base', kind: 'province', color: '#2f6bff', about: 'An Ethereum L2 run by Coinbase: cheaper, faster transactions, settled back on Ethereum.' },
  arbitrum: { id: 'arbitrum', name: 'Arbitrum', title: 'The Province of Arbitrum', kind: 'province', color: '#28a0f0', about: 'An Ethereum L2 (an optimistic rollup): cheaper, faster transactions, settled back on Ethereum.' },
  optimism: { id: 'optimism', name: 'Optimism', title: 'The Province of Optimism', kind: 'province', color: '#ff0420', about: 'An Ethereum L2 (an optimistic rollup, the OP Stack): cheaper, faster transactions, settled back on Ethereum.' },
};

/** Any chain as a realm (one we have no lore for is a far province, named after its id). */
export function realmOf(chainId: string): Realm {
  const known = REALMS[chainId];
  if (known) return known;
  const name = chainId.replace(/(^|-)(\w)/g, (_m, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase());
  return { id: chainId, name, title: `The Province of ${name}`, kind: 'province', color: '#9a8f80', about: 'Another chain the indexer knows.' };
}

/** What one realm holds for the guild, for the Realm Map. */
export interface RealmSummary {
  realm: Realm;
  /** Tokens, positions and NFTs kept there (USD; NFTs at floor). */
  usd: number;
  /** Heroes with anything there, or any quest there. */
  heroes: number;
  /** Quests on that chain in the loaded window. */
  journeys: number;
  /** Bridge crossings to or from it. */
  crossings: number;
  lastActiveAt: number | null;
}

/** Every realm in `chains` (in that order), plus any other chain the guild turns out to use. */
export function realmSummaries(guild: Guild, chains: readonly string[]): RealmSummary[] {
  const ids = new Set(chains);
  for (const h of guild.heroes) for (const it of [...h.items, ...h.nfts]) if (it.chainId !== 'unknown') ids.add(it.chainId);
  for (const j of guild.journeys) if (j.chainId !== 'unknown') ids.add(j.chainId);
  return [...ids].map((id) => {
    const rg = realmGuild(guild, id);
    const usd = rg.heroes.reduce((s, h) => s + realmWorth(h), 0);
    const crossings = guild.journeys.filter((j) => j.bridge && (j.bridge.from === id || j.bridge.to === id) && j.chainId === j.bridge.from).length;
    const last = rg.journeys.reduce<number | null>((m, j) => (m === null || j.time > m ? j.time : m), null);
    return { realm: realmOf(id), usd, heroes: rg.heroes.filter((h) => realmWorth(h) >= 1 || rg.journeys.some((j) => j.hero === h.address)).length, journeys: rg.journeys.length, crossings, lastActiveAt: last };
  });
}

/** What a hero keeps in their current (realm) guild. */
function realmWorth(h: Hero): number {
  return h.items.reduce((s, i) => s + (i.usd ?? 0), 0) + h.nfts.reduce((s, i) => s + (i.usd ?? 0), 0) + h.stashes.reduce((s, x) => s + x.netUsd, 0);
}

/**
 * The guild as it stands in one realm: every hero (so homes and mounts stay
 * the same everywhere), with only what they keep on that chain, the quests
 * that happened there, and the protocols those touch.
 */
export function realmGuild(guild: Guild, chainId: string): Guild {
  const journeys = guild.journeys.filter((j) => j.chainId === chainId);
  const heroes = guild.heroes.map((h): Hero => {
    const stashes = h.stashes.flatMap((s): Stash[] => {
      const entries = s.entries.filter((e) => e.chainId === chainId);
      if (entries.length === 0) return [];
      return [{ ...s, ...summarizeStash(entries) }];
    });
    return { ...h, items: h.items.filter((i) => i.chainId === chainId), nfts: h.nfts.filter((i) => i.chainId === chainId), stashes };
  });
  // the protocols that stand in this town: visited here, or keeping something here
  const visits = new Map<string, number>();
  for (const j of journeys) for (const st of j.steps) if (st.target.kind === 'building') visits.set(st.target.protocolId, (visits.get(st.target.protocolId) ?? 0) + 1);
  for (const h of heroes) for (const s of h.stashes) if (!visits.has(s.protocolId)) visits.set(s.protocolId, 0);
  const protocols = new Map([...guild.protocols].filter(([id]) => visits.has(id)).map(([id, p]) => [id, { ...p, visits: visits.get(id) ?? 0 }]));
  return { ...guild, heroes, journeys, protocols };
}

// --- bridges -------------------------------------------------------------------

/** The same asset under its usual bridged names (WETH is ETH on the far side, USDC.e is USDC…). */
function canonical(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\.E$/, '');
  return s === 'WETH' ? 'ETH' : s === 'USDBC' ? 'USDC' : s;
}

/** How long a crossing may take (most bridges land in minutes; the slow ones within hours). */
const CROSSING_MS = 6 * 3_600_000;

/**
 * Link each bridge crossing to its arrival on the other chain: the same hero
 * receives the same asset (by its usual name), a little less of it after the
 * bridge's fee, within a few hours. Unmatched crossings keep `to: null`.
 */
export function linkBridges(journeys: Journey[]): void {
  const taken = new Set<string>();
  const sent = (j: Journey): Goods[] => j.steps.flatMap((s) => s.give).filter((g) => !g.isNft);
  for (const j of journeys) {
    if (j.verb !== 'bridge' || !j.initiated || j.bridge !== undefined) continue;
    const out = sent(j);
    // an arrival is something that came in (a receive, or the bridge's own landing), not a later
    // swap of the same coin by the same hero; of those, the one closest in time
    let arrival: Journey | undefined;
    for (const r of journeys) {
      if (r === j || r.chainId === j.chainId || r.hero !== j.hero || taken.has(r.key) || r.bridge !== undefined) continue;
      if (r.initiated && r.verb !== 'bridge' && r.verb !== 'receive') continue;
      if (r.time < j.time - 60_000 || r.time > j.time + CROSSING_MS) continue;
      if (arrival && Math.abs(r.time - j.time) >= Math.abs(arrival.time - j.time)) continue;
      const got = r.steps.flatMap((s) => s.get).filter((g) => !g.isNft);
      if (out.some((g) => got.some((x) => canonical(x.symbol) === canonical(g.symbol) && x.quantity <= g.quantity * 1.01 && x.quantity >= g.quantity * 0.85))) arrival = r;
    }
    if (arrival) {
      taken.add(arrival.key);
      j.bridge = { from: j.chainId, to: arrival.chainId, pair: arrival.key };
      arrival.bridge = { from: j.chainId, to: arrival.chainId, pair: j.key };
    } else j.bridge = { from: j.chainId, to: null, pair: null };
  }
}
