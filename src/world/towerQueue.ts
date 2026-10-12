/**
 * The line at the Chronicle Tower's door: transactions waiting for a page in
 * the next block. It grows and shrinks with how congested the real chain is,
 * the front goes in when a block is sealed, and people in it chat to pass the
 * time.
 */

import { WALK_SPEED, type Agent, type Town } from './agents.js';
import type { Pt, TownPlan } from './layout.js';
import { walkRoute } from './route.js';
import { bubble } from './townsfolk.js';

/** The longest the line at the tower gets (people). */
const QUEUE_MAX = 18;

export class TowerQueue {
  /** The line, front first. */
  readonly line: Agent[] = [];
  /** Where the line stands: spots along the road from the tower door, front first. */
  readonly spots: Pt[];
  #timer = 0;
  #chatTimer = 2;
  readonly #town: Town;

  constructor(town: Town) {
    this.#town = town;
    this.spots = lineFromTower(town.plan);
  }

  /** How long the line should be: a couple of people when the chain is calm, the whole street when blocks are full. */
  target(congestion: number): number {
    return Math.min(this.spots.length, Math.round(2 + congestion * (QUEUE_MAX - 2)));
  }

  /** Send each person in line to their spot (after the front went in, or someone joined). */
  place(): void {
    this.line.forEach((a, i) => {
      const spot = this.spots[i];
      if (spot === undefined) return;
      const goal = a.tasks[0]?.type === 'walk' ? a.tasks[0].to : a.path.at(-1);
      if (goal && Math.hypot(goal.x - spot.x, goal.y - spot.y) < 0.05) return;
      if (a.path.length === 0 && Math.hypot(a.x - spot.x, a.y - spot.y) < 0.05) return;
      a.path = [];
      a.acting = null;
      a.tasks = [{ type: 'walk', to: spot }];
    });
  }

  /** Someone joins the back of the line, starting from `at`. */
  join(at: Pt): void {
    const town = this.#town;
    const a = town.makeAgent('villager', at.x, at.y);
    a.queued = true;
    a.speed = WALK_SPEED * (0.9 + town.rng() * 0.25);
    town.addAgent(a);
    this.line.push(a);
  }

  /** A block sealed: the front of the line goes in (more of it when the block was full). */
  admit(busy: number): void {
    const tower = this.#town.plan.tower;
    const n = Math.min(this.line.length, Math.max(1, Math.round(this.line.length * (0.35 + busy * 0.3))));
    for (const a of this.line.splice(0, n)) {
      a.queued = false;
      a.path = [];
      a.acting = null;
      a.tasks = [{ type: 'walk', to: tower.doorAt }, { type: 'enter', b: tower }, { type: 'vanish' }];
    }
    this.place();
  }

  /** Keep the line as long as the chain is busy: newcomers join at the back, the tail drifts away when it calms. */
  tend(dtReal: number, congestion: number): void {
    const town = this.#town;
    const plan = town.plan;
    const line = this.line;
    for (let i = line.length - 1; i >= 0; i--) if (line[i]!.gone) line.splice(i, 1);
    // a long wait: now and then someone turns to chat with the one behind
    this.#chatTimer -= dtReal;
    if (this.#chatTimer <= 0 && line.length >= 3) {
      this.#chatTimer = 1.5 + town.rng() * 3;
      const i = 1 + Math.floor(town.rng() * (line.length - 2));
      const q = line[i]!;
      const mate = line[i + 1]!;
      if (q.path.length === 0 && q.acting === null && mate.path.length === 0) {
        const seconds = 2.5 + town.rng() * 3;
        q.acting = { verb: 'talk', left: seconds, total: seconds, gesture: 'talk' };
        q.face = { x: mate.x, y: mate.y };
        bubble(town, q, seconds, 0);
      }
    }
    const target = this.target(congestion);
    this.#timer -= dtReal;
    if (line.length < target && this.#timer <= 0) {
      // from the gate or any street door, they come to wait their turn
      const from = town.rng() < 0.5 ? plan.gate.doorAt : (plan.buildings[Math.floor(town.rng() * plan.buildings.length)]?.doorAt ?? plan.gate.doorAt);
      this.join(from);
      this.place();
      this.#timer = 0.35 + town.rng() * 0.6;
    } else if (line.length > target + 2) {
      const a = line.pop()!;
      a.queued = false;
      a.path = [];
      a.tasks = [{ type: 'walk', to: plan.gate.doorAt }, { type: 'vanish' }];
    }
  }
}

/** Spots for the line: along the walk from the tower door towards the gate, a step apart. */
function lineFromTower(plan: TownPlan): Pt[] {
  const door = plan.tower.doorAt;
  const route = walkRoute(plan, door, plan.gate.doorAt);
  const pts = [door, ...route];
  const out: Pt[] = [];
  const STEP = 0.42;
  let want = 0.7; // the first one stands a little off the door
  let walked = 0;
  for (let i = 0; i < pts.length - 1 && out.length < QUEUE_MAX; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    while (want <= walked + len && out.length < QUEUE_MAX) {
      const f = (want - walked) / len;
      // a little to either side, as people stand in a real line
      const side = (out.length % 2 === 0 ? 1 : -1) * 0.1;
      out.push({ x: a.x + (b.x - a.x) * f - ((b.y - a.y) / len) * side, y: a.y + (b.y - a.y) * f + ((b.x - a.x) / len) * side });
      want += STEP;
    }
    walked += len;
  }
  return out;
}
