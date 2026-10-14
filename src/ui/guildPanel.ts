/**
 * The Guild panel: your Zerion key, your wallets (heroes), the towns you
 * follow, and the day's ink (request budget).
 */

import { realmOf } from '../domain/realms.js';
import { toAddress } from '../data/ens.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { untilReset } from '../data/zerion/budget.js';
import { loadApiKey, saveApiKey, savePrefs, type Prefs } from '../settings.js';
import { ALLOWED_RPC_HOSTS, DEFAULT_RPC, validRpcUrl } from '../data/rpc.js';
import { CLASS_LABEL, type Hero, type HeroClass } from '../domain/model.js';
import { approxUsd, TIER_COLORS } from '../domain/tiers.js';
import { el, shortAddr } from './dom.js';
import { heroNameEditor, portrait } from './panels.js';
import type { LedgerStatus } from '../data/ledger.js';

export interface GuildPanelContext {
  prefs: Prefs;
  budget: BudgetSnapshot;
  visiting: string | null;
  /** Wallets changed or the key changed: reload home. */
  onHomeChanged(): void;
  onKeyChanged(): void;
  onVisit(address: string): void;
  onClearCache(): Promise<void>;
  /** Use another Ethereum node ('' for the free public one). */
  onRpc(url: string): void;
  /** The realm's chains changed (Ethereum is always in): load them. */
  onChains(chains: string[]): void;
  /** Fetch what changed for the town on show now (null: not a live town). */
  onRefresh: (() => Promise<void>) | null;
  /** Re-render the panel (after a local change). */
  refresh(): void;
  /** Your wallets' lifetime history: how far back each reaches, and why the walk back rests (null: not running). */
  history: { statuses: LedgerStatus[]; paused: string | null } | null;
  /** Save your wallets' gathered history to a file (false: nothing to save). */
  onExportHistory(): Promise<boolean>;
  /** Load a saved history file; what happened, in plain words. */
  onImportHistory(data: ArrayBuffer): Promise<string>;
  /** The heroes of the town on show, to open or rename. */
  heroes: Hero[];
  classOf(address: string): HeroClass;
  onSelectHero(address: string): void;
  setName(address: string, name: string | null): void;
  bornName(address: string): string;
  portraitOf?: (address: string, cls: HeroClass) => string | null;
}

/** A hero of the town: portrait, name (renameable), class and worth; opens their sheet. */
function heroCard(hero: Hero, ctx: GuildPanelContext): HTMLElement {
  const cls = ctx.classOf(hero.address);
  const pic = portrait(hero, cls, ctx.portraitOf);
  pic.classList.add('mini');
  const open = el('button', { class: 'btn small' }, 'Character sheet');
  open.onclick = () => ctx.onSelectHero(hero.address);
  pic.onclick = () => ctx.onSelectHero(hero.address);
  const worth = el('span', { class: 'chip' }, approxUsd(hero.netWorth));
  worth.style.borderColor = TIER_COLORS[hero.tier] ?? '#888';
  return el(
    'div',
    { class: 'hero-card', 'data-hero': hero.address },
    pic,
    el(
      'div',
      { class: 'hero-card-body' },
      heroNameEditor(hero, { setName: (a, n) => ctx.setName(a, n), bornName: (a) => ctx.bornName(a) }),
      el('div', { class: 'muted small' }, `${CLASS_LABEL[cls]} · `, worth, ` · ${shortAddr(hero.address)}`),
      open,
    ),
  );
}


function walletRow(address: string, ctx: GuildPanelContext, actions: HTMLElement[]): HTMLElement {
  const name = ctx.prefs.ens[address];
  return el(
    'div',
    { class: 'wallet-row' },
    el('div', {}, el('strong', {}, name ? name : shortAddr(address)), name ? el('div', { class: 'muted mono' }, shortAddr(address)) : null),
    el('div', { class: 'row-actions' }, ...actions),
  );
}

