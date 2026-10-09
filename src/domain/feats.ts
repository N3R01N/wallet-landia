/**
 * Gamification (Phase 5): medals a hero earns by doing things on-chain, the
 * titles they unlock, and teaching quests that point at something worth
 * learning about a hero's own wallet.
 *
 * Everything is read from the guild as loaded: a medal is earned by the first
 * journey that qualifies (so the replay can award it as it plays), or by what
 * a hero holds now. The player's browser remembers medals once seen, since
 * the history window moves on (see `settings.ts`).
 */

import type { Guild, Hero, HeroClass, Journey, Verb } from './model.js';
import { CLASS_LABEL } from './model.js';

export interface Medal {
  id: string;
  name: string;
  icon: string;
  /** How to earn it. */
  hint: string;
  /** What it teaches, in plain words. */
  lesson: string;
  /** The title it unlocks ("Merric, the Barterer"). */
  title: string;
}

/** Earned: when, and by which journey (null: for what the hero holds now). */
export interface Earned {
  at: number | null;
  journey: string | null;
}

type JourneyRule = (j: Journey, seen: Seen) => boolean;
type HoldingRule = (hero: Hero) => boolean;

/** What a hero has done so far, walking their journeys oldest first. */
interface Seen {
  initiated: number;
  places: Set<string>;
  liquidated: boolean;
}

interface MedalDef extends Medal {
  journey?: JourneyRule;
  holding?: HoldingRule;
}

const did = (...verbs: Verb[]): JourneyRule => (j) => j.status === 'confirmed' && verbs.includes(j.verb);
const signed = (rule: JourneyRule): JourneyRule => (j, s) => j.initiated && rule(j, s);

