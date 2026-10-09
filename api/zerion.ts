/**
 * Zerion, through our own site: /api/zerion/v1/… → https://api.zerion.io/v1/…
 * (vercel.json rewrites /api/zerion/:path* to this function as ?path=…).
 *
 * Zerion's API only answers browsers on localhost (its CORS check, and a 403
 * for any other Origin), so the deployed page cannot call it directly. This
 * edge function forwards the player's own key (from their browser, never
 * stored or logged here) and nothing else — no Origin, no cookies — for
 * read-only /v1/ requests, and passes back the answer and Zerion's
 * rate-limit headers.
 */

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.zerion.io';
/** Headers the app reads from Zerion's answers. */
const PASS = /^(content-type|retry-after|ratelimit-.*)$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Only GET', { status: 405, headers: { allow: 'GET' } });
  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '';
  url.searchParams.delete('path');
  // only Zerion's read API, and never a path that climbs out of it
  if (!/^v1\/[A-Za-z0-9_\-./]+$/.test(path) || path.includes('..')) return new Response('Not found', { status: 404 });
  const auth = req.headers.get('authorization');
  if (!auth || !/^Basic [A-Za-z0-9+/=]+$/.test(auth)) return new Response('A Zerion key is needed', { status: 401 });

  const query = url.searchParams.toString();
  const upstream = await fetch(`${UPSTREAM}/${path}${query ? `?${query}` : ''}`, {
    headers: { authorization: auth, accept: 'application/json' },
  });
  const headers = new Headers({ 'cache-control': 'no-store' });
  upstream.headers.forEach((value, key) => {
    if (PASS.test(key)) headers.set(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}
