/**
 * The castle shell in the DOM: a top bar, the tabs, the stage where a tab's
 * content (later the 3D castle and town) lives, and one sheet for details.
 * Phones get bottom tabs and a bottom sheet; desktops get a side rail and a
 * docked sheet. The state and the rules live in shellState.ts.
 */

import { el } from '../util/dom.js';
import {
  TAB_LABEL,
  DESKTOP_MIN_WIDTH,
  TABS,
  closeSheet,
  initialShell,
  layoutFor,
  openSheet,
  selectTab,
  type LayoutMode,
  type ShellState,
  type SheetState,
  type TabId,
} from './shellState.js';

export interface ShellOptions {
  /** The content of a tab. Called again each time the tab is shown. */
  renderTab(tab: TabId, open: (sheet: SheetState) => void): HTMLElement;
  /** The body of the sheet for what `open` asked for. */
  renderSheet(sheet: SheetState, close: () => void): HTMLElement;
  /** The guild's name, rank and level for the top bar. */
  topbar?: { guild: string; rank: string; level: string };
  initialTab?: TabId;
}

export class Shell {
  readonly element: HTMLElement;
  #state: ShellState;
  #layout: LayoutMode;
  #opts: ShellOptions;
  #stage = el('main', { class: 'stage', 'aria-live': 'polite' });
  #sheet = el('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'false', hidden: '' });
  #sheetBody = el('div', { class: 'sheet-body' });
  #sheetTitle = el('h2', { class: 'sheet-title', id: 'sheet-title' });
  #tabButtons = new Map<TabId, HTMLButtonElement>();
  #media = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
  #shownTab: TabId | null = null;
  #guildEl = el('span', { class: 'guild-name' });
  #rankEl = el('span', { class: 'rank' });
  #statusEl = el('span', { class: 'status', role: 'status' });

  constructor(opts: ShellOptions) {
    this.#opts = opts;
    this.#state = initialShell(opts.initialTab);
    this.#layout = layoutFor(window.innerWidth);

    const nav = el('nav', { class: 'tabs', 'aria-label': 'Main' });
    for (const tab of TABS) {
      const btn = el('button', { class: 'tab', type: 'button', 'data-tab': tab }, TAB_LABEL[tab]);
      btn.addEventListener('click', () => this.go(tab));
      this.#tabButtons.set(tab, btn);
      nav.append(btn);
    }

    const topbar = el('header', { class: 'topbar' }, el('span', { class: 'brand' }, 'Wallet-landia'), this.#guildEl, this.#statusEl, this.#rankEl);
    this.setTopbar(opts.topbar ?? { guild: 'Your guild', rank: 'Wanderer', level: 'Lv 1' });

    this.#sheet.setAttribute('aria-labelledby', 'sheet-title');
    const head = el(
      'div',
      { class: 'sheet-head' },
      this.#sheetTitle,
      el('button', { class: 'btn sheet-close', type: 'button', 'aria-label': 'Close' }, '✕'),
    );
    head.querySelector('.sheet-close')?.addEventListener('click', () => this.close());
    this.#sheet.append(el('div', { class: 'sheet-handle', 'aria-hidden': 'true' }), head, this.#sheetBody);

    const scrim = el('div', { class: 'scrim', hidden: '' });
    scrim.addEventListener('click', () => this.close());

    this.element = el('div', { class: 'shell', 'data-layout': this.#layout }, topbar, nav, this.#stage, this.#sheet, scrim);
    this.#media.addEventListener('change', () => this.#setLayout(layoutFor(window.innerWidth)));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    this.#render(true);
  }

  /** Adds a control to the top bar's right end (e.g. the sound switch). */
  addTopbarAction(node: HTMLElement): void {
    this.element.querySelector('.topbar')?.append(node);
  }

  /** Gives each tab its icon (the theme's art; null leaves a tab with its label only). */
  setTabIcons(iconOf: (tab: TabId) => string | null): void {
    for (const [tab, btn] of this.#tabButtons) {
      btn.querySelector('img.tab-icon')?.remove();
      const src = iconOf(tab);
      if (src) btn.prepend(el('img', { class: 'tab-icon', src, alt: '', width: '28', height: '28' }));
    }
  }

  /** The guild's name, rank and level in the top bar. */
  setTopbar(top: { guild: string; rank: string; level: string }): void {
    this.#guildEl.textContent = top.guild;
    this.#rankEl.textContent = `${top.level} · ${top.rank}`;
  }

  /** The rank's tooltip: the rank with the title the player wears ('' for none). */
  setRankTitle(text: string): void {
    this.#rankEl.title = text;
  }

  /** A short status beside the guild's name (loading, live, an error); empty hides it. */
  setStatus(text: string, kind: 'info' | 'busy' | 'error' = 'info'): void {
    this.#statusEl.textContent = text;
    this.#statusEl.dataset.kind = kind;
    this.#statusEl.hidden = text === '';
  }

  /** Draws the current tab again (its data changed); an open sheet stays. */
  refresh(): void {
    this.#render(true);
  }

  get state(): ShellState {
    return this.#state;
  }

  get layout(): LayoutMode {
    return this.#layout;
  }

  go(tab: TabId): void {
    this.#state = selectTab(this.#state, tab);
    this.#render(true);
  }

  open(sheet: SheetState): void {
    this.#state = openSheet(this.#state, sheet);
    this.#render(false);
  }

  close(): void {
    this.#state = closeSheet(this.#state);
    this.#render(false);
  }

  #setLayout(layout: LayoutMode): void {
    if (layout === this.#layout) return;
    this.#layout = layout;
    this.element.dataset.layout = layout;
    // The sheet is a drawer on a phone and a column on a desktop (CSS): a
    // docked sheet can stay open, so nothing closes here.
  }

  /** Redraws what changed. Re-renders the stage only when the tab changes, so a scroll position survives opening a sheet. */
  #render(tabChanged: boolean): void {
    const { tab, sheet } = this.#state;
    for (const [id, btn] of this.#tabButtons) {
      const current = id === tab;
      btn.setAttribute('aria-current', current ? 'page' : 'false');
      btn.classList.toggle('active', current);
    }
    if (tabChanged || this.#shownTab !== tab) {
      this.#shownTab = tab;
      this.#stage.replaceChildren(this.#opts.renderTab(tab, (s) => this.open(s)));
      this.#stage.scrollTop = 0;
    }
    const scrim = this.element.querySelector<HTMLElement>('.scrim');
    if (sheet) {
      this.#sheetTitle.textContent = sheet.title;
      this.#sheetBody.replaceChildren(this.#opts.renderSheet(sheet, () => this.close()));
      this.#sheet.hidden = false;
      if (scrim) scrim.hidden = false;
    } else {
      this.#sheet.hidden = true;
      if (scrim) scrim.hidden = true;
    }
    this.element.dataset.sheet = sheet ? 'open' : 'closed';
  }
}
