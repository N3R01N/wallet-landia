/**
 * How many townsfolk the town holds, from the guild's net worth: a few for a
 * bedroll, more as the wealth grows (on a log scale, so a whale is not a
 * crowd), capped so the streets stay walkable. Pure.
 */

import type { Guild } from '../domain/model.js';

export const POPULATION = { base: 4, perDecade: 6, max: 40 } as const;

export function populationFor(netWorthUsd: number): number {
  const nw = Math.max(0, Number.isFinite(netWorthUsd) ? netWorthUsd : 0);
  return Math.min(POPULATION.max, Math.round(POPULATION.base + POPULATION.perDecade * Math.log10(1 + nw / 1000)));
}

/** The whole guild's net worth in USD: every hero's (tokens, positions and NFT floors). */
export function guildNetWorth(guild: Guild): number {
  return guild.heroes.reduce((s, h) => s + h.netWorth, 0);
}
