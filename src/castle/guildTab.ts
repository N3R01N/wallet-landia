/**
 * The Guild tab: where the castle's wallets come from. The player's own free
 * Zerion key (kept in this browser only), their wallets (addresses, ENS
 * names, or the connected wallet), and where the data stands (demo, captured,
 * live; requests left today). Uses the same key and wallet list as the town.
 */

import { el, shortAddr } from '../util/dom.js';
import { toAddress } from '../data/ens.js';
import { loadApiKey, saveApiKey, savePrefs, type Prefs } from '../settings.js';
import type { Mode } from '../data/session.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { encodeShare } from './share.js';
import { bornCrest, crestColors, setCrests, TINCTURES } from '../util/rng.js';
import { ALLOWED_RPC_HOSTS, DEFAULT_RPC, validRpcUrl } from '../data/rpc.js';

export interface GuildTabContext {
  prefs: Prefs;
  /** Where the castle's data comes from now (null: still loading). */
  mode: Mode | null;
  budget: BudgetSnapshot | null;
  /** The wallet list changed: load the castle again. */
  onWalletsChanged(): void;
  /** The key was saved or forgotten: load the castle again. */
  onKeyChanged(): void;
  /** Draw the tab again (after a change made here). */
  refresh(): void;
  /** Save your wallets' gathered history to a file (false: nothing to save). */
  onExportHistory(): Promise<boolean>;
  /** Load a saved history file; what happened, in plain words. */
  onImportHistory(data: ArrayBuffer): Promise<string>;
  /** Use another Ethereum node ('' for the free public one). */
  onRpc(url: string): void;
  /** The followed wallet whose castle is on show (null: your own). */
  visiting: string | null;
  /** Show a followed wallet's castle. */
  onVisit(address: string): void;
}

const MODE_TEXT: Record<Mode, string> = {
  demo: 'A demo guild: add your wallets and a key to see your own castle.',
  captured: 'Wallets captured for development (no key needed).',
  live: 'Live from Zerion with your key.',
};

/** Where the data comes from, in plain words (also updated in place when the guild reloads). */
export function modeText(mode: Mode | null): string {
  return mode ? MODE_TEXT[mode] : 'Loading…';
}

const ZERION_DASHBOARD = 'https://dashboard.zerion.io/';

export function guildTab(ctx: GuildTabContext): HTMLElement {
  const p = ctx.prefs;
  return el(
    'section',
    { class: 'tab-page guild-tab', 'data-tab-page': 'guild' },
    el('h1', {}, 'Guild'),
    el('p', { class: 'muted source' }, modeText(ctx.mode)),
    keySection(ctx),
    walletsSection(ctx, p),
    shareSection(p),
    followedSection(ctx, p),
    historySection(ctx),
    nodeSection(ctx, p),
    ctx.budget ? el('p', { class: 'muted budget' }, `Zerion requests left today: ${ctx.budget.remaining}`) : null,
  );
}

function keySection(ctx: GuildTabContext): HTMLElement {
  const hasKey = loadApiKey() !== null;
  const input = el('input', { type: 'password', placeholder: hasKey ? '•••••••• (saved)' : 'zk_…', autocomplete: 'off', 'aria-label': 'Zerion API key' });
  const save = el('button', { class: 'btn', type: 'button' }, 'Save');
  const msg = el('div', { class: 'form-msg', role: 'status' });
  const doSave = () => {
    const v = input.value.trim();
    if (v === '') return;
    // a refused key (a stray character pasted with it) is not kept: say why
    const problem = saveApiKey(v);
    if (problem !== null) {
      msg.textContent = problem;
      return;
    }
    ctx.onKeyChanged();
    ctx.refresh();
  };
  save.addEventListener('click', doSave);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
  });
  const forget = el('button', { class: 'btn', type: 'button' }, 'Forget');
  forget.hidden = !hasKey;
  forget.addEventListener('click', () => {
    saveApiKey(null);
    ctx.onKeyChanged();
    ctx.refresh();
  });
  const link = el('a', { href: ZERION_DASHBOARD, target: '_blank', rel: 'noopener noreferrer' }, 'Get a free key from Zerion');
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'key' },
    el('h2', {}, 'Zerion key'),
    el('p', { class: 'muted' }, 'Your own free key, kept only in this browser. It reads your wallets; it can never move anything. ', link, '.'),
    el('div', { class: 'form-row' }, input, save, forget),
    msg,
  );
}

