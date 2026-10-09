/** Deterministic hashing and RNG, so the same wallet always builds the same world. */

export function hashString(input: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick from empty list');
  return item;
}

const FIRST = [
  'Aldric', 'Brienne', 'Cedric', 'Dorian', 'Elowen', 'Fenwick', 'Gwyn', 'Hollis', 'Isolde', 'Jory',
  'Kestrel', 'Linnea', 'Merric', 'Nell', 'Osric', 'Perrin', 'Quill', 'Rowan', 'Sabine', 'Tamsin',
  'Ulric', 'Vesna', 'Wren', 'Yara', 'Zephyr', 'Ansel', 'Bramble', 'Clover', 'Dashiell', 'Ember',
];
const LAST = [
  'Ashford', 'Briarwood', 'Copperkettle', 'Dunmore', 'Elderglen', 'Fairweather', 'Goldmeadow',
  'Hazelbrook', 'Ironwood', 'Juniper', 'Kettlebrook', 'Larkspur', 'Millbrook', 'Nettlefield',
  'Oakhurst', 'Pebblestone', 'Quarrydale', 'Rosethorn', 'Silverbrook', 'Thistledown', 'Underhill',
  'Valebrook', 'Willowmere', 'Yarrowby',
];

export function heroName(address: string): string {
  const rng = makeRng(hashString(address.toLowerCase()));
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

/** Heraldic tinctures a player may pick for a crest. */
export const TINCTURES: readonly { name: string; color: string }[] = [
  { name: 'Gules', color: '#b0302a' },
  { name: 'Sanguine', color: '#7a1f24' },
  { name: 'Tenné', color: '#c8692a' },
  { name: 'Or', color: '#d4a32a' },
  { name: 'Vert', color: '#2f7d3a' },
  { name: 'Teal', color: '#1f7a78' },
  { name: 'Celeste', color: '#6aaee0' },
  { name: 'Azure', color: '#2a58b0' },
  { name: 'Purpure', color: '#73409c' },
  { name: 'Murrey', color: '#8a3a62' },
  { name: 'Sable', color: '#2a2628' },
  { name: 'Argent', color: '#e6e4de' },
];

/** Crests the player chose, by lowercase address (see `setCrests`). */
let chosen: Record<string, [string, string]> = {};

/** The player's chosen crests (from their preferences); every crest drawn after this uses them. */
export function setCrests(crests: Record<string, [string, string]>): void {
  chosen = crests;
}

/** The crest an address is born with. */
export function bornCrest(address: string): [string, string] {
  const h = hashString(`crest:${address.toLowerCase()}`);
  const hue = h % 360;
  // hex, not hsl(): the 3D library reads only the older comma form of hsl, and fell back to white
  return [hslHex(hue, 0.55, 0.45), hslHex((hue + 40) % 360, 0.7, 0.75)];
}

/** An HSL colour as #rrggbb (hue in degrees, saturation and lightness 0..1). */
export function hslHex(hue: number, sat: number, light: number): string {
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A crest colour pair per address: the player's choice, else the one it was born with. */
export function crestColors(address: string): [string, string] {
  return chosen[address.toLowerCase()] ?? bornCrest(address);
}
