// Ported from wallet-landia-v3 (src/data/zerion/transport.ts) on 2026-10-08.
/**
 * How requests reach api.zerion.io.
 *
 * `direct`: the browser calls Zerion itself. Zerion only allows that from
 * localhost (its CORS check answers 403 to any other Origin, measured
 * 2026-10-09), so it is for development.
 *
 * `proxy`: through our own site, `/api/zerion/v1/…`. Deployed on Vercel that
 * is the edge function in `api/zerion.ts` (vercel.json rewrites /api/zerion/… to it), which forwards the
 * player's key and nothing else; `vite preview` and the dev server proxy it
 * too (vite.config.ts). Production builds use it.
 */

export type Transport = 'direct' | 'proxy';

export const DIRECT_BASE = 'https://api.zerion.io/v1';
export const PROXY_BASE = '/api/zerion/v1';

/** `VITE_ZERION_TRANSPORT` if set; else the proxy in production builds, direct in development. */
export function configuredTransport(): Transport {
  const set = import.meta.env.VITE_ZERION_TRANSPORT;
  if (set === 'proxy' || set === 'direct') return set;
  return import.meta.env.PROD ? 'proxy' : 'direct';
}

export function baseUrl(transport: Transport): string {
  return transport === 'proxy' ? PROXY_BASE : DIRECT_BASE;
}

/**
 * Zerion uses HTTP Basic with the key as the username and an empty password —
 * hence the trailing colon before base64. Getting this wrong yields a 401 that
 * looks exactly like a bad key.
 */
export function authHeader(apiKey: string): string {
  return `Basic ${base64(`${apiKey}:`)}`;
}

function base64(input: string): string {
  if (typeof btoa === 'function') return btoa(input);
  return Buffer.from(input, 'binary').toString('base64');
}

/** Build a request URL with JSON:API-style bracketed params intact. */
export function buildUrl(
  transport: Transport,
  path: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  const suffix = query === '' ? '' : `?${decodeBrackets(query)}`;
  return `${baseUrl(transport)}${path}${suffix}`;
}

/**
 * URLSearchParams percent-encodes `[` and `]`. Zerion accepts either form, but
 * the encoded one makes every logged URL unreadable, so put the brackets back.
 */
function decodeBrackets(query: string): string {
  return query.replaceAll('%5B', '[').replaceAll('%5D', ']');
}
