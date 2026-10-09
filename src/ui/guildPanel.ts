/**
 * The Guild panel: your Zerion key, your wallets (heroes), the towns you
 * follow, and the day's ink (request budget).
 */

import { isEnsName, resolveName } from '../data/ens.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { untilReset } from '../data/zerion/budget.js';
import { loadApiKey, saveApiKey, savePrefs, type Prefs } from '../settings.js';
import { CLASS_LABEL, type Hero, type HeroClass } from '../domain/model.js';
import { approxUsd, TIER_COLORS } from '../domain/tiers.js';
import { el, shortAddr } from './dom.js';
import { heroNameEditor, portrait } from './panels.js';

export interface GuildPanelContext {
  prefs: Prefs;
  budget: BudgetSnapshot;
  visiting: string | null;
  /** Wallets changed or the key changed: reload home. */
  onHomeChanged(): void;
  onKeyChanged(): void;
  onVisit(address: string): void;
  onClearCache(): Promise<void>;
  /** Fetch what changed for the town on show now (null: not a live town). */
  onRefresh: (() => Promise<void>) | null;
  /** Re-render the panel (after a local change). */
  refresh(): void;
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
    el('p', { class: 'muted small' }, 'A new wallet costs ~5 requests. After that, towns come from this browser’s cache: the free public RPC tells us whether a wallet moved, and only then is Zerion asked for what changed. Unmoved wallets are re-checked every 30 minutes (1 request) and re-measured hourly (4).'),
    el('div', { class: 'form-row' }, refresh, clear),
  );
}
