/**
 * Ledger Wars' 3D view: the map (ground, river, bridges, scenery), the
 * buildings in their owners' colours and levels, a placement ghost, a
 * selection ring, and an RTS camera (WASD or arrows or middle-drag to pan,
 * the wheel to zoom, Q/E to turn). It draws what the World says; it changes
 * nothing in it.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Loaded, ModelLibrary } from '../../castle/assets/models.js';
import { showTierParts } from '../../castle/scene/castleView.js';
import { TEAM_COLORS } from '../../game/render/battleView.js';
import { BUILDINGS, type BuildingKind, type PlayerId } from '../data/rules.js';
import type { Building, World } from '../core/world.js';

interface Shown {
  obj: THREE.Object3D;
  model: string;
  level: number;
}

const PITCH_MIN = 0.55;
const PITCH_MAX = 1.35;
const DIST_MIN = 18;
const DIST_MAX = 140;

/** The model a building shows at its level, and the tier parts (`tier.2/4/6`) within it. */
export function buildingModel(kind: BuildingKind, level: number): { model: string; tier: number } {
  const r = BUILDINGS[kind];
  const model = r.models[Math.min(level, r.models.length) - 1]!;
  // a hall's tiers are its models; other buildings show their tier parts as they rise
  return { model, tier: kind === 'hall' ? 0 : [0, 2, 4, 6][Math.min(level, 4) - 1]! };
}

export class RtsView {
  readonly canvas = document.createElement('canvas');
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
  readonly #library: ModelLibrary;
  readonly #loaded = new Map<string, Loaded | null>();
  readonly #fit = new Map<string, { scale: number; lift: number }>();
  readonly #shown = new Map<number, Shown>();
  readonly #mixers: THREE.AnimationMixer[] = [];
  readonly #frame: ((dt: number) => void)[] = [];
  readonly #target = new THREE.Vector3(0, 0, 50);
  #dist = 70;
  #yaw = 0;
  #pitch = 0.95;
  readonly #keys = new Set<string>();
  #ghost: THREE.Group | null = null;
  #ghostKind: BuildingKind | null = null;
  readonly #ring: THREE.Mesh;
  readonly #timer = new THREE.Timer();
  #disposed = false;
  readonly #ray = new THREE.Raycaster();
  readonly #groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly #sun: THREE.DirectionalLight;

