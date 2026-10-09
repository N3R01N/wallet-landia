/**
 * Where the town's data comes from, and how it stays current.
 *
 * - No key, or no wallets added: the checked-in fixtures (captured, else demo).
 * - Key + wallets: live from Zerion, cached in IndexedDB.
 * - Live updates are gated by the free RPC: every block we ask each shown
 *   wallet's nonce and ETH balance in one batch call, and only spend a Zerion
 *   request when one of them moved. A slow catch-up (every 15 minutes while
 *   the tab is visible) picks up incoming tokens, which move neither.
 */

import { loadFixtures } from './fixtures.js';
import { reverseName } from './ens.js';
import { openCache, type KV } from './cache.js';
import { LiveLoader } from './live.js';
import { walletFingerprints } from './rpc.js';
import { DailyBudget, type BudgetSnapshot } from './zerion/budget.js';
import { ZerionError } from './zerion/client.js';
import type { RawWallet } from './zerion/endpoints.js';
import { loadApiKey, savePrefs, type Prefs } from '../settings.js';

export type Mode = 'demo' | 'captured' | 'live';

export interface Shown {
  mode: Mode;
  raws: RawWallet[];
  /** Address being visited, or null at home. */
  visiting: string | null;
  names: Map<string, string>;
  label: string;
}

export interface SessionEvents {
  /** A whole new town (first load, switching home/visit, wallets changed). */
  onTown(shown: Shown): void;
  /** Same town, newer data: new journeys should play live. */
  onUpdate(shown: Shown): void;
  onStatus(text: string, kind: 'info' | 'busy' | 'error'): void;
  onBudget(snapshot: BudgetSnapshot): void;
}

