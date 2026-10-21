/**
 * Pictures for the 3D rooms, through our own site: /api/image?u=<https url>.
 * The picture hosts send no CORS headers, so a WebGL texture cannot read them
 * from the browser; this edge function fetches a picture from a short list of
 * known image hosts (token logos, NFT pictures, protocol icons) and passes the
 * bytes back on our own origin. Nothing else is fetched: no other host, no
 * other scheme, no redirects to elsewhere, and only images of a sane size.
 *
 * SVG: much NFT art is SVG, so a host that says `image/svg+xml` is believed.
 * An SVG can carry script, and served from our origin, opened as a page, that
 * script would reach the player's stored key. So every answer is sandboxed
 * (SANDBOX: no script, no fetching, no forms): in an <img> or a texture an SVG
 * never runs script anyway, and opened directly it now can't either. A body
 * without an image type is judged by its first bytes, raster only.
 */

export const config = { runtime: 'edge' };

/** The hosts pictures come from (the token, NFT and protocol images Zerion links to). */
export const IMAGE_HOSTS = [
  'cdn.zerion.io',
  'res.cloudinary.com',
  'nft2-cdn.alchemy.com',
  'nft-cdn.alchemy.com',
  'protocol-icons.s3.amazonaws.com',
  'token-icons.s3.amazonaws.com',
  'dapp-icons.s3.amazonaws.com',
  'lh3.googleusercontent.com',
  'i2c.seadn.io',
  'i2.seadn.io',
  // NFT pictures read from the chain (a loan's collateral): IPFS and Arweave gateways
  'ipfs.filebase.io',
  'arweave.net',
];

/** A picture no bigger than this (a 3D texture's worth; NFT art can be a few MB). */
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 10_000;

/** On every answer: a picture opened as a page (an SVG above all) runs no script and loads nothing. */
export const SANDBOX = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/** The address to fetch, if it is a https picture on one of the hosts; else null. Pure. */
export function allowedImageUrl(raw: string | null): string | null {
  if (raw === null || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  // Arweave serves from per-file subdomains too (<hash>.arweave.net)
  const host = u.hostname.endsWith('.arweave.net') ? 'arweave.net' : u.hostname;
  return IMAGE_HOSTS.includes(host) ? u.href : null;
}

/** A raster picture's type from its first bytes (PNG, JPEG, GIF, WebP), else null (never SVG: it can carry script). Pure. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Only GET', { status: 405, headers: { allow: 'GET' } });
  const target = allowedImageUrl(new URL(req.url).searchParams.get('u'));
  if (target === null) return new Response('Not a picture we serve', { status: 404 });

  let upstream: Response;
  try {
    // redirects are not followed: the host we checked is the host we fetch
    upstream = await fetch(target, { redirect: 'manual', headers: { accept: 'image/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return new Response('The picture could not be fetched', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const said = upstream.headers.get('content-type') ?? '';
  // some hosts (S3) serve pictures as application/octet-stream: those are judged by their first bytes
  if (!upstream.ok || !(/^image\//.test(said) || /^(application\/octet-stream|binary\/octet-stream)?(;|$)/.test(said))) return new Response('Not a picture', { status: 404, headers: { 'cache-control': 'no-store' } });
  const length = Number(upstream.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return new Response('Too large', { status: 413 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 });
  const type = /^image\//.test(said) ? said : sniffImage(new Uint8Array(body, 0, Math.min(16, body.byteLength)));
  if (type === null) return new Response('Not a picture', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff', 'content-security-policy': SANDBOX },
  });
}
