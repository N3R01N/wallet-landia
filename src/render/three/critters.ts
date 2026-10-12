/**
 * Small life about town: flocks of birds wheeling over the roofs by day,
 * butterflies tumbling over the lawns, fireflies blinking in the grass at
 * night, and pigeons the Chronicle bell startles off the roofs round the tower.
 * Four draw calls at most (three instanced meshes and a point cloud), moved
 * on the CPU from smooth curves, so they cost next to nothing.
 */

import * as THREE from 'three';
import { makeRng } from '../../util/rng.js';
import { MAP_H, MAP_W, tileAt, type TownPlan } from '../../world/layout.js';
import { radialTexture } from './scenery.js';

const FLOCKS = 3;
const PER_FLOCK = 7;
const BUTTERFLIES = 14;
const FIREFLIES = 90;
const PIGEONS = 12;
/** Seconds from take-off to landing again. */
const FLIGHT = 7;

/** A gull seen from below: a little body and two swept wings (the wing tips rise and fall with the flap). */
function birdGeometry(): THREE.BufferGeometry {
  const v = [
    // left wing, right wing (tips at y = 0.12, so scaling y flaps them)
    -0.38, 0.12, -0.06, 0, 0, 0.1, 0, 0, -0.08,
    0, 0, 0.1, 0.38, 0.12, -0.06, 0, 0, -0.08,
    // body
    0, 0.01, 0.18, -0.04, 0, -0.16, 0.04, 0, -0.16,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Two wings meeting at the body, hinged so a y-scale folds them up. */
function butterflyGeometry(): THREE.BufferGeometry {
  const v = [-0.09, 0.05, 0.03, 0, 0, 0.04, 0, 0, -0.04, -0.09, 0.05, 0.03, 0, 0, -0.04, -0.07, 0.04, -0.06, 0.09, 0.05, 0.03, 0, 0, -0.04, 0, 0, 0.04, 0.09, 0.05, 0.03, 0.07, 0.04, -0.06, 0, 0, -0.04];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Where the pigeons sit (roof tops near the tower, tiles; y up) and the tower they circle. */
export interface Roosts {
  spots: { x: number; y: number; z: number }[];
  tower: { x: number; z: number; top: number };
}

interface Pigeon {
  /** Its roof, its circle (radius, height over the tower top), which way round, when it goes. */
  spot: { x: number; y: number; z: number };
  r: number;
  h: number;
  dir: number;
  delay: number;
  phase: number;
}

interface Flutter {
  x: number;
  y: number;
  /** Phases and rates of its wander (radians, rad/s). */
  p: [number, number, number];
  r: [number, number];
}

export class Critters {
  readonly group = new THREE.Group();
  /** For the image pipeline: additive points must stay out of ambient occlusion. */
  readonly glow: THREE.Points;
  readonly #birds: THREE.InstancedMesh;
  readonly #flies: THREE.InstancedMesh;
  readonly #flocks: { cx: number; cz: number; rx: number; rz: number; h: number; speed: number; phase: number }[] = [];
  readonly #butterflies: Flutter[] = [];
  readonly #fireflies: Flutter[] = [];
  readonly #glowColors: Float32Array;
  readonly #pigeonMesh: THREE.InstancedMesh | null = null;
  readonly #pigeons: Pigeon[] = [];
  readonly #tower: Roosts['tower'] | null = null;
  /** When the bell last startled them (sim seconds), or null: they sit. */
  #flushedAt: number | null = null;
  #p = new THREE.Vector3();
  readonly #m = new THREE.Matrix4();
  readonly #q = new THREE.Quaternion();
  readonly #e = new THREE.Euler();
  readonly #v = new THREE.Vector3();
  readonly #s = new THREE.Vector3();
  #day = 1;
  #dark = 0;

  constructor(plan: TownPlan, roosts: Roosts | null = null) {
    const rng = makeRng(777);
    this.group.name = 'critters';
    this.#birds = new THREE.InstancedMesh(birdGeometry(), new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.8, side: THREE.DoubleSide }), FLOCKS * PER_FLOCK);
    this.#birds.frustumCulled = false;
    for (let i = 0; i < FLOCKS; i++) {
      this.#flocks.push({ cx: MAP_W * (0.3 + rng() * 0.4), cz: MAP_H * (0.3 + rng() * 0.4), rx: 9 + rng() * 10, rz: 7 + rng() * 8, h: 9.5 + rng() * 4, speed: (0.12 + rng() * 0.08) * (rng() < 0.5 ? -1 : 1), phase: rng() * 6.3 });
    }
    // lawns: where butterflies and fireflies keep to
    const lawn: [number, number][] = [];
    for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) if (tileAt(plan, x, y) === 'grass' && plan.buildings.every((b) => x < b.x - 1 || x > b.x + b.w || y < b.y - 1 || y > b.y + b.h)) lawn.push([x + 0.5, y + 0.5]);
    const spot = (): [number, number] => lawn[Math.floor(rng() * lawn.length)] ?? [MAP_W / 2, MAP_H / 2];
    const flutter = (): Flutter => {
      const [x, y] = spot();
      return { x, y, p: [rng() * 6.3, rng() * 6.3, rng() * 6.3], r: [0.3 + rng() * 0.4, 0.25 + rng() * 0.4] };
    };
    for (let i = 0; i < BUTTERFLIES; i++) this.#butterflies.push(flutter());
    for (let i = 0; i < FIREFLIES; i++) this.#fireflies.push(flutter());

    this.#flies = new THREE.InstancedMesh(butterflyGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), BUTTERFLIES);
    this.#flies.frustumCulled = false;
    const wings = ['#f2c14e', '#f7f3e8', '#e8743b', '#9fc7f0', '#f5a0c8'];
    const col = new THREE.Color();
    for (let i = 0; i < BUTTERFLIES; i++) this.#flies.setColorAt(i, col.set(wings[i % wings.length]!));

    const pos = new Float32Array(FIREFLIES * 3);
    this.#glowColors = new Float32Array(FIREFLIES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.#glowColors, 3));
    this.glow = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, map: radialTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.glow.frustumCulled = false;
    this.glow.name = 'fireflies';
    this.group.add(this.#birds, this.#flies, this.glow);

    // pigeons: seeded apart from the rest, so the others stay as they were
    if (roosts && roosts.spots.length > 0) {
      const prng = makeRng(4242);
      this.#tower = roosts.tower;
      for (let i = 0; i < PIGEONS; i++) {
        this.#pigeons.push({ spot: roosts.spots[i % roosts.spots.length]!, r: 2.5 + prng() * 3.5, h: 1.2 + prng() * 2.2, dir: i % 3 === 0 ? -1 : 1, delay: prng() * 0.5, phase: prng() * 6.3 });
      }
      this.#pigeonMesh = new THREE.InstancedMesh(birdGeometry(), new THREE.MeshStandardMaterial({ color: '#8d929c', roughness: 0.85, side: THREE.DoubleSide }), PIGEONS);
      this.#pigeonMesh.frustumCulled = false;
      this.#pigeonMesh.visible = false;
      this.#pigeonMesh.name = 'pigeons';
      this.group.add(this.#pigeonMesh);
    }
  }

  /** The bell rang (`t`: sim seconds): the pigeons take off, circle the tower and settle again. */
  flush(t: number): void {
    this.#flushedAt = t;
  }

  /** `night` 0..1; `gloom` 0..1 (birds and butterflies take shelter from the storm). */
  update(t: number, dt: number, night: number, gloom: number): void {
    // fade in and out with the light rather than pop
    const k = 1 - Math.exp(-dt * 0.8);
    this.#day += ((night < 0.45 && gloom < 0.55 ? 1 : 0) - this.#day) * k;
    this.#dark += ((night > 0.55 && gloom < 0.7 ? 1 : 0) - this.#dark) * k;
    this.#updateBirds(t);
    this.#updateButterflies(t);
    this.#updateFireflies(t);
    this.#updatePigeons(t);
  }

  /** Where pigeon `p` is `s` seconds into its flight: up off its roof, round the tower, and back down. */
  #pigeonAt(p: Pigeon, s: number, out: THREE.Vector3): THREE.Vector3 {
    const c = this.#tower!;
    const a0 = Math.atan2(p.spot.z - c.z, p.spot.x - c.x);
    // whole laps, so it comes round to its own roof as it lands
    const a = a0 + p.dir * ((s / FLIGHT) * Math.PI * 4 + Math.sin(s * 1.3 + p.phase) * 0.15);
    const up = THREE.MathUtils.smoothstep(s, 0, 1.4) * (1 - THREE.MathUtils.smoothstep(s, FLIGHT - 1.8, FLIGHT));
    const cy = c.top + p.h + Math.sin(s * 1.7 + p.phase) * 0.4;
    out.set(c.x + Math.cos(a) * p.r, cy, c.z + Math.sin(a) * p.r);
    // from the roof to the circle and back; a little hop up as they leave
    out.x = p.spot.x + (out.x - p.spot.x) * up;
    out.z = p.spot.z + (out.z - p.spot.z) * up;
    out.y = p.spot.y + (out.y - p.spot.y) * up + Math.sin(Math.min(1, s / 1.4) * Math.PI) * 0.6 * (s < 1.4 ? 1 : 0);
    return out;
  }

  #updatePigeons(t: number): void {
    const mesh = this.#pigeonMesh;
    if (mesh === null) return;
    // (a clock that went back, a new sim's, ends the flight)
    if (this.#flushedAt !== null && t < this.#flushedAt) this.#flushedAt = null;
    const since = this.#flushedAt === null ? Infinity : t - this.#flushedAt;
    mesh.visible = since >= 0 && since < FLIGHT + 0.6;
    if (!mesh.visible) return;
    this.#pigeons.forEach((p, i) => {
      const s = Math.max(0, Math.min(FLIGHT, since - p.delay));
      // they appear as they lift off the roof and fold away as they land (perched, they are part of the roof)
      const size = 0.75 * Math.min(1, s / 0.25, (FLIGHT - s) / 0.35);
      const at = this.#pigeonAt(p, s, this.#v);
      const ahead = this.#pigeonAt(p, Math.min(FLIGHT, s + 0.05), this.#p);
      const yaw = Math.atan2(ahead.x - at.x, ahead.z - at.z);
      const flap = s < 1.6 || s > FLIGHT - 1.6 ? Math.sin(t * 18 + i * 2.3) : Math.sin(t * 11 + i * 1.7) > -0.2 ? Math.sin(t * 13 + i) : 0.35;
      this.#q.setFromEuler(this.#e.set(0, yaw, -0.35 * p.dir));
      this.#m.compose(at, this.#q, this.#s.set(size, size * flap * 1.6, size));
      mesh.setMatrixAt(i, this.#m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  #updateBirds(t: number): void {
    const shown = this.#day > 0.02;
    this.#birds.visible = shown;
    if (!shown) return;
    let i = 0;
    for (const f of this.#flocks) {
      // the flock wheels round a loose loop over the town, rising and dipping
      const a = f.phase + t * f.speed;
      const fx = f.cx + Math.cos(a) * f.rx;
      const fz = f.cz + Math.sin(a * 1.3) * f.rz;
      const vx = -Math.sin(a) * f.rx * f.speed;
      const vz = Math.cos(a * 1.3) * f.rz * 1.3 * f.speed;
      const yaw = Math.atan2(vx, vz);
      const bank = Math.max(-0.5, Math.min(0.5, Math.sin(a * 1.3) * 0.4 * Math.sign(f.speed)));
      for (let b = 0; b < PER_FLOCK; b++) {
        // a loose V behind the leader, each bird wandering a little in it
        const row = Math.ceil(b / 2);
        const side = b === 0 ? 0 : b % 2 === 0 ? 1 : -1;
        const lx = side * row * 0.9 + Math.sin(t * 0.7 + b * 1.9) * 0.3;
        const lz = -row * 0.8 + Math.cos(t * 0.5 + b * 2.3) * 0.3;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const x = fx + lx * cy + lz * sy;
        const z = fz - lx * sy + lz * cy;
        const y = f.h + Math.sin(t * 0.6 + b) * 0.5 + Math.sin(a * 2) * 1.2;
        // flap in bursts, then glide
        const glide = Math.sin(t * 0.9 + b * 1.7) > 0.3;
        const flap = glide ? 0.35 : Math.sin(t * 13 + b * 2.1);
        const size = 1.1 * this.#day;
        this.#q.setFromEuler(this.#e.set(0, yaw, bank));
        this.#m.compose(this.#v.set(x, y, z), this.#q, this.#s.set(size, size * flap * 1.6, size));
        this.#birds.setMatrixAt(i++, this.#m);
      }
    }
    this.#birds.instanceMatrix.needsUpdate = true;
  }

  #updateButterflies(t: number): void {
    const shown = this.#day > 0.02;
    this.#flies.visible = shown;
    if (!shown) return;
    this.#butterflies.forEach((f, i) => {
      // a tumbling wander round its patch of lawn, never far from it
      const x = f.x + Math.sin(t * f.r[0] + f.p[0]) * 1.4 + Math.sin(t * f.r[1] * 2.3 + f.p[1]) * 0.5;
      const z = f.y + Math.cos(t * f.r[1] + f.p[1]) * 1.4 + Math.cos(t * f.r[0] * 1.7 + f.p[2]) * 0.5;
      const y = 0.45 + Math.abs(Math.sin(t * 1.3 + f.p[2])) * 0.6 + Math.sin(t * 7 + i) * 0.05;
      const yaw = Math.atan2(Math.cos(t * f.r[0] + f.p[0]) * f.r[0], -Math.sin(t * f.r[1] + f.p[1]) * f.r[1]);
      const flap = Math.sin(t * 22 + i * 1.3);
      const size = 1.6 * this.#day;
      this.#q.setFromEuler(this.#e.set(0, yaw, 0));
      this.#m.compose(this.#v.set(x, y, z), this.#q, this.#s.set(size, size * flap * 1.8, size));
      this.#flies.setMatrixAt(i, this.#m);
    });
    this.#flies.instanceMatrix.needsUpdate = true;
  }

  #updateFireflies(t: number): void {
    const shown = this.#dark > 0.02;
    this.glow.visible = shown;
    if (!shown) return;
    const pos = this.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    this.#fireflies.forEach((f, i) => {
      arr[i * 3] = f.x + Math.sin(t * f.r[0] * 0.5 + f.p[0]) * 1.2;
      arr[i * 3 + 1] = 0.3 + Math.abs(Math.sin(t * f.r[1] * 0.4 + f.p[1])) * 1.1;
      arr[i * 3 + 2] = f.y + Math.cos(t * f.r[1] * 0.5 + f.p[2]) * 1.2;
      // each blinks on its own slow beat: a soft pulse, then dark for a while
      const beat = Math.sin(t * (1.1 + f.r[0]) + f.p[2] * 3);
      const on = Math.max(0, beat - 0.35) / 0.65;
      const b = on * on * this.#dark * 2.2;
      this.#glowColors[i * 3] = 0.85 * b;
      this.#glowColors[i * 3 + 1] = 1.0 * b;
      this.#glowColors[i * 3 + 2] = 0.35 * b;
    });
    pos.needsUpdate = true;
    this.glow.geometry.getAttribute('color').needsUpdate = true;
  }
}
