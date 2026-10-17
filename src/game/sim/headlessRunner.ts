/**
 * HeadlessRunner (spec: "Balance and size scaling"): NPC-vs-NPC matches in
 * batches, for the balance report. Pure and deterministic: a match spec
 * (seed, both portfolios, NPCs) gives the same outcome every time, so a
 * report can be split over processes and added up.
 */

import { npcTrade } from '../ai/npcPlanner.js';
import type { BattleMap } from '../core/battle.js';
import { Catalog } from '../core/catalog.js';
import { qtyFor } from '../core/fixed.js';
import { Match } from '../core/match.js';
import type { Archetype, Difficulty, Portfolio, SideId } from '../core/types.js';
import { templatePortfolio } from '../data/templates.js';

/** A side in a balance match: an archetype's template, or a test portfolio (all stables, all memecoins). */
export type Lineup = Archetype | 'all-stables' | 'all-memes';

export interface MatchSpec {
  seed: string;
  a: Lineup;
  b: Lineup;
  difficulty: Difficulty;
  value: number;
  map?: BattleMap;
}

export interface MatchStats {
  a: Lineup;
  b: Lineup;
  winner: SideId | 'draw';
  rounds: number;
  suddenDeath: boolean;
  /** Whether anyone borrowed, and how many liquidations happened. */
  borrowed: boolean;
  liquidations: number;
}

const catalog = new Catalog();

export function lineupPortfolio(l: Lineup, value: number): Portfolio {
  if (l === 'all-stables') return { positions: [{ asset: 'usdc', qty: qtyFor(value, 1), kind: 'spot' }], nfts: [], relics: [null, null, null] };
  if (l === 'all-memes')
    return {
      positions: [
        { asset: 'pepe', qty: qtyFor(value / 2, catalog.asset('pepe').price), kind: 'spot' },
        { asset: 'shib', qty: qtyFor(value / 2, catalog.asset('shib').price), kind: 'spot' },
      ],
      nfts: [],
      relics: [null, null, null],
    };
  return templatePortfolio(l, value, catalog);
}

/** The archetype that trades a test portfolio (it holds what it holds, and trades like a degen or a maxi). */
const TRADER: Record<Lineup, Archetype> = { degen: 'degen', whale: 'whale', 'stable-maxi': 'stable-maxi', 'yield-farmer': 'yield-farmer', balanced: 'whale', 'all-stables': 'stable-maxi', 'all-memes': 'degen' };

export function playMatch(spec: MatchSpec): MatchStats {
  const m = new Match({
    seed: spec.seed,
    portfolios: [lineupPortfolio(spec.a, spec.value), lineupPortfolio(spec.b, spec.value)],
    npc: [
      { archetype: TRADER[spec.a], difficulty: spec.difficulty },
      { archetype: TRADER[spec.b], difficulty: spec.difficulty },
    ],
    ...(spec.map ? { map: spec.map } : {}),
  });
  // the test portfolios hold still: all stables never trades out of them, all memes never sells them
  const trades = (side: SideId, l: Lineup) => l !== 'all-stables' && l !== 'all-memes' && npcTrade(m, side);
  let borrowed = false;
  m.playOut((x) => {
    trades('A', spec.a);
    trades('B', spec.b);
    for (const s of x.state.sides) if (s.portfolio.positions.some((p) => p.kind === 'borrowed')) borrowed = true;
  });
  const liquidations = m.liquidationCount;
  return { a: spec.a, b: spec.b, winner: m.state.winner ?? 'draw', rounds: m.state.round, suddenDeath: m.state.suddenDeath, borrowed, liquidations };
}

/** The specs of a report: every pair of lineups, sides swapped half the time, `n` matches each. */
export function reportSpecs(lineups: readonly [Lineup, Lineup][], n: number, difficulty: Difficulty = 'normal', value = 20000): MatchSpec[] {
  const out: MatchSpec[] = [];
  for (const [a, b] of lineups) {
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      out.push({ seed: `bal-${a}-${b}-${i}`, a: swap ? b : a, b: swap ? a : b, difficulty, value });
    }
  }
  return out;
}

export interface PairReport {
  a: Lineup;
  b: Lineup;
  matches: number;
  /** a's win rate (draws count half). */
  aWins: number;
  medianRounds: number;
  suddenDeath: number;
}

