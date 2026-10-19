/**
 * The fights' effects (Siege's models, render/battleFx.ts): arrows and spell
 * bolts flown from the shooter, sparks where blows land, siege impacts on
 * buildings, the wallet hall's arrows, a puff where a unit falls, and a
 * detonation where a building comes down.
 */

import * as THREE from 'three';
import { UNIT_TYPES } from '../../game/core/catalog.js';
import { BattleFx } from '../../game/render/battleFx.js';
import { BUILDINGS } from '../data/rules.js';
import type { World, WorldEvent } from '../core/world.js';
import type { RtsView } from './view.js';
import { groundHeight } from '../core/map.js';

/** Unit types that cast rather than shoot. */
export const CASTERS = new Set(['mage.swap', 'mage.battle', 'lender.ghost', 'construct']);

export class FightFx {
  readonly #fx: BattleFx;
  readonly #world: World;
  /** Buildings by id as they last stood (a fallen one is gone from the world). */
  readonly #seen = new Map<number, { x: number; z: number; f: number }>();

  constructor(view: RtsView, world: World) {
    this.#world = world;
    this.#fx = new BattleFx(view.stage());
    void this.#fx.load();
  }

  handle(events: readonly WorldEvent[]): void {
    const w = this.#world;
    // heights over what is walked on (a bridge's deck)
    const g = (x: number, z: number) => groundHeight(w.map, x, z);
    for (const b of w.buildings) this.#seen.set(b.id, { x: b.x, z: b.z, f: BUILDINGS[b.kind].footprint });
    for (const e of events) {
      if (e.t === 'strike') {
        const from = w.units.find((u) => u.id === e.from);
        const type = from ? UNIT_TYPES[from.type]! : null;
        const building = this.#seen.get(e.target);
        if (e.ranged && from) {
          this.#fx.shoot(CASTERS.has(from.type) ? 'fx.bolt' : 'fx.arrow', new THREE.Vector3(e.fromX, 1.4 + g(e.fromX, e.fromZ), e.fromZ), new THREE.Vector3(e.toX, 1.1 + g(e.toX, e.toZ), e.toZ));
        } else if (building && type?.role === 'siege') this.#fx.burst('fx.siege.impact', e.toX, 0.5, e.toZ, Math.atan2(e.fromX - e.toX, e.fromZ - e.toZ));
        else this.#fx.burst('fx.hit.spark', e.toX, 1.1 + g(e.toX, e.toZ), e.toZ, 0, e.crit ? 1.6 : 1);
      } else if (e.t === 'hallShot') {
        const hall = this.#seen.get(e.from);
        const v = w.units.find((u) => u.id === e.target);
        if (hall && v) this.#fx.shoot('fx.arrow', new THREE.Vector3(hall.x, 5, hall.z), new THREE.Vector3(v.x, 1.1 + g(v.x, v.z), v.z));
      } else if (e.t === 'death') {
        const u = w.units.find((x) => x.id === e.id);
        if (u) this.#fx.burst(u.type === 'swarm.frog' ? 'fx.detonation' : 'fx.puff', u.x, 0.4 + g(u.x, u.z), u.z, 0, u.type === 'swarm.frog' ? 0.5 : 0.8);
      } else if (e.t === 'ability' && e.ability === 'swap-enemies') {
        const u = w.units.find((x) => x.id === e.id);
        if (u) this.#fx.burst('fx.lightning', u.x, g(u.x, u.z), u.z, 0, 0.6);
      } else if (e.t === 'destroyed') {
        const b = this.#seen.get(e.id);
        if (b) {
          this.#fx.burst('fx.detonation', b.x, 1, b.z, 0, b.f / 3);
          this.#fx.burst('fx.puff', b.x, 0.5, b.z, 0, b.f / 2);
        }
        this.#seen.delete(e.id);
      }
    }
  }

  dispose(): void {
    this.#fx.dispose();
  }
}
