/**
 * The courier's errand as a timeline, with no WebGL: the drawbridge lowers,
 * the courier crosses it, pays the toll at the barrier, walks to a building's
 * door, the building's person comes out and takes the goods, and the courier
 * walks home; the bridge rises behind it. The view asks where everything is at
 * a moment in the cycle.
 */

import type { Waypoint } from './plan.js';

export type CourierClip = 'idle' | 'walk' | 'toll' | 'hand-over';
export type NpcClip = 'hidden' | 'emerge' | 'receive' | 'return';

interface Walk {
  kind: 'walk';
  from: { x: number; z: number };
  to: { x: number; z: number };
  start: number;
  end: number;
}

interface Wait {
  kind: 'wait';
  at: { x: number; z: number };
  /** What the courier is waiting for. */
  tag: 'gate-open' | 'toll' | 'refused' | 'hand-over' | 'gate-close';
  start: number;
  end: number;
}

type Leg = Walk | Wait;

export interface CourierScript {
  legs: Leg[];
  /** Seconds for one whole errand; the cycle repeats. */
  duration: number;
  /**
   * Out: leaves the castle with goods. In: fetches goods from the town and brings
   * them home. Inside: carries goods from one wallet's tower to another's along the walls.
   */
  direction: 'out' | 'in' | 'inside';
  /** A failed transaction: turned back at the barrier. */
  failed: boolean;
  /** How high the courier walks (0 on the ground; the wall-walk for errands inside the castle). */
  height: number;
  /** When the courier turns for home (the end of the way out). */
  turn: number;
}

export interface ScriptOptions {
  /** Turned back at the barrier (a failed transaction): pays, is refused, goes home. */
  failed?: boolean;
  /** How high the route runs (plan.ts WALL_WALK for errands inside the castle). */
  height?: number;
}

export interface Timing {
  /** Metres a second. */
  speed: number;
  /** Seconds the bridge takes to lower before the courier sets out, and to rise after. */
  gate: number;
  toll: number;
  /** Seconds at the door: the person comes out (emerge), then takes the goods (receive). */
  handOver: number;
}

export const DEFAULT_TIMING: Timing = { speed: 3, gate: 1.2, toll: 1.25, handOver: 3 };

/** Seconds of the person's emerge and return clips (as delivered: 1.25 s). */
export const NPC_CLIP = 1.25;

/**
 * The errand along a route (plan.ts routeTo). Out: from the gate, the toll, the
 * door (the person takes the goods), and home. In: it starts at the door (the
 * person hands goods over), or at the town's far end for goods from outside,
 * and walks home without a toll: the sender paid it.
 */
export function buildCourierScript(
  route: readonly Waypoint[],
  timing: Timing = DEFAULT_TIMING,
  direction: 'out' | 'in' | 'inside' = 'out',
  options: ScriptOptions = {},
): CourierScript {
  const failed = options.failed === true && direction === 'out';
  const height = options.height ?? 0;
  const legs: Leg[] = [];
  let t = 0;
  const wait = (at: Waypoint, tag: Wait['tag'], seconds: number) => {
    legs.push({ kind: 'wait', at: { x: at.x, z: at.z }, tag, start: t, end: t + seconds });
    t += seconds;
  };
  const walk = (from: Waypoint, to: Waypoint) => {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    if (d === 0) return;
    const seconds = d / timing.speed;
    legs.push({ kind: 'walk', from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, start: t, end: t + seconds });
    t += seconds;
  };
  const first = route[0];
  const last = route[route.length - 1];
  if (!first || !last) return { legs, duration: 0, direction, failed, height, turn: 0 };

  if (direction === 'inside') {
    // Along the walls to the other tower, hand the goods over there: no gate, no toll, no way back.
    for (let i = 1; i < route.length; i++) walk(route[i - 1]!, route[i]!);
    wait(last, 'hand-over', timing.handOver);
    return { legs, duration: t, direction, failed, height, turn: t };
  }

  if (failed) {
    // Out to the barrier, pays, is refused: home again with the goods.
    wait(first, 'gate-open', timing.gate);
    const toll = route.findIndex((p) => p.stop === 'toll');
    const stop = toll === -1 ? route.length - 1 : toll;
    for (let i = 1; i <= stop; i++) walk(route[i - 1]!, route[i]!);
    wait(route[stop]!, 'refused', timing.toll * 2);
    const turn = t;
    for (let i = stop; i > 0; i--) walk(route[i]!, route[i - 1]!);
    wait(first, 'gate-close', timing.gate);
    return { legs, duration: t, direction, failed, height, turn };
  }

  if (direction === 'out') {
    wait(first, 'gate-open', timing.gate);
    // Out: stop where the route says (the toll, the door).
    for (let i = 1; i < route.length; i++) {
      walk(route[i - 1]!, route[i]!);
      const stop = route[i]!.stop;
      if (stop === 'toll') wait(route[i]!, 'toll', timing.toll);
      if (stop === 'hand-over') wait(route[i]!, 'hand-over', timing.handOver);
    }
  } else if (last.stop === 'hand-over') {
    wait(last, 'hand-over', timing.handOver); // the person comes out with the goods
  }
  const turn = t;
  // Home by the same way, without stopping: the toll is paid by whoever sends.
  for (let i = route.length - 1; i > 0; i--) walk(route[i]!, route[i - 1]!);
  wait(first, 'gate-close', timing.gate);
  return { legs, duration: t, direction, failed, height, turn };
}