function walletsSection(ctx: GuildTabContext, p: Prefs): HTMLElement {
  const rows = p.owned.map((a) => {
    const name = p.ens[a];
    // shown when sharing your castle, or kept to yourself (the default)
    const pub = p.publicWallets.includes(a);
    const privacy = el(
      'button',
      { class: `btn small privacy${pub ? ' on' : ''}`, type: 'button', 'aria-pressed': String(pub), title: pub ? 'Public: in your share link. Tap to make it private.' : 'Private: never shared. Tap to make it public.' },
      pub ? '🔓 Public' : '🔒 Private',
    );
    privacy.addEventListener('click', () => {
      p.publicWallets = pub ? p.publicWallets.filter((x) => x !== a) : [...p.publicWallets, a];
      savePrefs(p);
      ctx.refresh();
    });
    const remove = el('button', { class: 'btn small', type: 'button', 'aria-label': `Remove ${name ?? shortAddr(a)}` }, '✕');
    remove.addEventListener('click', () => {
      p.owned = p.owned.filter((x) => x !== a);
      p.publicWallets = p.publicWallets.filter((x) => x !== a);
      savePrefs(p);
      ctx.onWalletsChanged();
      ctx.refresh();
    });
    return el(
      'li',
      { class: 'wallet-row' },
      el('div', {}, el('strong', {}, name ?? shortAddr(a)), name ? el('div', { class: 'muted mono' }, shortAddr(a)) : null),
      el('div', { class: 'row-actions' }, crestButton(a, p, ctx), privacy, remove),
    );
  });

  const add = (address: string) => {
    if (!p.owned.includes(address)) p.owned.push(address);
    p.followed = p.followed.filter((x) => x !== address);
    savePrefs(p);
    ctx.onWalletsChanged();
    ctx.refresh();
  };

  const input = el('input', { type: 'text', placeholder: '0x… or name.eth', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Wallet address or ENS name' });
  const addBtn = el('button', { class: 'btn', type: 'button' }, 'Add');
  const msg = el('div', { class: 'form-msg', role: 'status' });
  const go = async () => {
    msg.textContent = '';
    addBtn.disabled = true;
    try {
      add(await toAddress(input.value));
      input.value = '';
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', () => void go());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void go();
  });

  const eth = (window as unknown as { ethereum?: { request(args: { method: string }): Promise<unknown> } }).ethereum;
  const connect = eth ? el('button', { class: 'btn', type: 'button' }, 'Connect wallet') : null;
  const connectWallet = async () => {
    try {
      const accounts = (await eth!.request({ method: 'eth_requestAccounts' })) as string[];
      for (const a of accounts.map((x) => x.toLowerCase())) if (!p.owned.includes(a)) p.owned.push(a);
      savePrefs(p);
      ctx.onWalletsChanged();
      ctx.refresh();
    } catch {
      // the player declined
    }
  };
  connect?.addEventListener('click', () => void connectWallet());

  return el(
    'div',
    { class: 'guild-section', 'data-section': 'wallets' },
    el('h2', {}, 'Your wallets'),
    el('p', { class: 'muted' }, 'Each wallet is a tower on your castle walls. Addresses only: nothing here can sign or spend.'),
    rows.length ? el('ul', { class: 'wallet-list' }, ...rows) : el('p', { class: 'muted empty' }, 'No wallets yet.'),
    el('div', { class: 'form-row' }, input, addBtn, connect),
    msg,
  );
}

function historySection(ctx: GuildTabContext): HTMLElement {
  const msg = el('div', { class: 'form-msg ok', role: 'status' });
  const save = el('button', { class: 'btn', type: 'button' }, 'Save to a file');
  save.addEventListener('click', () => {
    void ctx.onExportHistory().then((saved) => {
      msg.textContent = saved ? 'Saved: open it in another browser with “Load a file”.' : 'Nothing gathered yet to save.';
    });
  });
  const file = el('input', { type: 'file', accept: '.gz,.json,application/gzip', 'aria-label': 'History file', hidden: '' });
  const load = el('button', { class: 'btn', type: 'button' }, 'Load a file');
  load.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f
      .arrayBuffer()
      .then((data) => ctx.onImportHistory(data))
      .then((said) => {
        msg.textContent = said;
      })
      .catch((e: unknown) => {
        msg.textContent = e instanceof Error ? e.message : String(e);
      });
  });
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'history' },
    el('h2', {}, 'Your history'),
    el('p', { class: 'muted' }, 'Your wallets’ whole history is gathered slowly in the background and kept in this browser. Save it to a file to bring it to another browser without asking Zerion again.'),
    el('div', { class: 'form-row' }, save, load, file),
    msg,
  );
}

