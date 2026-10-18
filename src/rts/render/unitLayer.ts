/**
 * The units on the map: one instanced mesh per unit type (Siege's baked
 * clips: idle, walk, attack, death), drawn between the last two ticks, the
 * team's colour on each; selection rings under the selected, and health bars
 * over the selected and the hurt.
 */

import * as THREE from 'three';
import { TEAM_COLORS } from '../../game/render/battleView.js';
import { UnitMesh } from '../../game/render/unitMeshes.js';
import type { UnitTypeId } from '../../game/core/types.js';
import { radiusOf, speedOf, type Unit } from '../core/units.js';
import type { RtsView } from './view.js';

const CAPACITY = 320;
/** Units drawn a little bigger than life, to read at an RTS camera's distance. */
const SCALE = 1.25;
const BAR_W = 1.1;

interface Anim {
  clip: string;
  time: number;
}

export class UnitLayer {
  readonly #view: RtsView;
  readonly #meshes = new Map<UnitTypeId, UnitMesh | 'loading' | null>();
  readonly #anim = new Map<number, Anim>();
  readonly #team = { A: new THREE.Color(TEAM_COLORS.A), B: new THREE.Color(TEAM_COLORS.B) };
  readonly #rings: THREE.InstancedMesh;
  readonly #barBack: THREE.InstancedMesh;
  readonly #barFill: THREE.InstancedMesh;
  readonly #m = new THREE.Matrix4();
  readonly #q = new THREE.Quaternion();
  readonly #v = new THREE.Vector3();
  readonly #s = new THREE.Vector3();
  readonly #c = new THREE.Color();

  constructor(view: RtsView) {
    this.#view = view;
    const ring = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
    this.#rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), CAPACITY);
    this.#rings.frustumCulled = false;
    this.#rings.renderOrder = 2;
    const bar = new THREE.PlaneGeometry(1, 1);
    this.#barBack = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0x2a2118, depthTest: false, transparent: true, opacity: 0.75 }), CAPACITY);
    this.#barFill = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), CAPACITY);
    for (const m of [this.#barBack, this.#barFill]) m.frustumCulled = false;
    // the fill over its backing
    this.#barBack.renderOrder = 5;
    this.#barFill.renderOrder = 6;
    // per-instance colours from the first frame (the shader is built with them)
    this.#rings.setColorAt(0, this.#c.set(0xffffff));
    this.#barFill.setColorAt(0, this.#c.set(0xffffff));
    for (const m of [this.#rings, this.#barBack, this.#barFill]) {
      m.count = 0;
      view.scene.add(m);
    }
  }

  /** Draws the units: `alpha` is how far the frame is between the last tick and the next (0–1). */
  draw(units: readonly Unit[], alpha: number, dt: number, selected: ReadonlySet<number>, me: string): void {
    const byType = new Map<UnitTypeId, Unit[]>();
    for (const u of units) {
      const list = byType.get(u.type);
      if (list) list.push(u);
      else byType.set(u.type, [u]);
    }
    for (const [type, list] of byType) {
      const mesh = this.#mesh(type);
      if (!mesh) continue;
      let i = 0;
      for (const u of list) {
        if (i >= CAPACITY) break;
        const a = this.#animate(u, mesh, dt);
        const x = u.px + (u.x - u.px) * alpha;
        const z = u.pz + (u.z - u.pz) * alpha;
        mesh.set(i++, x, z, u.face, a.clip, a.time, a.clip === 'walk' || a.clip === 'idle', this.#team[u.owner], 0, SCALE);
      }
      mesh.commit(i);
    }
    for (const [type, mesh] of this.#meshes) if (mesh && mesh !== 'loading' && !byType.has(type)) mesh.commit(0);
    // forget the animation clocks of units gone
    if (this.#anim.size > units.length + 50) {
      const live = new Set(units.map((u) => u.id));
      for (const id of this.#anim.keys()) if (!live.has(id)) this.#anim.delete(id);
    }

    // rings under the selected; bars over the selected and the hurt
    let r = 0;
    let b = 0;
    const cam = this.#view.camera;
    cam.getWorldQuaternion(this.#q);
    for (const u of units) {
      if (u.died >= 0) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const z = u.pz + (u.z - u.pz) * alpha;
      const sel = selected.has(u.id);
      if (sel && r < CAPACITY) {
        const rad = radiusOf(u.type) * 1.5;
        this.#m.compose(this.#v.set(x, 0.06, z), new THREE.Quaternion(), this.#s.set(rad, 1, rad));
        this.#rings.setMatrixAt(r, this.#m);
        this.#rings.setColorAt(r, this.#c.set(u.owner === me ? 0x7cf07c : 0xff6b5a));
        r++;
      }
      if ((sel || u.hp < u.maxHp) && b < CAPACITY) {
        const h = (1.6 + radiusOf(u.type) * 1.6) * SCALE;
        const frac = Math.max(0, u.hp / u.maxHp);
        this.#m.compose(this.#v.set(x, h, z), this.#q, this.#s.set(BAR_W, 0.14, 1));
        this.#barBack.setMatrixAt(b, this.#m);
        // the fill, from the bar's left end
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.#q);
        this.#m.compose(this.#v.set(x - right.x * (BAR_W * (1 - frac)) / 2, h, z - right.z * (BAR_W * (1 - frac)) / 2), this.#q, this.#s.set(BAR_W * frac, 0.1, 1));
        this.#barFill.setMatrixAt(b, this.#m);
        this.#barFill.setColorAt(b, this.#c.set(frac > 0.5 ? 0x5bd25b : frac > 0.25 ? 0xf2c14e : 0xe0452e));
        b++;
      }
    }
    this.#rings.count = r;
    this.#barBack.count = b;
    this.#barFill.count = b;
    for (const m of [this.#rings, this.#barBack, this.#barFill]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Starts loading the unit types that may come (the view draws them once loaded). */
  preload(types: readonly UnitTypeId[]): void {
    for (const t of types) this.#mesh(t);
  }

  #mesh(type: UnitTypeId): UnitMesh | null {
    const m = this.#meshes.get(type);
    if (m === 'loading' || m === null) return null;
    if (m) return m;
    this.#meshes.set(type, 'loading');
    void this.#view.load(`unit.${type}`).then((loaded) => {
      if (!loaded) {
        this.#meshes.set(type, null);
        return;
      }
      const mesh = new UnitMesh(loaded, CAPACITY);
      this.#view.scene.add(mesh.mesh);
      this.#meshes.set(type, mesh);
    });
    return null;
  }

  /** The clip a unit shows and its time in it. */
  #animate(u: Unit, mesh: UnitMesh, dt: number): Anim {
    let a = this.#anim.get(u.id);
    if (!a) {
      a = { clip: 'idle', time: (u.id * 0.37) % 1 };
      this.#anim.set(u.id, a);
    }
    const attackLen = mesh.clips.get('attack')?.duration ?? 0.8;
    const clip = u.died >= 0 ? 'death' : u.struck < attackLen ? 'attack' : u.moving ? 'walk' : 'idle';
    if (clip !== a.clip) {
      a.clip = clip;
      a.time = 0;
    }
    if (clip === 'death') a.time = u.died;
    else if (clip === 'attack') a.time = u.struck;
    // the walk clip faster for the faster units (their stride is about the same)
    else a.time += dt * (clip === 'walk' ? Math.max(0.7, speedOf(u.type) / 2.4) : 1);
    return a;
  }
}
