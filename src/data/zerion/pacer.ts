// Ported from wallet-landia-v3 (src/data/zerion/pacer.ts) on 2026-10-08.
/**
 * Spaces outgoing requests so we stay under Zerion's per-second cap.
 *
 * Without this, `fetchWalletSnapshot` fires four requests in one `Promise.all`,
 * every one of them 429s on a low per-second plan, and every one of them then
 * backs off by the *same* interval and fires again together. Retrying a
 * thundering herd just reproduces the herd — which is exactly how three retries
 * fail to clear a limit that a single second of patience would have.
 *
 * The rule is one slot per request, claimed synchronously so concurrent callers
 * cannot claim the same one, then waited out. A 429 holds back *every* queued
 * request, not just the one that was throttled: the limit is on the org, so a
 * refusal is news for the whole queue.
 */

/**
 * Starting pace, before any response has told us the real one. Deliberately
 * pessimistic — the cheapest plan allows one request per second, and being
 * wrong the other way costs a 429 on the very first load.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 1;

/**
 * Slack on top of the computed gap. Requests spaced at exactly 1000/N ms can
 * still land N+1 in one of the API's wall-clock windows; a few milliseconds of
 * padding is far cheaper than the retry it prevents.
 */
const PACE_MARGIN_MS = 25;

export interface PacerOptions {
  requestsPerSecond?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class Pacer {
  #minGapMs: number;
  /** Earliest time the next request may start. */
  #nextSlot = 0;
  /**
   * A floor under *every* start time, including requests that already claimed a
   * slot and are waiting out their turn. `#nextSlot` alone cannot express this:
   * by the time a 429 comes back, the rest of a burst has already claimed its
   * slots, and moving the claim pointer does nothing for them.
   */
  #heldUntil = 0;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: PacerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#minGapMs = gapFor(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND);
  }

  /** Current spacing between request starts, in ms. Exposed for the HUD. */
  get minGapMs(): number {
    return this.#minGapMs;
  }

  /**
   * Adopt the pace the API reports in `RateLimit-Org-Second-Limit`. We start
   * pessimistic and learn upward on the first response, so a generous plan only
   * pays for its caution once.
   */
  observeLimit(requestsPerSecond: number | null): void {
    if (requestsPerSecond === null || !Number.isFinite(requestsPerSecond)) return;
    if (requestsPerSecond < 1) return;
    this.#minGapMs = gapFor(requestsPerSecond);
  }

  /** Claim the next slot and wait for it. */
  async acquire(): Promise<void> {
    // Claimed synchronously: two concurrent callers cannot get the same slot.
    const start = Math.max(this.#now(), this.#nextSlot);
    this.#nextSlot = start + this.#minGapMs;

    // Re-checked after every sleep rather than waited out in one go, because
    // `penalize` can move the hold while this request is already suspended —
    // and a request that has claimed its slot is precisely the one a 429 needs
    // to catch. Each pass sleeps a positive amount, so this always terminates.
    for (;;) {
      const now = this.#now();
      const until = Math.max(start, this.#heldUntil);
      if (now >= until) return;
      await this.#sleep(until - now);
    }
  }

  /** Push every queued request back — a 429 is about the org, not one request. */
  penalize(delayMs: number): void {
    const until = this.#now() + delayMs;
    // Both pointers: the hold catches requests already waiting, the slot
    // pointer keeps requests that have not claimed yet from jumping the queue.
    this.#heldUntil = Math.max(this.#heldUntil, until);
    this.#nextSlot = Math.max(this.#nextSlot, until);
  }
}

function gapFor(requestsPerSecond: number): number {
  return Math.ceil(1000 / requestsPerSecond) + PACE_MARGIN_MS;
}
