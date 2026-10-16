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
import { LiveLoader, remeasureFor } from './live.js';
import { Backfill } from './backfill.js';
import type { LedgerStatus } from './ledger.js';
import { decodeLedgerFile, encodeLedgerFile, LEDGER_FILE_FORMAT, type LedgerFile } from './ledgerFile.js';
import { getEthMarket, realmScope } from './zerion/endpoints.js';
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
  /** How far back each of your wallets' kept history reaches (the lifetime ledger), and why it is resting, if it is. */
  onHistory?(statuses: LedgerStatus[], paused: Backfill['paused']): void;
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
  /** Bumped by each refresh the player asks for: a block check that started before one drops what it read. */
  #refreshes = 0;
  /** Reaching back through your own wallets' whole history, in the background. */
  #backfill: Backfill | null = null;
  /** The last lifetime history handed out, and what it was read from. */
  #lifetime: { stamp: string; raws: RawWallet[] } | null = null;

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

  /** ETH's price and 24-hour change, live from Zerion (one request); null with no key, or when the read fails. */
  async ethMarket(): Promise<{ usd: number; pct1d: number } | null> {
    const loader = await this.#liveLoader();
    if (loader === null) return null;
    return getEthMarket(loader.client).catch(() => null);
  }

  /** The key changed: forget the client built with the old one. */
  keyChanged(): void {
    this.#backfill?.stop();
    this.#backfill = null;
    this.#loader = null;
  }

  /** Your wallets' lifetime history: start (or carry on) reaching back through it; null stops it. */
  #walkBack(loader: LiveLoader | null, addresses: readonly string[] | null): void {
    if (loader === null || addresses === null || addresses.length === 0) {
      this.#backfill?.stop();
      this.#events.onHistory?.([], 'stopped');
      return;
    }
    if (this.#backfill === null) {
      const b = new Backfill({ ledger: loader.ledger, budget: () => this.budget.snapshot(), onProgress: (statuses) => this.#events.onHistory?.(statuses, b.paused) });
      this.#backfill = b;
      // a history that took many requests to gather is worth keeping: ask the browser not to clear it under pressure
      void navigator.storage?.persist?.().catch(() => false);
    }
    this.#backfill.start(addresses);
  }

  /**
   * Forget the cached towns (they refetch). The lifetime ledger (days of
   * requests) and imported packs share the store and are kept.
   */
  async clearCache(): Promise<void> {
    this.#cache ??= await openCache();
    await this.#cache.clear((k) => k.startsWith('wallet:'));
  }

  /**
   * Your own wallets with everything kept of their history (the lifetime
   * ledger), for the player's level and badges; the town's own wallets as
   * they are when there is no ledger (fixtures, or nothing kept yet).
   */
  async lifetime(shown: Shown): Promise<RawWallet[]> {
    if (shown.mode !== 'live' || shown.visiting !== null || this.#loader === null) return shown.raws;
    const ledger = this.#loader.ledger;
    // the same answer (the very same array) while nothing kept or shown changed, so the player need not be worked out again
    const stamp = (
      await Promise.all(shown.raws.map(async (r) => {
        const st = await ledger.status(r.address).catch(() => null);
        return `${r.address}:${st?.count ?? -1}:${st?.newest ?? ''}:${r.transactions.length}:${r.transactions[0]?.id ?? ''}:${r.capturedAt}`;
      }))
    ).join('|');
    if (this.#lifetime?.stamp === stamp) return this.#lifetime.raws;
    const raws = await Promise.all(
      shown.raws.map(async (r) => {
        const all = await ledger.all(r.address).catch(() => []);
        // pending ones live only in the town's history
        return all.length >= r.transactions.length ? { ...r, transactions: [...r.transactions.filter((t) => t.attributes.status === 'pending'), ...all] } : r;
      }),
    );
    this.#lifetime = { stamp, raws };
    return raws;
  }

  /** Your wallets' gathered history as a file (null: nothing kept, or no key). */
  async exportHistory(): Promise<Blob | null> {
    const loader = await this.#liveLoader();
    if (loader === null) return null;
    const wallets: LedgerFile['wallets'] = [];
    for (const a of this.prefs.owned) {
      const st = await loader.ledger.status(a);
      if (st === null) continue;
      wallets.push({ address: a, complete: st.complete, transactions: await loader.ledger.all(a) });
    }
    if (wallets.length === 0) return null;
    return encodeLedgerFile({ format: LEDGER_FILE_FORMAT, scope: realmScope(), exportedAt: Date.now(), wallets });
  }

  /** Load a saved history file into your wallets' kept history; what happened, in plain words. */
  async importHistory(data: ArrayBuffer): Promise<string> {
    const loader = await this.#liveLoader();
    if (loader === null) return 'Add your Zerion key first: the history belongs with the wallets it was gathered for.';
    const file = await decodeLedgerFile(data);
    const scope = realmScope();
    if (file.scope !== scope) return `This history was gathered for other realms (${file.scope.replace(/\+/g, ', ')}); choose the same ones under Realms first.`;
    const owned = new Set(this.prefs.owned.map((a) => a.toLowerCase()));
    let loaded = 0;
    let transactions = 0;
    for (const w of file.wallets) {
      if (!owned.has(w.address)) continue;
      // merged with what is kept: an older file never undoes what was gathered since
      await loader.ledger.merge(w.address, w.transactions, w.complete);
      loaded++;
      transactions += w.transactions.length;
    }
    const skipped = file.wallets.length - loaded;
    // carry on from there (anything newer, or older if it was not complete)
    if (loaded > 0 && this.shown?.mode === 'live' && this.shown.visiting === null) this.#walkBack(loader, this.prefs.owned);
    if (loaded === 0) return 'None of the wallets in that file are yours here: add them under Your wallets first.';
    return `Loaded ${transactions.toLocaleString('en-US')} transactions for ${loaded} wallet${loaded === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} not yours here, left out)` : ''}.`;
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
      const names = await this.#names(this.prefs.owned);
      // (the names can take seconds: a visit started meanwhile wins)
      if (gen !== this.#generation) return;
      this.#show({ mode: 'live', raws, visiting: null, names, label: `Your guild · ${raws.length} wallet${raws.length === 1 ? '' : 's'} · live` }, 'town');
      this.#walkBack(loader, this.prefs.owned);
      return;
    }
    this.#walkBack(null, null);
    const set = await loadFixtures();
    if (gen !== this.#generation) return;
    const label =
      set.kind === 'demo'
        ? 'Demo castle (synthetic) — add your key and wallets in the Guild tab'
        : `${set.wallets.length} captured wallets${loader === null ? ' — add a key in the Guild tab to go live' : ' — add your wallets in the Guild tab'}`;
    const names = await this.#names(set.wallets.map((w) => w.address));
    if (gen !== this.#generation) return;
    this.#show({ mode: set.kind, raws: set.wallets, visiting: null, names, label }, 'town');
  }

  /**
   * Visit a town (read-only, separate from home): a followed wallet's, or a
   * shared town's public wallets (`label` names it; with none, an empty town).
   */
  async visit(address: string | readonly string[], label?: string): Promise<void> {
    const gen = ++this.#generation;
    const addrs = (typeof address === 'string' ? [address] : [...address]).map((a) => a.toLowerCase());
    const loader = await this.#liveLoader();
    // a followed town keeps only its recent history: the walk back is for your own wallets
    this.#walkBack(null, null);
    let raws: RawWallet[] | null;
    if (addrs.length === 0) raws = [];
    else if (loader !== null) {
      raws = await this.#loadLive(loader, addrs, gen);
    } else {
      const set = await loadFixtures();
      const hits = set.wallets.filter((w) => addrs.includes(w.address));
      raws = hits.length > 0 ? hits : null;
      if (raws === null) this.#events.onStatus('Visiting needs a Zerion key (or a captured fixture for that address).', 'error');
    }
    if (raws === null || gen !== this.#generation) return;
    const names = await this.#names(addrs);
    if (gen !== this.#generation) return;
    const first = addrs[0] ?? 'shared';
    const who = label ?? names.get(first) ?? `${first.slice(0, 6)}…${first.slice(-4)}`;
    this.#show({ mode: loader ? 'live' : 'captured', raws, visiting: first, names, label: `Visiting ${who}'s castle` }, 'town');
  }

  /** Bring the town on show up to date now, at the player's request (~5 requests a wallet). */
  async refresh(): Promise<void> {
    const shown = this.shown;
    if (shown === null || shown.mode !== 'live') return;
    const loader = await this.#liveLoader();
    if (loader === null) return;
    const gen = this.#generation;
    // a block check still in flight must not put back what it read before this
    this.#refreshes++;
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
    // taken before the first await, so two blocks close together cannot both pass
    this.#checking = true;
    const gen = this.#generation;
    const refreshes = this.#refreshes;
    try {
      const loader = await this.#liveLoader();
      // nothing can be spent: leave the fingerprints and timers as they are, so the change is still seen once there is budget
      if (loader === null || this.budget.exhausted) return;
      const addrs = shown.raws.map((r) => r.address);
      // the free RPC failing (rate-limited, down) is not worth a word: the next block asks again
      const prints = await walletFingerprints(addrs).catch(() => null);
      if (prints === null) return;
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
      if (toRefresh.length === 0 && !drift) return;

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
          const v = await loader.remeasure(a, remeasureFor(r.fresh));
          if (v) {
            put({ ...v, transactions: r.raw.transactions });
            revalued = true;
          }
        }
      }
      if (drift) {
        for (const a of addrs) {
          const v = await loader.remeasure(a, 'total');
          if (v) {
            const i = raws.findIndex((x) => x.address === a);
            if (i >= 0) raws[i] = { ...raws[i]!, portfolio: v.portfolio, capturedAt: v.capturedAt };
            revalued = true;
          }
        }
      }
      if (gen !== this.#generation || refreshes !== this.#refreshes) return;
      if (added > 0 || revalued) this.#show({ ...shown, raws }, 'update');
    } catch (error) {
      this.#events.onStatus(describeError(error), 'error');
    } finally {
      this.#checking = false;
    }
  }
}
