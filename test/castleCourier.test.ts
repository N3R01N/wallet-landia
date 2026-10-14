import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, NPC_CLIP, buildCourierScript, courierAt } from '../src/castle/scene/courier.js';
import type { Waypoint } from '../src/castle/scene/plan.js';

const ROUTE: Waypoint[] = [
  { x: 0, z: -3 },
  { x: 0, z: 1.8, stop: 'toll' },
  { x: 0, z: 7 },
  { x: -2, z: 7, stop: 'hand-over' },
];
const BARRIER_Z = 2.5;
const script = buildCourierScript(ROUTE);
/** Every state over one cycle, a frame at a time. */
const frames = Array.from({ length: Math.ceil(script.duration * 60) }, (_, i) => ({ t: i / 60, ...courierAt(script, i / 60, BARRIER_Z) }));

describe('courier errand', () => {
  it('starts and ends at the gate, and repeats', () => {
    expect(courierAt(script, 0, BARRIER_Z)).toMatchObject({ x: 0, z: -3, clip: 'idle' });
    const a = courierAt(script, 3.3, BARRIER_Z);
    const b = courierAt(script, 3.3 + script.duration, BARRIER_Z);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });

  it('the bridge is down from setting out until the courier is home, then rises', () => {
    expect(courierAt(script, 0, BARRIER_Z).bridgeDown).toBe(true); // lowering before setting out
    expect(courierAt(script, script.duration - 0.1, BARRIER_Z).bridgeDown).toBe(false); // rising behind
    // whenever the courier is on the bridge (z −2 … 0), the bridge is down
    for (const f of frames.filter((f) => f.z > -2 && f.z < 0)) expect(f.bridgeDown, `t=${f.t}`).toBe(true);
  });

  it('pays the toll at the barrier before it lifts; never walks through a lowered barrier', () => {
    const tolls = frames.filter((f) => f.clip === 'toll');
    expect(tolls.length).toBeGreaterThan(0);
    expect(tolls[0]!.barrierUp).toBe(false); // still down as the courier starts to pay
    expect(tolls[tolls.length - 1]!.barrierUp).toBe(true); // up once paid
    // walking across the toll line (either way) only with the barrier up
    for (const f of frames.filter((f) => f.clip === 'walk' && Math.abs(f.z - BARRIER_Z) < 0.3)) expect(f.barrierUp, `t=${f.t}`).toBe(true);
    // on the way out, before paying, the barrier stays down
    const firstToll = tolls[0]!.t;
    for (const f of frames.filter((f) => f.t < firstToll)) expect(f.barrierUp, `t=${f.t}`).toBe(false);
  });

  it('at the door the person comes out, takes the goods while the courier hands them over, then goes back in', () => {
    const order = frames.map((f) => f.npc).filter((n, i, all) => i === 0 || n !== all[i - 1]);
    expect(order).toEqual(['hidden', 'emerge', 'receive', 'return', 'hidden']);
    const emerging = frames.filter((f) => f.npc === 'emerge');
    for (const f of emerging) expect(f.clip).toBe('idle'); // the courier waits while the person comes out
    expect(frames.some((f) => f.npc === 'receive' && f.clip === 'hand-over')).toBe(true);
    expect(emerging.length / 60).toBeCloseTo(NPC_CLIP, 1);
  });

  it('walks at the set speed and faces where it goes', () => {
    const out = frames.find((f) => f.clip === 'walk' && f.z > 3 && f.z < 6 && f.t < script.duration / 2)!;
    expect(out.heading).toBeCloseTo(0); // towards the town
    const home = frames.find((f) => f.clip === 'walk' && f.z > 3 && f.z < 6 && f.t > script.duration / 2)!;
    expect(Math.abs(home.heading)).toBeCloseTo(Math.PI); // back towards the castle
    // one step: no faster than the speed
    for (let i = 1; i < frames.length; i++) {
      const d = Math.hypot(frames[i]!.x - frames[i - 1]!.x, frames[i]!.z - frames[i - 1]!.z);
      expect(d).toBeLessThanOrEqual(DEFAULT_TIMING.speed / 60 + 1e-6);
    }
  });

  it('carries its goods from the gate until the person has taken them, and comes home empty-handed', () => {
    expect(frames[0]!.carrying).toBe(true);
    const handed = frames.findIndex((f) => !f.carrying);
    expect(frames[handed]!.npc).toBe('receive');
    expect(frames[handed]!.clip).toBe('hand-over');
    for (const f of frames.slice(handed)) expect(f.carrying).toBe(false);
  });

  it('incoming: the person at the door hands goods over, and the courier brings them home without a toll', () => {
    const inbound = buildCourierScript(ROUTE, DEFAULT_TIMING, 'in');
    const f = Array.from({ length: Math.ceil(inbound.duration * 60) }, (_, i) => ({ t: i / 60, ...courierAt(inbound, i / 60, BARRIER_Z) }));
    expect(f[0]).toMatchObject({ x: -2, z: 7, npc: 'emerge', carrying: false }); // starts at the door
    expect(f.some((x) => x.clip === 'toll')).toBe(false);
    const got = f.findIndex((x) => x.carrying);
    expect(f[got]!.npc).toBe('receive');
    for (const x of f.slice(got)) expect(x.carrying).toBe(true);
    // passes the barrier only with it up, and ends at the gate as the bridge rises
    for (const x of f.filter((x) => x.clip === 'walk' && Math.abs(x.z - BARRIER_Z) < 0.3)) expect(x.barrierUp).toBe(true);
    expect(f[f.length - 1]).toMatchObject({ x: 0, z: -3, bridgeDown: false });
  });

  it('incoming from outside the town: no one at a door, the goods come from the far end', () => {
    const inbound = buildCourierScript([{ x: 0, z: -3 }, { x: 0, z: 1.8, stop: 'toll' }, { x: 0, z: 10 }], DEFAULT_TIMING, 'in');
    expect(courierAt(inbound, 0, BARRIER_Z)).toMatchObject({ z: 10, carrying: true, npc: 'hidden' });
  });

  it('inside the castle: along the walls at the wall-walk’s height, the bridge stays up, no toll, goods handed over at the other tower', () => {
    const walls: Waypoint[] = [{ x: -8, z: -8 }, { x: -8, z: -14 }, { x: 8, z: -14, stop: 'hand-over' }];
    const inside = buildCourierScript(walls, DEFAULT_TIMING, 'inside', { height: 3 });
    expect(inside.height).toBe(3);
    const f = Array.from({ length: Math.ceil(inside.duration * 60) }, (_, i) => courierAt(inside, i / 60, BARRIER_Z));
    expect(f.every((x) => !x.bridgeDown && !x.barrierUp && x.npc === 'hidden' && x.clip !== 'toll')).toBe(true);
    expect(f[0]!.carrying).toBe(true);
    expect(f[f.length - 1]).toMatchObject({ x: 8, z: -14, carrying: false, clip: 'hand-over' });
  });

  it('a failed transaction: pays at the barrier, is refused, goes home with its goods; the barrier never lifts', () => {
    const failed = buildCourierScript(ROUTE, DEFAULT_TIMING, 'out', { failed: true });
    const f = Array.from({ length: Math.ceil(failed.duration * 60) }, (_, i) => courierAt(failed, i / 60, BARRIER_Z));
    expect(f.some((x) => x.refused)).toBe(true);
    expect(f.some((x) => x.clip === 'toll')).toBe(true);
    expect(f.every((x) => !x.barrierUp && x.carrying && x.npc === 'hidden')).toBe(true);
    expect(Math.max(...f.map((x) => x.z))).toBeLessThan(BARRIER_Z); // never past the barrier
    expect(f[f.length - 1]).toMatchObject({ x: 0, z: -3, bridgeDown: false }); // home, the bridge rising
  });

  it('an empty route stands still', () => {
    expect(courierAt(buildCourierScript([]), 5, BARRIER_Z)).toMatchObject({ clip: 'idle', npc: 'hidden' });
  });
});
