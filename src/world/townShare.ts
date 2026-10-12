/**
 * A town as a link, to share with friends: which building stands where and
 * which way it faces, the land, the look, and (sharing your town) the
 * public wallets that live in it. Roads and scenery are left out: they come
 * from the layout the same way every time. A few hundred characters for a
 * usual town, in the link's #fragment (which never reaches a server).
 *
 *   wl1|<t: town, d: design>|<realm>|<w>x<h>|<theme>|<buildings>|<heroes>
 *   building = <ref>~<kind>~<x>.<y>.<rot>
 *     ref: h<n> a home (the n-th hero), s a private estate (shuttered), or
 *     a protocol id (URI-encoded)
 *   hero = <address>~<name>~<class>~<title>~<crest>   (town links only)
 *
 * Deflated and base64url-encoded. Private wallets never leave: in a town
 * link their homes are shuttered estates, and a building only private
 * wallets brought is left out (it would tell what they did). A design names
 * no one: homes are numbered, and its buildings are tied to no wallet.
 */

import { DISTRICT_OF, MAP_H, MAP_W } from './layout.js';
import { buildables, BuildPlanner, type Buildable, type Known, type LayoutEntry, type Rot, type TownLayout } from './townLayout.js';
import type { Guild } from '../domain/model.js';

export const SHARE_VERSION = 'wl1';

export interface SharedBuilding {
  /** `h<n>` a home, `s` a private estate, else a protocol id. */
  ref: string;
  kind: string;
  x: number;
  y: number;
  rot: Rot;
}

export interface SharedHero {
  address: string;
  name: string;
  cls: string;
  title: string;
  crest: string;
}

export interface SharedTown {
  /** `town`: your town to visit (with its public heroes); `design`: a layout to copy. */
  mode: 'town' | 'design';
  realm: string;
  land: { w: number; h: number };
  theme: string;
  buildings: SharedBuilding[];
  heroes: SharedHero[];
}

// --- making one ------------------------------------------------------------------

export interface ShareInput {
  mode: 'town' | 'design';
  realm: string;
  land: { w: number; h: number };
  theme: string;
  layout: TownLayout;
  guild: Guild;
  /** What each protocol is, and which wallets brought it. */
  known: Known;
  /** Your wallets marked public. */
  publicWallets: readonly string[];
  /** How you dressed your heroes (town links): names, classes, titles, crest colours. */
  names: Record<string, string>;
  classes: Record<string, string>;
  titles: Record<string, string>;
  crests: Record<string, [string, string]>;
}

