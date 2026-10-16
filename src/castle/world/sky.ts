/**
 * The castle's sky: the light by the player's local hour (day, dusk, night) and
 * the weather from the market (ETH over the last 24 hours: rain when it fell,
 * clear when it rose). Pure numbers; the view applies them.
 */

import type { PriceMood } from '../../domain/risk.js';

/** 0 by day, 1 at night: dark from 21:00 to 05:00, with three hours of dusk and dawn between. */
export function nightFactor(hour: number): number {
  return Math.max(0, Math.min(1, (Math.abs(hour - 13) - 5) / 3));
}

export interface Light {
  /** 0 day … 1 night. */
  night: number;
  sun: number;
  ambient: number;
  /** The sky's colour (hex). */
  sky: number;
  /** How bright lit windows and lanterns glow. */
  glow: number;
}

const DAY_SKY = [0xbc, 0xd3, 0xe0];
const NIGHT_SKY = [0x1c, 0x24, 0x40];

export function lightAt(hour: number): Light {
  const night = nightFactor(hour);
  const mix = (a: number, b: number) => a + (b - a) * night;
  const sky = DAY_SKY.map((c, i) => Math.round(mix(c, NIGHT_SKY[i]!)));
  return {
    night,
    sun: mix(3, 0.25),
    ambient: mix(1, 0.35),
    sky: (sky[0]! << 16) | (sky[1]! << 8) | sky[2]!,
    glow: mix(0.4, 2.2),
  };
}

export interface Weather {
  /** 0 … 1: how hard it rains. */
  rain: number;
  /** 0 … 1: how grey the day is. */
  gloom: number;
  /** 0 … 1: how much of the sky is cloud (their shadows drift over the land). */
  clouds: number;
  /** 0 … 1: a bright, warm sun (a rising market). */
  shine: number;
}

/**
 * The market's mood as weather, so it shows whichever way it went: a big rise
 * is a bright, nearly cloudless day; a rise sunny; flat (or no 24h change to
 * compare) a few clouds; a fall overcast with drizzle; a crash a storm.
 */
export function weatherFor(mood: PriceMood | null): Weather {
  switch (mood) {
    case 'boom':
      return { rain: 0, gloom: 0, clouds: 0.1, shine: 1 };
    case 'up':
      return { rain: 0, gloom: 0, clouds: 0.25, shine: 0.6 };
    case 'down':
      return { rain: 0.45, gloom: 0.3, clouds: 0.75, shine: 0 };
    case 'crash':
      return { rain: 1, gloom: 0.6, clouds: 1, shine: 0 };
    default:
      return { rain: 0, gloom: 0, clouds: 0.45, shine: 0.2 };
  }
}