function nodeSection(ctx: GuildTabContext, p: Prefs): HTMLElement {
  const input = el('input', { type: 'text', placeholder: DEFAULT_RPC, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Ethereum node address' });
  input.defaultValue = p.rpcUrl;
  const msg = el('div', { class: 'form-msg', role: 'status' });
  const use = el('button', { class: 'btn', type: 'button' }, 'Use');
  use.addEventListener('click', () => {
    const v = input.value.trim();
    if (v !== '' && !validRpcUrl(v)) {
      msg.textContent = `Use an https address from: ${ALLOWED_RPC_HOSTS.join(', ')}.`;
      return;
    }
    ctx.onRpc(v);
    msg.textContent = v === '' ? 'Using the free public node.' : 'Using your node.';
  });
  const reset = el('button', { class: 'btn', type: 'button' }, 'Default');
  reset.addEventListener('click', () => {
    input.value = '';
    ctx.onRpc('');
    msg.textContent = 'Using the free public node.';
  });
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'node' },
    el('h2', {}, 'Ethereum node'),
    el('p', { class: 'muted' }, 'The bell rings for every block this node reports, and your wallets are watched through it. The free public node needs no setup.'),
    el('div', { class: 'form-row' }, input, use, reset),
    msg,
  );
}

function followedSection(ctx: GuildTabContext, p: Prefs): HTMLElement {
  const rows = p.followed.map((a) => {
    const name = p.ens[a];
    const here = ctx.visiting === a;
    const visit = el('button', { class: `btn small${here ? ' on' : ''}`, type: 'button' }, here ? 'Here' : 'Visit');
    visit.addEventListener('click', () => ctx.onVisit(a));
    const remove = el('button', { class: 'btn small', type: 'button', 'aria-label': `Stop following ${name ?? shortAddr(a)}` }, '✕');
    remove.addEventListener('click', () => {
      p.followed = p.followed.filter((x) => x !== a);
      savePrefs(p);
      ctx.refresh();
    });
    return el(
      'li',
      { class: 'wallet-row' },
      el('div', {}, el('strong', {}, name ?? shortAddr(a)), name ? el('div', { class: 'muted mono' }, shortAddr(a)) : null),
      el('div', { class: 'row-actions' }, visit, remove),
    );
  });
  const input = el('input', { type: 'text', placeholder: '0x… or name.eth', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Wallet to follow' });
  const add = el('button', { class: 'btn', type: 'button' }, 'Follow');
  const msg = el('div', { class: 'form-msg', role: 'status' });
  const go = async () => {
    msg.textContent = '';
    add.disabled = true;
    try {
      const a = await toAddress(input.value);
      if (p.owned.includes(a)) throw new Error('That wallet is one of yours: it is already a tower of your castle.');
      if (!p.followed.includes(a)) p.followed.push(a);
      savePrefs(p);
      input.value = '';
      ctx.refresh();
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      add.disabled = false;
    }
  };
  add.addEventListener('click', () => void go());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void go();
  });
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'followed' },
    el('h2', {}, 'Wallets you follow'),
    el('p', { class: 'muted' }, 'Other people’s wallets: visit their castle to see it as they would, without touching anything.'),
    rows.length ? el('ul', { class: 'wallet-list' }, ...rows) : el('p', { class: 'muted empty' }, 'Nobody followed yet.'),
    el('div', { class: 'form-row' }, input, add),
    msg,
  );
}

