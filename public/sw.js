/*
 * Wallet-landia's service worker: keeps the town's files on the device.
 *
 * - App code (/assets/, names carry a content hash) and versioned files
 *   (?v=: theme textures, models, animations, skies, pack art) never change
 *   under their URL: served from the device, fetched once.
 * - The page, the theme and pack lists (index.json, pack.json) can change:
 *   fetched fresh when online, the stored copy only when offline.
 * - Nothing from other sites (the Ethereum node, logos) and nothing under
 *   /api/ (Zerion through our proxy) is touched: wallet data lives in
 *   IndexedDB, not here.
 *
 * Bump VERSION to drop everything stored by an older worker.
 */

const VERSION = 'wl-2';
const KEEP = `${VERSION}-keep`;
const PAGES = `${VERSION}-pages`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (!name.startsWith(VERSION)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Files that never change under their URL. */
function immutable(url) {
  return url.pathname.includes('/assets/') || url.searchParams.has('v');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  // Zerion through our proxy: wallet data and the player's key, never stored here
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(immutable(url) ? fromDevice(req) : fromNetwork(req));
});

/** Stored copy if there is one; else fetch it and keep it. */
async function fromDevice(req) {
  const cache = await caches.open(KEEP);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** Fresh from the network, keeping a copy for when there is none. */
async function fromNetwork(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (error) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw error;
  }
}