/** Largest holding's share of the token treasury (stablecoins count as one pile). */
export function largestShare(hero: Hero): { share: number; symbol: string } | null {
  const piles = new Map<string, number>();
  for (const i of hero.items) {
    if (i.category === 'nft' || (i.usd ?? 0) <= 0) continue;
    const key = i.category === 'stable' ? 'stablecoins' : i.symbol;
    piles.set(key, (piles.get(key) ?? 0) + (i.usd ?? 0));
  }
  const total = [...piles.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  let best = { share: 0, symbol: '' };
  for (const [symbol, v] of piles) if (v / total > best.share) best = { share: v / total, symbol };
  return best;
}

const MEDALS: MedalDef[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    icon: '👣',
    hint: 'Set out on a journey of your own (sign a transaction).',
    lesson: 'Every transaction you sign pays a toll (gas) at the Chronicle Tower, even a tiny one.',
    title: 'the Wayfarer',
    journey: (j) => j.initiated && j.status === 'confirmed',
  },
  {
    id: 'barter',
    name: 'First Barter',
    icon: '⚖️',
    hint: 'Trade one token for another at a bazaar (a swap).',
    lesson: 'A swap trades at the pool’s price; big trades in thin pools move that price against you (slippage).',
    title: 'the Barterer',
    journey: signed(did('swap')),
  },
  {
    id: 'fountain',
    name: 'Fountain Keeper',
    icon: '⛲',
    hint: 'Pour a pair of tokens into a bazaar’s fountain (add liquidity).',
    lesson: 'Liquidity earns a share of trading fees, but when prices drift apart you end up holding more of the loser (impermanent loss).',
    title: 'Keeper of the Fountain',
    journey: signed(did('addLiquidity')),
  },
  {
    id: 'blessed',
    name: 'Blessed by the Temple',
    icon: '🕯️',
    hint: 'Stake ETH at the Temple, or hold blessed gold (a liquid staking token).',
    lesson: 'Staking helps secure the chain and pays a steady reward; a liquid staking token lets you keep using what you staked.',
    title: 'the Blessed',
    journey: signed(did('stake')),
    holding: (h) => h.items.some((i) => i.category === 'lst' && (i.usd ?? 0) >= 1),
  },
  {
    id: 'vault',
    name: 'Coin in the Vault',
    icon: '🏦',
    hint: 'Deposit into a Counting House (supply to a lending protocol).',
    lesson: 'Supplied tokens earn interest from borrowers and can serve as collateral.',
    title: 'the Prudent',
    journey: signed(did('supply')),
  },
  {
    id: 'borrower',
    name: 'Borrowed Against the Hoard',
    icon: '📜',
    hint: 'Take a loan against your collateral.',
    lesson: 'A loan stays safe while your collateral is worth well more than the debt; if prices fall too far, it gets liquidated.',
    title: 'the Bold',
    journey: signed(did('borrow')),
  },
  {
    id: 'paid',
    name: 'Paid in Full',
    icon: '✅',
    hint: 'Repay (part of) a loan.',
    lesson: 'Repaying lowers your debt and pushes the bailiffs (liquidation) further away.',
    title: 'the Honest',
    journey: signed(did('repay')),
  },
  {
    id: 'survived',
    name: 'Survived the Bailiffs',
    icon: '🛡️',
    hint: 'Carry on after a liquidation.',
    lesson: 'A liquidation sells part of your collateral at a discount to repay the loan. Watching your loan’s health avoids it.',
    title: 'the Unbroken',
    journey: (j, s) => s.liquidated && j.initiated && j.status === 'confirmed' && j.verb !== 'liquidated',
  },
  {
    id: 'keys',
    name: 'Keeper of Keys',
    icon: '🗝️',
    hint: 'Take back a key you handed to a contract (revoke an approval).',
    lesson: 'An approval lets a contract move your tokens until you revoke it. Old, unlimited approvals are a common way wallets get drained.',
    title: 'Keeper of Keys',
    journey: signed(did('revoke')),
  },
  {
    id: 'patron',
    name: 'Patron of the Arts',
    icon: '🖼️',
    hint: 'Buy a painting at the Auction House (an NFT).',
    lesson: 'An NFT’s floor price is only what the cheapest one is listed at; selling can take a while.',
    title: 'Patron of the Arts',
    journey: signed(did('buyNft')),
  },
  {
    id: 'seafarer',
    name: 'Seafarer',
    icon: '⛵',
    hint: 'Send assets to another realm from the Harbour (bridge).',
    lesson: 'A bridge moves assets between chains; while they travel they rely on the bridge’s own security.',
    title: 'the Seafarer',
    journey: signed(did('bridge')),
  },
  {
    id: 'harvest',
    name: 'Harvester',
    icon: '🌾',
    hint: 'Collect rewards that have grown for you (claim).',
    lesson: 'Rewards often pile up until you claim them, and claiming pays a toll, so small harvests can cost more than they bring.',
    title: 'the Harvester',
    journey: signed(did('claim')),
  },
  {
    id: 'favour',
    name: 'Herald’s Favour',
    icon: '📣',
    hint: 'Receive an airdrop.',
    lesson: 'Real airdrops reward past use; tokens that simply appear and urge you to visit a site are usually bait.',
    title: 'the Fortunate',
    journey: did('airdrop'),
  },
  {
    id: 'founder',
    name: 'Founder',
    icon: '🔨',
    hint: 'Put a contract of your own on the chain (deploy).',
    lesson: 'Deployed code is public and, unless built to be upgradeable, can never be changed.',
    title: 'the Founder',
    journey: signed(did('deploy')),
  },
  {
    id: 'council',
    name: 'Voice in the Council',
    icon: '🗳️',
    hint: 'Delegate your votes at the Council Hall.',
    lesson: 'Governance tokens carry votes; delegating lends your voice to someone without giving them your tokens.',
    title: 'Councillor',
    journey: signed(did('delegate')),
  },
  {
    id: 'generous',
    name: 'Generous Hand',
    icon: '🤝',
    hint: 'Send something to another hero of your guild.',
    lesson: 'A send between your own wallets still pays a toll, and is final once sealed in the Chronicle.',
    title: 'the Generous',
    journey: (j) => j.initiated && j.status === 'confirmed' && j.verb === 'send' && j.counterpartyHero !== null,
  },
  {
    id: 'explorer',
    name: 'Well Travelled',
    icon: '🧭',
    hint: 'Visit five different buildings.',
    lesson: 'Each protocol is its own contract with its own risks; the more you use, the more you trust.',
    title: 'the Explorer',
    journey: (j, s) => j.initiated && s.places.size >= 5,
  },
  {
    id: 'expedition',
    name: 'Expedition Leader',
    icon: '🗺️',
    hint: 'Make one journey with three or more stops (a multi-step transaction).',
    lesson: 'One transaction can call many contracts at once; it all happens, or none of it does.',
    title: 'the Pathfinder',
    journey: (j) => j.initiated && j.status === 'confirmed' && j.steps.length >= 3,
  },
  {
    id: 'veteran',
    name: 'Veteran of the Tower',
    icon: '🔔',
    hint: 'Sign 50 journeys.',
    lesson: 'Your address’s nonce counts every transaction you have ever sent; it is why they seal in order.',
    title: 'the Veteran',
    journey: (j, s) => j.initiated && s.initiated >= 50,
  },
  {
    id: 'scarred',
    name: 'Learned the Hard Way',
    icon: '🩹',
    hint: 'Have a journey fail.',
    lesson: 'A failed transaction changes nothing, but the toll is still paid: the network did the work.',
    title: 'the Scarred',
    journey: (j) => j.initiated && j.status === 'failed',
  },
  {
    id: 'steward',
    name: 'Balanced Treasury',
    icon: '🧺',
    hint: 'Hold at least four things worth $10 or more, none of them over half the treasury.',
    lesson: 'Spreading holdings means one token’s crash cannot sink you alone.',
    title: 'the Steward',
    holding: (h) => {
      const big = h.items.filter((i) => i.category !== 'nft' && (i.usd ?? 0) >= 10).length;
      const top = largestShare(h);
      return big >= 4 && top !== null && top.share <= 0.5;
    },
  },
  {
    id: 'hoard',
    name: 'Dragon’s Hoard',
    icon: '🐉',
    hint: 'Grow a hero’s worth to Legendary ($100k) or beyond.',
    lesson: 'Bigger treasuries draw more attention: a hardware wallet, and a separate wallet for experiments, are worth it.',
    title: 'the Legendary',
    holding: (h) => h.tier >= 5,
  },
];