function shareSection(p: Prefs): HTMLElement {
  const wallets = p.owned.filter((a) => p.publicWallets.includes(a));
  const out = el(
    'div',
    { class: 'guild-section', 'data-section': 'share' },
    el('h2', {}, 'Share your castle'),
    el('p', { class: 'muted' }, 'A link that opens your castle for a friend, read-only. Only the wallets you marked public go in it (the link holds their addresses).'),
  );
  if (wallets.length === 0) {
    out.append(el('p', { class: 'muted empty' }, 'Mark at least one of your wallets public (above) to share.'));
    return out;
  }
  const first = wallets[0]!;
  const link = `${location.origin}${location.pathname}${encodeShare({ wallets, name: p.ens[first] ?? '' })}`;
  const field = el('input', { type: 'text', readonly: '', 'aria-label': 'Your share link', class: 'mono' });
  field.value = link;
  const msg = el('div', { class: 'form-msg ok', role: 'status' });
  const copy = el('button', { class: 'btn', type: 'button' }, 'Copy link');
  copy.addEventListener('click', () => {
    field.select();
    void navigator.clipboard
      ?.writeText(link)
      .then(() => {
        msg.textContent = 'Copied.';
      })
      .catch(() => {
        msg.textContent = 'Select the link and copy it.';
      });
  });
  out.append(el('div', { class: 'form-row' }, field, copy), msg);
  return out;
}

/**
 * A wallet's crest: a swatch of its colour; tapping it offers the heraldic
 * tinctures (and the colour it was born with). The choice colours its tower's
 * flag, and is kept with the player's preferences (shared with the town).
 */
function crestButton(address: string, p: Prefs, ctx: GuildTabContext): HTMLElement {
  const [main] = crestColors(address);
  const wrap = el('div', { class: 'crest-pick' });
  const swatch = el('button', { class: 'crest-swatch', type: 'button', 'aria-label': 'Crest colour', 'aria-expanded': 'false', style: `background:${main}` });
  const choices = el('div', { class: 'crest-choices', role: 'group', 'aria-label': 'Pick a crest colour', hidden: '' });
  const born = bornCrest(address);
  const pick = (color: string | null) => {
    if (color === null) delete p.crests[address];
    else p.crests[address] = [color, born[1]];
    setCrests(p.crests);
    savePrefs(p);
    ctx.refresh();
  };
  for (const t of TINCTURES) {
    const b = el('button', { class: `crest-choice${t.color === main ? ' on' : ''}`, type: 'button', title: t.name, 'aria-label': t.name, style: `background:${t.color}` });
    b.addEventListener('click', () => pick(t.color));
    choices.append(b);
  }
  const reset = el('button', { class: 'btn small', type: 'button', title: 'The colour this wallet was born with' }, 'Born');
  reset.addEventListener('click', () => pick(null));
  choices.append(reset);
  swatch.addEventListener('click', () => {
    choices.hidden = !choices.hidden;
    swatch.setAttribute('aria-expanded', String(!choices.hidden));
  });
  wrap.append(swatch, choices);
  return wrap;
}
