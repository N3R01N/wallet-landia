/**
 * Match setup (spec: "Phase 0. Setup", "Portfolio sources"): pick where the
 * army comes from (a wallet of the guild, a template, or a blank build), edit
 * it within the cap and the budget, pick the opponent, and start. The rules
 * live in setup/editor.ts; this is only the form.
 */

import type { Hero, Protocol } from '../../domain/model.js';
import { el } from '../../util/dom.js';
import { BALANCE } from '../config/balance.js';
import { UNIT_TYPES } from '../core/catalog.js';
import { unitLink } from './hud.js';
import type { Archetype, Difficulty, Squad } from '../core/types.js';
import nftJson from '../data/nftCollections.json';
import { TEMPLATES } from '../data/templates.js';
import { importWallet } from '../data/walletImporter.js';
import {
  addDollars,
  addNft,
  blankDraft,
  catalogOf,
  draftValue,
  importDraft,
  kindsFor,
  preview,
  removeNft,
  removePosition,
  room,
  rowValue,
  setDollars,
  templateDraft,
  type Draft,
} from '../setup/editor.js';
import { deleteLoadout, listLoadouts, loadoutCode, readLoadoutCode, saveLoadout } from '../setup/loadouts.js';
import { decodeReplay, type Replay } from '../core/match.js';

export interface WalletChoice {
  name: string;
  hero: Hero;
}

export interface SetupChoice {
  draft: Draft;
  archetype: Archetype;
  difficulty: Difficulty;
}

export interface SetupOptions {
  /** The wallets the visualization has loaded (Ethereum mainnet is read from each). */
  wallets: () => WalletChoice[];
  protocols: () => ReadonlyMap<string, Protocol>;
  onStart: (choice: SetupChoice) => void;
  /** Watch a replay file. */
  onWatch?: (replay: Replay) => void;
}

