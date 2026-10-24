/**
 * Wallet-landia became Zenigard (2026-10-24). What a player saved under the
 * old names (preferences, the Zerion key, progress) moves to the new ones once,
 * when a page loads: each entry imports this first, before anything reads
 * storage. A key already saved under the new name is kept.
 */

const RENAMES: readonly (readonly [string, string])[] = [
  ['wallet-landia-v4/', 'zenigard/'],
  ['wallet-landia/', 'zenigard/'],
  ['wallet-landia.', 'zenigard.'],
];

export function moveOldKeys(s: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) keys.push(s.key(i) ?? '');
  for (const key of keys) {
    const rename = RENAMES.find(([from]) => key.startsWith(from));
    if (!rename) continue;
    const to = rename[1] + key.slice(rename[0].length);
    const value = s.getItem(key);
    if (value !== null && s.getItem(to) === null) s.setItem(to, value);
    s.removeItem(key);
  }
}

try {
  if (typeof localStorage !== 'undefined') moveOldKeys(localStorage);
} catch {
  // blocked storage: nothing saved to move
}
