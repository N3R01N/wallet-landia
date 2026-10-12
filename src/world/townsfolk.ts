/**
 * Townsfolk, and what anyone does with nothing to do: villagers wander from
 * door to door, drop in on shops, stop a passer-by for a chat and go home
 * when the streets are too full; bailiffs pace outside a risky loan's
 * Counting House; people in the tower's line face its door.
 */

import type { ActTask, Agent, Town } from './agents.js';
import { walkableAt } from './route.js';

export class Townsfolk {
  /** How many villagers the streets should hold (busier blocks bring more people out). */
  target = 10;
  readonly #town: Town;

  constructor(town: Town) {
    this.#town = town;
  }

  /** Villagers out in the streets (not in line, not indoors). */
  street(): number {
    let n = 0;
    for (const x of this.#town.agents()) if (x.kind === 'villager' && !x.queued && !x.inside) n++;
    return n;
  }

  /** A villager steps out: anywhere in town (the town opening), else out of a door or in at the gate. */
  spawn(anywhere: boolean): void {
    const town = this.#town;
    const plan = town.plan;
    const b = plan.buildings[Math.floor(town.rng() * plan.buildings.length)];
    if (!anywhere && b !== undefined && town.enterable(b) && town.rng() < 0.5) {
      // out of a door, into the street
      const at = town.doorway(b)!;
      const a = town.makeAgent('villager', at.x, at.y);
      a.inside = true;
      a.tasks = [{ type: 'exit', b }];
      town.addAgent(a);
      return;
    }
    const from = anywhere ? b?.doorAt : plan.gate.doorAt;
    if (from === undefined) return;
    town.addAgent(town.makeAgent('villager', from.x, from.y));
  }

  /** Someone with nothing left to do: what next. */
  idle(a: Agent): void {
    const town = this.#town;
    const plan = town.plan;
    a.journey = null;
    a.carrying = null;
    a.goods = [];
    if (a.loiterAt) {
      // pacing outside, waiting for the loan to slip
      const at = a.loiterAt;
      a.tasks = [{ type: 'walk', to: { x: at.x + (town.rng() - 0.5) * 1.4, y: at.y + town.rng() * 0.8 } }, { type: 'act', verb: 'unknown', seconds: 2 + town.rng() * 4 }];
      return;
    }
    if (a.queued) {
      // waiting their turn: face the tower
      const door = plan.tower.doorAt;
      if (Math.abs(door.x - a.x) > 0.05) a.facing = door.x > a.x ? 1 : -1;
      a.face = door;
      return;
    }
    if (a.kind === 'villager') {
      const b = plan.buildings[Math.floor(town.rng() * plan.buildings.length)];
      if (b === undefined || this.street() > this.target + 2) {
        // home time: in through the door they stand at, else away
        const here = a.slotAt !== null ? plan.buildings.find((x) => x.id === a.slotAt) : undefined;
        if (here !== undefined && town.enterable(here)) {
          a.tasks = [{ type: 'enter', b: here }, { type: 'vanish' }];
          return;
        }
        town.releaseSlot(a);
        a.gone = true;
        return;
      }
      if (town.rng() < 0.2 && this.#chat(a)) return;
      a.acting = null;
      if (town.enterable(b) && town.rng() < 0.65) {
        // in to shop (or pray, or bank), and out again
        a.tasks = [town.toDoor(b), { type: 'enter', b }, { type: 'act', verb: 'wait', seconds: 2 + town.rng() * 7 }, { type: 'exit', b }];
        return;
      }
      // a look at the door, a knock, a word with whoever is inside
      const act: ActTask = { type: 'act', verb: 'unknown', seconds: 0.5 + town.rng() * 2, face: { x: b.doorAt.x, y: b.y + b.h - 0.5 } };
      if (town.rng() < 0.5) act.gesture = 'interact';
      a.tasks = [town.toDoor(b), act];
    }
  }

  /** Stop a passer-by for a chat: walk up, face each other, talk a while. */
  #chat(a: Agent): boolean {
    const town = this.#town;
    const mate = town.agents().find((o) => o !== a && o.kind === 'villager' && !o.queued && !o.inside && o.doorway === null && o.acting === null && o.path.length > 0 && o.alt === 0 && Math.hypot(o.x - a.x, o.y - a.y) < 4);
    if (mate === undefined) return false;
    const d = Math.hypot(a.x - mate.x, a.y - mate.y);
    if (d < 0.1) return false;
    const spot = { x: mate.x + ((a.x - mate.x) / d) * 0.5, y: mate.y + ((a.y - mate.y) / d) * 0.5 };
    if (!walkableAt(town.plan, spot)) return false;
    const talk = 3 + town.rng() * 4;
    const travel = d / a.speed + 0.6;
    town.releaseSlot(mate);
    mate.path = [];
    mate.tasks = [
      { type: 'act', verb: 'wait', seconds: travel, face: spot },
      { type: 'act', verb: 'talk', seconds: talk, gesture: 'talk', face: spot },
    ];
    a.tasks = [{ type: 'walk', to: spot }, { type: 'act', verb: 'talk', seconds: talk, gesture: 'talk', face: { x: mate.x, y: mate.y } }];
    bubble(town, mate, talk, travel);
    bubble(town, a, talk, travel + 0.6);
    return true;
  }
}

/** A speech bubble over someone's head while they talk. */
export function bubble(town: Town, a: Agent, seconds: number, delay: number): void {
  const words = ['…', '!', '?', '♪', '$', '☺'];
  town.addEffect({ kind: 'bubble', x: a.x, y: a.y, age: 0, ttl: delay + seconds, delay, drama: 0, fromAgent: a.id, text: words[Math.floor(town.rng() * words.length)]! });
}
