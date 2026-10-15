/**
 * What an NFT looks like, from the chain: its collection's name (`name()`)
 * and its picture (`tokenURI` → its metadata → `image`), for an NFT the guild
 * doesn't hold (a loan's collateral). IPFS (Filebase's gateway: it lets the page read it; ipfs.io
 * no longer serves plain requests) and Arweave go through public gateways; a picture in the metadata itself (a data: URL) is used as it is.
 * Kept in localStorage: an NFT's look rarely changes.
 */

import { rpcPost } from './rpc.js';

export interface NftLook {
  /** The collection's name ("Pudgy Penguins"), or null when it has none. */
  collection: string | null;
  /** The NFT's own name from its metadata, if it has one. */
  name: string | null;
  /** Its picture (https or data:), or null. */
  image: string | null;
}

const NAME = '0x06fdde03';
/** CryptoPunksData.punkImageSvg(uint16): a punk's picture, on-chain. */
const PUNK_IMAGE = '0x74beb047';
const PUNKS_DATA = '0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2';
/** Collections whose token ids are punk numbers (wrapped CryptoPunks): their pictures come from the punks' own contract. */
const PUNK_WRAPPERS = new Set(['0xb7f7f6c52f2e2fdb1963eab30438024864c313f6', '0x000000000000003607fce1ac9e043a86675c5c2f']);
/** Where metadata may be fetched from (the page's connect-src): the IPFS and Arweave gateways (Arweave's subdomains too). */
const METADATA_HOSTS = new Set(['ipfs.filebase.io', 'arweave.net']);
const TOKEN_URI = '0xc87b56dd';
/** The IPFS gateway (it lets the page read it; ipfs.io no longer serves plain requests). */
const IPFS = 'https://ipfs.filebase.io/ipfs/';
/** v3: IPFS through Filebase (bare ids and other gateways too), Autoglyphs drawn (looks kept before lack them). */
const CACHE = 'nft:look:v3:';
const FETCH_TIMEOUT_MS = 8_000;

/** An ABI-encoded string from a call's result (null for none or garbage). Pure. */
export function abiString(hex: string | null | undefined): string | null {
  if (!hex || hex.length < 2 + 128) return null;
  try {
    const len = Number(BigInt(`0x${hex.slice(2 + 64, 2 + 128)}`));
    if (len === 0 || len > 100_000) return null;
    const bytes = hex.slice(2 + 128, 2 + 128 + len * 2);
    const arr = new Uint8Array(bytes.match(/../g)!.map((b) => parseInt(b, 16)));
    return new TextDecoder().decode(arr);
  } catch {
    return null;
  }
}

/** A link a browser can fetch: IPFS and Arweave through a public gateway; https and data: as they are. Pure. */
export function fetchable(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const u = uri.trim();
  if (u.startsWith('ipfs://')) return `${IPFS}${u.slice(7).replace(/^ipfs\//, '')}`;
  // a bare content id (some metadata gives only that), or another gateway's /ipfs/ link (ipfs.io no longer serves pages)
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})(\/|$)/.test(u)) return `${IPFS}${u}`;
  const gateway = /^https:\/\/[^/]+\/ipfs\/(.+)$/.exec(u);
  if (gateway) return `${IPFS}${gateway[1]}`;
  if (u.startsWith('ar://')) return `https://arweave.net/${u.slice(5)}`;
  if (u.startsWith('https://') || u.startsWith('data:')) return u;
  return null;
}

