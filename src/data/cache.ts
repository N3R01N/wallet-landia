/**
 * A tiny key-value cache: IndexedDB when available, memory otherwise (blocked
 * storage, private windows). Everything in it can be refetched; losing it only
 * costs requests (the lifetime ledger costs the most, so clearing can spare it).
 */

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  /** Resolves once the value is stored for good (a write that fails, e.g. over quota, rejects). */
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Everything, or only the keys `drop` picks. */
  clear(drop?: (key: string) => boolean): Promise<void>;
}

export class MemoryKV implements KV {
  #m = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.#m.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.#m.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.#m.delete(key);
  }
  async clear(drop?: (key: string) => boolean): Promise<void> {
    if (drop === undefined) this.#m.clear();
    else for (const k of [...this.#m.keys()]) if (drop(k)) this.#m.delete(k);
  }
}

const DB = 'zenigard';
const STORE = 'kv';
/** The cache's name before the rename to Zenigard: what it holds moves over once. */
const OLD_DB = 'wallet-landia-v4';

class IndexedKV implements KV {
  readonly #db: IDBDatabase;
  constructor(db: IDBDatabase) {
    this.#db = db;
  }
  get<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const r = this.#db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  }
  /**
   * A write is done when its transaction commits, not when its request
   * succeeds: a quota failure aborts the transaction afterwards, and the
   * ledger must not save a state naming a chunk that never landed.
   */
  #write(run: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('storage write aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('storage write failed'));
      run(tx.objectStore(STORE));
    });
  }
  put(key: string, value: unknown): Promise<void> {
    return this.#write((s) => s.put(value, key));
  }
  /** Several at once, in one transaction. */
  putAll(keys: readonly IDBValidKey[], values: readonly unknown[]): Promise<void> {
    return this.#write((s) => keys.forEach((k, i) => s.put(values[i], k)));
  }
  delete(key: string): Promise<void> {
    return this.#write((s) => s.delete(key));
  }
  clear(drop?: (key: string) => boolean): Promise<void> {
    if (drop === undefined) return this.#write((s) => s.clear());
    return this.#write((s) => {
      const r = s.openKeyCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (c === null) return;
        if (typeof c.key === 'string' && drop(c.key)) s.delete(c.key);
        c.continue();
      };
    });
  }
}

export async function openCache(): Promise<KV> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryKV();
    let created = false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        created = true;
        r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (created) await moveOldCache(db).catch(() => {});
    return new IndexedKV(db);
  } catch {
    return new MemoryKV();
  }
}

/** Copies the old cache into the new one, then deletes it. No old cache: nothing happens (and none is made). */
async function moveOldCache(to: IDBDatabase): Promise<void> {
  const old = await new Promise<IDBDatabase | null>((resolve) => {
    const r = indexedDB.open(OLD_DB);
    // it did not exist: aborting the upgrade leaves no empty database behind
    r.onupgradeneeded = () => r.transaction?.abort();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
  if (!old) return;
  try {
    if (!old.objectStoreNames.contains(STORE)) return;
    const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
      const s = old.transaction(STORE, 'readonly').objectStore(STORE);
      const k = s.getAllKeys();
      const v = s.getAll();
      v.onsuccess = () => resolve([k.result, v.result]);
      v.onerror = k.onerror = () => reject(v.error ?? k.error);
    });
    await new IndexedKV(to).putAll(keys, values);
  } finally {
    old.close();
  }
  indexedDB.deleteDatabase(OLD_DB);
}