export const ALL_MEDALS: readonly Medal[] = MEDALS;

/** A hero's journeys (theirs, or a guild-mate's send to them), oldest first. */
function journeysOf(hero: Hero, guild: Guild): Journey[] {
  return guild.journeys.filter((j) => j.hero === hero.address);
}

/** The medals a hero has earned, from the loaded guild. */
export function earnedMedals(hero: Hero, guild: Guild): Map<string, Earned> {
  const out = new Map<string, Earned>();
  const seen: Seen = { initiated: 0, places: new Set(), liquidated: false };
  for (const j of journeysOf(hero, guild)) {
    if (j.initiated) {
      seen.initiated++;
      for (const s of j.steps) if (s.target.kind === 'building') seen.places.add(s.target.protocolId);
    }
    for (const m of MEDALS) if (!out.has(m.id) && m.journey?.(j, seen)) out.set(m.id, { at: j.time, journey: j.key });
    if (j.verb === 'liquidated') seen.liquidated = true;
  }
  for (const m of MEDALS) if (!out.has(m.id) && m.holding?.(hero)) out.set(m.id, { at: null, journey: null });
  return out;
}

/** Medals earned by each journey: journey key → [hero, medal]. For announcing them as the replay plays. */
export function medalsByJourney(guild: Guild): Map<string, { hero: string; medal: Medal }[]> {
  const out = new Map<string, { hero: string; medal: Medal }[]>();
  for (const hero of guild.heroes) {
    for (const [id, e] of earnedMedals(hero, guild)) {
      if (e.journey === null) continue;
      const medal = MEDALS.find((m) => m.id === id)!;
      const list = out.get(e.journey) ?? [];
      list.push({ hero: hero.address, medal });
      out.set(e.journey, list);
    }
  }
  return out;
}

export function medalById(id: string): Medal | undefined {
  return MEDALS.find((m) => m.id === id);
}

/** Titles a hero may wear: one per medal, plus their class. */
export function titleOptions(cls: HeroClass, medals: Iterable<string>): string[] {
  const out = [`the ${CLASS_LABEL[cls]}`];
  for (const id of medals) {
    const m = medalById(id);
    if (m && !out.includes(m.title)) out.push(m.title);
  }
  return out;
}

/** The title shown unless the player picks one: the rarest-sounding medal, by its place in the list (later is harder). */
export function defaultTitle(cls: HeroClass, medals: Iterable<string>): string {
  const ids = new Set(medals);
  let best: Medal | null = null;
  let rank = -1;
  MEDALS.forEach((m, i) => {
    if (ids.has(m.id) && m.id !== 'first-steps' && i > rank) [best, rank] = [m, i];
  });
  return (best as Medal | null)?.title ?? `the ${CLASS_LABEL[cls]}`;
}

// --- teaching quests ---------------------------------------------------------------

export interface TeachingQuest {
  id: string;
  name: string;
  icon: string;
  /** The quest as the town tells it. */
  story: string;
  /** What it is really about. */
  lesson: string;
  done: boolean;
  /** Where the hero stands ("3 keys still out"). */
  progress: string;
  /** Somewhere to act on it, outside the town. */
  link?: { href: string; label: string };
}

/**
 * Quests that fit this hero now. Each only appears when it means something
 * for this wallet (no temple quest for an empty purse).
 */