function adder(placeholder: string, label: string, onAdd: (address: string) => void): HTMLElement {
  const input = el('input', { type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off', 'aria-label': placeholder });
  const btn = el('button', { class: 'btn' }, label);
  const msg = el('div', { class: 'form-msg' });
  const go = async (): Promise<void> => {
    msg.textContent = '';
    btn.disabled = true;
    try {
      onAdd(await toAddress(input.value));
      input.value = '';
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      btn.disabled = false;
    }
  };
  btn.onclick = () => void go();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void go();
  };
  return el('div', {}, el('div', { class: 'form-row' }, input, btn), msg);
}

export function guildPanel(ctx: GuildPanelContext): HTMLElement {
  const p = ctx.prefs;

  // --- key
  const hasKey = loadApiKey() !== null;
  const keyInput = el('input', { type: 'password', placeholder: hasKey ? '•••••••• (saved)' : 'zk_…', autocomplete: 'off', 'aria-label': 'Zerion API key' });
  const saveKey = el('button', { class: 'btn' }, 'Save');
  const keyMsg = el('div', { class: 'form-msg' });
  saveKey.onclick = () => {
    const v = keyInput.value.trim();
    if (v === '') return;
    // a refused key (a stray character pasted with it) is not kept: say why
    const problem = saveApiKey(v);
    if (problem !== null) {
      keyMsg.textContent = problem;
      return;
    }
    ctx.onKeyChanged();
    ctx.refresh();
  };
  const clearKey = el('button', { class: 'btn' }, 'Forget');
  clearKey.onclick = () => {
    saveApiKey(null);
    ctx.onKeyChanged();
    ctx.refresh();
  };

  // --- owned wallets
  const owned = p.owned.map((a) =>
    walletRow(a, ctx, [
      (() => {
        // shown when sharing your town, or kept to yourself (the default)
        const pub = p.publicWallets.includes(a);
        const b = el('button', { class: `btn small privacy${pub ? ' public' : ''}`, 'aria-pressed': String(pub), title: pub ? 'Public: shown when you share your town. Click to make it private.' : 'Private: never shared, even when you share your town. Click to make it public.' }, pub ? '🔓 Public' : '🔒 Private');
        b.onclick = () => {
          p.publicWallets = pub ? p.publicWallets.filter((x) => x !== a) : [...p.publicWallets, a];
          savePrefs(p);
          ctx.refresh();
        };
        return b;
      })(),
      (() => {
        const b = el('button', { class: 'btn small', title: 'Remove from your guild' }, '✕');
        b.onclick = () => {
          p.owned = p.owned.filter((x) => x !== a);
          p.publicWallets = p.publicWallets.filter((x) => x !== a);
          savePrefs(p);
          ctx.onHomeChanged();
          ctx.refresh();
        };
        return b;
      })(),
    ]),
  );
  const addOwned = adder('0x… or name.eth', 'Add', (a) => {
    if (!p.owned.includes(a)) p.owned.push(a);
    p.followed = p.followed.filter((x) => x !== a);
    savePrefs(p);
    ctx.onHomeChanged();
    ctx.refresh();
  });
  const eth = (window as unknown as { ethereum?: { request(args: { method: string }): Promise<unknown> } }).ethereum;
  const connect = eth
    ? (() => {
        const b = el('button', { class: 'btn' }, 'Connect wallet');
        b.onclick = async () => {
          try {
            const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
            for (const a of accounts.map((x) => x.toLowerCase())) if (!p.owned.includes(a)) p.owned.push(a);
            savePrefs(p);
            ctx.onHomeChanged();
            ctx.refresh();
          } catch {
            // the player declined
          }
        };
        return b;
      })()
    : null;

  // --- followed towns
  const followed = p.followed.map((a) =>
    walletRow(a, ctx, [
      (() => {
        const b = el('button', { class: `btn small${ctx.visiting === a ? ' on' : ''}` }, ctx.visiting === a ? 'Here' : 'Visit');
        b.onclick = () => ctx.onVisit(a);
        return b;
      })(),
      (() => {
        const b = el('button', { class: 'btn small', title: 'Stop following' }, '✕');
        b.onclick = () => {
          p.followed = p.followed.filter((x) => x !== a);
          savePrefs(p);
          ctx.refresh();
        };
        return b;
      })(),
    ]),
  );
  const addFollowed = adder('0x… or name.eth', 'Follow', (a) => {
    if (!p.followed.includes(a) && !p.owned.includes(a)) p.followed.push(a);
    savePrefs(p);
    ctx.refresh();
  });

  // --- the Ethereum node (the bell, wallet checks)
  const rpcInput = el('input', { type: 'text', placeholder: DEFAULT_RPC, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Ethereum RPC address' });
  rpcInput.defaultValue = p.rpcUrl;
  const rpcMsg = el('div', { class: 'form-msg' });
  const rpcSave = el('button', { class: 'btn' }, 'Use');
  rpcSave.onclick = () => {
    const v = rpcInput.value.trim();
    if (v !== '' && !validRpcUrl(v)) {
      rpcMsg.textContent = `Use an https address from: ${ALLOWED_RPC_HOSTS.join(', ')}.`;
      return;
    }
    ctx.onRpc(v);
    rpcMsg.textContent = v === '' ? 'Using the free public node.' : 'Using your node.';
  };
  const rpcReset = el('button', { class: 'btn' }, 'Default');
  rpcReset.onclick = () => {
    rpcInput.value = '';
    ctx.onRpc('');
    rpcMsg.textContent = 'Using the free public node.';
  };

  // --- the realm: which L2 provinces load with Ethereum
  const chainBoxes = ['base', 'arbitrum', 'optimism'].map((id) => {
    const box = el('input', { type: 'checkbox', 'data-chain': id });
    box.checked = p.chains.includes(id);
    return { id, box, row: el('label', { class: 'check-row' }, box, ` ${realmOf(id).name}`) };
  });
  const chainsMsg = el('div', { class: 'form-msg' });
  const chainsSave = el('button', { class: 'btn' }, 'Load these realms');
  chainsSave.onclick = () => {
    const chains = ['ethereum', ...chainBoxes.filter((c) => c.box.checked).map((c) => c.id)];
    if (chains.join() === p.chains.join()) {
      chainsMsg.textContent = 'Already loaded.';
      return;
    }
    ctx.onChains(chains);
    chainsMsg.textContent = 'Loading the realm afresh…';
  };

  // --- ink
  const b = ctx.budget;
  const clear = el('button', { class: 'btn' }, 'Clear cached data');
  clear.onclick = async () => {
    try {
      await ctx.onClearCache();
      clear.textContent = 'Cleared';
    } catch {
      clear.textContent = 'Could not clear';
    }
  };

  const refresh = ctx.onRefresh
    ? (() => {
        const b = el('button', { class: 'btn' }, '↻ Refresh this town now');
        b.title = 'Fetch new transactions and re-measure balances, positions and NFTs (about 5 requests per wallet)';
        const go = ctx.onRefresh;
        b.onclick = async () => {
          b.disabled = true;
          b.textContent = 'Refreshing…';
          try {
            await go();
            b.textContent = 'Up to date';
          } catch {
            b.textContent = 'Could not refresh';
          }
        };
        return b;
      })()
    : null;

  return el(
    'div',
    { class: 'panel-body' },
    el('h2', {}, '⚙ Guild'),
    el('p', { class: 'muted' }, 'Everything runs in your browser. Your key and wallet list are stored only here.'),

    el('h3', {}, `Heroes of this town (${ctx.heroes.length})`),
    ctx.heroes.length === 0 ? el('p', { class: 'muted' }, 'No heroes yet.') : el('div', { class: 'hero-cards' }, ...ctx.heroes.map((h) => heroCard(h, ctx))),

    el('h3', {}, 'Zerion key'),
    el(
      'p',
      {},
      hasKey ? '✔ A key is saved. ' : 'No key yet — the town shows demo or captured data. ',
      el('a', { href: 'https://dashboard.zerion.io', target: '_blank', rel: 'noopener noreferrer' }, 'Get a free key ↗'),
    ),
    el('div', { class: 'form-row' }, keyInput, saveKey, hasKey ? clearKey : null),
    keyMsg,
    el('p', { class: 'muted small' }, 'The key is sent only to api.zerion.io. It is visible in this browser’s devtools — use a free key.'),

    el('h3', {}, `Your wallets (${p.owned.length})`),
    p.owned.length === 0 ? el('p', { class: 'muted' }, 'Add the wallets you own: each becomes a hero in your town.') : null,
    ...owned,
    addOwned,
    connect,

    el('h3', {}, `Followed towns (${p.followed.length})`),
    p.followed.length === 0 ? el('p', { class: 'muted' }, 'Follow any address to visit its town.') : null,
    ...followed,
    addFollowed,

    el('h3', {}, 'Realms (chains)'),
    el('p', { class: 'muted small' }, 'Ethereum is the kingdom; these L2 provinces load with it, each a town of its own on the 🗺 Realm Map. More realms cost no more requests, but they share the 100 most recent transactions. Changing them loads every wallet afresh once (about 5 requests each).'),
    ...chainBoxes.map((c) => c.row),
    el('div', { class: 'form-row' }, chainsSave),
    chainsMsg,

    el('h3', {}, 'Ethereum node'),
    el('p', { class: 'muted small' }, 'The bell and the check for wallet changes ask an Ethereum node about once a block (12 s) while the town is open. The free public node is shared by everyone; with many players it may slow down or refuse, so you can use your own (e.g. a free Alchemy, Infura or Ankr address).'),
    el('div', { class: 'form-row' }, rpcInput, rpcSave, rpcReset),
    rpcMsg,

    ...historySection(ctx),

    el('h3', {}, 'Scribe’s ink (requests today)'),
    el(
      'div',
      { class: 'stat-row' },
      el('span', {}, `${b.remaining} of ${b.limit} left`),
      el('span', { class: 'muted' }, `refills ${untilReset(b.resetsAt, Date.now())}`),
    ),
    el('p', { class: 'muted small' }, 'A new wallet costs ~5 requests. After that, towns come from this browser’s cache: the free public RPC tells us whether a wallet moved, and only then is Zerion asked for what changed. Unmoved wallets are re-checked every 30 minutes (1 request) and re-measured hourly (4).'),
    el('div', { class: 'form-row' }, refresh, clear),
  );
}

/** Why the walk back through history is resting, in plain words. */
const RESTING: Record<string, string> = {
  hidden: 'resting while the tab is hidden',
  budget: 'resting: the rest of today’s requests are kept for the town',
  error: 'resting after an error; trying again soon',
  auth: 'stopped: Zerion did not accept the key',
  done: 'up to date',
  stopped: 'not running',
};

/** At a glance, how a wallet's walk back stands: its row's colour and badge. */
export type HistoryKind = 'done' | 'walking' | 'waiting' | 'problem' | 'partial';

export const HISTORY_BADGE: Record<HistoryKind, string> = {
  done: 'complete',
  walking: 'reaching back',
  waiting: 'waiting',
  problem: 'needs attention',
  partial: 'partial',
};

/** `paused` as the walk back reports it (null: running now). Pure, so the kinds can be tested. */
export function historyKind(s: Pick<LedgerStatus, 'complete' | 'capped'>, paused: string | null): HistoryKind {
  if (s.complete) return 'done';
  if (s.capped) return 'partial';
  if (paused === null) return 'walking';
  if (paused === 'error' || paused === 'auth') return 'problem';
  return 'waiting';
}

/**
 * How far back each wallet's history reaches. Its own element: while history
 * arrives the app replaces just this (every 2 s), keeping the rest of the
 * panel and its messages ("Saved.", an import's result) as they are.
 */
export function historyRows(ctx: Pick<GuildPanelContext, 'history' | 'prefs'>): HTMLElement {
  const h = ctx.history;
  // null: the walk back is not running (a null pause, by contrast, means it is reaching back now)
  const paused = h === null ? 'stopped' : h.paused;
  return el(
    'div',
    { class: 'history-rows' },
    ...(h?.statuses ?? []).map((s) => {
      const name = ctx.prefs.ens[s.address] || shortAddr(s.address);
      const reach = s.oldest !== null ? ` · back to ${new Date(s.oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
      const state = s.complete ? '✓ all of it, from the very first' : s.capped ? 'partial: a very busy wallet, kept to the newest 50,000' : paused === null ? 'reaching back…' : (RESTING[paused] ?? 'resting');
      const kind = historyKind(s, paused);
      return el(
        'div',
        { class: `history-row ${kind}`, 'data-address': s.address, 'data-state': kind },
        el('span', { class: 'history-head' }, el('strong', {}, name), el('span', { class: 'history-badge' }, HISTORY_BADGE[kind])),
        el('span', {}, `${s.count.toLocaleString('en-US')} transactions${s.spam > 0 ? ` (${s.spam.toLocaleString('en-US')} spam)` : ''}${reach}`),
        el('span', { class: 'muted small' }, `${state} · ${s.backfillRequests} request${s.backfillRequests === 1 ? '' : 's'} so far`),
      );
    }),
  );
}

/** Lifetime history: every transaction your wallets ever made, gathered once and kept in this browser. */
function historySection(ctx: GuildPanelContext): (HTMLElement | null)[] {
  const h = ctx.history;
  const live = loadApiKey() !== null && ctx.prefs.owned.length > 0;
  if (!live && (h === null || h.statuses.length === 0)) return [];
  // save and load: the history survives a new browser without asking Zerion again
  const msg = el('div', { class: 'form-msg' });
  const save = el('button', { class: 'btn' }, '⬇ Save to a file');
  save.onclick = async () => {
    try {
      msg.textContent = (await ctx.onExportHistory()) ? 'Saved.' : 'Nothing gathered yet to save.';
    } catch (e) {
      msg.textContent = `Could not save: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const file = el('input', { type: 'file', accept: '.gz,.json,application/gzip,application/json', 'aria-label': 'History file to load', hidden: '' });
  const load = el('button', { class: 'btn' }, '⬆ Load from a file');
  load.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    msg.textContent = 'Loading…';
    try {
      msg.textContent = await ctx.onImportHistory(await f.arrayBuffer());
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : String(e);
    }
    file.value = '';
  };
  return [
    el('h3', {}, 'Lifetime history'),
    el('p', { class: 'muted small' }, 'Every transaction your wallets ever made, gathered once (a request per hundred) and kept in this browser; afterwards only what is new is asked for. It walks back a page at a time while the tab is open, leaving 40% of each day’s requests for the town. Save it to a file to take it to another browser.'),
    historyRows(ctx),
    el('div', { class: 'form-row' }, save, load, file),
    msg,
  ];
}
