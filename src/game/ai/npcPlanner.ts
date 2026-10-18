/**
 * NpcPlanner (spec: "NPC opponents"): an archetype and a difficulty turn the
 * match as any player sees it into commands. NPCs play by exactly the same
 * rules and through the same command API as the player: every command goes
 * through `match.command` and its validation, and the planner reads only
 * what a player could see (prices, the week's candles, the public rumor, both
 * portfolios), never the event that is really coming.
 *
 * A utility-scoring planner: each candidate action is scored as personality
 * weight × expected army value change × risk penalty, and the top N are
 * taken, N from the difficulty. Everything is seeded.
 */

import { buildArmy } from '../core/army.js';
import { STAKES_INTO, UNIT_TYPES } from '../core/catalog.js';
import { streamOf, type Rng } from '../core/detmath.js';
import { qmul, qn } from '../core/fixed.js';
import { account, holding } from '../core/ledger.js';
import { available, previewCommand, type Match } from '../core/match.js';
import type { Archetype, AssetId, Command, Difficulty, EventId, Role, SideId } from '../core/types.js';

interface Personality {
  /** Weights: army units gained, keep HP gained, protocol positions taken, and how much loan risk it tolerates. */
  army: number;
  keep: number;
  protocol: number;
  /** The lowest health factor it is happy to borrow down to. */
  hfFloor: number;
  /** The tokens it likes to hold. */
  targets: AssetId[];
  /** How likely it is to trade at all in a round (a whale rarely does). */
  activity: number;
}

const PERSONALITY: Record<Exclude<Archetype, 'balanced'>, Personality> = {
  degen: { army: 1.4, keep: 0.1, protocol: 0.2, hfFloor: 1.05, targets: ['pepe', 'shib', 'ldo', 'ens'], activity: 1 },
  whale: { army: 0.8, keep: 0.4, protocol: 0.2, hfFloor: 2, targets: ['wbtc', 'eth'], activity: 0.35 },
  'stable-maxi': { army: 0.6, keep: 0.8, protocol: 0.5, hfFloor: 2, targets: ['usdc', 'dai', 'eth'], activity: 0.8 },
  'yield-farmer': { army: 0.7, keep: 0.4, protocol: 1.5, hfFloor: 1.5, targets: ['eth', 'link', 'usdc'], activity: 1 },
};

const DIFFICULTY: Record<Difficulty, { actions: number; rumor: number; hfManage: number | null; counterPick: boolean; random: boolean }> = {
  easy: { actions: 1, rumor: 0, hfManage: null, counterPick: false, random: true },
  normal: { actions: 3, rumor: 0.5, hfManage: 1.15, counterPick: false, random: false },
  hard: { actions: 5, rumor: 1, hfManage: 1.4, counterPick: true, random: false },
};

/** A stable maxi's keep is safe above this share of its HP (or level with the enemy's). */
const MAXI_SAFE = 0.6;
/** Rumors that warn of a fall: de-risk into stables. */
const CRASHES: readonly EventId[] = ['black-swan', 'depeg', 'rug-pull', 'slashing'];
/** The role that beats each role (counter triangle: Cavalry > Ranged > Melee > Cavalry). */
const COUNTER: Partial<Record<Role, Role>> = { ranged: 'cavalry', melee: 'ranged', cavalry: 'melee' };
/** A token that fields each role, for a counter-pick. */
const ROLE_TOKEN: Partial<Record<Role, AssetId>> = { cavalry: 'ldo', ranged: 'link', melee: 'eth' };

interface Candidate {
  cmd: Command;
  score: number;
  /** One per kind and asset in a plan. */
  key: string;
}

/** The commands an NPC sends this Trade phase (already sent through `match.command`); returns those accepted. */
export function npcTrade(m: Match, side: SideId): Command[] {
  const me = m.side(side);
  const npc = me.npc;
  if (!npc || m.state.phase !== 'trade') return [];
  const rng = streamOf(m.state.seed, `npc:${side}`, m.state.round);
  const personality = PERSONALITY[npc.archetype === 'balanced' ? 'whale' : npc.archetype];
  const diff = DIFFICULTY[npc.difficulty];
  const done: Command[] = [];
  if (rng() > personality.activity && !urgent(m, side, diff.hfManage)) return done;
  for (let i = 0; i < diff.actions; i++) {
    // a loan a round (a degen, who maxes leverage, two): no looping collateral and debt into a tower of leverage
    const borrowed = done.filter((d) => d.t === 'borrow').length >= (npc.archetype === 'degen' ? 2 : 1);
    const cands = candidates(m, side, npc.archetype, diff, rng).filter((c) => !done.some((d) => keyOf(d) === c.key) && !(borrowed && c.cmd.t === 'borrow'));
    if (cands.length === 0) break;
    cands.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    const good = cands.filter((c) => c.score > 0);
    if (good.length === 0) break;
    // easy picks at random among what suits it; the others take the best
    const pick = diff.random ? good[Math.floor(rng() * Math.min(good.length, 4))]! : good[0]!;
    const r = m.command(side, pick.cmd);
    if (r.ok) done.push(pick.cmd);
  }
  return done;
}

