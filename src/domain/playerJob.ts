/**
 * The player worked out from raw history (every kept transaction of each of
 * your wallets), in a form that can cross to and from a Web Worker. Mapping a
 * lifetime ledger is the heaviest thing the app does, so it runs off the main
 * thread when it can (`ui/player.worker.ts`) and right here when it cannot.
 *
 * What crosses is structured-cloned: Maps and plain data survive, functions do
 * not. Medals carry their rules (functions), so badges travel by medal id and
 * get their medal back on arrival (`fromWire`).
 */

import type { RawWallet } from '../data/zerion/endpoints.js';
import { medalById } from './feats.js';
import { buildGuild } from './mappers.js';
import { playerProfile, type PlayerBadge, type PlayerProfile, type Provenance } from './player.js';

export interface PlayerJob {
  /** Your own wallets with everything kept of their history. */
  raws: readonly RawWallet[];
  names: ReadonlyMap<string, string>;
  /** Badges seen before that the kept history may no longer show (medal id → when). */
  remembered: ReadonlyMap<string, Provenance>;
  /** The time the profile is for (the level counts months since the first journey). */
  now: number;
}

export type WireBadge = Omit<PlayerBadge, 'medal'>;
export interface WireProfile extends Omit<PlayerProfile, 'badges'> {
  /** Medal id → badge, in the profile's order. */
  badges: [string, WireBadge][];
}

/** The whole lifetime, mapped with no window, and the player made of it. */
export function workPlayer(job: PlayerJob): WireProfile {
  const life = buildGuild(job.raws, { kind: 'count', count: Number.MAX_SAFE_INTEGER }, { names: job.names });
  return toWire(playerProfile(life, job.remembered, job.now));
}

export function toWire(p: PlayerProfile): WireProfile {
  return { ...p, badges: [...p.badges].map(([id, { medal: _medal, ...rest }]) => [id, rest]) };
}

export function fromWire(w: WireProfile): PlayerProfile {
  const badges = new Map<string, PlayerBadge>();
  for (const [id, b] of w.badges) {
    const medal = medalById(id);
    if (medal) badges.set(id, { medal, ...b });
  }
  return { ...w, badges };
}