export interface BalanceReport {
  pairs: PairReport[];
  medianRounds: number;
  suddenDeath: number;
  /** Among matches where someone borrowed: the share with at least one liquidation. */
  liquidationShare: number;
  borrowMatches: number;
  /** Win rates of the test portfolios (all stables, all memes) against the archetypes. */
  stablesWin: number;
  memesWin: number;
  checks: { name: string; ok: boolean; value: string; target: string }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
};

export function summarize(stats: readonly MatchStats[]): BalanceReport {
  const key = (a: Lineup, b: Lineup) => [a, b].sort().join(' vs ');
  const groups = new Map<string, MatchStats[]>();
  for (const s of stats) groups.set(key(s.a, s.b), [...(groups.get(key(s.a, s.b)) ?? []), s]);
  const pairs: PairReport[] = [...groups.values()].map((g) => {
    const [a, b] = [g[0]!.a, g[0]!.b].sort() as [Lineup, Lineup];
    const wins = g.reduce((t, s) => t + (s.winner === 'draw' ? 0.5 : (s.winner === 'A' ? s.a : s.b) === a ? 1 : 0), 0);
    return { a, b, matches: g.length, aWins: wins / g.length, medianRounds: median(g.map((s) => s.rounds)), suddenDeath: g.filter((s) => s.suddenDeath).length / g.length };
  });
  const winRate = (l: Lineup) => {
    const g = stats.filter((s) => (s.a === l) !== (s.b === l));
    if (g.length === 0) return NaN;
    return g.reduce((t, s) => t + (s.winner === 'draw' ? 0.5 : (s.winner === 'A' ? s.a : s.b) === l ? 1 : 0), 0) / g.length;
  };
  const archetypal = stats.filter((s) => !['all-stables', 'all-memes'].includes(s.a) && !['all-stables', 'all-memes'].includes(s.b));
  const borrowed = stats.filter((s) => s.borrowed);
  const report: BalanceReport = {
    pairs,
    medianRounds: median(archetypal.map((s) => s.rounds)),
    suddenDeath: archetypal.filter((s) => s.suddenDeath).length / Math.max(1, archetypal.length),
    liquidationShare: borrowed.filter((s) => s.liquidations > 0).length / Math.max(1, borrowed.length),
    borrowMatches: borrowed.length,
    stablesWin: winRate('all-stables'),
    memesWin: winRate('all-memes'),
    checks: [],
  };
  const maxPair = Math.max(0, ...pairs.filter((p) => p.a !== p.b && !p.a.startsWith('all') && !p.b.startsWith('all')).map((p) => Math.max(p.aWins, 1 - p.aWins)));
  report.checks = [
    { name: 'median match length', ok: report.medianRounds >= 5 && report.medianRounds <= 7, value: `${report.medianRounds} rounds`, target: '5–7 rounds' },
    { name: 'matches reaching sudden death', ok: report.suddenDeath < 0.05, value: pct(report.suddenDeath), target: 'under 5%' },
    { name: 'best archetype against another', ok: maxPair <= 0.6, value: pct(maxPair), target: 'at most 60%' },
    { name: '100% stables wins', ok: !(report.stablesWin > 0), value: pct(report.stablesWin), target: 'never' },
    { name: '100% memecoins wins', ok: report.memesWin >= 0.35 && report.memesWin <= 0.5, value: pct(report.memesWin), target: '35–50%' },
    { name: 'a liquidation, among matches with borrowing', ok: report.liquidationShare >= 0.3 && report.liquidationShare <= 0.5, value: pct(report.liquidationShare), target: '30–50%' },
  ];
  return report;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

export const ARCHETYPES: readonly Archetype[] = ['degen', 'whale', 'stable-maxi', 'yield-farmer'];

/** The spec's report: the six archetype pairings, and the two test portfolios against each archetype. */
export function balanceLineups(): [Lineup, Lineup][] {
  const out: [Lineup, Lineup][] = [];
  for (let i = 0; i < ARCHETYPES.length; i++) for (let j = i + 1; j < ARCHETYPES.length; j++) out.push([ARCHETYPES[i]!, ARCHETYPES[j]!]);
  for (const a of ARCHETYPES) out.push(['all-stables', a], ['all-memes', a]);
  return out;
}

