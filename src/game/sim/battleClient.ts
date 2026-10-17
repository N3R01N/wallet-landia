/**
 * Runs battles in the worker (battle.worker.ts), or right here when a worker
 * can't start (no Worker, a CSP, an old deploy's file gone): the same pure
 * simulation either way, so the outcome is the same.
 */

import { simulateBattle, type BattleOptions, type BattleRun } from '../core/battle.js';
import type { Army } from '../core/types.js';
import type { BattleReply, BattleRequest } from './battle.worker.js';

interface Waiting {
  armies: [Army, Army];
  opts: BattleOptions;
  resolve: (run: BattleRun) => void;
  reject: (e: Error) => void;
}

export class BattleClient {
  #worker: Worker | null | undefined;
  #next = 1;
  readonly #waiting = new Map<number, Waiting>();

  run(armies: [Army, Army], opts: BattleOptions): Promise<BattleRun> {
    return new Promise((resolve, reject) => {
      const w = this.#start();
      if (!w) {
        try {
          resolve(simulateBattle(armies, opts));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      const id = this.#next++;
      this.#waiting.set(id, { armies, opts, resolve, reject });
      try {
        w.postMessage({ id, armies, opts } satisfies BattleRequest);
      } catch (error) {
        console.warn('battle worker', error);
        this.#fail();
      }
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  #start(): Worker | null {
    if (this.#worker !== undefined) return this.#worker;
    this.#worker = null;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./battle.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<BattleReply>) => {
        const r = e.data;
        const waiting = this.#waiting.get(r.id);
        if (!waiting) return;
        this.#waiting.delete(r.id);
        if (r.ok) waiting.resolve(r.run);
        else waiting.reject(new Error(r.error));
      };
      w.onerror = (e) => {
        console.warn('battle worker', e.message);
        this.#fail();
      };
      this.#worker = w;
    } catch (error) {
      console.warn('battle worker', error);
    }
    return this.#worker;
  }

  #fail(): void {
    this.#worker?.terminate();
    this.#worker = null;
    const waiting = [...this.#waiting.values()];
    this.#waiting.clear();
    for (const { armies, opts, resolve, reject } of waiting) {
      try {
        resolve(simulateBattle(armies, opts));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
