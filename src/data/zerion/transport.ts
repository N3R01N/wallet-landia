// Ported from wallet-landia-v3 (src/data/zerion/transport.ts) on 2026-10-08.
/**
 * How requests reach api.zerion.io.
 *
 * `direct` is the goal, and it is what the app uses: a static page the browser
 * can host anywhere, calling the API itself. That depends on Zerion serving
 * CORS headers for the browser's preflight, which their docs do not state
 * either way — so it was measured in phase 0 rather than assumed. It works.
 *
 * `proxy` routes through the Vite dev server instead (see vite.config.ts),
 * which sidesteps CORS entirely at the cost of needing that server to be
 * running. It is kept as the fallback for anyone who would rather the key never
 * reached the browser at all.
 */

export type Transport = 'direct' | 'proxy';

export const DIRECT_BASE = 'https://api.zerion.io/v1';
export const PROXY_BASE = '/api/zerion/v1';

/** Chosen by `VITE_ZERION_TRANSPORT`; defaults to direct. */
export function configuredTransport(): Transport {
  return import.meta.env.VITE_ZERION_TRANSPORT === 'proxy' ? 'proxy' : 'direct';
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
