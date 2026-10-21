/**
 * The Guild tab: where the castle's wallets come from. The player's own free
 * Zerion key (kept in this browser only), their wallets (addresses, ENS
 * names, or the connected wallet), and where the data stands (demo, captured,
 * live; requests left today). Uses the same key and wallet list as the town.
 */

import { el, shortAddr } from '../util/dom.js';
import type { LedgerStatus } from '../data/ledger.js';
import { TAP_SOUNDS } from '../audio/soundscape.js';
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
  /** Pick the click sound (TAP_SOUNDS) and hear it. */
  onTapSound(index: number): void;
  /** How far back each wallet's history is gathered, and whether the walk back rests now (null: not running). */
  history: { statuses: LedgerStatus[]; paused: string | null } | null;
}

/** At a glance, how a wallet's walk back stands: its row's colour and badge. */
export type HistoryKind = 'done' | 'walking' | 'waiting' | 'problem' | 'partial';

const HISTORY_BADGE: Record<HistoryKind, string> = {
  done: 'complete',
  walking: 'reaching back',
  waiting: 'waiting',
  problem: 'needs attention',
  partial: 'partial',
};

const RESTING: Record<string, string> = {
  hidden: 'resting while the tab is hidden',
  budget: 'resting: the rest of today’s requests are kept for the castle',
  error: 'resting after an error; trying again soon',
  auth: 'stopped: Zerion did not accept the key',
  done: 'up to date',
  stopped: 'not running',
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
 * How far back each wallet's history reaches: its own element, replaced in
 * place while history arrives (the rest of the tab, and what is being typed,
 * stays as it is).
 */
export function historyRows(ctx: Pick<GuildTabContext, 'history' | 'prefs'>): HTMLElement {
  const h = ctx.history;
  const paused = h === null ? 'stopped' : h.paused;
  if (!h || h.statuses.length === 0)
    return el('div', { class: 'history-rows' }, el('p', { class: 'muted' }, h === null ? 'The walk back through your history starts with your key and your own wallets.' : 'Starting…'));
  return el(
    'div',
    { class: 'history-rows' },
    ...h.statuses.map((s) => {
      const reach = s.oldest !== null ? ` · back to ${new Date(s.oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
      const state = s.complete ? '✓ all of it, from the very first' : s.capped ? 'partial: a very busy wallet, kept to the newest 50,000' : paused === null ? 'reaching back…' : (RESTING[paused] ?? 'resting');
      const kind = historyKind(s, paused);
      return el(
        'div',
        { class: `history-row ${kind}`, 'data-address': s.address, 'data-state': kind },
        el('span', { class: 'history-head' }, el('strong', {}, walletDisplayName(ctx.prefs, s.address)), el('span', { class: 'history-badge' }, HISTORY_BADGE[kind])),
        el('span', {}, `${s.count.toLocaleString('en-US')} transactions${s.spam > 0 ? ` (${s.spam.toLocaleString('en-US')} spam)` : ''}${reach}`),
        el('span', { class: 'muted small' }, `${state} · ${s.backfillRequests} request${s.backfillRequests === 1 ? '' : 's'} so far`),
      );
    }),
  );
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
    soundSection(ctx, p),
    shareSection(p),
    followedSection(ctx, p),
    historySection(ctx),
    nodeSection(ctx, p),
    ctx.budget ? el('p', { class: 'muted budget' }, `Zerion requests left today: ${ctx.budget.remaining}`) : null,
    aboutSection(),
  );
}

/** What the castle is not (advice, exact, official), and the way to the legal notice and privacy page. */
function aboutSection(): HTMLElement {
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'about' },
    el('h2', {}, 'About'),
    el('p', { class: 'muted' }, 'Not financial advice. The values come from Zerion and the chain and can be wrong or late. Wallet-landia is a free hobby project, not affiliated with Zerion or any protocol it shows.'),
    el('p', {}, el('a', { href: '/legal.html' }, 'Legal notice, privacy and terms')),
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
    el('p', { class: 'muted' }, 'Your own free key, kept only in this browser. It reads your wallets; it can never move anything. It goes only to Zerion, through this site’s server, which passes it on and never stores it. ', link, '.'),
    el('div', { class: 'form-row' }, input, save, forget),
    msg,
  );
}

/** A wallet's name: the one the player gave it, else its ENS name, else "Wallet 2" by its place. */
export function walletDisplayName(p: Pick<Prefs, 'names' | 'ens' | 'owned'>, address: string): string {
  const given = p.names[address]?.trim();
  if (given) return given;
  const ens = p.ens[address]?.trim();
  if (ens) return ens;
  const i = p.owned.indexOf(address);
  return i >= 0 ? `Wallet ${i + 1}` : shortAddr(address);
}

/** The name, with a ✎ to rename it in place (Enter or leaving the field keeps it; empty goes back to the default). */
function nameEditor(address: string, p: Prefs, ctx: GuildTabContext): HTMLElement {
  const label = el('strong', { class: 'wallet-name' }, walletDisplayName(p, address));
  const edit = el('button', { class: 'btn small rename', type: 'button', 'aria-label': `Rename ${walletDisplayName(p, address)}`, title: 'Rename' }, '✎');
  const wrap = el('span', { class: 'name-edit' }, label, edit);
  edit.addEventListener('click', () => {
    const input = el('input', { type: 'text', value: p.names[address] ?? '', placeholder: walletDisplayName({ ...p, names: {} }, address), maxlength: '40', 'aria-label': 'Wallet name' });
    const done = () => {
      const v = input.value.trim();
      if (v) p.names[address] = v;
      else delete p.names[address];
      savePrefs(p);
      ctx.refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done();
      if (e.key === 'Escape') ctx.refresh();
    });
    input.addEventListener('blur', done);
    wrap.replaceChildren(input);
    input.focus();
    input.select();
  });
  return wrap;
}

/** The click sound: five to pick from, each heard when picked. */
function soundSection(ctx: GuildTabContext, p: Prefs): HTMLElement {
  const choices = el('div', { class: 'sound-choices', role: 'radiogroup', 'aria-label': 'Click sound' });
  TAP_SOUNDS.forEach((name, i) => {
    const on = p.tapSound === i;
    const b = el('button', { class: `btn small sound-choice${on ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(on) }, `${on ? '● ' : '○ '}${name}`);
    b.addEventListener('click', () => {
      p.tapSound = i;
      savePrefs(p);
      ctx.onTapSound(i);
      ctx.refresh();
    });
    choices.append(b);
  });
  return el(
    'div',
    { class: 'guild-section', 'data-section': 'sound' },
    el('h2', {}, 'Click sound'),
    el('p', { class: 'muted' }, 'What you hear when you tap a building, a person or a courier. Tap one to hear it (it turns sound on).'),
    choices,
  );
}

function walletsSection(ctx: GuildTabContext, p: Prefs): HTMLElement {
  const rows = p.owned.map((a) => {
    const name = walletDisplayName(p, a);
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
    const remove = el('button', { class: 'btn small', type: 'button', 'aria-label': `Remove ${name}` }, '✕');
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
      el('div', {}, nameEditor(a, p, ctx), el('div', { class: 'muted mono' }, shortAddr(a))),
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
    historyRows(ctx),
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
