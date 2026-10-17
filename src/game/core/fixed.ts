/**
 * Quantities as fixed-point bigints (nano-units: 1 token = 10^9), so portfolio
 * amounts never drift. Prices and dollar values stay numbers.
 */

export const Q_SCALE = 1_000_000_000n;
const SCALE_N = 1e9;

/** A token amount from a decimal number (rounded to the nano-unit). */
export function q(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  return BigInt(Math.round(amount * SCALE_N));
}

/** A bigint amount as a decimal number (for values and display). */
export function qn(qty: bigint): number {
  const whole = qty / Q_SCALE;
  const frac = qty % Q_SCALE;
  return Number(whole) + Number(frac) / SCALE_N;
}

/** qty × factor, the factor rounded to 10^-9 (for yields, fees and seizures). */
export function qmul(qty: bigint, factor: number): bigint {
  if (factor <= 0 || qty <= 0n) return 0n;
  return (qty * BigInt(Math.round(factor * SCALE_N))) / Q_SCALE;
}

/** Dollar value of a quantity at a price. */
export function value(qty: bigint, price: number): number {
  return qn(qty) * price;
}

/** The quantity worth `dollars` at `price`. */
export function qtyFor(dollars: number, price: number): bigint {
  return price > 0 ? q(dollars / price) : 0n;
}

export function qmin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
