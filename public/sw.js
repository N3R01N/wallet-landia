/*
 * Zenigard's service worker: keeps the town's files on the device.
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
 * - Notifications (docs/ENGAGEMENT.md Track D): a tap brings the castle's tab
 *   forward; in the installed app (Chromium's Periodic Background Sync) it
 *   looks about twice a day at your wallets' nonce and balance through the
 *   public node, and tells which moved. The page keeps the wallets for it in
 *   IndexedDB (src/castle/notifications.ts); no Zerion key ever comes here.
 *
 * Bump VERSION to drop everything stored by an older worker.
 */

const VERSION = 'zg-5';
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

// --- notifications -------------------------------------------------------------

/** Keep in step with src/castle/notifications.ts (the store) and src/data/rpc.ts (the node). */
const WATCH_DB = 'zenigard-watch';
const WATCH_STORE = 'watch';
const WATCH_KEY = 'wallets';
const WATCH_TAG = 'zg-watch';
const NODE = 'https://ethereum-rpc.publicnode.com';

/** A tap on a notification: the castle's tab forward, else the castle opened. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (pages[0]) return pages[0].focus();
      return self.clients.openWindow(self.registration.scope);
    })().catch(() => {}),
  );
});

self.addEventListener('periodicsync', (event) => {
  // failures are quiet: the next look tries again
  if (event.tag === WATCH_TAG) event.waitUntil(lookAtWallets().catch(() => {}));
});

/** One request on the watch store, its result once the transaction is done. */
function watchStore(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(WATCH_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(WATCH_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(WATCH_STORE, mode);
      const req = run(tx.objectStore(WATCH_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? req.result : undefined);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

/** Each kept wallet's nonce and balance now, from the public node in one request: address → "nonce:balance". */
async function fingerprints(addresses) {
  const calls = addresses.flatMap((a, i) => [
    { jsonrpc: '2.0', id: i * 2, method: 'eth_getTransactionCount', params: [a, 'latest'] },
    { jsonrpc: '2.0', id: i * 2 + 1, method: 'eth_getBalance', params: [a, 'latest'] },
  ]);
  const res = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls), signal: AbortSignal.timeout(15_000) });
  const out = new Map();
  if (!res.ok) return out;
  const body = await res.json();
  if (!Array.isArray(body)) return out;
  const byId = new Map(body.map((r) => [r.id, r.result]));
  addresses.forEach((a, i) => {
    const nonce = byId.get(i * 2);
    const balance = byId.get(i * 2 + 1);
    if (typeof nonce === 'string' && typeof balance === 'string') out.set(a, `${nonce}:${balance}`);
  });
  return out;
}

/** The look while the app is closed: tell which wallets moved since the last look (or the page's last update). */
async function lookAtWallets() {
  if (self.Notification?.permission !== 'granted') return;
  const wallets = await watchStore('readonly', (s) => s.get(WATCH_KEY));
  if (!Array.isArray(wallets) || wallets.length === 0) return;
  const prints = await fingerprints(wallets.map((w) => w.address));
  if (prints.size === 0) return;
  const moved = wallets.filter((w) => w.print && prints.has(w.address) && prints.get(w.address) !== w.print);
  await watchStore('readwrite', (s) => s.put(wallets.map((w) => ({ ...w, print: prints.get(w.address) ?? w.print })), WATCH_KEY));
  for (const w of moved)
    await self.registration.showNotification(`Something moved in ${w.name}`, {
      body: 'Open the castle to see its couriers.',
      icon: `${self.registration.scope}apple-touch-icon.png`,
      tag: `zg-moved-${w.address}`,
    });
}
