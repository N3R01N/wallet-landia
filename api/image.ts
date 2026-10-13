/**
 * Pictures for the 3D rooms, through our own site: /api/image?u=<https url>.
 * The picture hosts send no CORS headers, so a WebGL texture cannot read them
 * from the browser; this edge function fetches a picture from a short list of
 * known image hosts (token logos, NFT pictures, protocol icons) and passes the
 * bytes back on our own origin. Nothing else is fetched: no other host, no
 * other scheme, no redirects to elsewhere, and only images of a sane size.
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
];

/** A picture no bigger than this (a 3D texture's worth; the pictures are small). */
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

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
  return IMAGE_HOSTS.includes(u.hostname) ? u.href : null;
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
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !/^image\//.test(type)) return new Response('Not a picture', { status: 404, headers: { 'cache-control': 'no-store' } });
  const length = Number(upstream.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return new Response('Too large', { status: 413 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 });
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' },
  });
}