/** An NFT's metadata from its token URI (a data: URL decoded in place, a link fetched). */
async function metadata(uri: string): Promise<{ name?: string; image?: string; image_url?: string } | null> {
  const link = fetchable(uri);
  if (!link) return null;
  try {
    if (link.startsWith('data:')) {
      const [head, body] = [link.slice(0, link.indexOf(',')), link.slice(link.indexOf(',') + 1)];
      return JSON.parse(head.includes(';base64') ? atob(body) : decodeURIComponent(body));
    }
    const host = new URL(link).hostname;
    if (!METADATA_HOSTS.has(host.endsWith('.arweave.net') ? 'arweave.net' : host)) return null; // a collection's own server: not reachable from the page
    const res = await fetch(link, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // no CORS, gone, not JSON
  }
}

/** A punk's on-chain SVG as a picture to draw: big and crisp (it is 24 × 24 pixels), on the punks' background. Pure. */
export function punkPicture(svgDataUrl: string | null): string | null {
  if (!svgDataUrl?.startsWith('data:image/svg+xml')) return null;
  const body = svgDataUrl.slice(svgDataUrl.indexOf(',') + 1);
  let raw = body;
  try {
    raw = decodeURIComponent(body);
  } catch {
    // not URI-encoded: as it is
  }
  // drawn big and crisp, on the punks' own blue-grey (the SVG has no background)
  const svg = raw.replace(/<svg ([^>]*)>/, '<svg width="240" height="240" shape-rendering="crispEdges" $1><rect x="0" y="0" width="24" height="24" fill="#638596"/>');
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** An NFT drawn as text in its token URI (Autoglyphs: rows of . X / \\ | - + O #) as a picture: the marks in ink on paper. Pure. */
export function textPicture(uri: string | null): string | null {
  if (!uri?.startsWith('data:text/plain')) return null;
  let text = uri.slice(uri.indexOf(',') + 1);
  try {
    text = decodeURIComponent(text);
  } catch {
    // as it is
  }
  const rows = text.split(/\r?\n|%0A/).filter((r) => r.length > 0);
  if (rows.length < 4) return null;
  const n = Math.max(rows.length, ...rows.map((r) => r.length));
  const cell = 480 / n;
  const esc = (c: string) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);
  const marks = rows
    .map((r, y) => [...r].map((c, x) => (c === '.' || c === ' ' ? '' : `<text x="${((x + 0.5) * cell).toFixed(1)}" y="${((y + 0.8) * cell).toFixed(1)}">${esc(c)}</text>`)).join(''))
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="#f6f1e4"/><g font-family="monospace" font-size="${(cell * 1.1).toFixed(1)}" text-anchor="middle" fill="#2b2433">${marks}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** The look of an NFT (from cache when known). */
export async function nftLook(collection: string, tokenId: string, rpcUrl: string): Promise<NftLook> {
  const key = `${CACHE}${collection.toLowerCase()}:${tokenId}`;
  try {
    const kept = localStorage.getItem(key);
    if (kept) return JSON.parse(kept) as NftLook;
  } catch {
    // no storage: ask again
  }
  const id = BigInt(tokenId).toString(16).padStart(64, '0');
  const punk = PUNK_WRAPPERS.has(collection.toLowerCase());
  let name: string | null = null;
  let uri: string | null = null;
  let punkSvg: string | null = null;
  try {
    const body = (await rpcPost(rpcUrl, [
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: collection, data: NAME }, 'latest'] },
      punk ? { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: PUNKS_DATA, data: PUNK_IMAGE + id }, 'latest'] } : { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: collection, data: TOKEN_URI + id }, 'latest'] },
    ])) as { id: number; result?: string }[];
    if (Array.isArray(body)) {
      name = abiString(body.find((r) => r.id === 1)?.result);
      uri = abiString(body.find((r) => r.id === 2)?.result);
      punkSvg = abiString(body.find((r) => r.id === 3)?.result);
    }
  } catch {
    return { collection: null, name: null, image: null }; // the node is busy: not kept, asked again next time
  }
  const drawn = textPicture(uri);
  const meta = uri && !drawn ? await metadata(uri) : null;
  const look: NftLook = { collection: name, name: meta?.name ?? null, image: punk ? punkPicture(punkSvg) : (drawn ?? fetchable(meta?.image ?? meta?.image_url)) };
  try {
    localStorage.setItem(key, JSON.stringify(look));
  } catch {
    // storage full: asked again next time
  }
  return look;
}
