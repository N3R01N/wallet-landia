/**
 * What the villager in a house says, by what the house holds: the bailiffs at
 * the door for a loan in danger, a claim for rewards waiting, a joke about
 * heavy bags for a lot of value, and "nothing here, ser" for an empty house.
 */

import type { Room } from './roomLayout.js';

export function roomRemark(room: Room): string {
  if (room.empty) return 'nothing here, ser';
  if (room.objects.some((o) => o.kind === 'scale' && (o.tone === 'danger' || o.tone === 'critical'))) return 'the bailiffs are at the door';
  if (room.objects.some((o) => o.kind === 'harvest')) return 'rewards to claim!';
  if (room.objects.filter((o) => o.kind === 'chest' || o.kind === 'coins' || o.kind === 'sack').length >= 3) return 'bags are heavy';
  if (room.objects.some((o) => o.kind === 'picture')) return 'nice pictures';
  return 'wagmi';
}
