/**
 * The Guild panel: your Zerion key, your wallets (heroes), the towns you
 * follow, and the day's ink (request budget).
 */

import { isEnsName, resolveName } from '../data/ens.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { untilReset } from '../data/zerion/budget.js';
import { loadApiKey, saveApiKey, savePrefs, type Prefs } from '../settings.js';
import { el, shortAddr } from './dom.js';

export interface GuildPanelContext {
  prefs: Prefs;
  budget: BudgetSnapshot;
  visiting: string | null;
  /** Wallets changed or the key changed: reload home. */
  onHomeChanged(): void;
  onKeyChanged(): void;
  onVisit(address: string): void;
  onClearCache(): Promise<void>;
  /** Re-render the panel (after a local change). */
  refresh(): void;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function toAddress(input: string): Promise<string> {
  const v = input.trim();
  if (ADDRESS.test(v)) return v.toLowerCase();
  if (isEnsName(v)) {
    const a = await resolveName(v);
    if (a === null) throw new Error(`${v} does not resolve to an address.`);
    return a;
  }
  throw new Error('Enter a 0x… address or an ENS name.');
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
  saveKey.onclick = () => {
    const v = keyInput.value.trim();
    if (v === '') return;
    saveApiKey(v);
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
        const b = el('button', { class: 'btn small', title: 'Remove from your guild' }, '✕');
        b.onclick = () => {
          p.owned = p.owned.filter((x) => x !== a);
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

  // --- ink
  const b = ctx.budget;
  const clear = el('button', { class: 'btn' }, 'Clear cached data');
  clear.onclick = async () => {
    await ctx.onClearCache();
    clear.textContent = 'Cleared';
  };

  return el(
    'div',
    { class: 'panel-body' },
    el('h2', {}, '⚙ Guild'),
    el('p', { class: 'muted' }, 'Everything runs in your browser. Your key and wallet list are stored only here.'),

    el('h3', {}, 'Zerion key'),
    el(
      'p',
      {},
      hasKey ? '✔ A key is saved. ' : 'No key yet — the town shows demo or captured data. ',
      el('a', { href: 'https://dashboard.zerion.io', target: '_blank', rel: 'noopener noreferrer' }, 'Get a free key ↗'),
    ),
    el('div', { class: 'form-row' }, keyInput, saveKey, hasKey ? clearKey : null),
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

    el('h3', {}, 'Scribe’s ink (requests today)'),
    el(
      'div',
      { class: 'stat-row' },
      el('span', {}, `${b.remaining} of ${b.limit} left`),
      el('span', { class: 'muted' }, `refills ${untilReset(b.resetsAt, Date.now())}`),
    ),
    el('p', { class: 'muted small' }, 'A new wallet costs ~5 requests; a reload within 5 minutes costs none. Live updates only ask Zerion when the chain shows a wallet changed.'),
    clear,
  );
}
