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

/** A crest colour pair per address. */
export function crestColors(address: string): [string, string] {
  const h = hashString(`crest:${address.toLowerCase()}`);
  const hue = h % 360;
  return [`hsl(${hue} 55% 45%)`, `hsl(${(hue + 40) % 360} 70% 75%)`];
}
