/**
 * The castle's own badges: earned by the guild as a whole (its towers, its
 * keep, its wings, the couriers that crossed the bridge), not by one
 * transaction. Pure: worked out from the castle's world and the player's stats.
 * Their pictures are the theme's `badge.<id>` art (docs/ASSET_SPEC.md §3.8).
 */

import type { PlayerStats } from '../../domain/player.js';
import { WING_FOR } from '../scene/plan.js';
import type { CastleWorld } from './world.js';

export interface CastleBadge {
  id: string;
  name: string;
  /** How to earn it. */
  hint: string;
  /** What it means, in plain words. */
  lesson: string;
  /** How far along: 0 … 1 (1 = earned). */
  progress: number;
  /** "3 of 8 towers": where the guild stands. */
  status: string;
}

/** Every wing the castle can grow (plan.ts): one per kind of protocol. */
const ALL_WINGS = [...new Set(Object.values(WING_FOR))];

export const CASTLE_BADGE_IDS = ['castle-builder', 'gatehouse-lord', 'gilded', 'full-moat', 'bridge-keeper'] as const;

const MYTHIC = 6;
const BRIDGE_CROSSINGS = 1000;

export function castleBadges(world: CastleWorld, stats: Pick<PlayerStats, 'signed'> | null): CastleBadge[] {
  const wings = new Set(world.protocols.map((p) => WING_FOR[p.category] ?? 'other'));
  const signed = stats?.signed ?? 0;
  const share = (have: number, need: number) => Math.min(1, have / need);
  return [
    {
      id: 'castle-builder',
      name: 'Castle Builder',
      hint: 'Have three wallets in your guild: three towers on the walls.',
      lesson: 'Spreading your coins over several wallets (for spending, saving, trying new things) keeps one mistake from reaching everything.',
      progress: share(world.wallets, 3),
      status: `${world.wallets} of 3 towers`,
    },
    {
      id: 'gatehouse-lord',
      name: 'Gatehouse Lord',
      hint: 'Have eight wallets in your guild.',
      lesson: 'A big guild of wallets needs keeping track of: label them, and know which one does what.',
      progress: share(world.wallets, 8),
      status: `${world.wallets} of 8 towers`,
    },
    {
      id: 'gilded',
      name: 'Gilded',
      hint: 'Grow your guild’s worth to the Mythic tier ($1M or more): a gilded keep.',
      lesson: 'The keep shows what the whole guild is worth, every wallet together, at today’s prices.',
      progress: share(world.tier, MYTHIC),
      status: `keep at tier ${world.tier} of ${MYTHIC}`,
    },
    {
      id: 'full-moat',
      name: 'Full Moat',
      hint: 'Use every kind of protocol: lending, exchange, staking, NFTs, governance and the rest. Each one grows a wing of the castle.',
      lesson: 'Each kind of protocol does a different job; knowing them all is knowing your way round the chain.',
      progress: share(ALL_WINGS.filter((w) => wings.has(w)).length, ALL_WINGS.length),
      status: `${ALL_WINGS.filter((w) => wings.has(w)).length} of ${ALL_WINGS.length} wings`,
    },
    {
      id: 'bridge-keeper',
      name: 'Bridge Keeper',
      hint: `Sign ${BRIDGE_CROSSINGS.toLocaleString('en-US')} transactions: that many couriers across the drawbridge.`,
      lesson: 'Every courier pays the toll (the gas fee) at the barrier: a thousand crossings is a lot of tolls.',
      progress: share(signed, BRIDGE_CROSSINGS),
      status: `${signed.toLocaleString('en-US')} of ${BRIDGE_CROSSINGS.toLocaleString('en-US')} crossings`,
    },
  ];
}
