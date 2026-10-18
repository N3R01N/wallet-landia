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
import type { Match, Replay } from '../core/match.js';
import { ReplayPanel } from './replayPanel.js';
import { MatchClient } from '../sim/matchClient.js';
import { siegePlan, type SiegePlan } from '../render/siegePlan.js';
import { TEAM_COLORS } from '../render/battleView.js';
import { opponentPortfolio } from '../setup/editor.js';
import { Guide } from './guide.js';
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
  readonly #guide = new Guide({ load: () => (this.#scene ? (name) => this.#scene!.stage().load(name) : null) });
  #replayPanel: ReplayPanel | null = null;

  constructor(opts: SiegeModeOptions) {
    this.#opts = opts;
    this.#on = opts.on ?? false;
    this.button = el('button', { class: 'btn siege-toggle', type: 'button', 'aria-pressed': 'false' });
    this.button.addEventListener('click', () => this.set(!this.#on));
    this.#setup = new SetupPanel({ wallets: opts.wallets, protocols: opts.protocols, onStart: (c) => this.start(c), onWatch: (r) => this.watch(r) });
    this.#body = el('div', { class: 'siege-body' }, this.#setup.element);
    const min = el('button', { class: 'btn siege-min', type: 'button', 'aria-label': 'Fold the panel', 'aria-expanded': 'true' }, '▾');
    min.addEventListener('click', () => {
      const folded = this.#panel.toggleAttribute('data-min');
      min.textContent = folded ? '▸' : '▾';
      min.setAttribute('aria-expanded', String(!folded));
    });
    const help = el('button', { class: 'btn siege-guide-open', type: 'button', 'aria-label': 'Open the guide' }, '? Guide');
    help.addEventListener('click', () => this.#guide.show());
    const howTo = el('button', { class: 'siege-link', type: 'button' }, 'New here? How to play');
    howTo.addEventListener('click', () => this.#guide.show('play'));
    this.#panel = el(
      'div',
      { class: 'siege-panel', role: 'region', 'aria-label': 'Siege of the Ledger' },
      min,
      help,
      el('h2', {}, '⚔ Siege of the Ledger'),
      el('p', { class: 'siege-intro' }, 'Your portfolio is your army. Trade between battles and bring down the enemy keep. ', howTo),
      this.#body,
    );
    // a unit's name anywhere in the panel opens the guide at that unit
    this.#panel.addEventListener('click', (e) => {
      const at = (e.target as HTMLElement).closest<HTMLElement>('[data-guide-unit]');
      if (at?.dataset.guideUnit) this.#guide.show('units', at.dataset.guideUnit);
    });
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
    if (this.#replayPanel) this.#replayPanel.attach(scene);
    else if (this.#matchPanel) this.#matchPanel.attach(scene);
    else this.#setup.render();
    this.#show();
  }

  /** Starts a match from the setup's choice, on this town's battlefield. */
  start(choice: SetupChoice): Match {
    const seed = this.#opts.seed?.() ?? randomSeed();
    const client = new MatchClient({
      seed,
      portfolios: [choice.draft.portfolio, opponentPortfolio(choice.draft, choice.archetype, choice.difficulty)],
      npc: [undefined, { archetype: choice.archetype, difficulty: choice.difficulty }],
      customAssets: choice.draft.customAssets,
      ...(this.#plan ? { map: this.#plan.map } : {}),
    });
    const f = this.#plan?.field;
    const match = client.replica;
    this.#matchPanel = new MatchPanel({ client, centre: f ? { x: 0, z: (f.z0 + f.z1) / 2 + 8 } : { x: 0, z: 30 }, onLeave: () => this.leave(), onWatch: (r) => this.watch(r) });
    this.#body.replaceChildren(this.#matchPanel.element);
    // Test hook (dev server only): an event's look on the town, without touching the match.
    if (import.meta.env.DEV) (window as unknown as { siegePreviewEvent?: (e: string | null) => void }).siegePreviewEvent = (e) => this.#matchPanel?.previewEvent(e);
    if (this.#scene) this.#matchPanel.attach(this.#scene);
    return match;
  }

  /** Watches a whole match again: every battle, rebuilt from its replay. */
  watch(replay: Replay): void {
    this.#matchPanel?.dispose();
    this.#matchPanel = null;
    this.#replayPanel?.dispose();
    this.#replayPanel = new ReplayPanel({ replay, onLeave: () => this.leave() });
    this.#body.replaceChildren(this.#replayPanel.element);
    if (this.#scene) this.#replayPanel.attach(this.#scene);
  }

  /** Back to the setup (the match or the replay is dropped). */
  leave(): void {
    this.#matchPanel?.dispose();
    this.#matchPanel = null;
    this.#replayPanel?.dispose();
    this.#replayPanel = null;
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
