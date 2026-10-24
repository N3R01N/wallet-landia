/**
 * The campaign's progress on this device: the missions won. A mission opens
 * when the one before it is won. Storage may be missing or blocked (a private
 * window): then every mission starts locked but the first, and nothing breaks.
 */

const KEY = 'zenigard.rts.campaign';

export function wonMissions(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

export function markWon(n: number): void {
  const won = wonMissions();
  won.add(n);
  try {
    localStorage.setItem(KEY, JSON.stringify([...won].sort((a, b) => a - b)));
  } catch {
    // not kept: the next visit starts from the missions open then
  }
}

export function isOpen(n: number, won: Set<number> = wonMissions()): boolean {
  return n === 1 || won.has(n - 1) || won.has(n);
}
