/**
 * The castle and town in 3D: the plan (plan.ts) turned into models, with the
 * standin where a model is missing, and the guild's transactions played out as
 * couriers' errands (courier.ts): the drawbridge lowers, a courier pays at the
 * barrier, walks to a protocol's door, and the building's person comes out to
 * take the goods (or hand them over, for what arrives). Several couriers can
 * be out at once; new transactions jump the queue; when the queue is empty the
 * recent ones play again. The bell rings for each block. Drag to pan, pinch or
 * wheel to zoom, tap a building to select it. Renders only while on the page.
 */

import * as THREE from 'three';
import { assetPath, brandColor, findAsset, tierColor } from '../assets/manifest.js';
import { ModelLibrary, disposeTree, type Loaded } from '../assets/models.js';
import { themeFileUrl, type CastleTheme } from '../assets/theme.js';
import { crestColors } from '../../util/rng.js';
import { DEFAULT_TIMING, buildCourierScript, courierAt, type CourierScript, type CourierState, type NpcClip } from './courier.js';
import { WALL_WALK, planCastle, routeAlongWalls, routeTo, type BuildingPlacement, type CastlePlan, type Placement } from './plan.js';
import type { CastleWorld, Errand } from '../world/world.js';
import { lightAt, type Weather } from '../world/sky.js';

export type CastleFocus = 'castle' | 'town';

export interface CastleViewOptions {
  world: CastleWorld;
  focus: CastleFocus;
  /** The theme the models come from (loadCastleTheme). */
  theme: Promise<CastleTheme> | CastleTheme;
  /** A building was tapped. */
  onSelect?: (building: BuildingPlacement) => void;
  /** A courier was tapped: its errand (the transaction). */
  onSelectErrand?: (errand: Errand) => void;
  /** A courier pays the toll at the barrier (for the coins' sound). */
  onToll?: (errand: Errand) => void;
  /** The hour of the day to light the scene by (default: the player's local time, followed as it passes). */
  hour?: number;
  /** The market's weather to start with. */
  weather?: Weather;
}

const FOCUS_POINT: Record<CastleFocus, [number, number]> = {
  castle: [0, -7],
  town: [0, 9],
};
/** Metres of the scene visible top to bottom at zoom 1. */
const VIEW_HEIGHT = 26;
/** At zoom 1 at least this many metres show across, so a narrow phone sees the whole castle. */
const VIEW_WIDTH_MIN = 30;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
/** Where the camera may look: the island, the moat and the town, with a margin. */
const PAN_BOUNDS = { x0: -16, x1: 16, z0: -24, z1: 24 };
/** The camera's direction from what it looks at (an orthographic camera: distance changes nothing on screen). */
const CAMERA_OFFSET = new THREE.Vector3(18, 20, 18);
/** How far back along that direction the camera stands: far enough that a tall phone view's near ground is in front of it. */
const CAMERA_BACK = 4;
/** Seconds the bell swings for a block. */
const BELL_RING = 1.5;
/** With no block reported for this long, the bell keeps time by itself (Ethereum's 12 s), so an offline town still rings. */
const BLOCK_SILENCE = 20;
const BLOCK_TIME = 12;
/** Couriers out at once, and seconds between two setting out. */
const MAX_COURIERS = 3;
const COURIER_GAP = 2.5;
/** With nothing new to play, the recent errands play again after this pause; this many of them. */
const REPLAY_PAUSE = 3;
const REPLAY_COUNT = 12;
/** The bell's yoke when the tower model has no `hinge` (the delivered tower has it at 9.1 m). */
const BELL_HEIGHT = 9.1;
/** The spec leaves the barrier's height to the game (docs/ASSET_SPEC.md §3.3). */
const BARRIER_HEIGHT = 1;
/** A tap moves less than this many pixels; more is a drag. */
const TAP_SLOP = 6;
const FADE = 0.25;
/** The Chronicle tower turns this see-through while someone is behind it. */
const TOWER_FADED = 0.3;
/** How far behind the tower (on the ground, away from the camera) it can hide someone, and how wide its shadow is. */
const TOWER_HIDES = { depth: 12, halfWidth: 2 };
/** A courier's tap target: a cylinder about its body, never drawn. Shared by every courier of every view, and never freed (it is tiny). */
const HIT_HEIGHT = 2;
const HIT_GEOMETRY = new THREE.CylinderGeometry(0.7, 0.7, HIT_HEIGHT, 8);
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
/** Colours for decorations' Tint parts: a fixed one, or the guild's crest (its first wallet's). */
const DECOR_TINT: Record<string, string> = {
  'prop.market.stall': '#8a3b32', // the palette's cloth red (docs/ASSET_SPEC.md §1.2)
  'animal.dog': 'crest',
  'animal.horse': 'crest',
};
/** Clips a placed model plays on its own, looping (the first one it has). */
const LOOPING_CLIPS = ['idle', 'wave', 'swim'];
/** A wallet tower's top, where its flag stands (docs/ASSET_SPEC.md §3.1: 3 m). */
const TOWER_TOP = 3;
/** The refusal seal over the barrier: how high, how big, and its colour when the theme has no picture. */
const REFUSAL_HEIGHT = 2.4;
const REFUSAL_SIZE = 1.1;
const REFUSAL_COLOR = 0xb0473a;
/** The grass round everything: the palette's moss (docs/ASSET_SPEC.md §1.2). */
const LAND_COLOR = 0x5b7a4a;
const LAND_SIZE = 160;
/** The path glow: warm lamplight rather than the model's plain white. */
const GLOW_COLOR = 0xffc861;
/** The glow plate is 0.01 m high and the road 0.02 m: lift the plate just above the road. */
const GLOW_LIFT = 0.015;

