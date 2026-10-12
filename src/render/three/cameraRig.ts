/**
 * The 3D view's orbit camera. One damping stage toward a goal (camera-direction
 * skill): input moves both goal and current at once (it must feel immediate);
 * focus and follow move only the goal and the camera glides there, frame-rate
 * independent.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W } from '../../world/layout.js';
import type { Sim } from '../../world/sim.js';

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
  readonly #target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  yaw = -0.55;
  #pitch = 0.85;
  /** Tiles from the target: the overlay sizes and hides what it draws by it. */
  distance = 62;
  readonly #goal = { target: new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2), distance: 62 };
  #follow: string | null = null;
  #followThen: string | null = null;
  // scratch for pan (input events): no garbage
  readonly #right = new THREE.Vector3();
  readonly #forward = new THREE.Vector3();

  /** The whole town in view; `aspect` the canvas's width over height. */
  fit(aspect: number): void {
    this.#follow = null;
    this.#goal.target.set(MAP_W / 2, 0, MAP_H / 2 + 1);
    this.#goal.distance = Math.min(110, 52 / Math.min(1, aspect / 1.4));
    this.yaw = -0.55;
    this.#pitch = 0.85;
    this.#target.copy(this.#goal.target);
    this.distance = this.#goal.distance;
  }

  /** Fixed views for visual validation. */
  bookmark(name: 'near' | 'design' | 'far', aspect: number): void {
    this.fit(aspect);
    if (name === 'near') {
      this.#goal.target.set(20, 0, 20);
      this.#goal.distance = 16;
      this.#pitch = 0.62;
    } else if (name === 'far') {
      this.#goal.distance = 110;
      this.#pitch = 1.1;
    }
    this.#target.copy(this.#goal.target);
    this.distance = this.#goal.distance;
  }

  pan(dx: number, dy: number): void {
    this.#follow = null;
    const f = this.distance * 0.0016;
    const right = this.#right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = this.#forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const t of [this.#target, this.#goal.target]) {
      t.addScaledVector(right, -dx * f).addScaledVector(forward, dy * f);
      t.x = Math.max(-5, Math.min(MAP_W + 5, t.x));
      t.z = Math.max(-5, Math.min(MAP_H + 5, t.z));
    }
  }

  zoom(factor: number): void {
    this.distance = Math.max(10, Math.min(130, this.distance / factor));
    this.#goal.distance = this.distance;
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.#pitch = Math.max(0.3, Math.min(1.45, this.#pitch + dy * 0.004));
  }

  /** Glide to a tile position, coming a little closer if far away. */
  focus(x: number, y: number): void {
    this.#goal.target.set(x, 0, y);
    this.#goal.distance = Math.min(this.#goal.distance, 34);
  }

  /** Who the camera keeps in view (null: no one). */
  get following(): string | null {
    return this.#follow;
  }

  /** Keep someone in view (an agent id or hero address); `then` once they have gone. Null to stop. */
  follow(key: string | null, then: string | null): void {
    this.#follow = key;
    this.#followThen = then;
    if (key !== null) this.#goal.distance = Math.min(this.#goal.distance, 30);
  }

  /** Put the camera somewhere at once: looking at (x, y) from `distance` tiles. */
  set(x: number, y: number, distance: number, yaw: number, pitch: number): void {
    this.#goal.target.set(x, 0, y);
    this.#target.copy(this.#goal.target);
    this.#goal.distance = this.distance = distance;
    this.yaw = yaw;
    this.#pitch = pitch;
  }

  /** A little shake for the big moments, separate from the camera's path. */
  shake(amount: number): void {
    if (amount > 0) this.#target.x += (Math.random() - 0.5) * amount * 0.08;
  }

  /** Follow, glide toward the goal, and place the camera for this frame. */
  place(dt: number, sim: Sim): void {
    if (this.#follow !== null) {
      let a = sim.findAgent(this.#follow);
      if (!a && this.#followThen !== null) {
        // the messenger has gone: back to the hero they came to
        this.#follow = this.#followThen;
        this.#followThen = null;
        a = sim.findAgent(this.#follow);
      }
      if (a) this.#goal.target.set(a.x, a.alt, a.y);
    }
    const k = 1 - Math.exp(-4 * Math.max(0, dt));
    this.#target.lerp(this.#goal.target, k);
    this.distance += (this.#goal.distance - this.distance) * k;
    const c = Math.cos(this.#pitch);
    this.camera.position.set(
      this.#target.x + Math.sin(this.yaw) * c * this.distance,
      this.#target.y + Math.sin(this.#pitch) * this.distance,
      this.#target.z + Math.cos(this.yaw) * c * this.distance,
    );
    this.camera.lookAt(this.#target);
  }
}
