/**
 * Notifications (docs/ENGAGEMENT.md Track D), all on this device: no push
 * server, nothing sent anywhere.
 *
 * - In a background tab: a new courier for your own wallets shows a
 *   notification (a burst is one). The page's own live updates find them.
 * - Installed app on Chromium: Periodic Background Sync wakes the service
 *   worker about twice a day; it asks the public node for each own wallet's
 *   nonce and balance and tells which moved. The page keeps the wallets and
 *   their last fingerprints for it in a small IndexedDB store (the worker
 *   can't read localStorage), never the Zerion key.
 *
 * Every browser call is guarded: a missing API or a refusal just means no
 * notification.
 */

import type { Errand } from './world/world.js';
import { courierNote, type Note } from './notify.js';
import { walletFingerprints } from '../data/rpc.js';

/** The store the service worker reads: keep in step with public/sw.js. */
const WATCH_DB = 'zenigard-watch';
const WATCH_STORE = 'watch';
const WATCH_KEY = 'wallets';
/** The periodic sync's name: keep in step with public/sw.js. */
const WATCH_TAG = 'zg-watch';
/** Its name before the rename to Zenigard: dropped where it is still registered. */
const OLD_WATCH_TAG = 'wl-watch';
/** About twice a day (the browser decides when, and may wait longer). */
const WATCH_EVERY_MS = 12 * 3_600_000;
/** Couriers this close together are one notification. */
const BURST_MS = 3_000;

/** A wallet as the service worker keeps it: its name for the notification, and its last nonce:balance. */
export interface Watched {
  address: string;
  name: string;
  print: string | null;
}

/** Whether this browser can show notifications at all. */
export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** The browser's answer so far ('unsupported' when it has no notifications). */
export function permission(): NotificationPermission | 'unsupported' {
  return canNotify() ? Notification.permission : 'unsupported';
}

/** Ask the browser (only ever after the player's click). */
export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** The service worker's registration, if the page has one (production only). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker?.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** Shows one notification: through the service worker when there is one (iOS needs it), else from the page. A tap brings the tab forward. */
export async function showNote(note: Note): Promise<void> {
  if (permission() !== 'granted') return;
  const options: NotificationOptions = { body: note.body, icon: `${import.meta.env.BASE_URL}apple-touch-icon.png` };
  try {
    const reg = await registration();
    if (reg) {
      await reg.showNotification(note.title, options);
      return;
    }
    const n = new Notification(note.title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // the browser would not show it: nothing to do
  }
}

/**
 * New couriers for your wallets while the tab is hidden: gathered for a
 * moment, then told in one notification. Back in view, what is pending is
 * dropped (the castle shows them).
 */
export class CourierNotifier {
  #pending: Errand[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly opts: { on: () => boolean; place: (id: string) => string; walletName: (address: string) => string };

  constructor(opts: CourierNotifier['opts']) {
    this.opts = opts;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.#drop();
    });
  }

  /** These couriers just came (your own wallets'). */
  note(errands: readonly Errand[]): void {
    if (!errands.length || !document.hidden || !this.opts.on() || permission() !== 'granted') return;
    this.#pending.push(...errands);
    this.#timer ??= setTimeout(() => this.#flush(), BURST_MS);
  }

  #flush(): void {
    const list = this.#pending;
    this.#drop();
    const note = courierNote(list, this.opts.place, this.opts.walletName);
    if (note && document.hidden) void showNote(note);
  }

  #drop(): void {
    this.#pending = [];
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

// --- while the app is closed (the service worker) ----------------------------

/** Whether the installed app can check while closed: 'ok', or why not. */
export type BackgroundCheck = 'ok' | 'unsupported' | 'not-installed';

type PeriodicSync = {
  register(tag: string, o: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
};

function periodicSync(reg: ServiceWorkerRegistration | null): PeriodicSync | null {
  const ps = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSync }) | null)?.periodicSync;
  return ps ?? null;
}

/** Can this browser check while the app is closed? Chromium only, and only for the installed app. */
export async function backgroundCheck(): Promise<BackgroundCheck> {
  const reg = await registration();
  if (!periodicSync(reg)) return 'unsupported';
  try {
    const s = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    return s.state === 'granted' ? 'ok' : 'not-installed';
  } catch {
    return 'unsupported';
  }
}

/** Starts (or stops) the check while closed, where the browser allows it. */
export async function setBackgroundCheck(on: boolean): Promise<void> {
  const ps = periodicSync(await registration());
  if (!ps) return;
  try {
    await ps.unregister(OLD_WATCH_TAG);
    if (on && (await backgroundCheck()) === 'ok') await ps.register(WATCH_TAG, { minInterval: WATCH_EVERY_MS });
    else if (!on) await ps.unregister(WATCH_TAG);
  } catch {
    // refused: the tab still tells while it is open
  }
}

/** Runs one request on the watch store; resolves with its result once the transaction is done. */
function watchStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const open = indexedDB.open(WATCH_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(WATCH_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(WATCH_STORE, mode);
      const req = run(tx.objectStore(WATCH_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? (req.result as T) : undefined);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

/**
 * Keep your wallets for the service worker: their names and their nonce and
 * balance now (so it tells only what moved after this). An empty list (or
 * notifications off) forgets them.
 */
export async function watchWallets(wallets: readonly { address: string; name: string }[]): Promise<void> {
  try {
    if (!wallets.length) {
      await watchStore('readwrite', (s) => s.delete(WATCH_KEY));
      return;
    }
    const prints = await walletFingerprints(wallets.map((w) => w.address)).catch(() => new Map<string, string>());
    const before = (await watchStore<Watched[]>('readonly', (s) => s.get(WATCH_KEY))) ?? [];
    const kept: Watched[] = wallets.map((w) => ({ address: w.address, name: w.name, print: prints.get(w.address) ?? before.find((b) => b.address === w.address)?.print ?? null }));
    await watchStore('readwrite', (s) => s.put(kept, WATCH_KEY));
  } catch {
    // storage unavailable: the check while closed has nothing to look at
  }
}
