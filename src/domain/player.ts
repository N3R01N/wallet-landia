/**
 * The player (lifetime history, H3): one person behind all their wallets.
 * Their badges and level come from everything those wallets ever did (the
 * lifetime ledger), not from the window the town replays.
 *
 * - Badges are the medals of `feats.ts`, earned once by the player (by
 *   whichever wallet got there first). Those that can be repeated gain tiers:
 *   bronze, silver and gold at 1, 10 and 100. Each tier remembers when, which
 *   wallet and which transaction earned it.
 * - The level rewards breadth and time, never wealth (wealth already shows in
 *   homes and mounts): trying each kind of action, protocol and chain;
 *   months active; how long ago it all began; badge tiers. Repeating the same
 *   thing earns less each time (a log curve), so spam cannot farm it.
 *
 * Pure: the same history gives the same profile on any device.
 */

import type { Guild, Hero, Journey, Verb } from './model.js';
import { ALL_MEDALS, medalRules, walkSeen, type Medal } from './feats.js';

/** Counts at which a repeatable badge reaches bronze, silver, gold. */
export const BADGE_TIERS = [1, 10, 100] as const;
export const BADGE_TIER_NAMES = ['', 'bronze', 'silver', 'gold'] as const;

/** Badges that are a milestone or a state, not something repeated: one tier only. */
const SINGLE = new Set(['survived', 'explorer', 'veteran', 'steward', 'hoard']);

export interface Provenance {
  /** When (ms), or null for what is held now. */
  at: number | null;
  /** The wallet that earned it. */
  wallet: string;
  /** The transaction (journey key), or null for a holding. */
  journey: string | null;
}

export interface PlayerBadge {
  medal: Medal;
  /** Qualifying journeys over the whole history (1 for single badges and holdings). */
  count: number;
  /** 1 bronze … 3 gold (single badges: 1). */
  tier: 1 | 2 | 3;
  single: boolean;
  /** How each tier was reached, in order (the first is when the badge was earned). */
  tiers: Provenance[];
}

export interface PlayerStats {
  wallets: number;
  /** Signed by the player (paid a toll), and arrived without them lifting a finger. */
  signed: number;
  received: number;
  firstAt: number | null;
  lastAt: number | null;
  chains: string[];
  protocols: number;
  /** Different kinds of action signed. */
  kinds: number;
  activeMonths: number;
}

export interface PlayerProfile {
  xp: number;
  level: number;
  /** XP where this level began and where the next one begins. */
  levelXp: number;
  nextXp: number;
  rank: string;
  badges: Map<string, PlayerBadge>;
  stats: PlayerStats;
  /** Where the XP came from, for the sheet. */
  parts: { label: string; xp: number }[];
}

/** XP needed to reach a level (level 1 at 0). A gentle curve: early levels come quickly, later ones take years. */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(60 * (level - 1) ** 1.7);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

const RANKS: [number, string][] = [
  [1, 'Wanderer'],
  [5, 'Squire'],
  [10, 'Knight'],
  [20, 'Captain'],
  [30, 'Lord'],
  [45, 'Legend'],
];

export function rankOf(level: number): string {
  let out = RANKS[0]![1];
  for (const [from, name] of RANKS) if (level >= from) out = name;
  return out;
}

const MONTH = (t: number): string => new Date(t).toISOString().slice(0, 7);
const curve = (n: number, per: number): number => per * Math.log2(1 + n);

/**
 * The player's profile from their lifetime guild (all their wallets' whole
 * history, mapped with no window). `remembered`: badges seen before (by
 * medal id, when) that the loaded history no longer shows; kept, as bronze.
 */
