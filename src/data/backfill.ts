/**
 * Reaching back through the player's own wallets' whole history (lifetime
 * ledger, H2), one page at a time in the background, without starving the
 * live town:
 * - only while the tab is visible;
 * - only while more than `reserve` of the day's Zerion requests are left
 *   (the rest is for the town's own loads and live updates);
 * - wallets take turns, a page each, so every one makes progress;
 * - errors back off (quota: until there is budget again; a bad key: stop).
 *
 * It resumes by itself: each step starts from the oldest transaction kept.
 */

import type { Ledger, LedgerStatus } from './ledger.js';
import { ZerionError } from './zerion/client.js';
import type { BudgetSnapshot } from './zerion/budget.js';

export interface BackfillOptions {
  ledger: Ledger;
  budget: () => BudgetSnapshot;
  onProgress: (statuses: LedgerStatus[]) => void;
  /** Share of the day's limit kept for the town (0..1). */
  reserve?: number;
  /** Pause between pages (ms). */
  gapMs?: number;
  /** How long to wait before looking again when paused (hidden tab, low budget, an error). */
  idleMs?: number;
  visible?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** May a backfill page be spent now? Only while more than `reserve` of the day's limit is left. */
export function mayBackfill(b: BudgetSnapshot, reserve: number): boolean {
  return !b.exhausted && b.remaining > Math.ceil(b.limit * reserve);
}

export class Backfill {
  readonly #o: Required<Omit<BackfillOptions, 'visible' | 'sleep'>> & { visible: () => boolean; sleep: (ms: number) => Promise<void> };
  #addresses: string[] = [];
  #run = 0;
  /** The wallet served last: the next turn goes to the next unfinished one after it. */
  #last: string | null = null;
  /** Why it is not walking right now (for the Guild panel), or null while it is. */
  paused: 'hidden' | 'budget' | 'error' | 'auth' | 'done' | 'stopped' | null = 'stopped';

  constructor(o: BackfillOptions) {
    this.#o = {
      reserve: 0.4,
      gapMs: 1200,
      idleMs: 30_000,
      visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...o,
    };
  }

  /** Walk back through these wallets (replacing any earlier set). */
  start(addresses: readonly string[]): void {
    this.#addresses = addresses.map((a) => a.toLowerCase());
    const run = ++this.#run;
    void this.#loop(run);
  }

  stop(): void {
    this.#run++;
    this.paused = 'stopped';
  }

  async statuses(): Promise<LedgerStatus[]> {
    const out: LedgerStatus[] = [];
    for (const a of this.#addresses) {
      const s = await this.#o.ledger.status(a);
      if (s) out.push(s);
    }
    return out;
  }

  async #loop(run: number): Promise<void> {
    const o = this.#o;
    o.onProgress(await this.statuses());
    while (run === this.#run) {
      const statuses = await this.statuses();
      // wallets the town has not loaded yet have no ledger: nothing to walk back from
      const open = statuses.filter((s) => !s.complete && !s.capped);
      if (open.length === 0) {
        this.paused = 'done';
        o.onProgress(statuses);
        return;
      }
      if (!o.visible()) {
        this.paused = 'hidden';
        await o.sleep(o.idleMs / 6);
        continue;
      }
      if (!mayBackfill(o.budget(), o.reserve)) {
        this.paused = 'budget';
        o.onProgress(statuses);
        await o.sleep(o.idleMs * 4);
        continue;
      }
      const at = this.#last === null ? -1 : this.#addresses.indexOf(this.#last);
      const s = [...this.#addresses.slice(at + 1), ...this.#addresses.slice(0, at + 1)].map((a) => open.find((x) => x.address === a)).find((x) => x !== undefined)!;
      this.#last = s.address;
      try {
        this.paused = null;
        await o.ledger.backfill(s.address);
        if (run !== this.#run) return;
        o.onProgress(await this.statuses());
        await o.sleep(o.gapMs);
      } catch (error) {
        if (error instanceof ZerionError && error.kind === 'auth') {
          this.paused = 'auth';
          return;
        }
        this.paused = 'error';
        await o.sleep(o.idleMs * 2);
      }
    }
  }
}
