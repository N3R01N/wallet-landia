/*
 * Wallet-landia's service worker: keeps the town's files on the device.
 *
 * - App code (/assets/, names carry a content hash) and versioned files
 *   (?v=: the theme's models and art) never change
 *   under their URL: served from the device, fetched once.
 * - The page and the theme's manifest (theme.json) can change:
 *   fetched fresh when online, the stored copy only when offline.
 * - Nothing from other sites (the Ethereum node, logos) and nothing under
 *   /api/ (Zerion through our proxy) is touched: wallet data lives in
 *   IndexedDB, not here.
 *
 * Bump VERSION to drop everything stored by an older worker.
 */

const VERSION = 'wl-4';
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
  // only whole answers: a 206 (a range of a video, say) makes cache.put throw
  if (res.status === 200) await cache.put(req, res.clone());
  return res;
}

/**
 * Fresh from the network, keeping a copy for when there is none. A page is
 * kept under its path alone: ?wallet=…, ?realm=… and the like are the same
 * page, so one copy serves them all offline instead of one per link.
 */
async function fromNetwork(req) {
  const cache = await caches.open(PAGES);
  const key = req.mode === 'navigate' ? new URL(req.url).pathname : req;
  try {
    const res = await fetch(req);
    if (res.status === 200) await cache.put(key, res.clone());
    return res;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}