/** One animated figure: its object and, when its model has clips, a mixer that cross-fades between them. */
class Figure {
  readonly object: THREE.Object3D;
  readonly #mixer: THREE.AnimationMixer | null;
  readonly #actions = new Map<string, THREE.AnimationAction>();
  #current: string | null = null;

  constructor(object: THREE.Object3D, clips: readonly THREE.AnimationClip[], once: readonly string[] = []) {
    this.object = object;
    // skinned figures: their bounds do not follow the animation
    object.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    this.#mixer = clips.length ? new THREE.AnimationMixer(object) : null;
    for (const clip of clips) {
      const action = this.#mixer!.clipAction(clip);
      if (once.includes(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.#actions.set(clip.name, action);
    }
  }

  /** Forgets the clip playing, so the next `play` starts afresh (a person going back inside, to come out again later). */
  rest(): void {
    this.#mixer?.stopAllAction();
    this.#current = null;
  }

  /** Plays a clip, cross-fading from the one before. Unknown clips leave the figure as it is. */
  play(name: string): void {
    if (name === this.#current) return;
    const next = this.#actions.get(name);
    if (!next) return;
    const prev = this.#current ? this.#actions.get(this.#current) : undefined;
    next.reset().fadeIn(FADE).play();
    prev?.fadeOut(FADE);
    this.#current = name;
  }

  update(dt: number): void {
    this.#mixer?.update(dt);
  }

  dispose(): void {
    this.#mixer?.stopAllAction();
    this.#mixer?.uncacheRoot(this.object);
  }
}

/** A courier out on an errand. */
interface Run {
  errand: Errand;
  building: BuildingPlacement | null;
  script: CourierScript;
  /** View time it set out. */
  start: number;
  figure: Figure;
  cargo: THREE.Object3D;
  /** Its figure is a standin (no model): its geometry is its own to free. */
  standin: boolean;
  /** It has paid the toll (told once). */
  tolled?: boolean;
}

export class CastleView {
  readonly element: HTMLElement;
  readonly #canvas = document.createElement('canvas');
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  readonly #focus = new THREE.Vector3();
  readonly #opts: CastleViewOptions;
  readonly #plan: CastlePlan;
  readonly #timer = new THREE.Timer();
  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  readonly #scratch = new THREE.Vector3();
  readonly #figures: Figure[] = [];
  readonly #buildingRoots: THREE.Object3D[] = [];
  readonly #resize: ResizeObserver;
  readonly #library: ModelLibrary;
  #zoom = 1;
  #bridge: THREE.Object3D | null = null;
  #barrier: THREE.Object3D | null = null;
  #bell: THREE.Object3D | null = null;
  /** Models by asset name (null: none made, the standin shows). */
  readonly #loaded = new Map<string, Loaded | null>();
  /** Errands waiting for a courier; live ones go to the front. */
  #queue: Errand[] = [];
  readonly #runs: Run[] = [];
  /** Each building's person, by protocol id. */
  readonly #npcs = new Map<string, Figure>();
  #lastSpawn = -Infinity;
  #replayAt = 0;
  /** When the bell last started ringing, and when a real block last came. */
  #ringAt = -Infinity;
  #blockAt = 0;
  readonly #courierScratch: CourierState[] = [];
  readonly #hemi = new THREE.HemisphereLight(0xffffff, 0x6b6250, 1.7);
  readonly #sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  /** The models' Glow materials (windows, lanterns), brighter at night. */
  readonly #glows = new Set<THREE.MeshStandardMaterial>();
  #lightAt = 0;
  readonly #weatherEl = document.createElement('div');
  /** Painted copies of the models' Tint and Trim materials, one per source material and colour (shared by every piece painted alike). */
  readonly #painted = new Map<string, THREE.Material>();
  /** The couriers' tap targets. */
  #courierTargets: THREE.Mesh[] = [];
  /** The red seal over the barrier while a failed transaction's courier is turned back. */
  #refusal: THREE.Sprite | null = null;
  /** Buildings with a looping clip of their own (Curve's water wheel, Pendle's pendulum). */
  readonly #ambient: Figure[] = [];
  #litTiles: THREE.Object3D[] = [];
  #tower: THREE.Object3D | null = null;
  /** The tower's own copies of its materials, so it can fade alone. */
  #towerMaterials: THREE.Material[] = [];
  #towerOpacity = 1;
  #bridgeAngle = -Math.PI / 2; // raised
  #barrierAngle = 0; // down
  #time = 0;
  #ready = false;
  #wasConnected = false;
  #disposed = false;
  /** Pointers down on the canvas, for drag and pinch. */
  readonly #pointers = new Map<number, { x: number; y: number }>();
  #gesture: { x: number; y: number; moved: number; pinch: number } | null = null;

  constructor(opts: CastleViewOptions) {
    this.#opts = opts;
    this.#plan = planCastle(opts.world);
    // the recent errands first, oldest first
    this.#queue = opts.world.errands.slice(-REPLAY_COUNT);
    this.#library = new ModelLibrary(opts.theme);
    const [fx, fz] = FOCUS_POINT[opts.focus];
    this.#focus.set(fx, 0, fz);

    this.element = document.createElement('div');
    this.element.className = 'castle-view';
    this.element.append(this.#canvas);
    this.#canvas.style.touchAction = 'none';

    this.#renderer = new THREE.WebGLRenderer({ canvas: this.#canvas, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setClearColor(0xbcd3e0, 1);
    this.#scene.add(this.#hemi);
    this.#sun.position.set(10, 20, 6);
    this.#scene.add(this.#sun);
    // the weather: a grey veil and rain over the scene (DOM layers: cheap, and no draw calls)
    this.#weatherEl.className = 'weather';
    this.#weatherEl.append(el('div', 'gloom'), el('div', 'rain'));
    void Promise.resolve(opts.theme).then((t) => {
      const spec = findAsset('fx.rain');
      if (spec) this.#weatherEl.style.setProperty('--rain-image', `url("${themeFileUrl(t, assetPath(spec))}")`);
    });
    this.#applyLight();
    // The land the island and the town stand on, out past the woods (a hair below the tiles).
    const land = new THREE.Mesh(new THREE.PlaneGeometry(LAND_SIZE, LAND_SIZE), new THREE.MeshStandardMaterial({ color: LAND_COLOR, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.y = -0.02;
    this.#scene.add(land);

    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(this.element);
    this.#fit();
    this.#bindInput();
    void this.#build();
    this.#renderer.setAnimationLoop(this.#tick);
  }

  get plan(): CastlePlan {
    return this.#plan;
  }

  /** True once every model has loaded and been placed. */
  get ready(): boolean {
    return this.#ready;
  }

  /** Test hook: the page coordinates of a protocol's building, to tap it. */
  screenPoint(protocolId: string): { x: number; y: number } | null {
    const b = this.#plan.buildings.find((p) => p.protocol.id === protocolId);
    if (!b) return null;
    this.#scratch.set(b.x, 1, b.z).project(this.#camera);
    const rect = this.#canvas.getBoundingClientRect();
    return { x: rect.left + ((this.#scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.#scratch.y) / 2) * rect.height };
  }

  /** Test hook: the page coordinates of the first courier out (null: none out). */
  courierPoint(): { x: number; y: number } | null {
    const run = this.#runs[0];
    if (!run) return null;
    run.figure.object.getWorldPosition(this.#scratch);
    this.#scratch.y += 1;
    this.#scratch.project(this.#camera);
    const rect = this.#canvas.getBoundingClientRect();
    return { x: rect.left + ((this.#scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.#scratch.y) / 2) * rect.height };
  }

  /** Test hook: the protocols with a building, nearest the gate first. */
  buildingIds(): string[] {
    return this.#plan.buildings.map((b) => b.protocol.id);
  }

  /** Test hook: what the errands look like now. */
  state(): { bridgeAngle: number; barrierAngle: number; courier: { x: number; z: number } | null; couriers: number; queued: number; zoom: number; ringing: boolean } {
    const c = this.#runs[0]?.figure.object.position;
    return {
      bridgeAngle: this.#bridgeAngle,
      barrierAngle: this.#barrierAngle,
      courier: c ? { x: c.x, z: c.z } : null,
      couriers: this.#runs.length,
      queued: this.#queue.length,
      zoom: this.#zoom,
      ringing: this.#time - this.#ringAt < BELL_RING,
    };
  }

  /** New transactions: their couriers go next, ahead of the replay. */
  enqueue(errands: readonly Errand[]): void {
    this.#queue.unshift(...errands);
  }

  /** A block was mined: the bell rings. */
  ringBell(): void {
    this.#ringAt = this.#time;
    this.#blockAt = this.#time;
  }

  /** Stops the loop and frees what this view made on the GPU. Runs by itself when the view leaves the page. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer.setAnimationLoop(null);
    this.#resize.disconnect();
    for (const f of this.#figures) f.dispose();
    for (const f of this.#ambient) f.dispose();
    for (const r of this.#runs) r.figure.dispose();
    // Everything shown came from this view's own library (models, standins, the tower's own materials):
    // nothing is shared beyond the view, so all of it goes.
    for (const t of this.#courierTargets) t.removeFromParent(); // shared by every view: kept
    disposeTree(this.#scene);
    this.#refusal?.material.map?.dispose();
    this.#refusal?.material.dispose();
    this.#scene.clear();
    void this.#library.dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
  }

  async #build(): Promise<void> {
    const plan = this.#plan;
    const lib = this.#library;
    const placements = this.#placements();
    const categories = new Set(plan.buildings.map((b) => b.protocol.category));
    const names = new Set<string>([
      ...placements.flatMap((p) => [p.name, ...(p.fallbacks ?? [])]),
      plan.bridge.name,
      plan.barrier.name,
      'town.tower.bell',
      'courier.base',
      ...[0, 1, 2, 3, 4, 5, 6].map((t) => `courier.cargo.t${t}`),
      'person.npc.base',
      ...[...categories].map((c) => `person.npc.${c}`),
    ]);
    await Promise.all([...names].map(async (n) => this.#loaded.set(n, await lib.load(n))));
    if (this.#disposed) return;

    for (const p of placements) {
      // the first of the name and its fallbacks that has a model; the last one's standin otherwise
      const options = [p.name, ...(p.fallbacks ?? [])];
      if (p.optional && !options.some((n) => this.#loaded.get(n))) continue; // decoration waits for its model
      const chosen = options.find((n) => this.#loaded.get(n)) ?? options[options.length - 1]!;
      const obj = this.#make(chosen);
      // its own looping clip: a mill wheel, a pendulum, an animal at rest, a flag in the wind
      const loop = this.#loaded.get(chosen)?.clips.find((c) => LOOPING_CLIPS.includes(c.name));
      if (loop) {
        const moving = new Figure(obj, [loop]);
        moving.play(loop.name);
        this.#ambient.push(moving);
      }
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = p.rot ?? 0;
      this.#scene.add(obj);
      if (p.key === 'flag') {
        // on top of its wallet's tower, in that wallet's crest colour
        obj.position.y = TOWER_TOP;
        const wallet = this.#opts.world.walletIds[plan.towers.findIndex((t) => t.x === p.x && t.z === p.z)];
        if (wallet) paint(obj, 'Tint', crestColors(wallet)[0], this.#painted);
      }
      if (p.key === 'lit') {
        obj.position.y = GLOW_LIFT; // over the road's surface, not under it
        obj.visible = false;
        this.#litTiles.push(obj);
        tintGlow(obj);
      }
      // The tier shows in the Trim (docs/ASSET_SPEC.md §1.3): a building's from what the guild keeps
      // there, the castle's own pieces from the guild's worth.
      if ('protocol' in p) {
        obj.userData.building = p;
        this.#buildingRoots.push(obj);
        const brand = brandColor((p as BuildingPlacement).protocol.id);
        if (brand) paint(obj, 'Tint', brand, this.#painted);
        paint(obj, 'Trim', tierColor(p.tier ?? 0), this.#painted);
      } else if (p.name.startsWith('castle.')) {
        // a wallet's tower at its own tier, the rest of the castle at the guild's
        paint(obj, 'Trim', tierColor(p.tier ?? plan.keep.tier ?? 0), this.#painted);
      }
      const decorTint = p.key === 'decor' ? DECOR_TINT[p.name] : undefined;
      if (decorTint) paint(obj, 'Tint', decorTint === 'crest' ? crestColors(this.#opts.world.walletIds[0] ?? '')[0] : decorTint, this.#painted);
      if (p === plan.tower) {
        this.#hangBell(obj, this.#make('town.tower.bell'));
        this.#tower = obj;
        this.#towerMaterials = ownMaterials(obj);
      }
    }

    // The drawbridge swings about its hinge: lowered is flat towards the town, raised stands up.
    const hinge = new THREE.Group();
    hinge.position.set(plan.bridge.x, 0, plan.bridge.z);
    hinge.add(this.#make(plan.bridge.name));
    hinge.rotation.x = this.#bridgeAngle;
    this.#scene.add(hinge);
    this.#bridge = hinge;

    // The barrier's arm swings up about its post.
    const barrier = new THREE.Group();
    barrier.position.set(plan.barrier.x, BARRIER_HEIGHT, plan.barrier.z);
    barrier.add(this.#make(plan.barrier.name));
    this.#scene.add(barrier);
    this.#barrier = barrier;

    // The refusal: the theme's red seal over the road at the barrier (a red marker without it).
    const seal = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    seal.position.set(0, REFUSAL_HEIGHT, plan.barrier.z);
    seal.scale.setScalar(REFUSAL_SIZE);
    seal.visible = false;
    this.#scene.add(seal);
    this.#refusal = seal;
    void this.#loadSprite('fx.refused').then((map) => {
      if (this.#disposed) {
        map?.dispose();
        return;
      }
      if (map) seal.material.map = map;
      else seal.material.color.set(REFUSAL_COLOR);
      seal.material.needsUpdate = true;
    });

    // Each building's person waits inside, to come out when a courier calls.
    for (const b of plan.buildings) {
      const name = this.#loaded.get(`person.npc.${b.protocol.category}`) ? `person.npc.${b.protocol.category}` : 'person.npc.base';
      const npc = new Figure(this.#make(name), this.#loaded.get(name)?.clips ?? [], ['emerge', 'receive', 'return']);
      npc.object.position.set(b.npc.x, 0, b.npc.z);
      npc.object.rotation.y = b.rot ?? 0; // faces out of its door, towards the visitor
      npc.object.visible = false;
      this.#scene.add(npc.object);
      this.#figures.push(npc);
      this.#npcs.set(b.protocol.id, npc);
    }
    // the Glow parts of everything placed (shared materials: one entry each)
    this.#scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.name === 'Glow' && 'emissiveIntensity' in m) this.#glows.add(m as THREE.MeshStandardMaterial);
    });
    this.#applyLight();
    if (this.#opts.weather) this.setWeather(this.#opts.weather);
    this.element.append(this.#weatherEl);
    this.#ready = true;
    this.element.dataset.ready = 'true';
  }

  /** A sprite's picture from the theme, or null when it has none. */
  async #loadSprite(name: string): Promise<THREE.Texture | null> {
    const spec = findAsset(name);
    if (!spec) return null;
    try {
      const theme = await this.#opts.theme;
      const map = await new THREE.TextureLoader().loadAsync(themeFileUrl(theme, assetPath(spec)));
      map.colorSpace = THREE.SRGBColorSpace;
      return map;
    } catch {
      return null;
    }
  }

  /** Lights the scene for the hour: the sun, the sky, and how bright windows and lanterns glow. */
  #applyLight(): void {
    const now = new Date();
    const l = lightAt(this.#opts.hour ?? now.getHours() + now.getMinutes() / 60);
    this.#sun.intensity = l.sun;
    this.#hemi.intensity = l.ambient;
    this.#renderer.setClearColor(l.sky, 1);
    for (const m of this.#glows) m.emissiveIntensity = l.glow;
    this.element.dataset.night = l.night.toFixed(2);
  }

  /** The market's weather: rain and a grey veil (0 … 1 each). */
  setWeather(w: Weather): void {
    this.#weatherEl.style.setProperty('--rain', w.rain.toFixed(2));
    this.#weatherEl.style.setProperty('--gloom', w.gloom.toFixed(2));
    this.element.dataset.rain = w.rain.toFixed(2);
  }

  /** A new object for an asset: its model, or its standin. */
  #make(name: string): THREE.Object3D {
    const spec = findAsset(name);
    if (!spec) throw new Error(`no asset named ${name}`);
    return this.#library.instance(spec, this.#loaded.get(name) ?? null);
  }

  /** Sends a courier on an errand: to (or from) its protocol's building, or the town's far end. */
  #spawn(errand: Errand): void {
    const building = errand.protocolId ? (this.#plan.buildings.find((b) => b.protocol.id === errand.protocolId) ?? null) : null;
    let script: CourierScript;
    if (errand.direction === 'inside') {
      // between two wallets' towers, along the wall-walk (a wallet beyond the towers' slots has no tower: no errand)
      const from = this.#plan.towers[errand.fromTower ?? -1];
      const to = this.#plan.towers[errand.toTower ?? -1];
      if (!from || !to) return;
      script = buildCourierScript(routeAlongWalls(from, to), DEFAULT_TIMING, 'inside', { height: WALL_WALK });
    } else {
      script = buildCourierScript(routeTo(building), DEFAULT_TIMING, errand.direction, { failed: errand.failed });
    }
    const figure = new Figure(this.#make('courier.base'), this.#loaded.get('courier.base')?.clips ?? []);
    // its goods, sized by value, in its right hand (on the standin's back)
    const cargo = this.#make(`courier.cargo.t${Math.max(0, Math.min(6, errand.tier))}`);
    const hand = figure.object.getObjectByName('hand');
    if (hand) hand.add(cargo);
    else {
      cargo.position.set(0, 1, -0.3);
      figure.object.add(cargo);
    }
    // an invisible, generous target to tap (a walking figure is small on a phone)
    const target = new THREE.Mesh(HIT_GEOMETRY, HIT_MATERIAL);
    target.position.y = HIT_HEIGHT / 2;
    target.userData.errand = errand;
    figure.object.add(target);
    this.#courierTargets.push(target);
    this.#scene.add(figure.object);
    this.#runs.push({ errand, building, script, start: this.#time, figure, cargo, standin: !this.#loaded.get('courier.base') });
    this.#lastSpawn = this.#time;
  }

  /** A courier home again: it goes. Its model's geometry belongs to the library and stays; a standin's is its own. */
  #finish(run: Run): void {
    // its tap target is shared geometry: off the figure before a standin's own geometry is freed
    for (const t of this.#courierTargets) if (t.parent === run.figure.object) t.removeFromParent();
    this.#courierTargets = this.#courierTargets.filter((t) => t.parent !== null);
    this.#scene.remove(run.figure.object);
    run.figure.dispose();
    if (run.standin) disposeTree(run.figure.object);
    this.#runs.splice(this.#runs.indexOf(run), 1);
  }

  /** Hangs the bell at the tower's `hinge` point, or at the default height on a standin. */
  #hangBell(tower: THREE.Object3D, bellModel: THREE.Object3D): void {
    tower.updateMatrixWorld(true);
    const hinge = tower.getObjectByName('hinge');
    const pivot = new THREE.Group();
    if (hinge) hinge.getWorldPosition(pivot.position);
    else pivot.position.set(tower.position.x, BELL_HEIGHT, tower.position.z);
    pivot.add(bellModel);
    this.#scene.add(pivot);
    this.#bell = pivot;
  }

  #placements(): Placement[] {
    const p = this.#plan;
    return [...p.water, ...p.ground, ...p.walls, ...p.towers, ...p.wings, p.keep, p.gatehouse, p.tollbooth, p.tower, ...p.road, ...p.lit, ...p.buildings, ...p.scenery, ...p.decor];
  }

  #fit(): void {
    const w = this.element.clientWidth || 1;
    const h = this.element.clientHeight || 1;
    this.#renderer.setSize(w, h, false);
    this.#updateCamera();
  }

  #updateCamera(): void {
    const w = this.element.clientWidth || 1;
    const h = this.element.clientHeight || 1;
    const aspect = w / h;
    const half = this.#viewHeight() / 2;
    this.#camera.left = -half * aspect;
    this.#camera.right = half * aspect;
    this.#camera.top = half;
    this.#camera.bottom = -half;
    this.#camera.position.copy(CAMERA_OFFSET).multiplyScalar(CAMERA_BACK).add(this.#focus);
    this.#camera.lookAt(this.#focus);
    this.#camera.updateProjectionMatrix();
  }

  /** Metres of the scene shown top to bottom now: tall enough for the minimum width, divided by the zoom. */
  #viewHeight(): number {
    const aspect = (this.element.clientWidth || 1) / (this.element.clientHeight || 1);
    return Math.max(VIEW_HEIGHT, VIEW_WIDTH_MIN / aspect) / this.#zoom;
  }

  #bindInput(): void {
    const c = this.#canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.#gesture = { x: e.clientX, y: e.clientY, moved: this.#gesture?.moved ?? 0, pinch: this.#pinchDistance() };
      if (this.#pointers.size === 1) this.#gesture.moved = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.#pointers.get(e.pointerId);
      if (!prev || !this.#gesture) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.#gesture.moved += Math.hypot(dx, dy);
      if (this.#pointers.size >= 2) {
        const d = this.#pinchDistance();
        if (this.#gesture.pinch > 0 && d > 0) this.#setZoom(this.#zoom * (d / this.#gesture.pinch));
        this.#gesture.pinch = d;
      } else {
        this.#pan(dx, dy);
      }
    });
    const end = (e: PointerEvent) => {
      const g = this.#gesture;
      this.#pointers.delete(e.pointerId);
      if (this.#pointers.size === 0) {
        if (g && g.moved < TAP_SLOP) this.#tap(e.clientX, e.clientY);
        this.#gesture = null;
      } else if (this.#gesture) {
        this.#gesture.pinch = this.#pinchDistance();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => {
      this.#pointers.delete(e.pointerId);
      if (this.#pointers.size === 0) this.#gesture = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#setZoom(this.#zoom * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  #pinchDistance(): number {
    const [a, b] = [...this.#pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  #setZoom(zoom: number): void {
    this.#zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this.#updateCamera();
  }

  /** Moves the view so the ground under the pointer follows it. */
  #pan(dx: number, dy: number): void {
    const h = this.element.clientHeight || 1;
    const metresPerPixel = this.#viewHeight() / h;
    // The camera looks along −CAMERA_OFFSET: its right on the ground, and its up projected onto the ground
    // (stretched, since the ground is seen at a slant).
    const right = this.#scratch.set(CAMERA_OFFSET.z, 0, -CAMERA_OFFSET.x).normalize();
    const rx = right.x;
    const rz = right.z;
    const flat = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
    const slant = CAMERA_OFFSET.length() / CAMERA_OFFSET.y;
    const fx = -CAMERA_OFFSET.x / flat;
    const fz = -CAMERA_OFFSET.z / flat;
    this.#focus.x += (-dx * rx + dy * fx * slant) * metresPerPixel;
    this.#focus.z += (-dx * rz + dy * fz * slant) * metresPerPixel;
    this.#focus.x = Math.max(PAN_BOUNDS.x0, Math.min(PAN_BOUNDS.x1, this.#focus.x));
    this.#focus.z = Math.max(PAN_BOUNDS.z0, Math.min(PAN_BOUNDS.z1, this.#focus.z));
    this.#updateCamera();
  }

  #tap(clientX: number, clientY: number): void {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    // couriers first: they walk in front of the buildings
    const courier = this.#raycaster.intersectObjects(this.#courierTargets, false)[0];
    const errand = courier?.object.userData.errand as Errand | undefined;
    if (errand) {
      this.#opts.onSelectErrand?.(errand);
      return;
    }
    const hit = this.#raycaster.intersectObjects(this.#buildingRoots, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.building) o = o.parent;
    if (o) this.#opts.onSelect?.(o.userData.building as BuildingPlacement);
  }

  readonly #tick = (now: number): void => {
    if (this.element.isConnected) this.#wasConnected = true;
    else if (this.#wasConnected) {
      this.dispose();
      return;
    }
    this.#timer.update(now);
    const dt = Math.min(0.1, this.#timer.getDelta());
    this.#time += dt;
    if (this.#ready) this.#animate(dt);
    this.#renderer.render(this.#scene, this.#camera);
  };

  #animate(dt: number): void {
    const now = this.#time;
    // the light follows the clock (once a minute is plenty)
    if (now - this.#lightAt > 60) {
      this.#lightAt = now;
      this.#applyLight();
    }
    // Couriers: the next errand sets out when there is room; with nothing waiting, the recent ones play again.
    if (this.#queue.length === 0 && this.#runs.length === 0) {
      if (this.#replayAt === 0) this.#replayAt = now + REPLAY_PAUSE;
      else if (now >= this.#replayAt) {
        this.#queue = this.#opts.world.errands.slice(-REPLAY_COUNT);
        this.#replayAt = 0;
      }
    }
    if (this.#queue.length > 0 && this.#runs.length < MAX_COURIERS && now - this.#lastSpawn >= COURIER_GAP) this.#spawn(this.#queue.shift()!);

    const states = this.#courierScratch;
    states.length = 0;
    let bridgeDown = false;
    let barrierUp = false;
    let refused = false;
    const npcState = new Map<string, NpcClip>();
    for (const run of [...this.#runs]) {
      const t = now - run.start;
      if (t >= run.script.duration) {
        this.#finish(run);
        continue;
      }
      const s = courierAt(run.script, t, this.#plan.barrier.z);
      if (s.clip === 'toll' && !run.tolled) {
        run.tolled = true;
        this.#opts.onToll?.(run.errand);
      }
      states.push(s);
      run.figure.object.position.set(s.x, run.script.height, s.z);
      refused ||= s.refused;
      run.figure.object.rotation.y = s.heading;
      run.figure.play(s.clip);
      run.cargo.visible = s.carrying;
      run.figure.update(dt);
      bridgeDown ||= s.bridgeDown;
      barrierUp ||= s.barrierUp;
      if (run.building && s.npc !== 'hidden' && !npcState.has(run.building.protocol.id)) npcState.set(run.building.protocol.id, s.npc);
    }
    for (const f of this.#ambient) f.update(dt);
    for (const [id, npc] of this.#npcs) {
      const clip = npcState.get(id);
      if (clip) {
        npc.object.visible = true;
        npc.play(npcClipFor(clip));
      } else if (npc.object.visible) {
        npc.object.visible = false;
        npc.rest();
      }
      if (npc.object.visible) npc.update(dt);
    }

    if (this.#refusal) this.#refusal.visible = refused;
    const bridgeTarget = bridgeDown ? 0 : -Math.PI / 2;
    this.#bridgeAngle += (bridgeTarget - this.#bridgeAngle) * Math.min(1, dt * 4);
    if (this.#bridge) this.#bridge.rotation.x = this.#bridgeAngle;
    const barrierTarget = barrierUp ? Math.PI / 2 : 0;
    this.#barrierAngle += (barrierTarget - this.#barrierAngle) * Math.min(1, dt * 6);
    if (this.#barrier) this.#barrier.rotation.z = this.#barrierAngle;

    // The bell rings for each block (keeping Ethereum's time by itself while no block is reported);
    // the paths flash with it, and otherwise glow under the couriers.
    if (now - this.#blockAt > BLOCK_SILENCE && now - this.#ringAt >= BLOCK_TIME) this.#ringAt = now;
    const phase = now - this.#ringAt;
    const ringing = phase >= 0 && phase < BELL_RING;
    if (this.#bell) this.#bell.rotation.z = ringing ? Math.sin((phase / BELL_RING) * Math.PI * 4) * 0.35 : 0;
    for (const tile of this.#litTiles) {
      let lit = ringing && phase < 0.6;
      for (const s of states) if (!lit && Math.hypot(tile.position.x - s.x, tile.position.z - s.z) < 1.2) lit = true;
      tile.visible = lit;
    }

    // The tower fades while a courier or a person at a door is behind it.
    let hidden = states.some((s) => this.#behindTower(s.x, s.z));
    for (const npc of this.#npcs.values()) if (!hidden && npc.object.visible) hidden = this.#behindTower(npc.object.position.x, npc.object.position.z);
    const target = hidden ? TOWER_FADED : 1;
    if (Math.abs(target - this.#towerOpacity) > 0.001) {
      this.#towerOpacity += (target - this.#towerOpacity) * Math.min(1, dt * 6);
      const faded = this.#towerOpacity < 0.999;
      for (const m of this.#towerMaterials) {
        m.transparent = faded;
        m.opacity = this.#towerOpacity;
        m.depthWrite = !faded;
      }
    }
  }

  /** Whether a spot on the ground is in the tower's shadow line: behind it, away from the camera. */
  #behindTower(x: number, z: number): boolean {
    if (!this.#tower) return false;
    const flat = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
    const ax = -CAMERA_OFFSET.x / flat; // from the camera, along the ground
    const az = -CAMERA_OFFSET.z / flat;
    const vx = x - this.#tower.position.x;
    const vz = z - this.#tower.position.z;
    const along = vx * ax + vz * az;
    const across = Math.abs(vx * az - vz * ax);
    return along > 0 && along < TOWER_HIDES.depth && across < TOWER_HIDES.halfWidth;
  }
}

/** Gives an object its own copies of its materials (so changing them touches nothing else) and returns them. */
function ownMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const copies = mats.map((m) => m.clone());
    mesh.material = Array.isArray(mesh.material) ? copies : copies[0]!;
    out.push(...copies);
  });
  return out;
}

/**
 * Paints an object's parts of one of the spec's recoloured materials
 * (docs/ASSET_SPEC.md §1.6: `Tint` for the brand, `Trim` for the tier). Its own
 * copies of those materials (the model's are shared by every copy placed), one
 * per source material and colour, kept in `cache`.
 */
function paint(root: THREE.Object3D, material: 'Tint' | 'Trim', color: string, cache: Map<string, THREE.Material>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (m.name !== material) return m;
      const key = `${m.uuid}|${color}`;
      let own = cache.get(key);
      if (!own) {
        own = m.clone();
        (own as THREE.MeshStandardMaterial).color?.set(color);
        cache.set(key, own);
      }
      return own;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/** Turns a path glow overlay warm. Its materials are shared by every overlay in this view, so this runs once per material. */
function tintGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.userData.glowTinted) continue;
      m.userData.glowTinted = true;
      const std = m as THREE.MeshStandardMaterial;
      std.color?.setHex(GLOW_COLOR);
      std.emissive?.setHex(GLOW_COLOR);
    }
  });
}

/** A div with a class (the weather's layers). */
function el(tag: 'div', className: string): HTMLDivElement {
  const d = document.createElement(tag);
  d.className = className;
  return d;
}

function npcClipFor(clip: NpcClip): string {
  return clip === 'hidden' ? 'idle' : clip;
}