export function playerProfile(guild: Guild, remembered: ReadonlyMap<string, Provenance> = new Map(), now = Date.now()): PlayerProfile {
  const mine = new Set(guild.heroes.map((h) => h.address));
  // each journey once (a send between your own wallets is one journey), oldest first
  const journeys = guild.journeys.filter((j) => mine.has(j.hero)).sort((a, b) => a.time - b.time);
  const badges = lifetimeBadges(journeys, guild.heroes);
  for (const [id, p] of remembered) {
    if (badges.has(id)) continue;
    const medal = ALL_MEDALS.find((m) => m.id === id);
    if (medal) badges.set(id, { medal, count: 1, tier: 1, single: SINGLE.has(id), tiers: [p] });
  }

  // --- XP: breadth and time ---
  const signed = journeys.filter((j) => j.initiated && j.status === 'confirmed');
  const received = journeys.filter((j) => !j.initiated && j.status === 'confirmed');
  const byVerb = new Map<Verb, number>();
  for (const j of signed) byVerb.set(j.verb, (byVerb.get(j.verb) ?? 0) + 1);
  const gotByVerb = new Map<Verb, number>();
  for (const j of received) gotByVerb.set(j.verb, (gotByVerb.get(j.verb) ?? 0) + 1);
  const protocols = new Set<string>();
  for (const j of signed) for (const s of j.steps) if (s.target.kind === 'building') protocols.add(s.target.protocolId);
  const chains = [...new Set(signed.map((j) => j.chainId))].sort();
  const months = new Set(signed.map((j) => MONTH(j.time)));
  const firstAt = journeys[0]?.time ?? null;
  const lastAt = journeys.at(-1)?.time ?? null;
  const ageMonths = firstAt === null ? 0 : Math.min(240, Math.floor((now - firstAt) / (30.44 * 86_400_000)));

  const earnedTiers = [...badges.values()].filter((b) => b.medal.id !== 'hoard').reduce((s, b) => s + b.tier, 0);
  const parts = [
    { label: 'Journeys signed (each kind counts less the more you repeat it)', xp: [...byVerb.values()].reduce((s, n) => s + curve(n, 20), 0) },
    { label: 'Things that came to you', xp: [...gotByVerb.values()].reduce((s, n) => s + curve(n, 5), 0) },
    { label: `Kinds of journey tried (${byVerb.size})`, xp: byVerb.size * 40 },
    { label: `Buildings visited (${protocols.size})`, xp: protocols.size * 30 },
    { label: `Realms travelled (${chains.length})`, xp: chains.length * 80 },
    { label: `Months active (${months.size})`, xp: months.size * 25 },
    { label: `Months since your first journey (${ageMonths})`, xp: ageMonths * 4 },
    // (the Dragon's Hoard is wealth, which the level leaves alone)
    { label: `Badge tiers (${earnedTiers})`, xp: [...badges.values()].filter((b) => b.medal.id !== 'hoard').reduce((s, b) => s + [0, 50, 150, 350][b.tier]!, 0) },
  ].map((p) => ({ ...p, xp: Math.round(p.xp) }));
  const xp = parts.reduce((s, p) => s + p.xp, 0);
  const level = levelForXp(xp);
  return {
    xp,
    level,
    levelXp: xpForLevel(level),
    nextXp: xpForLevel(level + 1),
    rank: rankOf(level),
    badges,
    parts,
    stats: { wallets: guild.heroes.length, signed: signed.length, received: received.length, firstAt, lastAt, chains, protocols: protocols.size, kinds: byVerb.size, activeMonths: months.size },
  };
}

/** Every badge over the whole history, walking all wallets' journeys together, oldest first. */
function lifetimeBadges(journeys: readonly Journey[], heroes: readonly Hero[]): Map<string, PlayerBadge> {
  const out = new Map<string, PlayerBadge>();
  const rules = medalRules();
  walkSeen(journeys, (j, seen) => {
    for (const r of rules) {
      if (!r.journey?.(j, seen)) continue;
      const single = SINGLE.has(r.medal.id);
      const b = out.get(r.medal.id);
      const here: Provenance = { at: j.time, wallet: j.hero, journey: j.key };
      if (b === undefined) out.set(r.medal.id, { medal: r.medal, count: 1, tier: 1, single, tiers: [here] });
      else if (!single) {
        b.count++;
        const tier = BADGE_TIERS.filter((n) => b.count >= n).length as 1 | 2 | 3;
        if (tier > b.tier) {
          b.tier = tier;
          b.tiers.push(here);
        }
      }
    }
  });
  // holdings: any of the player's wallets, as they stand now
  for (const r of rules) {
    if (out.has(r.medal.id) || !r.holding) continue;
    const h = heroes.find((x) => r.holding!(x));
    if (h) out.set(r.medal.id, { medal: r.medal, count: 1, tier: 1, single: true, tiers: [{ at: null, wallet: h.address, journey: null }] });
  }
  return out;
}

/** Journeys that earned a badge or a new tier (journey key → what), to announce them as the replay plays them. */
export function badgeMoments(profile: PlayerProfile): Map<string, { badge: PlayerBadge; tier: number }[]> {
  const out = new Map<string, { badge: PlayerBadge; tier: number }[]>();
  for (const b of profile.badges.values()) {
    b.tiers.forEach((p, i) => {
      if (p.journey === null) return;
      const list = out.get(p.journey) ?? [];
      list.push({ badge: b, tier: i + 1 });
      out.set(p.journey, list);
    });
  }
  return out;
}
