/**
 * The town's secrets: things to find (the wishing well, the old wanderer by
 * the ruin, the monuments to Ethereum's history the guild took part in). Each
 * says how it was found once it is; the found ones are kept on this device.
 * Pure but for the storage, which is guarded (private windows, blocked storage).
 */

import { historyMoments, type MomentId, type PastTx } from '../../domain/moments.js';
import type { CastlePlan, Placement } from '../scene/plan.js';
import type { Errand } from './world.js';

export type SecretId = 'wishing-well' | 'old-wanderer' | MomentId;

export interface Secret {
  id: SecretId;
  name: string;
  /** How it is found: shown once it is. */
  hint: string;
}

export const SECRETS: readonly Secret[] = [
  { id: 'wishing-well', name: 'The wishing well', hint: 'Three quick taps on the town’s well drop a coin in for a wish.' },
  { id: 'old-wanderer', name: 'The old wanderer', hint: 'He waits by the ruin for a guild whose first transaction is over five years old.' },
  { id: 'dao-year', name: 'The year of The DAO', hint: 'A transaction of the guild’s in 2016 raised a monument in town.' },
  { id: 'ens-airdrop', name: 'The ENS airdrop', hint: 'Claiming the ENS airdrop (from November 2021) raised a monument in town.' },
  { id: 'merge', name: 'The Merge', hint: 'A transaction in the Merge’s block (15537394) or on its day, 15 September 2022, raised a monument in town.' },
];

/** The monuments' words, tapped, their banners' colours, and what their plaques say (an emblem over a line or two). */
export const MONUMENTS: Record<MomentId, { says: string; tint: string; plaque: { mark: string; lines: string[] } }> = {
  'dao-year': { says: 'Your guild was here in 2016, the year of The DAO', tint: '#8a5a2b', plaque: { mark: 'Ξ', lines: ['THE DAO', '2016'] } },
  'ens-airdrop': { says: 'Your guild claimed the ENS airdrop', tint: '#5298ff', plaque: { mark: '.eth', lines: ['ENS AIRDROP', 'NOV 2021'] } },
  merge: { says: 'Your guild was there when Ethereum merged to proof of stake', tint: '#c9a227', plaque: { mark: 'Ξ', lines: ['THE MERGE', '15 SEP 2022'] } },
};

/** What the old wanderer says. */
export const WANDERER_LINES: readonly string[] = [
  'not your keys, not your coins',
  'I remember when gas was cheap… and when it was not',
  'bear markets build, bull markets sell',
  'write your seed words down, never type them in',
  'patience, traveller: the chain remembers everything',
  'every cycle, someone says it is different this time',
];

/** The wish when the well takes a coin. */
export const WISHES: readonly string[] = ['a coin for a wish… may your gas be low', 'plink! wish for green candles', 'the well keeps your wish safe'];

/** How old the guild's first transaction must be for the wanderer. */
const WANDERER_YEARS = 5;
const YEAR = 365.25 * 86_400_000;

/** The wanderer shows for a guild whose first transaction is more than five years old. */
export function wandererComes(firstAt: number | null, now: number): boolean {
  return firstAt !== null && now - firstAt > WANDERER_YEARS * YEAR;
}

/** Taps this close together (s) count as one go at the well. */
export const WELL_WINDOW = 2.5;
export const WELL_TAPS = 3;

/** Counts quick taps: true on the tap that makes it three in a row (then starts again). */
export class TapCounter {
  #times: number[] = [];

  constructor(
    readonly need = WELL_TAPS,
    readonly window = WELL_WINDOW,
  ) {}

