/**
 * Famous castles: snapshots of well-known public wallets, served as plain
 * files from /famous/ (written by `npm run famous`). Visiting one needs no
 * key and spends no requests, which is what a first-time visitor without a
 * key has to look at. A link opens one too: `#famous=vitalik`.
 *
 * The files are fetched, not bundled: the castle page does not grow with
 * every wallet added, and the list can change without a new build.
 */

import type { PlaceLabel } from '../domain/mappers.js';
import type { ProtocolCategory } from '../domain/catalog.js';
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
  /** It has a story file beside its snapshot (`<address>.story.json`). */
  story?: boolean;
}

/**
 * A famous castle's story, told over its replay: the places it names, the
 * beats a guided replay stops at, and the messages written into transactions
 * (its own, and the crowd's). Written by `npm run famous` from
 * scripts/famous.json and the chain.
 */
export interface FamousStory {
  /** Addresses that are places in town (the victim, a multisig, a stranger). */
  labels: Map<string, PlaceLabel>;
  beats: StoryBeat[];
  /** Its own messages, by transaction hash. */
  notes: Map<string, string>;
  /** Messages strangers wrote to it, oldest first. */
  crowd: { at: number; text: string }[];
}

export interface StoryBeat {
  /** The transaction the beat stops at. */
  hash: string;
  title: string;
  text: string;
  /** What happens to a place at this beat: hit (blast, fire, ruin), mended, or a coin frozen. */
  effect?: 'hack' | 'repair' | 'freeze';
  /** The label id the effect is about. */
  place?: string;
}

const CATEGORIES: readonly ProtocolCategory[] = ['dex', 'aggregator', 'lending', 'staking', 'restaking', 'yield', 'nft-market', 'bridge', 'governance', 'names', 'wrapper', 'mint', 'airdrop', 'unknown'];
const HASH = /^0x[0-9a-f]{64}$/;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);

/** A story file's well-formed parts (anything else is dropped). Pure. */
export function parseFamousStory(raw: unknown): FamousStory {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const labels = new Map<string, PlaceLabel>();
  for (const l of list(o.labels)) {
    const address = typeof l.address === 'string' ? l.address.toLowerCase() : '';
    const id = str(l.id, 40);
    const name = str(l.name, 60);
    const category = CATEGORIES.find((c) => c === l.category);
    if (ADDRESS.test(address) && id !== null && SLUG.test(id) && name !== null && category !== undefined) labels.set(address, { id: `story:${id}`, name, category });
  }
  const beats = list(o.beats).flatMap((b): StoryBeat[] => {
    const hash = typeof b.hash === 'string' ? b.hash.toLowerCase() : '';
    const title = str(b.title, 80);
    const text = str(b.text, 600);
    if (!HASH.test(hash) || title === null || text === null) return [];
    const effect = b.effect === 'hack' || b.effect === 'repair' || b.effect === 'freeze' ? b.effect : undefined;
    const place = str(b.place, 40);
    return [{ hash, title, text, ...(effect ? { effect } : {}), ...(place !== null && SLUG.test(place) ? { place: `story:${place}` } : {}) }];
  });
  const notes = new Map<string, string>();
  for (const n of list(o.notes)) {
    const hash = typeof n.hash === 'string' ? n.hash.toLowerCase() : '';
    const text = str(n.text, 4000);
    if (HASH.test(hash) && text !== null) notes.set(hash, text);
  }
  const crowd = list(o.crowd).flatMap((c) => {
    const text = str(c.text, 280);
    return typeof c.at === 'number' && Number.isFinite(c.at) && text !== null ? [{ at: c.at, text }] : [];
  });
  return { labels, beats, notes, crowd };
}

/** A famous castle's story, or null when it has none or it cannot be read. */
export async function loadFamousStory(castle: FamousCastle): Promise<FamousStory | null> {
  if (castle.story !== true) return null;
  try {
    const res = await fetch(`${FAMOUS_DIR}${castle.address}.story.json?v=${castle.capturedAt}`);
    return res.ok ? parseFamousStory(await res.json()) : null;
  } catch {
    return null;
  }
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
    const { slug, address, name, about, capturedAt, story } = e as Record<string, unknown>;
    if (typeof slug !== 'string' || !SLUG.test(slug)) return [];
    if (typeof address !== 'string' || !ADDRESS.test(address)) return [];
    if (typeof name !== 'string' || name === '' || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return [];
    return [{ slug, address, name: name.slice(0, 60), about: typeof about === 'string' ? about.slice(0, 160) : '', capturedAt, ...(story === true ? { story: true } : {}) }];
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

/** `0xA87fB85A93…` as `0xA87f…a00B`: readable, not something to copy and send money to. Pure. */
export function shortenAddresses(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);
}

/**
 * The words in a transaction's input data, or null when it is a contract
 * call or binary. Encrypted messages (hex or ECIES JSON) read as such.
 */
export function inputText(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || !/^0x([0-9a-f]{2})+$/i.test(input)) return null;
  const bytes = Uint8Array.from(input.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    return null;
  }
  if (text.length < 3) return null;
  const readable = [...text].filter((c) => c === '\n' || c === '\r' || c === '\t' || c >= ' ').length / [...text].length;
  if (readable < 0.95) return null;
  if (/^[0-9a-f]{64,}$/i.test(text) || /"ciphertext"\s*:/.test(text)) return '(an encrypted message)';
  return shortenAddresses(text.replace(/\r\n?/g, '\n'));
}