export function teachingQuests(hero: Hero, guild: Guild): TeachingQuest[] {
  const out: TeachingQuest[] = [];
  const mine = journeysOf(hero, guild).filter((j) => j.initiated && j.status === 'confirmed');

  // keys handed out in this window, and whether they were taken back
  const open = new Map<string, number>();
  for (const j of mine) {
    const place = j.steps[0]?.target;
    if (place?.kind !== 'building') continue;
    if (j.verb === 'approve') open.set(place.protocolId, (open.get(place.protocolId) ?? 0) + 1);
    if (j.verb === 'revoke') open.delete(place.protocolId);
  }
  const granted = mine.filter((j) => j.verb === 'approve').length;
  if (granted > 0) {
    const names = [...open.keys()].map((id) => guild.protocols.get(id)?.name ?? id);
    out.push({
      id: 'keys',
      name: 'Recover your master keys',
      icon: '🗝️',
      story: 'Keys to your chests are scattered around town. A careful hero takes back the ones no longer needed.',
      lesson: 'Each approval lets a contract move one of your tokens, often without limit, until you revoke it.',
      done: open.size === 0,
      progress:
        open.size === 0
          ? `All ${granted} key${granted === 1 ? '' : 's'} seen in this window taken back.`
          : `${open.size} place${open.size === 1 ? '' : 's'} still hold${open.size === 1 ? 's' : ''} a key: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}.`,
      link: { href: `https://revoke.cash/address/${hero.address}`, label: 'Check every key on revoke.cash ↗' },
    });
  }

  const eth = hero.items.filter((i) => i.category === 'native' && i.symbol.toUpperCase() === 'ETH').reduce((s, i) => s + (i.usd ?? 0), 0);
  const blessed = hero.items.some((i) => i.category === 'lst' && (i.usd ?? 0) >= 1) || hero.stashes.some((s) => ['temple', 'barracks'].includes(guild.protocols.get(s.protocolId)?.building ?? ''));
  if (eth >= 100 || blessed) {
    out.push({
      id: 'temple',
      name: 'Visit the Temple',
      icon: '🕯️',
      story: 'The monks of the Temple bless gold that is left in their care, and it grows a little each day.',
      lesson: 'Staking ETH (directly, or through a liquid staking token like stETH) earns rewards for helping secure Ethereum.',
      done: blessed,
      progress: blessed ? 'Some of this hero’s gold is blessed.' : `${Math.round(eth).toLocaleString('en-US')} USD of ETH sits idle in the purse.`,
    });
  }

  const top = largestShare(hero);
  const treasury = hero.items.filter((i) => i.category !== 'nft').reduce((s, i) => s + Math.max(0, i.usd ?? 0), 0);
  if (top && treasury >= 100) {
    const pct = Math.round(top.share * 100);
    out.push({
      id: 'diversify',
      name: 'Diversify your treasury',
      icon: '🧺',
      story: 'A wise steward never keeps all the grain in one barn.',
      lesson: 'When one holding is most of a wallet, its price is the wallet’s fate.',
      done: top.share <= 0.75,
      progress: `${pct}% of the treasury is ${top.symbol}.`,
    });
  }

  const debts = hero.stashes.filter((s) => s.hasDebt);
  if (debts.length > 0 || mine.some((j) => j.verb === 'borrow')) {
    const names = debts.map((s) => guild.protocols.get(s.protocolId)?.name ?? s.protocolId);
    out.push({
      id: 'bailiffs',
      name: 'Keep the bailiffs away',
      icon: '⚖️',
      story: 'The Counting House lends against what you leave in its vault, and its bailiffs watch the scales.',
      lesson: 'If your collateral’s value falls close to your debt, the loan is liquidated. Repaying some, or adding collateral, keeps it safe.',
      done: debts.length === 0,
      progress: debts.length === 0 ? 'No loans outstanding.' : `Owes at ${names.join(', ')}. Watch the loan’s health on the protocol’s own site.`,
    });
  }

  const ripe = hero.stashes.filter((s) => s.hasRewards);
  if (ripe.length > 0 || mine.some((j) => j.verb === 'claim')) {
    out.push({
      id: 'harvest',
      name: 'Bring in the harvest',
      icon: '🌾',
      story: 'Rewards ripen in the fields of the buildings where you keep things.',
      lesson: 'Protocol rewards accrue until claimed. Claim when they are worth more than the toll.',
      done: ripe.length === 0,
      progress: ripe.length === 0 ? 'Nothing waiting to be claimed.' : `Rewards ready at ${ripe.map((s) => guild.protocols.get(s.protocolId)?.name ?? s.protocolId).join(', ')}.`,
    });
  }

  if (hero.spamCount > 0) {
    out.push({
      id: 'midden',
      name: 'Leave the cursed junk alone',
      icon: '🗑',
      story: `${hero.spamCount} pieces of cursed junk lie in the midden. They were thrown over the fence, not earned.`,
      lesson: 'Spam tokens arrive unasked, often named like a website. Never visit it or try to sell them: that is the trap.',
      done: true,
      progress: 'Hidden from the treasury. Nothing to do but ignore them.',
    });
  }
  return out;
}
