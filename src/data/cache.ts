/**
 * A tiny key-value cache: IndexedDB when available, memory otherwise (blocked
 * storage, private windows). Everything in it can be refetched; losing it only
 * costs requests.
 */

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryKV implements KV {
  #m = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.#m.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.#m.set(key, structuredClone(value));
  }
  async clear(): Promise<void> {
    this.#m.clear();
  }
}

const DB = 'wallet-landia-v4';
const STORE = 'kv';

class IndexedKV implements KV {
  readonly #db: IDBDatabase;
  constructor(db: IDBDatabase) {
    this.#db = db;
  }
  #req<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const r = run(this.#db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  }
  get<T>(key: string): Promise<T | undefined> {
    return this.#req<T | undefined>('readonly', (s) => s.get(key));
  }
  async put(key: string, value: unknown): Promise<void> {
    await this.#req('readwrite', (s) => s.put(value, key));
  }
  async clear(): Promise<void> {
    await this.#req('readwrite', (s) => s.clear());
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
