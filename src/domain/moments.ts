/**
 * Historic moments of Ethereum the guild took part in, read from its own
 * transactions: one in 2016 (the year of The DAO), a claim of the ENS airdrop,
 * one in the Merge's block or on its day. Pure; each unveils a monument in
 * town and a secret (src/castle/world/secrets.ts).
 */

import type { Journey, Verb } from './model.js';

export type MomentId = 'dao-year' | 'ens-airdrop' | 'merge';

/** What a check needs of a transaction (a journey's or an errand's). */
export interface PastTx {
  time: number;
  chainId: string;
  block: number | null;
  verb: Verb;
  /** The protocol it went to, if any. */
  protocolId: string | null;
  /** The guild signed it (a claim is signed by the claimer). */
  signed: boolean;
  failed: boolean;
  /** Symbols of the tokens (not NFTs) it brought in. */
  got: string[];
}

/** The Merge: Ethereum's first proof-of-stake block, and its day (UTC). */
export const MERGE_BLOCK = 15_537_394;
const MERGE_DAY = '2022-09-15';
/** The ENS airdrop's claim: opened on 8 November 2021, closed in early May 2022. */
const ENS_CLAIM_FROM = Date.parse('2021-11-08T00:00:00Z');
const ENS_CLAIM_TO = Date.parse('2022-05-05T00:00:00Z');
const CLAIM_VERBS: ReadonlySet<Verb> = new Set(['claim', 'airdrop', 'receive', 'mint', 'unknown']);

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

export function inDaoYear(tx: PastTx): boolean {
  return !tx.failed && new Date(tx.time).getUTCFullYear() === 2016;
}

/** A claim of ENS tokens, signed by the guild, while the airdrop's claim was open. */
export function claimedEnsAirdrop(tx: PastTx): boolean {
  if (tx.failed || !tx.signed || tx.time < ENS_CLAIM_FROM || tx.time >= ENS_CLAIM_TO) return false;
  const atEns = tx.protocolId !== null && /^(ens|ethereum-name-service)$/i.test(tx.protocolId);
  const gotEns = tx.got.some((s) => s.toUpperCase() === 'ENS');
  return gotEns ? CLAIM_VERBS.has(tx.verb) : atEns && (tx.verb === 'claim' || tx.verb === 'airdrop');
}

export function atTheMerge(tx: PastTx): boolean {
  if (tx.failed || tx.chainId !== 'ethereum') return false;
  return tx.block === MERGE_BLOCK || day(tx.time) === MERGE_DAY;
}

const CHECKS: [MomentId, (tx: PastTx) => boolean][] = [
  ['dao-year', inDaoYear],
  ['ens-airdrop', claimedEnsAirdrop],
  ['merge', atTheMerge],
];

/** The moments found in these transactions, in a fixed order. */
export function historyMoments(txs: Iterable<PastTx>): MomentId[] {
  const found = new Set<MomentId>();
  for (const tx of txs) for (const [id, check] of CHECKS) if (!found.has(id) && check(tx)) found.add(id);
  return CHECKS.map(([id]) => id).filter((id) => found.has(id));
}

/** A journey as a check reads it. */
export function pastOfJourney(j: Journey): PastTx {
  const building = j.steps.find((s) => s.target.kind === 'building')?.target;
  return {
    time: j.time,
    chainId: j.chainId,
    block: j.block,
    verb: j.verb,
    protocolId: building?.kind === 'building' ? building.protocolId : null,
    signed: j.initiated,
    failed: j.status === 'failed',
    got: j.steps.flatMap((s) => s.get.filter((g) => !g.isNft).map((g) => g.symbol)),
  };
}
