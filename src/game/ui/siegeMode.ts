/**
 * Siege of the Ledger's switch: a topbar button that turns the castle view into
 * the game and back (docs/game/MAPPING.md). The chain view never depends on it.
 * For now (M0) the game is a stub panel over the scene; the match comes later.
 */

import { el } from '../../util/dom.js';
import './siege.css';

/** `?mode=siege` starts in the game. */
export const SIEGE_PARAM = 'mode';

export interface SiegeModeOptions {
  /** Whether the game starts on (default: off). */
  on?: boolean;
  /** Called after every switch, with the new state. */
  onChange?: (on: boolean) => void;
}

export class SiegeMode {
  readonly button: HTMLButtonElement;
  #on: boolean;
  #onChange: ((on: boolean) => void) | undefined;
  #scene: HTMLElement | null = null;
  #panel: HTMLElement;

  constructor(opts: SiegeModeOptions = {}) {
    this.#on = opts.on ?? false;
    this.#onChange = opts.onChange;
    this.button = el('button', { class: 'btn siege-toggle', type: 'button', 'aria-pressed': 'false' });
    this.button.addEventListener('click', () => this.set(!this.#on));
    this.#panel = el(
      'div',
      { class: 'siege-panel', role: 'region', 'aria-label': 'Siege of the Ledger' },
      el('h2', {}, '⚔ Siege of the Ledger'),
      el('p', {}, 'Your portfolio is your army. Pick a wallet and an opponent, trade between battles, and bring down the enemy keep.'),
      el('p', { class: 'siege-soon' }, 'Match setup is coming next.'),
    );
    this.#show();
  }

  get on(): boolean {
    return this.#on;
  }

  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    this.#show();
    this.#onChange?.(on);
  }

  /** The castle view's element, each time it is built: the game's HUD goes over it. */
  attach(scene: HTMLElement): void {
    this.#scene = scene;
    scene.append(this.#panel);
    this.#show();
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