export interface CourierState {
  x: number;
  z: number;
  /** Facing, radians about the vertical axis (0 = towards +z, the town). */
  heading: number;
  clip: CourierClip;
  /** The drawbridge should be down: while the courier sets out, crosses, or is out in the town. */
  bridgeDown: boolean;
  /** The barrier should be up: after the toll is paid, and while the courier passes it. */
  barrierUp: boolean;
  npc: NpcClip;
  /** The courier still carries its goods: from the gate until the person at the door has taken them. */
  carrying: boolean;
  /** Turned back at the barrier just now (the refusal shows). */
  refused: boolean;
}

/** Where things are at `time` seconds (any number: the errand repeats). `barrierZ` is the toll line. */
export function courierAt(script: CourierScript, time: number, barrierZ: number): CourierState {
  if (script.legs.length === 0 || script.duration <= 0) {
    return { x: 0, z: 0, heading: 0, clip: 'idle', bridgeDown: false, barrierUp: false, npc: 'hidden', carrying: false, refused: false };
  }
  const t = ((time % script.duration) + script.duration) % script.duration;
  const index = script.legs.findIndex((l) => t < l.end);
  const leg = script.legs[index === -1 ? script.legs.length - 1 : index]!;

  let x: number;
  let z: number;
  let clip: CourierClip;
  if (leg.kind === 'walk') {
    const f = (t - leg.start) / Math.max(1e-9, leg.end - leg.start);
    x = leg.from.x + (leg.to.x - leg.from.x) * f;
    z = leg.from.z + (leg.to.z - leg.from.z) * f;
    clip = 'walk';
  } else {
    x = leg.at.x;
    z = leg.at.z;
    const local = t - leg.start;
    clip =
      leg.tag === 'toll' || (leg.tag === 'refused' && local < NPC_CLIP)
        ? 'toll'
        : leg.tag === 'hand-over'
          ? local < NPC_CLIP && script.direction !== 'inside'
            ? 'idle'
            : 'hand-over'
          : 'idle';
  }

  const heading = headingAt(script, index === -1 ? script.legs.length - 1 : index);
  // Inside the castle nothing crosses the moat: the bridge stays up.
  const bridgeDown = script.direction !== 'inside' && !(leg.kind === 'wait' && leg.tag === 'gate-close');
  // The barrier lifts once the toll is half paid, and for every pass after that (on the way home too),
  // never for a courier still walking up to pay.
  const tollIndex = script.legs.findIndex((l) => l.kind === 'wait' && l.tag === 'toll');
  const here = index === -1 ? script.legs.length - 1 : index;
  const paid = leg.kind === 'wait' && leg.tag === 'toll' && t - leg.start > (leg.end - leg.start) / 2;
  const passing = !script.failed && script.direction !== 'inside' && leg.kind === 'walk' && (tollIndex === -1 || here > tollIndex) && Math.abs(z - barrierZ) < 1.2;
  const barrierUp = paid || passing;
  const stay = script.legs.find((l): l is Wait => l.kind === 'wait' && l.tag === 'hand-over');
  // Out: the goods go to the person at the door (or, for someone outside, at the far end).
  // In: the person hands them over, or a stranger's goods come from the far end.
  // A refused courier keeps its goods; inside the castle they go to the other tower at the hand-over.
  const carrying = script.failed
    ? true
    : script.direction === 'in'
      ? stay
        ? t >= handedAt(stay)
        : true
      : t < (stay ? (script.direction === 'inside' ? stay.start + 0.6 : handedAt(stay)) : script.turn);
  const refused = leg.kind === 'wait' && leg.tag === 'refused' && t - leg.start >= NPC_CLIP;
  // only a building's person comes out: not at a tower
  const npc = script.direction === 'inside' ? 'hidden' : npcAt(script, t);
  return { x, z, heading, clip, bridgeDown, barrierUp, npc, carrying, refused };
}

/** The moment the goods change hands: halfway through the hand-over clip, after the person has come out. */
function handedAt(stay: Wait): number {
  return stay.start + NPC_CLIP + Math.min(0.6, (stay.end - stay.start - NPC_CLIP) / 2);
}

/** The building's person: comes out as the courier arrives, takes the goods, goes back in as it leaves. */
function npcAt(script: CourierScript, t: number): NpcClip {
  const stay = script.legs.find((l): l is Wait => l.kind === 'wait' && l.tag === 'hand-over');
  if (!stay) return 'hidden';
  if (t >= stay.start && t < stay.start + NPC_CLIP) return 'emerge';
  if (t >= stay.start + NPC_CLIP && t < stay.end) return 'receive';
  if (t >= stay.end && t < stay.end + NPC_CLIP) return 'return';
  return 'hidden';
}

/** Facing along the current walk, or the last walk before a wait. */
function headingAt(script: CourierScript, index: number): number {
  for (let i = index; i >= 0; i--) {
    const l = script.legs[i]!;
    if (l.kind === 'walk') return Math.atan2(l.to.x - l.from.x, l.to.z - l.from.z);
  }
  return 0;
}