const NPC_ARCHETYPES: readonly Archetype[] = ['degen', 'whale', 'stable-maxi', 'yield-farmer'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const KIND_LABEL: Record<string, string> = { spot: 'Held', staked: 'Staked', restaked: 'Restaked', lp: 'Pool', supplied: 'Supplied', borrowed: 'Borrowed' };

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export class SetupPanel {
  readonly element: HTMLElement;
  readonly #opts: SetupOptions;
  #draft: Draft = templateDraft('balanced');
  #source = 'template:balanced';
  #archetype: Archetype = 'whale';
  #difficulty: Difficulty = 'normal';
  #message = '';
  /** The last loadout code made (shown to copy by hand where the clipboard is closed). */
  #shared = '';

  constructor(opts: SetupOptions) {
    this.#opts = opts;
    // drawn when the scene shows it (render): the wallets are read then, not at construction
    this.element = el('div', { class: 'siege-setup' });
  }

  get draft(): Draft {
    return this.#draft;
  }

  render(): void {
    const d = this.#draft;
    const cat = catalogOf(d);
    const pv = preview(d, this.#archetype, this.#difficulty);
    const wallets = this.#opts.wallets();

    // where the army comes from
    const source = el('select', { class: 'siege-source', 'aria-label': 'Portfolio' });
    const opt = (value: string, label: string) => {
      const o = el('option', { value }, label);
      if (value === this.#source) o.selected = true;
      return o;
    };
    source.append(
      el('optgroup', { label: 'Templates' }, ...(Object.keys(TEMPLATES) as Archetype[]).map((a) => opt(`template:${a}`, TEMPLATES[a].name))),
      opt('blank', `Blank build (${usd(BALANCE.match.startingBudget)} budget)`),
      ...(wallets.length > 0 ? [el('optgroup', { label: 'Import a wallet' }, ...wallets.map((w, i) => opt(`wallet:${i}`, w.name)))] : []),
    );
    source.addEventListener('change', () => this.#pickSource(source.value));

    const archetype = el('select', { class: 'siege-archetype', 'aria-label': 'Opponent' }, ...NPC_ARCHETYPES.map((a) => {
      const o = el('option', { value: a }, TEMPLATES[a].name);
      o.selected = a === this.#archetype;
      return o;
    }));
    archetype.addEventListener('change', () => {
      this.#archetype = archetype.value as Archetype;
      this.render();
    });
    const difficulty = el('select', { class: 'siege-difficulty', 'aria-label': 'Difficulty' }, ...DIFFICULTIES.map((x) => {
      const o = el('option', { value: x }, x[0]!.toUpperCase() + x.slice(1));
      o.selected = x === this.#difficulty;
      return o;
    }));
    difficulty.addEventListener('change', () => {
      this.#difficulty = difficulty.value as Difficulty;
      this.render();
    });

    // the positions
    const rows = d.portfolio.positions.map((pos, i) => {
      const a = cat.asset(pos.asset);
      const what = pv.rows[i];
      const input = el('input', { class: 'siege-dollars', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': `${a.symbol} in dollars`, value: String(Math.round(Math.abs(rowValue(d, i)))) });
      input.addEventListener('change', () => this.#edit(setDollars(d, i, Number(input.value))));
      const remove = el('button', { class: 'btn siege-remove', type: 'button', 'aria-label': `Remove ${a.symbol}` }, '×');
      remove.addEventListener('click', () => {
        removePosition(d, i);
        this.render();
      });
      const unitId = cat.unitOf(pos.asset)?.id;
      const units = typeof what === 'number' ? (unitId ? unitLink(unitId, what) : `${what} units`) : what === 'dust' ? 'too small: no units' : what === 'walls' ? 'walls' : 'debt';
      const pair = pos.pairWith ? ` + ${cat.asset(pos.pairWith).symbol}` : '';
      return el(
        'tr',
        { class: typeof what === 'number' ? '' : `siege-row-${what}` },
        el('td', {}, `${a.symbol}${pair}`, el('small', {}, ` ${KIND_LABEL[pos.kind] ?? pos.kind}`)),
        el('td', {}, input),
        el('td', { class: 'siege-units' }, units ?? ''),
        el('td', {}, remove),
      );
    });

    // adding one
    const addAsset = el('select', { class: 'siege-add-asset', 'aria-label': 'Asset to add' }, ...cat.assets.filter((a) => a.id !== 'drop').map((a) => el('option', { value: a.id }, a.symbol)));
    const addKind = el('select', { class: 'siege-add-kind', 'aria-label': 'How it is held' });
    const fillKinds = () => {
      addKind.replaceChildren(...kindsFor(cat.asset(addAsset.value)).map((k, i) => el('option', { value: String(i) }, k.label)));
    };
    fillKinds();
    addAsset.addEventListener('change', fillKinds);
    const addAmount = el('input', { class: 'siege-add-dollars', type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: '$', 'aria-label': 'Dollars to add' });
    const addBtn = el('button', { class: 'btn siege-add', type: 'button' }, 'Add');
    addBtn.addEventListener('click', () => {
      const kinds = kindsFor(cat.asset(addAsset.value));
      const k = kinds[Number(addKind.value)] ?? kinds[0]!;
      this.#edit(addDollars(d, addAsset.value, Number(addAmount.value), k.kind, k.protocol));
    });

    // NFTs: relics, not units
    const nftRows = d.portfolio.nfts.map((n) => {
      const name = nftJson.collections.find((c) => c.id === n.collection)?.name ?? n.collection;
      const floor = el('input', { class: 'siege-floor', type: 'number', min: '0', step: '1', 'aria-label': `${name} floor in dollars`, value: String(Math.round(n.floor)) });
      floor.addEventListener('change', () => {
        n.floor = Math.max(0, Number(floor.value) || 0);
        this.render();
      });
      const remove = el('button', { class: 'btn siege-remove', type: 'button', 'aria-label': `Remove ${name}` }, '×');
      remove.addEventListener('click', () => {
        removeNft(d, n.collection);
        this.render();
      });
      return el('li', {}, el('span', {}, name), floor, remove);
    });
    const nftPick = el('select', { class: 'siege-add-nft', 'aria-label': 'NFT collection to add' }, ...nftJson.collections.map((c) => el('option', { value: c.id }, `${c.name} · ${usd(c.floor)}`)));
    const nftAdd = el('button', { class: 'btn', type: 'button' }, 'Add NFT');
    nftAdd.addEventListener('click', () => {
      const c = nftJson.collections.find((x) => x.id === nftPick.value);
      if (c) addNft(d, { collection: c.id, floor: c.floor });
      this.render();
    });

    // loadouts
    const name = el('input', { class: 'siege-loadout-name', type: 'text', maxlength: '40', placeholder: 'Loadout name', 'aria-label': 'Loadout name' });
    const save = el('button', { class: 'btn', type: 'button' }, 'Save');
    save.addEventListener('click', () => {
      this.#message = saveLoadout(name.value, d, Date.now()) ? `Saved “${name.value.trim()}”.` : 'Give it a name (this device must allow storage).';
      this.render();
    });
    const saved = listLoadouts().map((l) => {
      const load = el('button', { class: 'btn', type: 'button' }, 'Load');
      load.addEventListener('click', () => {
        this.#draft = structuredClone(l.draft);
        this.#source = 'loadout';
        this.#message = `Loaded “${l.name}”.`;
        this.render();
      });
      const del = el('button', { class: 'btn siege-remove', type: 'button', 'aria-label': `Delete ${l.name}` }, '×');
      del.addEventListener('click', () => {
        deleteLoadout(l.name);
        this.render();
      });
      // off this device: a code to paste anywhere, or a file
      const share = el('button', { class: 'btn siege-share', type: 'button', 'aria-label': `Copy ${l.name} as a code` }, 'Code');
      share.addEventListener('click', () => {
        const code = loadoutCode(l.name, l.draft);
        this.#shared = code;
        void navigator.clipboard?.writeText(code).then(
          () => {
            this.#message = `“${l.name}” copied as a code: paste it on another device.`;
            this.render();
          },
          () => this.render(),
        );
        this.render();
      });
      const file = el('button', { class: 'btn siege-remove', type: 'button', 'aria-label': `Download ${l.name}` }, '⬇');
      file.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([loadoutCode(l.name, l.draft)], { type: 'text/plain' }));
        const a = el('a', { href: url, download: `${l.name.replace(/[^\w-]+/g, '-')}.siege.txt` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      return el('li', {}, el('span', {}, l.name), load, share, file, del);
    });
    // and back: a pasted code, or a file
    const codeIn = el('input', { class: 'siege-code-in', type: 'text', placeholder: 'Paste a loadout code', 'aria-label': 'Loadout code' });
    const importBtn = el('button', { class: 'btn', type: 'button' }, 'Import');
    const take = (text: string) => {
      try {
        const l = readLoadoutCode(text);
        // someone else's code: the match cap holds as for any import, and custom tokens need a sane price
        const custom = (l.draft.customAssets ?? []).filter((a) => typeof a.id === 'string' && Number.isFinite(a.price) && a.price > 0);
        const draft = importDraft(l.draft.portfolio, custom);
        saveLoadout(l.name, draft, Date.now());
        this.#draft = draft;
        this.#source = 'loadout';
        this.#message = `Imported “${l.name}”.`;
      } catch {
        this.#message = 'That isn’t a loadout code.';
      }
      this.render();
    };
    importBtn.addEventListener('click', () => take(codeIn.value));
    const codeFile = el('input', { class: 'siege-code-file', type: 'file', accept: '.txt,text/plain', 'aria-label': 'Loadout file' });
    codeFile.addEventListener('change', () => {
      const f = codeFile.files?.[0];
      if (f) void f.text().then(take);
    });

    // a replay file (downloaded after a match): every battle again
    const replayFile = el('input', { class: 'siege-replay-file', type: 'file', accept: '.json,application/json', 'aria-label': 'Replay file' });
    replayFile.addEventListener('change', () => {
      const file = replayFile.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          this.#opts.onWatch?.(decodeReplay(text));
        } catch (error) {
          this.#message = `Not a replay file (${error instanceof Error ? error.message : String(error)}).`;
          this.render();
        }
      });
    });
    const start = el('button', { class: 'btn siege-start', type: 'button' }, '⚔ Start the siege');
    const armyUnits = pv.squads.reduce((s, q) => s + q.count, 0);
    if (armyUnits === 0) start.setAttribute('disabled', '');
    start.addEventListener('click', () => this.#opts.onStart({ draft: structuredClone(d), archetype: this.#archetype, difficulty: this.#difficulty }));

    const limit = d.budget !== null ? `Budget left: ${usd(room(d))} of ${usd(d.budget)}` : `${usd(draftValue(d))} of the ${usd(BALANCE.match.matchCap)} match cap`;
    const parts: (Node | null)[] = [
      el('div', { class: 'siege-row' }, el('label', {}, 'Army from ', source)),
      el('div', { class: 'siege-row' }, el('label', {}, 'Opponent ', archetype), el('label', {}, ' ', difficulty)),
      d.notice ? el('p', { class: 'siege-notice' }, d.notice) : null,
      el('table', { class: 'siege-positions' }, el('tbody', {}, ...rows)),
      el('p', { class: 'siege-limit' }, limit),
      el('div', { class: 'siege-row siege-add-row' }, addAsset, addKind, addAmount, addBtn),
      el('h3', {}, 'NFTs (relics, no units)'),
      el('ul', { class: 'siege-list' }, ...nftRows),
      el('div', { class: 'siege-row' }, nftPick, nftAdd),
      el(
        'div',
        { class: 'siege-preview' },
        el('div', {}, el('strong', {}, 'You: '), `${armyUnits} units · keep ${Math.round(pv.keepHp)} HP`, el('br', {}), squadLine(pv.squads)),
        el('div', {}, el('strong', {}, `${TEMPLATES[this.#archetype].name}: `), `${pv.opponent.squads.reduce((s, q) => s + q.count, 0)} units · keep ${Math.round(pv.opponent.keepHp)} HP`, el('br', {}), squadLine(pv.opponent.squads)),
      ),
      el('h3', {}, 'Loadouts'),
      el('div', { class: 'siege-row' }, name, save),
      el('ul', { class: 'siege-list siege-loadouts' }, ...saved),
      this.#shared ? el('input', { class: 'siege-code-out', type: 'text', readonly: '', value: this.#shared, 'aria-label': 'The loadout’s code' }) : null,
      el('div', { class: 'siege-row' }, codeIn, importBtn),
      el('div', { class: 'siege-row' }, el('label', {}, 'or a file: ', codeFile)),
      this.#message ? el('p', { class: 'siege-message', role: 'status' }, this.#message) : null,
      start,
      ...(this.#opts.onWatch ? [el('div', { class: 'siege-row siege-replay-row' }, el('label', {}, '▶ Watch a replay: ', replayFile))] : []),
    ];
    this.element.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  #edit(r: { ok: true } | { ok: false; reason: string }): void {
    this.#message = r.ok ? '' : r.reason;
    this.render();
  }

  #pickSource(value: string): void {
    this.#source = value;
    this.#message = '';
    if (value === 'blank') this.#draft = blankDraft();
    else if (value.startsWith('template:')) this.#draft = templateDraft(value.slice(9) as Archetype);
    else if (value.startsWith('wallet:')) {
      const w = this.#opts.wallets()[Number(value.slice(7))];
      if (w) {
        const r = importWallet(w.hero, this.#opts.protocols());
        this.#draft = importDraft(r.portfolio, r.customAssets);
        const notes = [this.#draft.notice, ...r.notes].filter(Boolean);
        this.#draft.notice = notes.length > 0 ? notes.join(' ') : null;
      }
    }
    this.render();
  }
}

function squadLine(squads: readonly Squad[]): string {
  return [...squads]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((s) => `${s.count} ${UNIT_TYPES[s.unit]?.name ?? s.unit}`)
    .join(', ');
}