  constructor(library: ModelLibrary) {
    this.#library = library;
    this.canvas.className = 'rts-canvas';
    this.canvas.tabIndex = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x9cbfd4);
    this.scene.fog = new THREE.Fog(0x9cbfd4, 160, 420);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x8a6e4b, 1));
    this.#sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    this.#sun.castShadow = true;
    this.#sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.#sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
    this.scene.add(this.#sun, this.#sun.target);
    const ring = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);
    this.#ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.#ring.visible = false;
    this.#ring.renderOrder = 2;
    this.scene.add(this.#ring);
    this.#bindInput();
    this.renderer.setAnimationLoop((now: number) => this.#loop(now));
  }

  /** Called every frame with its seconds. Returns the way to stop. */
  onFrame(fn: (dt: number) => void): () => void {
    this.#frame.push(fn);
    return () => {
      const i = this.#frame.indexOf(fn);
      if (i >= 0) this.#frame.splice(i, 1);
    };
  }

  async load(name: string): Promise<Loaded | null> {
    if (!this.#loaded.has(name)) this.#loaded.set(name, await this.#library.load(name).catch(() => null));
    return this.#loaded.get(name) ?? null;
  }

  /** The ground, the river and the scenery; then the buildings. */
  async build(world: World): Promise<void> {
    const size = world.map.size;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7fae4a, roughness: 1 }));
    grass.receiveShadow = true;
    grass.name = 'ground';
    const beyond = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d9a44, roughness: 1 }));
    beyond.position.y = -0.05;
    this.scene.add(beyond, grass);
    const names = [...new Set(world.map.scenery.map((s) => s.name))];
    await Promise.all(names.map((n) => this.load(n)));
    for (const s of world.map.scenery) {
      const loaded = this.#loaded.get(s.name);
      if (!loaded) continue;
      const obj = loaded.scene.clone(true);
      obj.position.set(s.x, 0, s.z);
      obj.rotation.y = s.rot;
      obj.scale.setScalar(s.scale);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = !s.name.includes('river') && !s.name.includes('lake') && !s.name.includes('meadow');
          o.receiveShadow = true;
        }
      });
      const idle = loaded.clips.find((c) => c.name === 'idle');
      if (idle) {
        const mixer = new THREE.AnimationMixer(obj);
        mixer.clipAction(idle).play();
        this.#mixers.push(mixer);
      }
      this.scene.add(obj);
    }
    await this.sync(world);
  }

  /** The buildings as the World has them: new ones placed, levels shown, gone ones removed. */
  async sync(world: World): Promise<void> {
    const live = new Set<number>();
    for (const b of world.buildings) {
      live.add(b.id);
      const { model, tier } = buildingModel(b.kind, b.level);
      const shown = this.#shown.get(b.id);
      if (shown && shown.model === model && shown.level === b.level) continue;
      const obj = await this.#make(model, b.kind, b.owner);
      if (!obj) continue;
      showTierParts(obj, tier);
      obj.position.set(b.x, 0, b.z);
      // facing the middle of the map, as a front door should
      obj.rotation.y = b.z > 0 ? Math.PI : 0;
      obj.userData.buildingId = b.id;
      obj.traverse((o) => (o.userData.buildingId = b.id));
      if (shown) shown.obj.removeFromParent();
      this.scene.add(obj);
      this.#shown.set(b.id, { obj, model, level: b.level });
    }
    for (const [id, s] of this.#shown) {
      if (live.has(id)) continue;
      s.obj.removeFromParent();
      this.#shown.delete(id);
    }
  }

  /** A copy of a building model in its owner's colour, scaled to its footprint (null: no model). */
  async #make(model: string, kind: BuildingKind, owner: PlayerId | null): Promise<THREE.Object3D | null> {
    const loaded = await this.load(model);
    if (!loaded) return null;
    const obj = loaded.scene.clone(true);
    let fit = this.#fit.get(model);
    if (!fit) {
      const box = new THREE.Box3().setFromObject(loaded.scene);
      const size = box.getSize(new THREE.Vector3());
      fit = { scale: (BUILDINGS[kind].footprint * 0.95) / Math.max(size.x, size.z, 0.1), lift: -box.min.y };
      this.#fit.set(model, fit);
    }
    const wrap = new THREE.Group();
    obj.scale.setScalar(fit.scale);
    obj.position.y = fit.lift * fit.scale;
    wrap.add(obj);
    const colour = owner ? new THREE.Color(TEAM_COLORS[owner]) : null;
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!colour) return;
      const tint = (m: THREE.Material) => {
        if (m.name !== 'Tint' || !('color' in m)) return m;
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.color.copy(colour);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
    return wrap;
  }

  /** The placement ghost: this kind at (x, z), green where it may go, red where not; null hides it. */
  async ghost(kind: BuildingKind | null, x = 0, z = 0, ok = true): Promise<void> {
    if (kind !== this.#ghostKind) {
      this.#ghost?.removeFromParent();
      this.#ghost = null;
      this.#ghostKind = kind;
      if (kind) {
        const { model, tier } = buildingModel(kind, 1);
        const obj = await this.#make(model, kind, null);
        if (this.#ghostKind !== kind) return;
        const g = new THREE.Group();
        if (obj) {
          showTierParts(obj, tier);
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = false;
            const ghostly = (m: THREE.Material) => Object.assign(m.clone(), { transparent: true, opacity: 0.55, depthWrite: false });
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ghostly) : ghostly(mesh.material);
          });
          g.add(obj);
        }
        const f = BUILDINGS[kind].footprint;
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(f, f).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.35, depthWrite: false }));
        plate.position.y = 0.05;
        plate.name = 'plate';
        g.add(plate);
        this.#ghost = g;
        this.scene.add(g);
      }
    }
    const g = this.#ghost;
    if (!g) return;
    g.position.set(x, 0, z);
    g.rotation.y = z > 0 ? Math.PI : 0;
    ((g.getObjectByName('plate') as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(ok ? 0x4caf50 : 0xd0302a);
  }

  /** The selection ring round a building (null: none). */
  select(b: Building | null): void {
    this.#ring.visible = b !== null;
    if (!b) return;
    const r = BUILDINGS[b.kind].footprint * 0.75;
    this.#ring.position.set(b.x, 0.08, b.z);
    this.#ring.scale.setScalar(r);
  }

  /** The point on the ground under a point of the page (null: none). */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    this.#aim(clientX, clientY);
    const hit = this.#ray.ray.intersectPlane(this.#groundPlane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** The building under a point of the page (its id), or null. */
  buildingAt(clientX: number, clientY: number): number | null {
    this.#aim(clientX, clientY);
    const objs = [...this.#shown.values()].map((s) => s.obj);
    const hit = this.#ray.intersectObjects(objs, true)[0];
    return (hit?.object.userData.buildingId as number | undefined) ?? null;
  }

  /** Where a world point shows on the page (client px), or null behind the camera. */
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  focus(x: number, z: number): void {
    this.#target.set(x, 0, z);
    // your side at the bottom of the screen
    this.#yaw = z < 0 ? Math.PI : 0;
  }

  /** Test hook: the camera's state. */
  get cameraState(): { x: number; z: number; dist: number; yaw: number } {
    return { x: this.#target.x, z: this.#target.z, dist: this.#dist, yaw: this.#yaw };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }

  #aim(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.#ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
  }

  #bindInput(): void {
    const c = this.canvas;
    c.addEventListener('keydown', (e) => this.#keys.add(e.key.toLowerCase()));
    c.addEventListener('keyup', (e) => this.#keys.delete(e.key.toLowerCase()));
    c.addEventListener('blur', () => this.#keys.clear());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#dist = Math.max(DIST_MIN, Math.min(DIST_MAX, this.#dist * (1 + Math.sign(e.deltaY) * 0.12)));
      },
      { passive: false },
    );
    // middle-drag pans
    let drag: { x: number; y: number } | null = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = this.#dist / 600;
      this.#pan(-(e.clientX - drag.x) * k, -(e.clientY - drag.y) * k);
      drag = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button === 1) drag = null;
    });
  }

  /** Pans by screen right/up amounts (metres). */
  #pan(right: number, up: number): void {
    const s = Math.sin(this.#yaw);
    const co = Math.cos(this.#yaw);
    this.#target.x += right * co + up * s;
    this.#target.z += -right * s + up * co;
    const h = 85;
    this.#target.x = Math.max(-h, Math.min(h, this.#target.x));
    this.#target.z = Math.max(-h, Math.min(h, this.#target.z));
  }

  #loop(now: number): void {
    this.#timer.update(now);
    const dt = Math.min(0.1, this.#timer.getDelta());
    const k = this.#keys;
    const speed = this.#dist * 0.9 * dt;
    if (k.has('w') || k.has('arrowup')) this.#pan(0, -speed);
    if (k.has('s') || k.has('arrowdown')) this.#pan(0, speed);
    if (k.has('a') || k.has('arrowleft')) this.#pan(-speed, 0);
    if (k.has('d') || k.has('arrowright')) this.#pan(speed, 0);
    if (k.has('q')) this.#yaw -= dt * 1.5;
    if (k.has('e')) this.#yaw += dt * 1.5;
    this.#pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.#pitch));
    const t = this.#target;
    this.camera.position.set(t.x + Math.sin(this.#yaw) * Math.cos(this.#pitch) * this.#dist, Math.sin(this.#pitch) * this.#dist, t.z + Math.cos(this.#yaw) * Math.cos(this.#pitch) * this.#dist);
    this.camera.lookAt(t);
    this.#sun.position.set(t.x + 30, 60, t.z + 20);
    this.#sun.target.position.copy(t);
    for (const m of this.#mixers) m.update(dt);
    for (const f of [...this.#frame]) f(dt);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
