import { describe, expect, it } from 'vitest';
import {
  ORBIT_RADIUS,
  PITCH_DEFAULT,
  PITCH_MAX,
  PITCH_MIN,
  SCENE_REACH,
  YAW_DEFAULT,
  clampPitch,
  dampAngles,
  groundAhead,
  isBehind,
  nearestYaw,
  offsetFor,
  panDelta,
  standBack,
  wrapAngle,
} from '../src/castle/scene/cameraRig.js';

const deg = (d: number) => (d * Math.PI) / 180;

describe('castle camera rig', () => {
  it('the default angles are the old fixed view, (18, 20, 18), about 38° above the horizon', () => {
    const o = offsetFor(YAW_DEFAULT, PITCH_DEFAULT, ORBIT_RADIUS, { x: 0, y: 0, z: 0 });
    expect(o.x).toBeCloseTo(18);
    expect(o.y).toBeCloseTo(20);
    expect(o.z).toBeCloseTo(18);
    expect((PITCH_DEFAULT * 180) / Math.PI).toBeCloseTo(38.2, 0);
  });

  it('turning half way round puts the camera on the other side', () => {
    const o = offsetFor(YAW_DEFAULT + Math.PI, PITCH_DEFAULT, ORBIT_RADIUS, { x: 0, y: 0, z: 0 });
    expect(o.x).toBeCloseTo(-18);
    expect(o.y).toBeCloseTo(20);
    expect(o.z).toBeCloseTo(-18);
  });

  it('tilt stays between 25° and 75°', () => {
    expect(clampPitch(0)).toBe(PITCH_MIN);
    expect(clampPitch(Math.PI / 2)).toBe(PITCH_MAX);
    expect(clampPitch(deg(50))).toBe(deg(50));
    expect((PITCH_MIN * 180) / Math.PI).toBeCloseTo(25);
    expect((PITCH_MAX * 180) / Math.PI).toBeCloseTo(75);
  });

  it('wraps angles into −π … π and turns back the short way', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(deg(370))).toBeCloseTo(deg(10));
    expect(wrapAngle(deg(-190))).toBeCloseTo(deg(170));
    // three quarters round from the default: back is a quarter turn on, not three back
    const from = YAW_DEFAULT + deg(270);
    expect(nearestYaw(from, YAW_DEFAULT) - from).toBeCloseTo(deg(90));
  });

  it('panning matches the old fixed view at the default angles', () => {
    // the old code: right = (O.z, 0, −O.x) normalised; ahead = −O's ground direction, stretched by |O| / O.y
    const O = { x: 18, y: 20, z: 18 };
    const flat = Math.hypot(O.x, O.z);
    const len = Math.hypot(O.x, O.y, O.z);
    const rx = O.z / flat;
    const rz = -O.x / flat;
    const slant = len / O.y;
    const fx = -O.x / flat;
    const fz = -O.z / flat;
    const [dx, dy, mpp] = [12, -7, 0.05];
    const d = panDelta(dx, dy, mpp, { yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT }, { x: 0, z: 0 });
    expect(d.x).toBeCloseTo((-dx * rx + dy * fx * slant) * mpp);
    expect(d.z).toBeCloseTo((-dx * rz + dy * fz * slant) * mpp);
  });

  it('panning follows the angle: dragging down from straight behind moves the view away from the camera', () => {
    // camera due south (+z), looking north: a drag down on screen pulls the ground towards you, the view moves north (−z)
    const d = panDelta(0, 10, 1, { yaw: 0, pitch: Math.PI / 2 - 1e-9 }, { x: 0, z: 0 });
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-10);
    // a drag right moves the view west (−x): the ground follows the finger
    const r = panDelta(10, 0, 1, { yaw: 0, pitch: deg(45) }, { x: 0, z: 0 });
    expect(r.x).toBeCloseTo(-10);
    expect(r.z).toBeCloseTo(0);
  });

  it('“behind” is away from the camera, whichever way it faces', () => {
    // camera to the south (+z): north of the tower (−z) is behind it
    expect(isBehind(0, -5, 0, 12, 2)).toBe(true);
    expect(isBehind(0, 5, 0, 12, 2)).toBe(false);
    expect(isBehind(3, -5, 0, 12, 2)).toBe(false); // off to the side
    expect(isBehind(0, -13, 0, 12, 2)).toBe(false); // too far
    // turned half round: now south is behind
    expect(isBehind(0, 5, Math.PI, 12, 2)).toBe(true);
    const a = groundAhead(Math.PI / 2, { x: 0, z: 0 });
    expect(a.x).toBeCloseTo(-1);
    expect(a.z).toBeCloseTo(0);
  });

  it('damping eases towards the target, lands on it, and reports when it moved', () => {
    const cur = { yaw: 0, pitch: PITCH_DEFAULT };
    const target = { yaw: 1, pitch: PITCH_MAX };
    expect(dampAngles(cur, target, 1 / 60)).toBe(true);
    expect(cur.yaw).toBeGreaterThan(0);
    expect(cur.yaw).toBeLessThan(1);
    for (let i = 0; i < 300; i++) dampAngles(cur, target, 1 / 60);
    expect(cur).toEqual(target);
    expect(dampAngles(cur, target, 1 / 60)).toBe(false);
  });

  it('after many turns the angles come back to small numbers, both alike', () => {
    const cur = { yaw: 0, pitch: PITCH_DEFAULT };
    const target = { yaw: deg(3 * 360 + 30), pitch: PITCH_DEFAULT };
    for (let i = 0; i < 600; i++) dampAngles(cur, target, 1 / 60);
    expect(target.yaw).toBeCloseTo(deg(30));
    expect(cur.yaw).toBe(target.yaw);
  });

  it('the camera stands back far enough for a zoomed-out, low view, within the scene’s reach', () => {
    const usual = ORBIT_RADIUS * 4;
    // the default view at zoom 1 needs no more than the usual stand
    expect(standBack(13, PITCH_DEFAULT, usual)).toBe(usual);
    // zoomed far out on a tall phone, looking low: the near ground and tall landmarks stay in front of the camera
    const half = 90;
    const back = standBack(half, PITCH_MIN, usual);
    expect(back).toBeGreaterThan(usual);
    expect(back).toBeLessThanOrEqual(SCENE_REACH + 2);
    expect(back).toBeGreaterThanOrEqual(Math.min(SCENE_REACH, half / Math.tan(PITCH_MIN)));
  });
});
