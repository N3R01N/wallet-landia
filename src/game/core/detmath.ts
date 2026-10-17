/**
 * Maths that gives the same bits on every machine. JavaScript's Math.exp,
 * Math.log, Math.pow and the trig functions may differ in the last bit between
 * engines; +, −, ×, ÷ and Math.sqrt are exactly rounded (IEEE 754). The core
 * uses only those, through these helpers, so a replay or a PvP match plays out
 * the same everywhere.
 */

import { hashString, makeRng } from '../../util/rng.js';

const LN2 = 0.6931471805599453;

/** e^x by range reduction (x = k ln2 + r, |r| ≤ ln2/2) and a Taylor series. */
export function dexp(x: number): number {
  if (x === 0) return 1;
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n < 20; n++) {
    term = (term * r) / n;
    sum += term;
  }
  return sum * pow2(k);
}

/** ln x for x > 0: x = m · 2^k with m in [√½, √2), then 2·atanh((m−1)/(m+1)). */
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let k = 0;
  let m = x;
  while (m >= Math.SQRT2) {
    m /= 2;
    k++;
  }
  while (m < Math.SQRT1_2) {
    m *= 2;
    k--;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = 0;
  for (let n = 1; n < 40; n += 2) {
    sum += term / n;
    term *= s2;
  }
  return 2 * sum + k * LN2;
}

/** x^y for x > 0. */
export function dpow(x: number, y: number): number {
  return dexp(y * dlog(x));
}

function pow2(k: number): number {
  let out = 1;
  const base = k < 0 ? 0.5 : 2;
  for (let i = 0; i < Math.abs(k); i++) out *= base;
  return out;
}

/** A seeded uniform stream in [0, 1). */
export type Rng = () => number;

/** The stream for one subsystem ('market', 'events', 'battle', 'npc:A'…), derived from the match seed. */
export function streamOf(seed: string, subsystem: string, round = 0): Rng {
  return makeRng(hashString(`${seed}|${subsystem}|${round}`));
}

/** A standard normal draw: Irwin–Hall with 12 uniforms (only additions: the same on every machine). */
export function normal(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng();
  return s - 6;
}

/** One item by weight. */
export function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error('weighted pick from empty list');
  return last[0];
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
