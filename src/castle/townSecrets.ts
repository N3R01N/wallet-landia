/**
 * Lore, secrets and rare moments in the castle view (docs/ENGAGEMENT.md,
 * track C), wired between the page and the scene: the townsfolk's lore, the
 * wishing well, the monuments and the old wanderer, the golden and the ghost
 * couriers, the shooting star. The rules are in world/lore.ts, world/secrets.ts
 * and world/rare.ts; the 3D in scene/wonders.ts.
 */

import type { CastleView } from './scene/castleView.js';
import type { Person } from './scene/life.js';
import type { Placement } from './scene/plan.js';
import { Wonders } from './scene/wonders.js';
import { Storyteller } from './world/lore.js';
import { biggestErrand, courierLook } from './world/rare.js';
import { MONUMENTS, SECRETS, TapCounter, WANDERER_LINES, WISHES, findSecret, foundSecrets, landmarksOf, monumentOf, secretPlacements, type SecretId } from './world/secrets.js';
import { isNight } from './world/sky.js';
import type { CastleWorld, Errand } from './world/world.js';
import type { MomentId } from '../domain/moments.js';

export interface SecretsHost {
  /** The scene's hour now (a pinned one, or the player's clock). */
  hour(): number;
  /** A secret was found for the first time: tell the player. */
  found(text: string): void;
  /** The wish's sound. */
  wish(): void;
}

/** What is known of the guild's whole kept history (the player's profile, at home). */
type Lifetime = { moments?: readonly MomentId[]; firstAt: number | null };

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export class TownSecrets {
  readonly #host: SecretsHost;
  readonly #teller = new Storyteller();
  readonly #well = new TapCounter();
  #view: CastleView | null = null;
  #wonders: Wonders | null = null;
  #biggest: Errand | null = null;

  constructor(host: SecretsHost) {
    this.#host = host;
  }

  /** What a townsperson says: now and then, tapped, a line of lore. */
  say(who: Person, tapped: boolean, chatter: () => string): string {
    return this.#teller.say(who, tapped, chatter);
  }

  /** A new scene: its rare moments and what the guild has to show in it (`home`: your own guild, whose moments are your secrets). */
  attach(view: CastleView, world: CastleWorld, lifetime: Lifetime | null, home: boolean): void {
    this.#wonders?.dispose();
    this.#view = view;
    this.#wonders = new Wonders(view.stage());
    this.#biggest = biggestErrand(world.errands);
    this.show(world, lifetime, home);
  }

  /** The monuments and the wanderer the guild has earned (again as more history arrives). */
  show(world: CastleWorld, lifetime: Lifetime | null, home: boolean): void {
    const view = this.#view;
    if (!view) return;
    const marks = landmarksOf({ errands: world.errands, lifetime, now: Date.now() });
    if (home) for (const id of marks.moments) this.#find(id);
    // on the dev server, `?landmarks=all` shows every monument and the wanderer (to look at the models)
    const all = import.meta.env.DEV && new URLSearchParams(location.search).get('landmarks') === 'all';
    void view.addPlacements(secretPlacements(view.plan, all ? { moments: ['dao-year', 'ens-airdrop', 'merge'], wanderer: true } : marks));
  }

  /** Couriers: gold for the biggest errand, a ghost for a failed one at night. */
  dress(errand: Errand, courier: Parameters<Wonders['dress']>[0]): void {
    this.#wonders?.dress(courier, courierLook(errand, { biggest: this.#biggest?.key ?? null, night: isNight(this.#host.hour()) }));
  }

  /** The well, a monument or the wanderer tapped: what they say. */
  tapped(p: Placement): string | null {
    if (p.name === 'prop.well') {
      if (!this.#well.tap(performance.now() / 1000)) return null;
      this.#wonders?.dropCoin(p);
      this.#host.wish();
      this.#find('wishing-well');
      return pick(WISHES);
    }
    if (p.key === 'wanderer') {
      this.#find('old-wanderer');
      return pick(WANDERER_LINES);
    }
    const moment = monumentOf(p.key);
    return moment ? MONUMENTS[moment].says : null;
  }

  /** A followed wallet moved: a shooting star. */
  shootingStar(): boolean {
    return this.#wonders?.shootingStar() ?? false;
  }

  /** Test hook: the biggest errand's key, and how the couriers out are dressed. */
  test(): { biggest: string | null; looks: ReturnType<Wonders['looks']> } {
    return { biggest: this.#biggest?.key ?? null, looks: this.#wonders?.looks() ?? [] };
  }

  /** Test hook: sends the biggest errand's courier out now, and follows it (false: none). */
  sendBiggest(): boolean {
    if (!this.#view || !this.#biggest) return false;
    this.#view.sendNow(this.#biggest);
    this.#view.follow(this.#biggest);
    return true;
  }

  #find(id: SecretId): void {
    if (!findSecret(id)) return;
    const s = SECRETS.find((x) => x.id === id)!;
    const n = Object.keys(foundSecrets()).length;
    this.#host.found(`Secret found: ${s.name} (${n} of ${SECRETS.length})`);
  }
}