function urgent(m: Match, side: SideId, hfManage: number | null): boolean {
  if (hfManage === null) return false;
  const ctx = { catalog: m.catalog, prices: m.state.market.prices };
  return (['lending', 'vault'] as const).some((p) => {
    const a = account(m.side(side), p, ctx);
    return a.debt > 0 && a.hf < hfManage;
  });
}

function keyOf(cmd: Command): string {
  const asset = 'asset' in cmd ? cmd.asset : 'from' in cmd ? `${cmd.from}>${cmd.to}` : 'a' in cmd ? `${cmd.a}+${cmd.b}` : 'nft' in cmd ? cmd.nft : '';
  return `${cmd.t}|${asset}`;
}

function candidates(m: Match, side: SideId, archetype: Archetype, diff: (typeof DIFFICULTY)[Difficulty], rng: Rng): Candidate[] {
  const s = m.state;
  const me = m.side(side);
  const base = PERSONALITY[archetype === 'balanced' ? 'whale' : archetype];
  const other = s.sides.find((x) => x.id !== side)!;
  // a stable maxi whose keep is safe (ahead or level on keep HP, or above 60%) turns walls into army
  const safe = me.keepHp / me.keepHpMax >= Math.min(MAXI_SAFE, other.keepHp / other.keepHpMax);
  const p = archetype === 'stable-maxi' && safe ? { ...base, army: 1.4, keep: 0.15 } : base;
  const uv = s.unitValue;
  const prices = s.market.prices;
  const out: Candidate[] = [];
  const consider = (cmd: Command, weight = 1) => {
    if ('qty' in cmd && cmd.qty <= 0n) return;
    const pv = previewCommand(m, side, cmd);
    if (!pv.ok) return;
    const hf = Math.min(pv.hfAfter.lending, pv.hfAfter.vault);
    // risk: a loan below its floor is heavily penalised
    const risk = hf < p.hfFloor ? 0.1 : 1;
    const army = (pv.unitsAfter - pv.unitsBefore) * p.army;
    const keep = ((pv.keepMaxAfter - pv.keepMaxBefore) / 2) * p.keep;
    const cost = (pv.valueBefore - pv.valueAfter) / uv;
    const score = (army + keep - cost) * weight * risk;
    out.push({ cmd, score, key: keyOf(cmd) });
  };
  const spot = me.portfolio.positions.filter((x) => x.kind === 'spot' && x.unlocksAtRound === undefined).map((x) => x.asset);
  const stables = spot.filter((id) => m.catalog.asset(id).isStable);
  const risky = spot.filter((id) => !m.catalog.asset(id).isStable);

  // the rumor (public): a warned crash is a reason to move into stables
  const rumor = s.market.rumor;
  const heeds = rumor !== null && rng() < diff.rumor;
  const crash = heeds && CRASHES.includes(rumor);
  const boom = heeds && (rumor === 'bull-run' || rumor === 'meme-mania');

  // keep the loans healthy
  if (diff.hfManage !== null) {
    for (const via of ['lending', 'vault'] as const) {
      const acc = account(me, via, { catalog: m.catalog, prices });
      if (acc.debt <= 0 || acc.hf >= diff.hfManage) continue;
      for (const debt of me.portfolio.positions.filter((x) => x.kind === 'borrowed' && x.protocol === via)) {
        const q = available(m, side, 'repay', debt.asset, via);
        if (q > 0n) out.push({ cmd: { t: 'repay', asset: debt.asset, qty: q, via }, score: 100, key: `repay|${debt.asset}` });
      }
    }
  }

  // swaps into what it likes (or, warned of a crash, into stables)
  const targets = crash ? ['usdc'] : boom ? [...p.targets, 'pepe'] : p.targets;
  for (const from of spot) {
    const fromStable = m.catalog.asset(from).isStable;
    for (const to of targets) {
      if (to === from || !m.catalog.has(to)) continue;
      if (crash && fromStable) continue;
      for (const share of [0.25, 0.5]) {
        const qty = qmul(available(m, side, 'swap', from), share);
        // crash rumors make the move to safety worth a lot, if it heeds them
        consider({ t: 'swap', from, to, qty }, crash && !fromStable ? 3 : 1);
      }
    }
  }

  // a degen chases last week's best performer
  if (archetype === 'degen' && s.market.candles.length > 0) {
    const first = s.market.candles[0]!.open;
    const last = s.market.candles[s.market.candles.length - 1]!.close;
    const best = m.catalog.assets.filter((a) => !a.isStable && a.id !== 'drop').sort((a, b) => (last[b.id] ?? 0) / (first[b.id] ?? 1) - (last[a.id] ?? 0) / (first[a.id] ?? 1))[0];
    if (best) for (const from of stables) consider({ t: 'swap', from, to: best.id, qty: qmul(available(m, side, 'swap', from), 0.5) }, 2);
  }
  // a whale buys the dip after a Black Swan
  if (archetype === 'whale' && s.market.current?.id === 'black-swan') {
    for (const from of stables) for (const to of ['wbtc', 'eth']) consider({ t: 'swap', from, to, qty: qmul(available(m, side, 'swap', from), 0.5) }, 3);
  }
  // a stable maxi trades walls into army while its keep is safe (up to three quarters of its stables a round,
  // into ETH, stETH and WBTC), turtles when it isn't, and adds to its walls only when warned of a crash
  if (archetype === 'stable-maxi') {
    if (safe) for (const from of stables) for (const to of ['eth', 'wbtc', 'steth']) for (const share of [0.25, 0.5, 0.75]) consider({ t: 'swap', from, to, qty: qmul(available(m, side, 'swap', from), share) }, 1.5);
    for (let i = out.length - 1; i >= 0; i--) {
      const c = out[i]!;
      if (c.cmd.t !== 'swap') continue;
      const intoRisk = m.catalog.asset(c.cmd.from).isStable && !m.catalog.asset(c.cmd.to).isStable;
      const intoWalls = !m.catalog.asset(c.cmd.from).isStable && m.catalog.asset(c.cmd.to).isStable;
      if ((intoRisk && !safe) || (intoWalls && !crash)) out.splice(i, 1);
    }
  }

  // leverage: supply collateral, then borrow (a degen to the limit)
  for (const asset of risky) {
    if (!m.catalog.asset(asset).collateral) continue;
    consider({ t: 'supply', asset, qty: qmul(available(m, side, 'supply', asset), 0.5) }, p.protocol + (archetype === 'degen' ? 1 : 0));
  }
  if (account(me, 'lending', { catalog: m.catalog, prices }).collateral > 0) {
    for (const asset of [...p.targets.filter((t) => !m.catalog.asset(t).isStable), 'usdc']) {
      const room = available(m, side, 'borrow', asset);
      consider({ t: 'borrow', asset, qty: archetype === 'degen' ? room : qmul(room, 0.5) }, archetype === 'degen' ? 2 : 0.6);
    }
  }

  // protocol positions: stake, restake, pools (a yield farmer's game)
  for (const asset of spot) {
    if (STAKES_INTO[asset]) consider({ t: 'stake', asset, qty: qmul(available(m, side, 'stake', asset), 0.5) }, 0.5 + p.protocol);
  }
  const staked = holding(me, 'steth', 'staked', 'staking');
  if (staked > 0n) consider({ t: 'restake', asset: 'steth', qty: qmul(staked, 0.5) }, 0.3 + p.protocol);
  if (archetype === 'yield-farmer') {
    const eth = available(m, side, 'lpAdd', 'eth');
    const usdc = holding(me, 'usdc');
    const ethFor = Math.min(qn(eth), (qn(usdc) * (prices.usdc ?? 1)) / (prices.eth ?? 1));
    if (ethFor > 0) consider({ t: 'lpAdd', a: 'eth', b: 'usdc', qty: BigInt(Math.floor(ethFor * 0.5 * 1e9)) }, 2);
  }
  // protocol abilities are worth something on their own (the planner sees them in its weights)
  for (const c of out) if (['stake', 'restake', 'lpAdd', 'supply'].includes(c.cmd.t)) c.score += p.protocol * 2;
  // a degen borrows early: collateral first, in its first rounds
  const hasCollateral = account(me, 'lending', { catalog: m.catalog, prices }).collateral > 0;
  if (archetype === 'degen' && s.round <= 2 && !hasCollateral) for (const c of out) if (c.cmd.t === 'supply') c.score += 50;

  // a hard NPC counter-picks the player's largest role
  if (diff.counterPick) {
    const other = s.sides.find((x) => x.id !== side)!;
    const army = buildArmy(other, { catalog: m.catalog, prices, unitValue: uv });
    const byRole = new Map<Role, number>();
    for (const sq of army.squads) {
      const role = UNIT_TYPES[sq.unit]?.role;
      if (role) byRole.set(role, (byRole.get(role) ?? 0) + sq.count * (UNIT_TYPES[sq.unit]?.costMult ?? 1));
    }
    const biggest = [...byRole.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const counter = biggest ? COUNTER[biggest] : undefined;
    const token = counter ? ROLE_TOKEN[counter] : undefined;
    if (token) for (const from of spot) if (from !== token) consider({ t: 'swap', from, to: token, qty: qmul(available(m, side, 'swap', from), 0.35) }, 2.5);
  }

  // a relic in an empty slot
  const free = me.portfolio.relics.findIndex((r) => r === null);
  const unslotted = me.portfolio.nfts.find((n) => !me.portfolio.relics.some((r) => r?.nft === n.collection));
  if (free >= 0 && unslotted) out.push({ cmd: { t: 'slotRelic', nft: unslotted.collection, slot: free as 0 | 1 | 2 }, score: 5, key: `slotRelic|${unslotted.collection}` });

  return out;
}
