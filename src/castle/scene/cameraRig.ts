/**
 * The castle camera's angles, in plain numbers (no three.js, so it is easy to
 * test): which way the camera faces (yaw, a full turn round the point it looks
 * at) and how steeply it looks down (pitch, above the horizon). From them: where
 * the camera stands, which way is "away from the camera" on the ground, how a
 * drag on screen moves the ground, and how far back the camera must stand so
 * nothing in view is cut off. The functions write into an `out` object rather
 * than return a new one: they run every frame while the camera turns.
 */

/** Today's fixed view, kept as the default: the camera stands at (18, 20, 18) from what it looks at. */
const DEFAULT_OFFSET = { x: 18, y: 20, z: 18 };

/** The default angles: facing the castle from the town's corner, about 38° above the horizon. */
export const YAW_DEFAULT = Math.atan2(DEFAULT_OFFSET.x, DEFAULT_OFFSET.z);
export const PITCH_DEFAULT = Math.atan2(DEFAULT_OFFSET.y, Math.hypot(DEFAULT_OFFSET.x, DEFAULT_OFFSET.z));
/** How low and how high the camera may look down from: never flat along the ground, never straight down. */
export const PITCH_MIN = (25 * Math.PI) / 180;
export const PITCH_MAX = (75 * Math.PI) / 180;
/** The camera's distance from what it looks at, before standing further back (an orthographic camera: it changes nothing on screen). */
export const ORBIT_RADIUS = Math.hypot(DEFAULT_OFFSET.x, DEFAULT_OFFSET.y, DEFAULT_OFFSET.z);
/** How quickly the camera catches up with where it is turned to (per second; higher is snappier). */
export const TURN_RATE = 10;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** The camera's angles, in radians. Yaw is not wrapped (it may run past a full turn), so damping always takes the short way. */
export interface CameraAngles {
  yaw: number;
  pitch: number;
}

export function clampPitch(pitch: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
}

/** An angle brought into −π … π. */
export function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  const w = (((a + Math.PI) % turn) + turn) % turn;
  return w - Math.PI;
}

/** The yaw equal to `goal` (modulo a full turn) that is nearest `from`: the reset turns the short way. */
export function nearestYaw(from: number, goal: number): number {
  return from + wrapAngle(goal - from);
}

/** Where the camera stands, seen from what it looks at: `radius` metres along the angles. */
export function offsetFor(yaw: number, pitch: number, radius: number, out: Vec3): Vec3 {
  const flat = Math.cos(pitch) * radius;
  out.x = Math.sin(yaw) * flat;
  out.y = Math.sin(pitch) * radius;
  out.z = Math.cos(yaw) * flat;
  return out;
}

/** The ground direction away from the camera (what lies "behind" something, as seen). */
export function groundAhead(yaw: number, out: Vec2): Vec2 {
  out.x = -Math.sin(yaw);
  out.z = -Math.cos(yaw);
  return out;
}

/**
 * How far the ground moves for a drag of (dx, dy) pixels so the spot under the
 * finger stays under it: right on screen is the camera's right; up on screen is
 * away from the camera, stretched since the ground is seen at a slant.
 */
export function panDelta(dx: number, dy: number, metresPerPixel: number, angles: CameraAngles, out: Vec2): Vec2 {
  const rx = Math.cos(angles.yaw);
  const rz = -Math.sin(angles.yaw);
  const slant = 1 / Math.sin(angles.pitch);
  const fx = -Math.sin(angles.yaw) * slant;
  const fz = -Math.cos(angles.yaw) * slant;
  out.x = (-dx * rx + dy * fx) * metresPerPixel;
  out.z = (-dx * rz + dy * fz) * metresPerPixel;
  return out;
}

/** Whether a spot (relative to an object) lies behind that object, as seen: within `depth` metres away from the camera and `halfWidth` either side. */
export function isBehind(vx: number, vz: number, yaw: number, depth: number, halfWidth: number): boolean {
  const ax = -Math.sin(yaw);
  const az = -Math.cos(yaw);
  const along = vx * ax + vz * az;
  const across = Math.abs(vx * az - vz * ax);
  return along > 0 && along < depth && across < halfWidth;
}

/**
 * Moves the angles towards the target, smoothly (it slows as it arrives), and
 * lands exactly once close enough. Returns whether anything moved.
 */
export function dampAngles(current: CameraAngles, target: CameraAngles, dt: number, rate = TURN_RATE): boolean {
  const dy = target.yaw - current.yaw;
  const dp = target.pitch - current.pitch;
  if (dy === 0 && dp === 0) return false;
  const k = 1 - Math.exp(-dt * rate);
  current.yaw = Math.abs(dy) < 1e-4 ? target.yaw : current.yaw + dy * k;
  current.pitch = Math.abs(dp) < 1e-4 ? target.pitch : current.pitch + dp * k;
  // keep the numbers small after many turns: both move by the same whole turns
  const turns = Math.trunc(target.yaw / (Math.PI * 2));
  if (turns !== 0 && current.yaw === target.yaw) {
    target.yaw -= turns * Math.PI * 2;
    current.yaw = target.yaw;
  }
  return true;
}

/** Metres the scene can reach from where the camera looks: the land's far corner from the farthest the view pans. */
export const SCENE_REACH = 160;
/** The tallest things the scene may hold (landmarks), so their tops are not cut off near the camera. */
export const TALLEST = 40;

/**
 * How far back the camera stands from what it looks at. An orthographic camera
 * sees the same at any distance, but everything in view must be in front of it:
 * the ground at the bottom of the screen lies `halfHeight / tan(pitch)` towards
 * the camera, and a tall thing whose top shows there stands `TALLEST / sin(pitch)`
 * nearer still. Never less than `least`
 * (the usual stand), never more than the scene's reach needs.
 */
export function standBack(halfHeight: number, pitch: number, least: number): number {
  const reach = Math.min(SCENE_REACH, halfHeight / Math.tan(pitch) + TALLEST / Math.sin(pitch));
  return Math.max(least, reach + 2);
}
