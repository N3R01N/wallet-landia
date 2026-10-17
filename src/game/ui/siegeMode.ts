/**
 * Siege of the Ledger's switch: a topbar button that turns the castle view into
 * the game and back (docs/game/MAPPING.md). The chain view never depends on it.
 * The game's panel holds the match setup, then the match.
 */

import { el } from '../../util/dom.js';
import { Match } from '../core/match.js';
import { opponentPortfolio } from '../setup/editor.js';
import { SetupPanel, type SetupChoice, type SetupOptions } from './setupPanel.js';
import './siege.css';

/** `?mode=siege` starts in the game. */
export const SIEGE_PARAM = 'mode';

export interface SiegeModeOptions extends Omit<SetupOptions, 'onStart'> {
  /** Whether the game starts on (default: off). */
  on?: boolean;
  /** Called after every switch, with the new state. */
  onChange?: (on: boolean) => void;
  /** A new match (the renderer picks it up). */
  onMatch?: (match: Match | null) => void;
  /** A match seed; the default is random. */
  seed?: () => string;
}

export class SiegeMode {
  readonly button: HTMLButtonElement;
  #on: boolean;
  readonly #opts: SiegeModeOptions;
  #scene: HTMLElement | null = null;
  readonly #panel: HTMLElement;
  readonly #body: HTMLElement;
  readonly #setup: SetupPanel;
  match: Match | null = null;

  constructor(opts: SiegeModeOptions) {
    this.#opts = opts;
    this.#on = opts.on ?? false;
    this.button = el('button', { class: 'btn siege-toggle', type: 'button', 'aria-pressed': 'false' });
    this.button.addEventListener('click', () => this.set(!this.#on));
    this.#setup = new SetupPanel({ wallets: opts.wallets, protocols: opts.protocols, onStart: (c) => this.start(c) });
    this.#body = el('div', { class: 'siege-body' }, this.#setup.element);
    this.#panel = el(
      'div',
      { class: 'siege-panel', role: 'region', 'aria-label': 'Siege of the Ledger' },
      el('h2', {}, '⚔ Siege of the Ledger'),
      el('p', { class: 'siege-intro' }, 'Your portfolio is your army. Trade between battles and bring down the enemy keep.'),
      this.#body,
    );
    this.#show();
  }

  get on(): boolean {
    return this.#on;
  }

  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    // the wallets may have loaded since the setup was drawn
    if (on && !this.match) this.#setup.render();
    this.#show();
    this.#opts.onChange?.(on);
  }

  /** The castle view's element, each time it is built: the game's HUD goes over it. */
  attach(scene: HTMLElement): void {
    this.#scene = scene;
    scene.append(this.#panel);
    if (!this.match) this.#setup.render();
    this.#show();
  }

  /** Starts a match from the setup's choice. */
  start(choice: SetupChoice): Match {
    const seed = this.#opts.seed?.() ?? randomSeed();
    const match = new Match({
      seed,
      portfolios: [choice.draft.portfolio, opponentPortfolio(choice.draft, choice.archetype, choice.difficulty)],
      npc: [undefined, { archetype: choice.archetype, difficulty: choice.difficulty }],
      customAssets: choice.draft.customAssets,
    });
    this.match = match;
    this.#showMatch();
    this.#opts.onMatch?.(match);
    return match;
  }

  /** Back to the setup (the match is dropped). */
  leave(): void {
    this.match = null;
    this.#body.replaceChildren(this.#setup.element);
    this.#setup.render();
    this.#opts.onMatch?.(null);
  }

  #showMatch(): void {
    const m = this.match;
    if (!m) return;
    const leave = el('button', { class: 'btn siege-leave', type: 'button' }, 'Leave the match');
    leave.addEventListener('click', () => this.leave());
    const s = m.state;
    this.#body.replaceChildren(
      el('div', { class: 'siege-match', 'data-phase': s.phase }, el('p', {}, `Round ${s.round} · ${s.phase} phase`), el('p', { class: 'siege-soon' }, `Seed ${s.seed}`), leave),
    );
  }

  #show(): void {
    // the word hides on phones (siege.css), the icon stays
    this.button.replaceChildren(this.#on ? '🏰' : '⚔', el('span', { class: 'siege-word' }, this.#on ? ' Town' : ' Siege'));
    this.button.setAttribute('aria-pressed', String(this.#on));
    this.button.setAttribute('aria-label', this.#on ? 'Back to the town' : 'Siege of the Ledger');
    this.button.title = this.#on ? 'Back to the town' : 'Siege of the Ledger: your portfolio goes to war';
    this.#panel.hidden = !this.#on;
    if (this.#scene) this.#scene.toggleAttribute('data-siege', this.#on);
  }
}

function randomSeed(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
