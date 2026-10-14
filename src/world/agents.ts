/**
 * The people of the town (heroes, couriers, townsfolk, bailiffs), what they
 * can be asked to do, and the effects they leave behind; plus what the parts
 * of the living town that move them (`townsfolk.ts`) may ask
 * of the Sim that owns them.
 */

import type { Hero, Journey, JourneyStep, Verb } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import type { Placed, Pt, TownPlan } from './layout.js';

export type AgentKind = 'hero' | 'raven' | 'villager' | 'herald' | 'bailiff';

/** Something a person does with their hands while busy (rigged people play it; sprites hop). */
export type Gesture = 'talk' | 'interact' | 'pickup' | 'cheer' | 'push';

/** Goods as they are drawn changing hands: a coin with the token's logo (or the NFT's picture). */
export interface Coin {
  symbol: string;
  quantity: number;
  icon: string | null;
  nft: boolean;
}

/**
 * `toll`, `give`, `seize`: paying, delivering, seizing. `stash`: putting what
 * was brought home inside. `pickup`: catching what is handed out of a door.
 * `talk` and `wait`: townsfolk passing the time.
 */
export type ActVerb = Verb | 'toll' | 'give' | 'seize' | 'stash' | 'pickup' | 'talk' | 'wait';

export interface ActTask {
  type: 'act';
  verb: ActVerb;
  seconds: number;
  journey?: Journey;
  /** The step of the journey done here: what is handed over, and what comes back. */
  step?: JourneyStep;
  /** Business at this building's door: it opens, and goods pass through it. */
  door?: Placed;
  gesture?: Gesture;
  /** Who or what to look at meanwhile. */
  face?: Pt;
  /** Goods handed out of this building's door to the agent. */
  pickup?: { coins: Coin[]; from: Placed };
  /** Seeing a crossing off from the harbour, bound for this realm (a chain id, '?' unknown). */
  sail?: string;
}

export type Task =
  /** `door`: arriving at a building, so claim a free waiting spot there. */
  | { type: 'walk'; to: Pt; fly?: boolean; door?: Placed }
  | ActTask
  /** Go in through the door (handing `give` in on the way), out of sight until `exit`. */
  | { type: 'enter'; b: Placed; give?: Coin[] }
  | { type: 'exit'; b: Placed }
  /** Markers: through the doorway (in, or out). */
  | { type: 'inside' }
  | { type: 'outside' }
  | { type: 'vanish' };

export interface Agent {
  id: string;
  kind: AgentKind;
  hero?: Hero;
  x: number;
  y: number;
  path: Pt[];
  tasks: Task[];
  acting: { verb: string; left: number; total: number; gesture?: Gesture; door?: string } | null;
  facing: 1 | -1;
  /** Inside a building, out of sight (trading at the counter, shopping, waiting for a page in the tower). */
  inside: boolean;
  /** The building whose doorway this agent is passing through (its door stands open meanwhile). */
  doorway: string | null;
  /** What is in hand: drawn as coins over the head while out and about. */
  goods: Coin[];
  /** Where to look while standing still (someone to talk to, the tower door), or null. */
  face: Pt | null;
  speed: number;
  flying: boolean;
  /** Height above the ground, in tiles (flyers in the air). */
  alt: number;
  /** Height it keeps when not flying: griffins and dragons hover low over the road. */
  hover: number;
  /** Hangs about here (bailiffs watching a risky loan's Counting House). */
  loiterAt?: Pt;
  /** The door this agent is waiting at, if any (see door slots). */
  slotAt: string | null;
  /** Value tier of what is being carried right now, or null when empty-handed. */
  carrying: Tier | null;
  journey: Journey | null;
  /** What of that journey is being done right now: -1 the toll, else the step's index (undefined: neither). */
  actStep?: number;
  /** Recent positions, so a caravan can follow the leader. */
  trail: Pt[];
  phase: number;
  dim: boolean;
  gone: boolean;
}

export type EffectKind = 'float' | 'coins' | 'ring' | 'smoke' | 'key' | 'sparkle' | 'alarm' | 'storm' | 'transfer' | 'bubble';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  age: number;
  ttl: number;
  text?: string;
  color?: string;
  drama: number;
  /** transfer: where the coins land; they follow `toAgent` (and leave from `fromAgent`) while it is about. bubble: who speaks. */
  to?: Pt;
  toAgent?: string;
  fromAgent?: string;
  /** transfer: what changes hands. */
  coins?: Coin[];
  /** transfer: `in` handed over (dropped off), `out` handed back (picked up). */
  dir?: 'in' | 'out';
  /** Seconds before it shows (the age counts from when it was made). */
  delay?: number;
  /** bubble: held in full (a phrase to read), not blinked on and off. */
  sticky?: boolean;
  /** Bailiffs seizing (coins, transfer): drawn and heard as a loss, not a payment. */
  seized?: boolean;
}

/** Tiles per second on foot: a brisk walk (~2.2 m/s); a hero with errands piling up hurries. */
export const WALK_SPEED = 1.2;

/**
 * The Sim, as the parts that move its people see it. Everything random comes
 * from its one generator, in the order the town was always played, so the
 * same town plays the same way (tests rely on it).
 */
export interface Town {
  readonly plan: TownPlan;
  rng(): number;
  /** Everyone in town now (the Sim replaces this list as people leave). */
  agents(): readonly Agent[];
  addAgent(a: Agent): void;
  /** A new person (not yet in town: `addAgent`). */
  makeAgent(kind: AgentKind, x: number, y: number): Agent;
  addEffect(e: Effect): void;
  releaseSlot(a: Agent): void;
  /** Walk (or fly) to a building's door and wait at a free spot there. */
  toDoor(b: Placed, fly?: boolean): Task;
  /** Can townsfolk drop in here? */
  enterable(b: Placed): boolean;
  doorway(b: Placed): Pt | null;
}