/** What a link would hold: the layout, with private wallets kept out (see the header). */
export function makeShare(i: ShareInput): SharedTown {
  const pub = new Set(i.publicWallets.map((a) => a.toLowerCase()));
  const can = new Map(buildables(i.guild).map((b) => [b.id, b]));
  // only what actually stands in town
  const standing = new BuildPlanner(i.guild, i.layout).placed;
  const heroes: SharedHero[] = [];
  const buildings: SharedBuilding[] = [];
  let homes = 0;
  for (const e of i.layout.placed) {
    const what = can.get(e.id);
    if (what === undefined || !standing.has(e.id)) continue;
    const at = { x: e.x, y: e.y, rot: e.rot };
    if (what.heroAddress !== undefined) {
      const a = what.heroAddress;
      if (i.mode === 'design') buildings.push({ ref: `h${homes++}`, kind: 'home', ...at });
      else if (pub.has(a)) {
        buildings.push({ ref: `h${heroes.length}`, kind: 'home', ...at });
        const crest = i.crests[a]?.[0] ?? '';
        heroes.push({ address: a, name: i.names[a] ?? '', cls: i.classes[a] ?? '', title: i.titles[a] ?? '', crest: /^#[0-9a-f]{6}$/i.test(crest) ? crest : '' });
      } else buildings.push({ ref: 's', kind: 'home', ...at });
      continue;
    }
    const id = what.protocolId!;
    // in your town a building tells what its wallets did: only one a public wallet brought may go
    // (a design names no one: its buildings are tied to no wallet)
    const by = i.known[id]?.by ?? [];
    if (i.mode === 'town' && !by.some((w) => pub.has(w.toLowerCase()))) continue;
    buildings.push({ ref: id, kind: what.kind, ...at });
  }
  return { mode: i.mode, realm: i.realm, land: i.land, theme: i.theme, buildings, heroes };
}

// --- as text ---------------------------------------------------------------------

/** URI-encoded, and `~` too (the field separator, which encodeURIComponent leaves alone). */
const esc = (s: string): string => encodeURIComponent(s).replace(/~/g, '%7E');

export function shareText(s: SharedTown): string {
  const b = s.buildings.map((x) => `${/^h\d+$|^s$/.test(x.ref) ? x.ref : esc(x.ref)}~${x.kind}~${x.x}.${x.y}.${x.rot}`).join(';');
  const h = s.heroes.map((x) => [x.address, x.name, x.cls, x.title, x.crest].map(esc).join('~')).join(';');
  return [SHARE_VERSION, s.mode === 'town' ? 't' : 'd', s.realm, `${s.land.w}x${s.land.h}`, s.theme, b, h].join('|');
}

const KINDS = new Set<string>([...Object.keys(DISTRICT_OF), 'home']);
const MAX_TEXT = 40_000;
const MAX_BUILDINGS = 400;
const MAX_HEROES = 50;

/** Read a link's text back, strictly (a link can come from anyone): a plain-words error when it is not one. */
export function parseShareText(text: string): SharedTown {
  const bad = (why: string): Error => new Error(`That link is not a Wallet-landia town (${why}).`);
  if (text.length > MAX_TEXT) throw bad('too long');
  const parts = text.split('|');
  if (parts.length !== 7 || parts[0] !== SHARE_VERSION) throw bad('unknown format');
  const [, m, realm, size, theme, bs, hs] = parts as [string, string, string, string, string, string, string];
  if (m !== 't' && m !== 'd') throw bad('unknown kind');
  if (!/^[a-z0-9-]{1,40}$/.test(realm)) throw bad('no realm');
  const sz = /^(\d{1,3})x(\d{1,3})$/.exec(size);
  if (sz === null) throw bad('no land');
  const land = { w: Math.min(MAP_W, Number(sz[1])), h: Math.min(MAP_H, Number(sz[2])) };
  if (!/^[a-z0-9-]{0,40}$/.test(theme)) throw bad('odd theme');
  const buildings: SharedBuilding[] = [];
  for (const raw of bs === '' ? [] : bs.split(';')) {
    const f = raw.split('~');
    if (f.length !== 3) throw bad('odd building');
    const pos = /^(\d{1,2})\.(\d{1,2})\.([0-3])$/.exec(f[2]!);
    if (pos === null) throw bad('odd position');
    const [x, y, rot] = [Number(pos[1]), Number(pos[2]), Number(pos[3]) as Rot];
    if (x >= MAP_W || y >= MAP_H) throw bad('off the map');
    let ref: string;
    try {
      ref = decodeURIComponent(f[0]!);
    } catch {
      throw bad('odd building');
    }
    if (ref.length === 0 || ref.length > 200) throw bad('odd building');
    if (!KINDS.has(f[1]!)) throw bad('unknown building');
    const home = /^h\d{1,2}$/.test(ref) || ref === 's';
    if (home !== (f[1] === 'home')) throw bad('odd home');
    buildings.push({ ref, kind: f[1]!, x, y, rot });
    if (buildings.length > MAX_BUILDINGS) throw bad('too many buildings');
  }
  const heroes: SharedHero[] = [];
  if (m === 't') {
    for (const raw of hs === '' ? [] : hs.split(';')) {
      const f = raw.split('~');
      if (f.length !== 5) throw bad('odd hero');
      let v: string[];
      try {
        v = f.map((x) => decodeURIComponent(x));
      } catch {
        throw bad('odd hero');
      }
      const [address, name, cls, title, crest] = v as [string, string, string, string, string];
      if (!/^0x[0-9a-f]{40}$/.test(address)) throw bad('odd address');
      heroes.push({ address, name: name.slice(0, 60), cls: /^[a-z]{0,20}$/.test(cls) ? cls : '', title: title.slice(0, 60), crest: /^#[0-9a-f]{6}$/i.test(crest) ? crest : '' });
      if (heroes.length > MAX_HEROES) throw bad('too many heroes');
    }
  } else if (hs !== '') throw bad('a design names no one');
  // every home a town link shows belongs to one of its heroes
  for (const b of buildings) if (m === 't' && /^h\d+$/.test(b.ref) && Number(b.ref.slice(1)) >= heroes.length) throw bad('a home without its hero');
  return { mode: m === 't' ? 'town' : 'design', realm, land, theme, buildings, heroes };
}

// --- as a link -------------------------------------------------------------------------

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function squeeze(text: string, how: 'in' | 'out', bytes?: Uint8Array): Promise<Uint8Array | string> {
  if (how === 'in') return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  // unpacking a link from anyone: stop at a size no town needs
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + dec.decode();
    out += dec.decode(value, { stream: true });
    if (out.length > MAX_TEXT) {
      void reader.cancel();
      throw new Error('That link is not a Wallet-landia town (too long).');
    }
  }
}

/** The link's payload (what follows `#town=` or `#design=`). */
export async function encodeShare(s: SharedTown): Promise<string> {
  return b64url((await squeeze(shareText(s), 'in')) as Uint8Array);
}

export async function decodeShare(payload: string): Promise<SharedTown> {
  if (!/^[A-Za-z0-9_-]{1,20000}$/.test(payload)) throw new Error('That link is not a Wallet-landia town (damaged).');
  let text: string;
  try {
    text = (await squeeze('', 'out', fromB64url(payload))) as string;
  } catch (e) {
    if (e instanceof Error && e.message.includes('too long')) throw e;
    throw new Error('That link is not a Wallet-landia town (damaged).');
  }
  return parseShareText(text);
}

/** Read a page address's fragment: a shared town or design, if it holds one. */
export function shareInHash(hash: string): { mode: 'town' | 'design'; payload: string } | null {
  const m = /^#(town|design)=([A-Za-z0-9_-]+)$/.exec(hash);
  return m === null ? null : { mode: m[1] as 'town' | 'design', payload: m[2]! };
}

// --- using one -----------------------------------------------------------------------------

/**
 * A shared design laid onto your own town: each of its buildings that you
 * may build takes its place (its homes go to your homes in turn); what you
 * may not build, or what cannot stand there now, is left out (it stays in
 * your build list). Returns the layout and how many found their place.
 */
export function applyDesign(design: SharedTown, guild: Guild): { layout: TownLayout; placed: number; of: number } {
  const mine = buildables(guild);
  const homes = mine.filter((b) => b.kind === 'home');
  const ids = new Set(mine.map((b) => b.id));
  const placed: LayoutEntry[] = [];
  let nextHome = 0;
  for (const b of design.buildings) {
    let id: string | null = null;
    if (b.kind === 'home') id = homes[nextHome++]?.id ?? null;
    else if (ids.has(`b:${b.ref}`)) id = `b:${b.ref}`;
    if (id === null) continue;
    const entry: LayoutEntry = { id, x: b.x, y: b.y, rot: b.rot };
    // one at a time, in the design's order: each with its road, as it would be built
    if (new BuildPlanner(guild, { v: 1, placed }).preview(id, b.x, b.y, b.rot).ok) placed.push(entry);
  }
  return { layout: { v: 1, placed }, placed: placed.length, of: design.buildings.length };
}

/**
 * A shared town to visit: its layout in the visited guild's terms, the
 * buildings that guild does not know of (from the link: kind only), and its
 * private estates, so `planFromLayout` can raise it.
 */
export function visitLayout(shared: SharedTown): { layout: TownLayout; extra: Buildable[] } {
  const placed: LayoutEntry[] = [];
  const extra: Buildable[] = [];
  let estates = 0;
  for (const b of shared.buildings) {
    const at = { x: b.x, y: b.y, rot: b.rot };
    if (b.ref === 's') {
      const id = `estate:${estates++}`;
      extra.push({ id, kind: 'home', w: 3, h: 3 });
      placed.push({ id, ...at });
    } else if (/^h\d+$/.test(b.ref)) {
      const hero = shared.heroes[Number(b.ref.slice(1))];
      if (hero !== undefined) placed.push({ id: `home:${hero.address}`, ...at });
    } else {
      const id = `b:${b.ref}`;
      extra.push({ id, kind: b.kind as Buildable['kind'], w: 3, h: 3, protocolId: b.ref });
      placed.push({ id, ...at });
    }
  }
  return { layout: { v: 1, placed }, extra };
}