const CATCH_UP_MS = 15 * 60_000;
/** Prices drift with no transaction; refresh portfolio totals this often… */
const DRIFT_MS = 60 * 60_000;
/** …but only while more than this much of the day's budget is left. */
const DRIFT_MIN_BUDGET = 150;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ZerionError) {
    switch (error.kind) {
      case 'auth':
        return 'Zerion did not accept the key. Check it in the Guild panel.';
      case 'quota':
        return error.message;
      case 'bad-request':
        return 'Zerion does not track that address (a contract or exchange wallet?).';
      case 'network':
        return 'Could not reach Zerion (offline or blocked).';
      default:
        return `Zerion error: ${error.message}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export class Session {
  readonly prefs: Prefs;
  readonly budget: DailyBudget;
  shown: Shown | null = null;

  #events: SessionEvents;
  #cache: KV | null = null;
  #loader: LiveLoader | null = null;
  #fingerprints = new Map<string, string>();
  #lastCatchUp = Date.now();
  #lastDrift = Date.now();
  #checking = false;
  #generation = 0;

  constructor(prefs: Prefs, events: SessionEvents) {
    this.prefs = prefs;
    this.#events = events;
    this.budget = new DailyBudget({ storage: storage(), onChange: (s) => events.onBudget(s) });
  }

  get hasKey(): boolean {
    return loadApiKey() !== null;
  }

  async #liveLoader(): Promise<LiveLoader | null> {
    const key = loadApiKey();
    if (key === null) return null;
    this.#cache ??= await openCache();
    if (this.#loader === null) this.#loader = new LiveLoader({ apiKey: key, budget: this.budget, cache: this.#cache });
    return this.#loader;
  }

  /** The key changed: forget the client built with the old one. */
  keyChanged(): void {
    this.#loader = null;
  }

  async clearCache(): Promise<void> {
    this.#cache ??= await openCache();
    await this.#cache.clear();
  }

  // --- names -----------------------------------------------------------------

  async #names(addresses: readonly string[]): Promise<Map<string, string>> {
    const missing = addresses.filter((a) => this.prefs.ens[a] === undefined);
    await Promise.all(
      missing.map(async (a) => {
        try {
          this.prefs.ens[a] = (await reverseName(a)) ?? '';
        } catch {
          // RPC unavailable: try again next time
        }
      }),
    );
    if (missing.length > 0) savePrefs(this.prefs);
    return new Map(addresses.filter((a) => (this.prefs.ens[a] ?? '') !== '').map((a) => [a, this.prefs.ens[a] ?? '']));
  }

  // --- loading ---------------------------------------------------------------

  /** Show home: your wallets live if possible, else fixtures. */
  async home(): Promise<void> {
    const gen = ++this.#generation;
    const loader = await this.#liveLoader();
    if (loader !== null && this.prefs.owned.length > 0) {
      const raws = await this.#loadLive(loader, this.prefs.owned, gen);
      if (raws === null) return;
      this.#show({ mode: 'live', raws, visiting: null, names: await this.#names(this.prefs.owned), label: `Your guild · ${raws.length} wallet${raws.length === 1 ? '' : 's'} · live` }, 'town');
      return;
    }
    const set = await loadFixtures();
    if (gen !== this.#generation) return;
    const label =
      set.kind === 'demo'
        ? 'Demo town (synthetic) — open ⚙ Guild to add your key and wallets'
        : `${set.wallets.length} captured wallets${loader === null ? ' — add a key in ⚙ Guild to go live' : ' — add your wallets in ⚙ Guild'}`;
    this.#show({ mode: set.kind, raws: set.wallets, visiting: null, names: await this.#names(set.wallets.map((w) => w.address)), label }, 'town');
  }

  /** Visit a followed wallet's town (read-only, separate from home). */
  async visit(address: string): Promise<void> {
    const gen = ++this.#generation;
    const addr = address.toLowerCase();
    const loader = await this.#liveLoader();
    let raws: RawWallet[] | null;
    if (loader !== null) {
      raws = await this.#loadLive(loader, [addr], gen);
    } else {
      const set = await loadFixtures();
      const hit = set.wallets.find((w) => w.address === addr);
      raws = hit ? [hit] : null;
      if (raws === null) this.#events.onStatus('Visiting needs a Zerion key (or a captured fixture for that address).', 'error');
    }
    if (raws === null || gen !== this.#generation) return;
    const names = await this.#names([addr]);
    this.#show({ mode: loader ? 'live' : 'captured', raws, visiting: addr, names, label: `Visiting ${names.get(addr) ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`}'s town` }, 'town');
  }

  /** Bring the town on show up to date now, at the player's request (~5 requests a wallet). */
  async refresh(): Promise<void> {
    const shown = this.shown;
    if (shown === null || shown.mode !== 'live') return;
    const loader = await this.#liveLoader();
    if (loader === null) return;
    const gen = this.#generation;
    const raws = await this.#loadLive(loader, shown.raws.map((r) => r.address), gen, true);
    if (raws === null || gen !== this.#generation) return;
    this.#show({ ...shown, raws: raws.map((r, i) => ({ ...r, label: shown.raws[i]?.label ?? r.label })) }, 'update');
  }

  async #loadLive(loader: LiveLoader, addresses: readonly string[], gen: number, fresh = false): Promise<RawWallet[] | null> {
    const raws: RawWallet[] = [];
    // Free first: has each wallet moved on-chain since we cached it? Unmoved
    // wallets come straight from the cache (see LiveLoader.load).
    const prints = await walletFingerprints(addresses).catch(() => new Map<string, string>());
    try {
      for (const [i, a] of addresses.entries()) {
        this.#events.onStatus(`Loading wallet ${i + 1} of ${addresses.length}…`, 'busy');
        const print = prints.get(a);
        raws.push(await loader.load(a, this.prefs.ens[a] || 'Your wallet', { ...(print !== undefined ? { print } : {}), fresh }));
        if (gen !== this.#generation) return null;
      }
      this.#events.onStatus('', 'info');
      return raws;
    } catch (error) {
      this.#events.onStatus(describeError(error), 'error');
      if (raws.length > 0) return raws;
      return null;
    }
  }

  #show(shown: Shown, how: 'town' | 'update'): void {
    this.shown = shown;
    if (how === 'town') {
      this.#fingerprints.clear();
      // Take the baseline now, not on the next block: anything that happens
      // between loading and that block would otherwise go unnoticed.
      if (shown.mode === 'live') void this.#baseline(shown.raws.map((r) => r.address));
      this.#events.onTown(shown);
    } else {
      this.#events.onUpdate(shown);
    }
  }

  async #baseline(addresses: string[]): Promise<void> {
    try {
      const prints = await walletFingerprints(addresses);
      for (const [a, p] of prints) if (!this.#fingerprints.has(a)) this.#fingerprints.set(a, p);
    } catch {
      // the next block will set it
    }
  }

  // --- live updates ------------------------------------------------------------

  /** Called on every new block. Cheap unless something actually happened. */
  async onBlock(): Promise<void> {
    const shown = this.shown;
    if (shown === null || shown.mode !== 'live' || this.#checking) return;
    const loader = await this.#liveLoader();
    if (loader === null) return;
    this.#checking = true;
    const gen = this.#generation;
    try {
      const addrs = shown.raws.map((r) => r.address);
      const prints = await walletFingerprints(addrs);
      const due = Date.now() - this.#lastCatchUp > CATCH_UP_MS && document.visibilityState === 'visible';
      const changed = addrs.filter((a) => {
        const now = prints.get(a);
        const before = this.#fingerprints.get(a);
        if (now !== undefined) this.#fingerprints.set(a, now);
        // The first fingerprint is a baseline, not a change.
        return before !== undefined && now !== undefined && now !== before;
      });
      const toRefresh = due ? addrs : changed;
      if (due) this.#lastCatchUp = Date.now();
      const drift =
        Date.now() - this.#lastDrift > DRIFT_MS && this.budget.remaining > DRIFT_MIN_BUDGET && document.visibilityState === 'visible';
      if (drift) this.#lastDrift = Date.now();
      if ((toRefresh.length === 0 && !drift) || this.budget.exhausted) return;

      let added = 0;
      let revalued = false;
      const raws = [...shown.raws];
      const put = (raw: RawWallet): void => {
        const i = raws.findIndex((x) => x.address === raw.address);
        if (i >= 0) raws[i] = { ...raw, label: raws[i]?.label ?? raw.label };
      };
      for (const a of toRefresh) {
        const r = await loader.refreshHistory(a, prints.get(a));
        if (r === null) continue;
        added += r.added;
        put(r.raw);
        // Something happened to this wallet: its holdings changed too. Plain
        // transfers only move tokens; anything touching a protocol may move
        // positions and NFTs as well, which costs more to re-measure.
        if (r.added > 0 && changed.includes(a)) {
          const plain = r.fresh.every((t) => ['send', 'receive', 'approve', 'revoke'].includes(t.attributes.operation_type) && !t.relationships?.dapp);
          const v = await loader.refreshValuations(a, plain ? 'tokens' : 'full');
          if (v) {
            put({ ...v, transactions: r.raw.transactions });
            revalued = true;
          }
        }
      }
      if (drift) {
        for (const a of addrs) {
          const v = await loader.refreshValuations(a, 'total');
          if (v) {
            const i = raws.findIndex((x) => x.address === a);
            if (i >= 0) raws[i] = { ...raws[i]!, portfolio: v.portfolio, capturedAt: v.capturedAt };
            revalued = true;
          }
        }
      }
      if (gen !== this.#generation) return;
      if (added > 0 || revalued) this.#show({ ...shown, raws }, 'update');
    } catch (error) {
      this.#events.onStatus(describeError(error), 'error');
    } finally {
      this.#checking = false;
    }
  }
}
