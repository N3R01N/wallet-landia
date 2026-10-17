/**
 * Siege of the Ledger's switch: a topbar button that turns the castle view into
 * the game and back (docs/game/MAPPING.md). The chain view never depends on it:
 * while the game is on, the view is built with the siege's extension (the
 * enemy castle past the town, a quiet town), and the game's panel holds the
 * match setup, then the match.
 */

import type { SceneExtension } from '../../castle/scene/castleView.js';
import type { CastlePlan } from '../../castle/scene/plan.js';
import { el } from '../../util/dom.js';
import { Match } from '../core/match.js';
import { siegePlan, type SiegePlan } from '../render/siegePlan.js';
import { TEAM_COLORS } from '../render/battleView.js';
import { opponentPortfolio } from '../setup/editor.js';
import { MatchPanel, showCastleDamage, type MatchScene } from './matchPanel.js';
import { SetupPanel, type SetupChoice, type SetupOptions } from './setupPanel.js';
import './siege.css';

/** `?mode=siege` starts in the game. */
export const SIEGE_PARAM = 'mode';

export interface SiegeModeOptions extends Omit<SetupOptions, 'onStart'> {
  /** Whether the game starts on (default: off). */
  on?: boolean;
  /** Called after every switch, with the new state (the castle view is built again). */
  onChange?: (on: boolean) => void;
  /** A match seed; the default is random. */
  seed?: () => string;
}

export class SiegeMode {
  readonly button: HTMLButtonElement;
  #on: boolean;
  readonly #opts: SiegeModeOptions;
  #scene: MatchScene | null = null;
  readonly #panel: HTMLElement;
  readonly #body: HTMLElement;
  readonly #setup: SetupPanel;
  #plan: SiegePlan | null = null;
  #matchPanel: MatchPanel | null = null;

  constructor(opts: SiegeModeOptions) {
    this.#opts = opts;
    this.#on = opts.on ?? false;
    this.button = el('button', { class: 'btn siege-toggle', type: 'button', 'aria-pressed': 'false' });
    this.button.addEventListener('click', () => this.set(!this.#on));
    this.#setup = new SetupPanel({ wallets: opts.wallets, protocols: opts.protocols, onStart: (c) => this.start(c) });
    this.#body = el('div', { class: 'siege-body' }, this.#setup.element);
    const min = el('button', { class: 'btn siege-min', type: 'button', 'aria-label': 'Fold the panel', 'aria-expanded': 'true' }, '▾');
    min.addEventListener('click', () => {
      const folded = this.#panel.toggleAttribute('data-min');
      min.textContent = folded ? '▸' : '▾';
      min.setAttribute('aria-expanded', String(!folded));
    });
    this.#panel = el(
      'div',
      { class: 'siege-panel', role: 'region', 'aria-label': 'Siege of the Ledger' },
      min,
      el('h2', {}, '⚔ Siege of the Ledger'),
      el('p', { class: 'siege-intro' }, 'Your portfolio is your army. Trade between battles and bring down the enemy keep.'),
      this.#body,
    );
    this.#show();
  }

  get on(): boolean {
    return this.#on;
  }

  get match(): Match | null {
    return this.#matchPanel?.match ?? null;
  }

  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    if (!on) this.leave();
    this.#show();
    this.#opts.onChange?.(on);
  }

  /** What the castle view adds while the game is on: the enemy castle, the cleared ground, a quiet town. */
  extension(plan: CastlePlan): SceneExtension | undefined {
    if (!this.#on) return undefined;
    const sp = siegePlan(plan);
    this.#plan = sp;
    return {
      placements: sp.enemy,
      cleared: sp.cleared,
      reachZ: sp.field.z1 + 4,
      tints: { enemy: TEAM_COLORS.B, 'enemy-piece': TEAM_COLORS.B, 'enemy-keep': TEAM_COLORS.B },
      quiet: true,
    };
  }

  /** The castle view, each time it is built: the game's HUD goes over it. */
  attach(scene: MatchScene): void {
    this.#scene = scene;
    scene.element.append(this.#panel);
    if (this.#matchPanel) this.#matchPanel.attach(scene);
    else this.#setup.render();
    this.#show();
  }

  /** Starts a match from the setup's choice, on this town's battlefield. */
  start(choice: SetupChoice): Match {
    const seed = this.#opts.seed?.() ?? randomSeed();
    const match = new Match({
      seed,
      portfolios: [choice.draft.portfolio, opponentPortfolio(choice.draft, choice.archetype, choice.difficulty)],
      npc: [undefined, { archetype: choice.archetype, difficulty: choice.difficulty }],
      customAssets: choice.draft.customAssets,
      ...(this.#plan ? { map: this.#plan.map } : {}),
    });
    const f = this.#plan?.field;
    this.#matchPanel = new MatchPanel({ match, centre: f ? { x: 0, z: (f.z0 + f.z1) / 2 + 8 } : { x: 0, z: 30 }, onLeave: () => this.leave() });
    this.#body.replaceChildren(this.#matchPanel.element);
    if (this.#scene) this.#matchPanel.attach(this.#scene);
    return match;
  }

  /** Back to the setup (the match is dropped). */
  leave(): void {
    this.#matchPanel?.dispose();
    this.#matchPanel = null;
    this.#body.replaceChildren(this.#setup.element);
    // the keeps stand whole again
    if (this.#scene) showCastleDamage(this.#scene, [0, 0]);
    if (this.#on) this.#setup.render();
  }

  #show(): void {
    // the word hides on phones (siege.css), the icon stays
    this.button.replaceChildren(this.#on ? '🏰' : '⚔', el('span', { class: 'siege-word' }, this.#on ? ' Town' : ' Siege'));
    this.button.setAttribute('aria-pressed', String(this.#on));
    this.button.setAttribute('aria-label', this.#on ? 'Back to the town' : 'Siege of the Ledger');
    this.button.title = this.#on ? 'Back to the town' : 'Siege of the Ledger: your portfolio goes to war';
    this.#panel.hidden = !this.#on;
    this.#scene?.element.toggleAttribute('data-siege', this.#on);
  }
}

function randomSeed(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
