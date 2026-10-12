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

const DB = 'wallet-landia-v4';
const STORE = 'kv';

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
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new IndexedKV(db);
  } catch {
    return new MemoryKV();
  }
}
