/**
 * Famous castles: snapshots of well-known public wallets, served as plain
 * files from /famous/ (written by `npm run famous`). Visiting one needs no
 * key and spends no requests, which is what a first-time visitor without a
 * key has to look at. A link opens one too: `#famous=vitalik`.
 *
 * The files are fetched, not bundled: the castle page does not grow with
 * every wallet added, and the list can change without a new build.
 */

import type { RawWallet } from './zerion/endpoints.js';

export interface FamousCastle {
  /** Short name for links (`#famous=<slug>`): lowercase letters, digits and dashes. */
  slug: string;
  address: string;
  name: string;
  /** One line on who this is. */
  about: string;
  /** When the snapshot was taken, epoch ms. */
  capturedAt: number;
}

export const FAMOUS_DIR = '/famous/';
/** A snapshot keeps the positions worth at least this many dollars (see trimForSnapshot). */
export const SNAPSHOT_MIN_USD = 1;
const SLUG = /^[a-z0-9-]{1,40}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The entries of an index file that are well formed (anything else is dropped). Pure. */
export function parseFamousIndex(raw: unknown): FamousCastle[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown): FamousCastle[] => {
    if (typeof e !== 'object' || e === null) return [];
    const { slug, address, name, about, capturedAt } = e as Record<string, unknown>;
    if (typeof slug !== 'string' || !SLUG.test(slug)) return [];
    if (typeof address !== 'string' || !ADDRESS.test(address)) return [];
    if (typeof name !== 'string' || name === '' || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return [];
    return [{ slug, address, name: name.slice(0, 60), about: typeof about === 'string' ? about.slice(0, 160) : '', capturedAt }];
  });
}

/** The famous castle a link's hash names (`#famous=<slug>`), or null. Pure. */
export function famousSlugOf(hash: string): string | null {
  const slug = new URLSearchParams(hash.replace(/^#/, '')).get('famous');
  return slug !== null && SLUG.test(slug) ? slug : null;
}

/** `#famous=<slug>`. */
export function famousLink(slug: string): string {
  return `#famous=${slug}`;
}

/**
 * A whale's wallet as a visitor needs it: the positions worth at least
 * SNAPSHOT_MIN_USD. A famous wallet collects thousands of tokens with no
 * price and dust (vitalik.eth: 4,409 tokens, 5.4 MB); the castle looks the
 * same without them, and the file is a fifth of the size. Pure.
 */
export function trimForSnapshot(raw: RawWallet): RawWallet {
  const worth = (p: { attributes: { value?: number | null } }): boolean => (p.attributes.value ?? 0) >= SNAPSHOT_MIN_USD;
  return { ...raw, simple: raw.simple.filter(worth), complex: raw.complex.filter(worth) };
}

let index: Promise<FamousCastle[]> | null = null;

/** The list of famous castles (empty when there is none or it cannot be read). Fetched once a page load. */
export function loadFamousIndex(): Promise<FamousCastle[]> {
  index ??= fetch(`${FAMOUS_DIR}index.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : []))
    .then(parseFamousIndex)
    .catch(() => {
      index = null; // offline: try again next time
      return [];
    });
  return index;
}

/** One famous castle's snapshot, or null when it cannot be read. */
export async function loadFamousWallet(castle: FamousCastle): Promise<RawWallet | null> {
  try {
    // the snapshot's date names the file's version: a new capture is a new URL
    const res = await fetch(`${FAMOUS_DIR}${castle.address}.json?v=${castle.capturedAt}`);
    if (!res.ok) return null;
    const raw = (await res.json()) as RawWallet;
    return typeof raw === 'object' && raw !== null && raw.address?.toLowerCase() === castle.address ? raw : null;
  } catch {
    return null;
  }
}