  tap(at: number): boolean {
    this.#times = [...this.#times.filter((t) => at - t <= this.window), at];
    if (this.#times.length < this.need) return false;
    this.#times = [];
    return true;
  }
}

const KEY = 'zenigard/secrets/v1';

/** Where the found secrets are kept (localStorage, or a stand-in in tests). */
export type SecretStore = Pick<Storage, 'getItem' | 'setItem'>;

function store(): SecretStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The secrets found on this device: id → when. */
export function foundSecrets(s: SecretStore | null = store()): Partial<Record<SecretId, number>> {
  try {
    const raw = JSON.parse(s?.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Partial<Record<SecretId, number>> = {};
    for (const secret of SECRETS) if (typeof raw[secret.id] === 'number') out[secret.id] = raw[secret.id] as number;
    return out;
  } catch {
    return {};
  }
}

/** Finds a secret (kept); true when it is newly found. */
export function findSecret(id: SecretId, now = Date.now(), s: SecretStore | null = store()): boolean {
  const found = foundSecrets(s);
  if (found[id] !== undefined) return false;
  found[id] = now;
  try {
    s?.setItem(KEY, JSON.stringify(found));
  } catch {
    // storage full or blocked: found for now, not kept
  }
  return true;
}

/** The found secrets in the registry's order, and how many there are. */
export function secretsProgress(found: Partial<Record<SecretId, number>>): { found: (Secret & { at: number })[]; total: number } {
  return { found: SECRETS.filter((s) => found[s.id] !== undefined).map((s) => ({ ...s, at: found[s.id]! })), total: SECRETS.length };
}

/** The monuments' spots on the plaza, east of the well (dx, dz from the tower), in the moments' order. */
const MONUMENT_SPOTS = [
  { dx: 7.5, dz: -4 },
  { dx: 7.5, dz: 0 },
  { dx: 7.5, dz: 4 },
];
const MOMENT_ORDER: readonly MomentId[] = ['dao-year', 'ens-airdrop', 'merge'];

/**
 * What the secrets add to the town, placed like its decor (optional: nothing
 * shows while the theme has no model): a monument on the plaza for each moment
 * (its key `monument:<id>`), the old wanderer by the ruin.
 */
export function secretPlacements(plan: Pick<CastlePlan, 'tower' | 'scenery'> & Partial<Pick<CastlePlan, 'plazaSpots'>>, o: { moments: readonly MomentId[]; wanderer: boolean }): Placement[] {
  const out: Placement[] = [];
  MOMENT_ORDER.forEach((id, i) => {
    if (!o.moments.includes(id)) return;
    // the plaza's monument spots (facing the avenue, or in a district town's square), else beside the well
    const spot = plan.plazaSpots?.monuments[i] ?? { x: plan.tower.x + MONUMENT_SPOTS[i]!.dx, z: plan.tower.z + MONUMENT_SPOTS[i]!.dz, rot: -Math.PI / 2 };
    out.push({ name: 'prop.monument', x: spot.x, z: spot.z, rot: spot.rot, optional: true, key: `monument:${id}`, tint: MONUMENTS[id].tint, plaque: MONUMENTS[id].plaque });
  });
  const ruin = plan.scenery.find((p) => p.name === 'scenery.ruin');
  if (o.wanderer && ruin) out.push({ name: 'person.npc.wanderer', x: ruin.x - 3, z: ruin.z + 3, rot: -0.6, optional: true, key: 'wanderer' });
  return out;
}

/** The monument's moment, from its placement key (null: not a monument). */
export function monumentOf(key: string | undefined): MomentId | null {
  const id = key?.startsWith('monument:') ? key.slice('monument:'.length) : null;
  return id !== null && id in MONUMENTS ? (id as MomentId) : null;
}

/** An errand as the history checks read it. */
export function pastOfErrand(e: Errand): PastTx {
  return {
    time: e.time,
    chainId: e.chainId,
    block: e.block,
    verb: e.verb,
    protocolId: e.protocolId,
    signed: e.direction !== 'in',
    failed: e.failed,
    got: e.steps.flatMap((s) => s.get.filter((g) => !g.isNft).map((g) => g.symbol)),
  };
}

/** What the guild has to show in town: the moments of its history (the loaded errands and, at home, the whole kept history) and whether the wanderer comes. */
export function landmarksOf(o: { errands: readonly Errand[]; lifetime: { moments?: readonly MomentId[]; firstAt: number | null } | null; now: number }): { moments: MomentId[]; wanderer: boolean } {
  const seen = new Set([...historyMoments(o.errands.map(pastOfErrand)), ...(o.lifetime?.moments ?? [])]);
  const firsts = [o.errands[0]?.time, o.lifetime?.firstAt].filter((t): t is number => typeof t === 'number');
  return { moments: MOMENT_ORDER.filter((id) => seen.has(id)), wanderer: wandererComes(firsts.length ? Math.min(...firsts) : null, o.now) };
}
