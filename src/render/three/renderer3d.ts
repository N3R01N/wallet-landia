/**
 * The 3D view: a diorama of the same town. Built in, buildings are low-poly
 * meshes from the same style table as the 2D sprites and people are pixel-art
 * billboards (an "HD-2D" look). With a theme bundle (Phase 7) the town gets the
 * theme's grammar-built buildings, terrain, woods, props and lanterns, PBR
 * ground, sky lighting, and rigged people on their mounts.
 *
 * Loaded on demand — `three` only ships to players who open the 3D view.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import type { Tier } from '../../domain/tiers.js';
import { crestColors, hashString } from '../../util/rng.js';
import { MAP_H, MAP_W, type Placed } from '../../world/layout.js';
import type { Agent, Effect, Sim } from '../../world/sim.js';
import { brandColor } from '../buildings.js';
import { caravanArt, heroArt, npcArt, villagerArt } from '../../assets/art.js';
import { BuildingFactory, type BuildingSpec } from './buildingFactory.js';
import { bakeTopGround, scatterProps, type Prop } from '../ground.js';
import { districtLabels, floatingText, markers, nameTags, nightFactor, route, weather, type Project } from '../overlay.js';
import { P, type Sprite } from '../pixel.js';
import { ImagePipeline, type DebugView, type Quality } from './pipeline.js';
import { buildGrass, buildLamps, buildPropMeshes, placeLamps, type LampSet } from './scenery.js';
import { EnvironmentController, skyForHour } from './environment.js';
import { bundleTheme, type CharacterProvider, type SandboxCharacter, type Theme } from './themes.js';
import { tileSurfaces, townSite } from './townSite.js';
import type { ThemeBundle } from '../../assets/themeBundles.js';
import { currentHour } from '../overlay.js';
import { wind } from './wind.js';
import type { HitTarget, WorldView } from '../view.js';

/** Art pixels per tile, so sprites keep their 2D proportions. */
const ART_PER_TILE = 16;
/** People read better a little larger than the buildings' scale. */
const HERO_SCALE = 1.35;

/** A rigged person standing in for an agent (themed towns). */
interface Person {
  char: SandboxCharacter;
  /** An invisible stand-in the pointer can hit (skinned meshes raycast poorly). */
  proxy: THREE.Mesh | null;
  x: number;
  y: number;
  speed: number;
  heading: number;
  state: 'idle' | 'walk' | 'run';
}

/** Above this many tiles per second a rigged person runs. */
const RUN_FROM = 1.7;

interface BuildingInfo {
  placed: Placed;
  group: THREE.Group;
  /** Height of the roof top in tiles, for markers. */
  top: number;
  /** Where the sign hangs (world tiles; y is up) and whose logo goes on it. */
  sign?: { x: number; y: number; z: number; url: string };
}

export class Renderer3D implements WorldView {
  readonly element: HTMLElement;
  /** The overlay canvas: on top, receives pointer events. */
  readonly canvas: HTMLCanvasElement;
  hover: HitTarget | null = null;
  selected: HitTarget | null = null;
  classOf: (address: string) => HeroClass = () => 'adventurer';

  #sim: Sim;
  #gl: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
  #world = new THREE.Group();
  #sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  #hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 1.1);
  #sky = new THREE.Color('#9fd3f0');
  #buildings: BuildingInfo[] = [];
  #sprites = new Map<string, { body: THREE.Sprite; caravan: THREE.Sprite }>();
  #textures = new WeakMap<HTMLCanvasElement, [THREE.CanvasTexture, THREE.CanvasTexture]>();
  #spriteMats = new Map<THREE.Texture, THREE.SpriteMaterial>();
  #factory = new BuildingFactory();
  #waterMat = new THREE.MeshStandardMaterial({ color: '#4a90c8', transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 });
  #ring: THREE.Mesh;
  #raycaster = new THREE.Raycaster();
  /**
   * Logo images for the overlay. Logo hosts often send no CORS headers, which
   * WebGL textures require; a 2D overlay canvas can draw them regardless.
   */
  #logos = new Map<string, HTMLImageElement>();

  // orbit camera state
  #target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  #yaw = -0.55;
  #pitch = 0.85;
  #distance = 62;
  #goal = { target: new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2), distance: 62 };
  #follow: string | null = null;

  #pipeline: ImagePipeline;
  #lastSize = '';
  #lastFrame = performance.now();
  #lamps: LampSet | null = null;
  /** The Chronicle bell: a pivot that swings on every block. */
  #bell: THREE.Object3D | null = null;
  #bellSwing = { t: 99, amp: 0 };
  #rungRings = new WeakSet<Effect>();
  /** Last screen-facing per agent, so idle sprites keep their side. */
  #facing = new Map<string, boolean>();
  /** Signs a building stands in front of (logo hidden); refreshed every few frames. */
  #hiddenSigns = new Set<string>();
  #frame = 0;
  #flash = 0;
  #shadowGeo = new THREE.CircleGeometry(0.32, 16);
  #shadowMatrix = new THREE.Matrix4();
  #spriteTint = new THREE.Color('#ffffff');
  #agentShadows = new THREE.InstancedMesh(this.#shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }), 400);
  /** The theme bundle drawing the town, or null for the built-in look. */
  #theme: Theme | null = null;
  /** Rigged people, once the theme's characters have loaded. */
  #people: CharacterProvider | null = null;
  #persons = new Map<string, Person>();
  #proxyGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.8, 8).translate(0, 0.9, 0);
  #proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  #env: EnvironmentController | null = null;
  /** Deep, glossy water that mirrors the sky (themed towns are lit by an HDRI). */
  #themedWater = new THREE.MeshStandardMaterial({ color: '#27506a', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 });

  constructor(sim: Sim, quality: Quality = 'medium') {
    this.#sim = sim;
    this.element = document.createElement('div');
    this.element.className = 'stage3d';
    const glCanvas = document.createElement('canvas');
    glCanvas.className = 'stage';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage overlay';
    this.element.append(glCanvas, this.canvas);

    this.#gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.#gl.shadowMap.enabled = true;
    this.#gl.shadowMap.type = THREE.PCFShadowMap; // soft PCF is the default filter since r18x
    this.#gl.outputColorSpace = THREE.SRGBColorSpace;
    this.#pipeline = new ImagePipeline(this.#gl, this.#scene, this.#camera, quality);
    this.#pipeline.aoExclusions = () => {
      const out: THREE.Object3D[] = [this.#agentShadows];
      for (const p of this.#sprites.values()) out.push(p.body, p.caravan);
      if (this.#lamps) out.push(this.#lamps.pools);
      return out;
    };

    this.#scene.background = this.#sky;
    this.#scene.fog = new THREE.Fog(this.#sky, 110, 230);
    this.#scene.add(this.#hemi, this.#sun, this.#sun.target, this.#world);
    this.#sun.position.set(MAP_W / 2 - 22, 42, MAP_H / 2 + 26);
    this.#sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    this.#sun.castShadow = true;
    // The town is a bounded receiver region, so one shadow map is the right
    // tool (shadow-systems skill). The light is fixed, so there is no texel
    // crawl to snap away; bias is sized to the world-space texel instead.
    const sc = this.#sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 120;
    this.#applyShadowTier();

    this.#ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 40),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    this.#ring.rotation.x = -Math.PI / 2;
    this.#ring.visible = false;
    this.#scene.add(this.#ring);

    this.#shadowGeo.rotateX(-Math.PI / 2);
    this.#scene.add(this.#agentShadows);

    this.#build();
  }

  setSim(sim: Sim): void {
    this.#sim = sim;
    this.#build();
  }

  /** The theme id drawing the town ('' = built in). */
  get themeId(): string {
    return this.#theme?.id ?? '';
  }

  /**
   * Draw the town with a theme bundle (null: the built-in look). Buildings and
   * surroundings change at once; rigged people follow when their files load.
   */
  async setTheme(bundle: ThemeBundle | null): Promise<void> {
    const theme = bundle ? bundleTheme(bundle) : null;
    this.#theme = theme;
    this.#people = null;
    // for tests and debugging: which theme draws the town, and whether its people are in
    this.element.dataset.theme = theme?.id ?? '';
    this.element.dataset.people = 'sprites';
    this.#clearPersons();
    if (theme) {
      this.#env ??= new EnvironmentController(this.#gl, this.#scene);
    } else {
      this.#env?.use(null, this.#sky);
      this.#scene.background = this.#sky;
    }
    this.#build();
    if (theme?.prepare) {
      await theme.prepare();
      if (this.#theme !== theme) return; // switched again meanwhile
    }
    if (theme) {
      this.#people = theme.characters;
      this.element.dataset.people = 'rigged';
    }
  }

  #clearPersons(): void {
    for (const p of this.#persons.values()) p.char.dispose();
    this.#persons.clear();
  }

  setQuality(q: Quality): void {
    this.#pipeline.setQuality(q);
    this.#applyShadowTier();
    this.#lastSize = '';
  }

  /** Validation views: final, no post, AO only, no grade. */
  setDebug(view: DebugView): void {
    this.#pipeline.debug = view;
  }

  #applyShadowTier(): void {
    const size = this.#pipeline.quality === 'low' ? 1024 : 2048;
    this.#sun.shadow.mapSize.set(size, size);
    this.#sun.shadow.map?.dispose();
    this.#sun.shadow.map = null;
    const texel = 76 / size; // world units per shadow texel
    this.#sun.shadow.normalBias = texel * 1.1;
    this.#sun.shadow.bias = -0.0004;
  }

  // --- camera ----------------------------------------------------------------
  // One damping stage toward a goal (camera-direction skill): input moves both
  // goal and current at once (it must feel immediate); focus and follow move
  // only the goal and the camera glides there, frame-rate independent.

  fit(): void {
    const aspect = Math.max(0.5, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.#follow = null;
    this.#goal.target.set(MAP_W / 2, 0, MAP_H / 2 + 1);
    this.#goal.distance = Math.min(110, 52 / Math.min(1, aspect / 1.4));
    this.#yaw = -0.55;
    this.#pitch = 0.85;
    this.#target.copy(this.#goal.target);
    this.#distance = this.#goal.distance;
  }

  /** Fixed views for visual validation. */
  bookmark(name: 'near' | 'design' | 'far'): void {
    this.fit();
    if (name === 'near') {
      this.#goal.target.set(20, 0, 20);
      this.#goal.distance = 16;
      this.#pitch = 0.62;
    } else if (name === 'far') {
      this.#goal.distance = 110;
      this.#pitch = 1.1;
    }
    this.#target.copy(this.#goal.target);
    this.#distance = this.#goal.distance;
  }

  pan(dx: number, dy: number): void {
    this.#follow = null;
    const f = this.#distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.#yaw), 0, -Math.sin(this.#yaw));
    const forward = new THREE.Vector3(-Math.sin(this.#yaw), 0, -Math.cos(this.#yaw));
    for (const t of [this.#target, this.#goal.target]) {
      t.addScaledVector(right, -dx * f).addScaledVector(forward, dy * f);
      t.x = Math.max(-5, Math.min(MAP_W + 5, t.x));
      t.z = Math.max(-5, Math.min(MAP_H + 5, t.z));
    }
  }

  zoomAt(_sx: number, _sy: number, factor: number): void {
    this.#distance = Math.max(10, Math.min(130, this.#distance / factor));
    this.#goal.distance = this.#distance;
  }

  rotate(dx: number, dy: number): void {
    this.#yaw -= dx * 0.006;
    this.#pitch = Math.max(0.3, Math.min(1.45, this.#pitch + dy * 0.004));
  }

  /** Glide to a tile position, coming a little closer if far away. */
  focus(x: number, y: number): void {
    this.#goal.target.set(x, 0, y);
    this.#goal.distance = Math.min(this.#goal.distance, 34);
  }

  /** Keep a hero in view (Quest Replay); null to stop. Panning also stops it. */
  follow(address: string | null): void {
    this.#follow = address;
    if (address !== null) this.#goal.distance = Math.min(this.#goal.distance, 30);
  }

  #placeCamera(dt: number): void {
    if (this.#follow !== null) {
      const a = this.#sim.heroAgent(this.#follow);
      if (a) this.#goal.target.set(a.x, 0, a.y);
    }
    const k = 1 - Math.exp(-4 * Math.max(0, dt));
    this.#target.lerp(this.#goal.target, k);
    this.#distance += (this.#goal.distance - this.#distance) * k;
    const c = Math.cos(this.#pitch);
    this.#camera.position.set(
      this.#target.x + Math.sin(this.#yaw) * c * this.#distance,
      this.#target.y + Math.sin(this.#pitch) * this.#distance,
      this.#target.z + Math.cos(this.#yaw) * c * this.#distance,
    );
    this.#camera.lookAt(this.#target);
  }

  // --- scene -----------------------------------------------------------------

  #build(): void {
    this.#world.clear();
    this.#buildings = [];
    for (const s of this.#sprites.values()) {
      s.body.removeFromParent();
      s.caravan.removeFromParent();
    }
    this.#sprites.clear();
    this.#clearPersons();
    const plan = this.#sim.plan;

    this.#bell = null;
    for (const b of plan.buildings) {
      const info = this.#buildBuilding(b);
      this.#world.add(info.group);
      this.#buildings.push(info);
    }

    const theme = this.#theme;
    if (theme?.surroundings) {
      // the theme's world: terrain, woods, props and lanterns around the town, PBR ground
      const s = theme.surroundings(townSite(plan, placeLamps(plan)));
      this.#world.add(s.group);
      this.#lamps = s.lamps;
      const surface = (w: 'road' | 'path'): THREE.Material => theme.groundMaterial?.(w) ?? this.#factory.mat(w === 'road' ? '#9a8f80' : '#8a7556');
      for (const m of tileSurfaces(plan, { paved: surface('road'), trodden: surface('path'), water: this.#themedWater })) this.#world.add(m);
      return;
    }

    // the ground: the same pixel-art tiles as the top-down view, on a diorama slab
    const groundTex = new THREE.CanvasTexture(bakeTopGround(plan).canvas);
    groundTex.magFilter = THREE.NearestFilter;
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_W / 2, 0, MAP_H / 2);
    ground.receiveShadow = true;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(MAP_W, 1.6, MAP_H), [
      this.#factory.mat('#7a5a3a'),
      this.#factory.mat('#6a4a2a'),
      this.#factory.mat('#78b856'),
      this.#factory.mat('#4a3420'),
      this.#factory.mat('#8a6a4a'),
      this.#factory.mat('#6a4a2a'),
    ]);
    slab.position.set(MAP_W / 2, -0.81, MAP_H / 2);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), this.#waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(42.5, 0.04, 32.5);
    this.#world.add(ground, slab, water);
    this.#buildProps(scatterProps(plan));
    this.#world.add(buildGrass(plan));
    this.#lamps = buildLamps(placeLamps(plan));
    this.#world.add(this.#lamps.group);
  }

  #buildBuilding(b: Placed): BuildingInfo {
    const sim = this.#sim;
    const protocol = b.protocolId !== undefined ? sim.guild.protocols.get(b.protocolId) : undefined;
    const hero = b.heroAddress !== undefined ? sim.guild.heroes.find((h) => h.address === b.heroAddress) : undefined;
    const guildColor = sim.guild.heroes[0] ? crestColors(sim.guild.heroes[0].address)[0] : P.red;
    const spec: BuildingSpec = {
      kind: b.kind,
      w: b.w,
      h: b.h,
      tier: (hero?.tier ?? 0) as Tier,
      roof: protocol ? brandColor(protocol.id) : '#a0522d',
      banner: b.kind === 'guildhall' || hero ? guildColor : P.red,
      iconUrl: protocol?.iconUrl ?? null,
    };
    const built = this.#theme ? this.#theme.building(spec) : this.#factory.build(spec);
    const g = built.group;
    g.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    const target = { kind: 'building', placed: b } satisfies HitTarget;
    g.traverse((o) => {
      o.userData.target = target;
    });
    if (built.bell) this.#bell = built.bell;
    const info: BuildingInfo = { placed: b, group: g, top: built.top };
    if (built.sign) info.sign = { ...built.sign, x: g.position.x + built.sign.x, z: g.position.z + built.sign.z };
    return info;
  }

  #buildProps(props: Prop[]): void {
    for (const o of buildPropMeshes(props, (c) => this.#factory.mat(c))) this.#world.add(o);
  }

  // --- sprites ---------------------------------------------------------------

  #texture(canvas: HTMLCanvasElement, flip: boolean): THREE.SpriteMaterial {
    let pair = this.#textures.get(canvas);
    if (pair === undefined) {
      const mk = (f: boolean): THREE.CanvasTexture => {
        const t = new THREE.CanvasTexture(canvas);
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        if (f) {
          t.wrapS = THREE.RepeatWrapping;
          t.repeat.x = -1;
        }
        return t;
      };
      pair = [mk(false), mk(true)];
      this.#textures.set(canvas, pair);
    }
    const tex = pair[flip ? 1 : 0];
    let mat = this.#spriteMats.get(tex);
    if (mat === undefined) {
      mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false, color: this.#spriteTint.clone() });
      this.#spriteMats.set(tex, mat);
    }
    return mat;
  }

  #placeSprite(obj: THREE.Sprite, s: Sprite, x: number, y: number, lift: number, flip: boolean, scale = 1): void {
    obj.material = this.#texture(s.canvas, flip);
    const w = (s.canvas.width / ART_PER_TILE) * scale;
    const h = (s.canvas.height / ART_PER_TILE) * scale;
    obj.scale.set(w, h, 1);
    obj.center.set(flip ? 1 - s.ax / s.canvas.width : s.ax / s.canvas.width, 1 - s.ay / s.canvas.height);
    obj.position.set(x, lift, y);
  }

  #syncAgents(dt: number): void {
    this.#agentShadows.count = 0;
    const seen = new Set<string>();
    for (const a of this.#sim.agents) {
      seen.add(a.id);
      let pair = this.#sprites.get(a.id);
      if (pair === undefined) {
        pair = { body: new THREE.Sprite(), caravan: new THREE.Sprite() };
        pair.body.userData.agent = a.id;
        if (a.kind === 'hero' && a.hero) pair.body.userData.target = { kind: 'hero', address: a.hero.address } satisfies HitTarget;
        this.#scene.add(pair.body, pair.caravan);
        this.#sprites.set(a.id, pair);
      }
      this.#drawAgent(a, pair.body, pair.caravan);
      // themed towns: a rigged person stands in for the hero's or villager's sprite
      const person = this.#people && (a.kind === 'hero' || a.kind === 'villager') ? this.#person(a) : null;
      pair.body.visible = person === null;
      if (person) this.#movePerson(person, a, dt);
    }
    this.#agentShadows.instanceMatrix.needsUpdate = true;
    for (const [id, pair] of this.#sprites) {
      if (seen.has(id)) continue;
      this.#facing.delete(id);
      pair.body.removeFromParent();
      pair.caravan.removeFromParent();
      this.#sprites.delete(id);
    }
    for (const [id, p] of this.#persons) {
      if (seen.has(id)) continue;
      p.char.dispose();
      this.#persons.delete(id);
    }
  }

  #person(a: Agent): Person | null {
    const people = this.#people;
    if (people === null) return null;
    let p = this.#persons.get(a.id);
    if (p === undefined) {
      const hero = a.kind === 'hero' ? a.hero : undefined;
      const char = people.create({
        id: a.id,
        kind: hero ? 'hero' : 'villager',
        cls: hero ? this.classOf(hero.address) : 'adventurer',
        tier: hero?.tier ?? 0,
        crest: hero ? crestColors(hero.address)[0] : '#888888',
        seed: hashString(hero?.address ?? a.id),
      });
      let proxy: THREE.Mesh | null = null;
      if (hero) {
        proxy = new THREE.Mesh(this.#proxyGeo, this.#proxyMat);
        proxy.userData.target = { kind: 'hero', address: hero.address } satisfies HitTarget;
        // mounted heroes are bigger targets
        if (hero.tier >= 2) proxy.scale.set(1.6, 1.3, 1.6);
        char.object.add(proxy);
      }
      this.#scene.add(char.object);
      p = { char, proxy, x: a.x, y: a.y, speed: 0, heading: 0, state: 'idle' };
      char.setState('idle');
      this.#persons.set(a.id, p);
    }
    return p;
  }

  /** Follow the agent: speed and heading from how it actually moved this frame. */
  #movePerson(p: Person, a: Agent, dt: number): void {
    const dx = a.x - p.x;
    const dz = a.y - p.y;
    const dist = Math.hypot(dx, dz);
    const measured = dt > 0 ? dist / dt : 0;
    p.speed += (measured - p.speed) * Math.min(1, dt * 8);
    if (dist > 1e-4) p.heading = Math.atan2(dz, dx);
    p.x = a.x;
    p.y = a.y;
    const state = a.path.length > 0 && p.speed > 0.05 ? (p.speed > RUN_FROM ? 'run' : 'walk') : 'idle';
    if (state !== p.state) {
      p.state = state;
      p.char.setState(state);
    }
    p.char.object.position.set(a.x, a.alt + (a.alt > 0.05 ? Math.sin(a.phase) * 0.1 : 0), a.y);
    p.char.update(dt, p.speed, p.heading, this.#camera);
  }

  #drawAgent(a: Agent, body: THREE.Sprite, caravan: THREE.Sprite): void {
    const moving = a.path.length > 0;
    const frame = moving ? Math.floor(a.phase) : 0;
    // Face the way the agent moves *on screen*: orbiting the camera must not
    // make people walk backwards.
    const next = a.path[0];
    let flip = this.#facing.get(a.id) ?? a.facing < 0;
    if (next !== undefined) {
      const dx = next.x - a.x;
      const dz = next.y - a.y;
      const screenRight = dx * Math.cos(this.#yaw) - dz * Math.sin(this.#yaw);
      if (Math.abs(screenRight) > 0.001) flip = screenRight < 0;
      this.#facing.set(a.id, flip);
    }
    // Height comes from the simulation: flyers cruise above the rooftops.
    const lift = a.alt + (a.alt > 0.05 ? Math.sin(a.phase) * 0.1 : moving ? 0 : Math.abs(Math.sin(a.phase * 2)) * 0.02);
    let s: Sprite;
    if (a.kind === 'hero' && a.hero) {
      const h = hashString(a.hero.address);
      s = heroArt({ address: a.hero.address, cls: this.classOf(a.hero.address), tier: a.hero.tier, crest: crestColors(a.hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 }, frame, false);
    } else if (a.kind === 'villager') {
      s = villagerArt(hashString(a.id), frame, true);
    } else {
      s = npcArt(a.kind === 'raven' ? 'raven' : a.kind === 'herald' ? 'herald' : 'bailiff', frame);
    }
    const scale = a.kind === 'hero' ? HERO_SCALE : a.kind === 'villager' ? 1.1 : 1.2;
    this.#placeSprite(body, s, a.x, a.y, lift, flip, scale);
    this.#shadow(a.x, a.y, a.kind === 'hero' ? (a.hero && a.hero.tier >= 5 ? 1.7 : 1.15) : a.kind === 'raven' ? 0.5 : 0.8, lift);

    const back = a.trail[a.flying ? 6 : 9];
    const cs = a.kind === 'hero' && a.carrying !== null && a.carrying > 0 ? caravanArt(a.carrying, frame, false) : null;
    caravan.visible = back !== undefined && cs !== null;
    if (back && cs) {
      this.#placeSprite(caravan, cs, back.x, back.y, lift * 0.6, flip, HERO_SCALE);
      this.#shadow(back.x, back.y, a.carrying !== null && a.carrying >= 4 ? 1.6 : 0.9, lift * 0.6);
    }
  }

  /** A soft contact shadow on the ground, smaller as the thing lifts off. */
  #shadow(x: number, y: number, size: number, lift: number): void {
    const i = this.#agentShadows.count;
    if (i >= this.#agentShadows.instanceMatrix.count) return;
    const s = size / (1 + lift * 0.8);
    this.#shadowMatrix.makeScale(s, 1, s * 0.75).setPosition(x, 0.03, y);
    this.#agentShadows.setMatrixAt(i, this.#shadowMatrix);
    this.#agentShadows.count = i + 1;
  }

  // --- frame -----------------------------------------------------------------

  draw(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const size = `${w}x${h}@${dpr}`;
    if (size !== this.#lastSize) {
      this.#lastSize = size;
      this.#pipeline.setSize(w, h, dpr);
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }

    this.#lighting(dt);
    this.#swingBell(dt);
    this.#placeCamera(dt);
    this.#syncAgents(dt);
    this.#highlight();
    if (this.#frame++ % 10 === 0) this.#occludeSigns();
    this.#pipeline.render();
    this.#overlay(dpr, w, h);
  }

  /**
   * The bell swings as a damped oscillation each time a block lands, and locks
   * exactly at rest once the envelope is spent (procedural-animation skill:
   * time-based, with a terminal lock rather than endless tiny residuals).
   */
  #swingBell(dt: number): void {
    for (const e of this.#sim.effects) {
      if (e.kind !== 'ring' || this.#rungRings.has(e)) continue;
      this.#rungRings.add(e);
      this.#bellSwing = { t: 0, amp: 0.55 };
    }
    const b = this.#bell;
    if (b === null) return;
    const st = this.#bellSwing;
    st.t += dt;
    const envelope = Math.exp(-st.t / 1.1);
    b.rotation.x = envelope < 0.01 ? 0 : st.amp * envelope * Math.sin((st.t * Math.PI * 2) / 1.05);
  }

  #lighting(dt: number): void {
    const sim = this.#sim;
    const night = nightFactor();
    const gloom = sim.gloom;
    const day = new THREE.Color('#9fd3f0');
    const dusk = new THREE.Color('#1c2450');
    // A siege brings lightning: brief flashes while the storm is at its height.
    if (gloom > 0.6 && Math.random() < dt * 0.6) this.#flash = 1;
    this.#flash = Math.max(0, this.#flash - dt * 5);
    this.#sky.copy(day).lerp(dusk, night).lerp(new THREE.Color('#3a3e48'), gloom * 0.8).lerp(new THREE.Color('#e8ecff'), this.#flash * 0.6);
    this.#sun.intensity = 2.2 * (1 - night * 0.8) * (1 - gloom * 0.6) + this.#flash * 2;
    this.#sun.color.set(night > 0.5 ? '#9fb0ff' : '#fff1d6');
    this.#hemi.intensity = 1.1 * (1 - night * 0.55) * (1 - gloom * 0.4) + this.#flash;
    // Emissive hierarchy (bloom skill): fire > lamp bulbs > windows > lit walls.
    // Only the first three exceed the HDR bloom threshold, and only at night.
    const windows = this.#theme?.windowMaterial ?? this.#factory.windowMat;
    const fire = this.#theme?.fireMaterial ?? this.#factory.fireMat;
    windows.emissiveIntensity = night * 1.7;
    fire.emissiveIntensity = 1.4 + night * 2.2;
    // A themed town is lit by its sky (image-based); the fill light steps back.
    if (this.#theme && this.#env) {
      const byHour = skyForHour(currentHour(), gloom > 0.5);
      const id = byHour === 'day' ? this.#theme.defaultSky : byHour;
      if (id !== this.#env.current) this.#env.use(id, this.#sky);
      if (this.#env.active) this.#hemi.intensity *= 0.3;
    }
    // Billboards are unlit; tint them so people do not glow at midnight.
    this.#spriteTint.setRGB(1, 1, 1).lerp(new THREE.Color('#7f88b8'), night * 0.85).lerp(new THREE.Color('#9a9aa6'), gloom * 0.5);
    for (const m of this.#spriteMats.values()) m.color.copy(this.#spriteTint);
    this.#lamps?.setNight(night);
    this.#pipeline.setNight(Math.max(night, gloom * 0.5));
    this.#waterMat.opacity = 0.8 + Math.sin(sim.elapsed * 1.3) * 0.06;
    // Wind: a breeze, rising with the storm.
    wind.uTime.value = sim.elapsed;
    wind.uStrength.value = 0.3 + gloom * 0.7;
    // a little shake for the big moments, separate from the camera's path
    if (sim.shake > 0) this.#target.x += (Math.random() - 0.5) * sim.shake * 0.08;
  }

  #highlight(): void {
    const t = this.selected ?? this.hover;
    if (t === null) {
      this.#ring.visible = false;
      return;
    }
    if (t.kind === 'building') {
      const b = t.placed;
      this.#ring.position.set(b.x + b.w / 2, 0.05, b.y + b.h / 2);
      this.#ring.scale.setScalar(Math.max(b.w, b.h) * 0.62);
    } else {
      const a = this.#sim.heroAgent(t.address);
      if (!a) return;
      this.#ring.position.set(a.x, 0.05, a.y);
      this.#ring.scale.setScalar(0.55);
    }
    this.#ring.visible = true;
  }

  #project: Project = (x, y, z = 0) => {
    const v = new THREE.Vector3(x, z, y).project(this.#camera);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * this.canvas.clientWidth, ((1 - v.y) / 2) * this.canvas.clientHeight];
  };

  #overlay(dpr: number, w: number, h: number): void {
    const c = this.canvas.getContext('2d');
    if (c === null) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const sim = this.#sim;
    for (const e of sim.effects) this.#effect(c, e);
    weather(c, sim, w, h, false);
    if (this.#distance > 30) districtLabels(c, this.#project);
    if (sim.route) route(c, sim.route, this.#project, sim.elapsed);
    const tops = new Map<string, [number, number]>();
    for (const b of this.#buildings) {
      const p = this.#project(b.placed.x + b.placed.w / 2, b.placed.y + b.placed.h / 2, b.top + 0.3);
      if (p) tops.set(b.placed.id, p);
    }
    this.#signLogos(c);
    markers(c, sim, tops);
    floatingText(c, sim, this.#project, 2.6);
    if (this.#distance < 55) nameTags(c, sim, (x, y, alt) => this.#project(x, y, 2.6 + alt));
  }

  /**
   * Logos are drawn on the 2D overlay (their hosts send no CORS headers), so
   * the depth buffer cannot hide them. A ray from the camera to each sign,
   * every few frames, tells which ones another building stands in front of.
   */
  #occludeSigns(): void {
    this.#hiddenSigns.clear();
    const origin = this.#camera.position;
    const groups = this.#buildings.map((b) => b.group);
    for (const b of this.#buildings) {
      const s = b.sign;
      if (s === undefined) continue;
      const to = new THREE.Vector3(s.x, s.y, s.z);
      const dir = to.clone().sub(origin);
      const dist = dir.length();
      this.#raycaster.set(origin, dir.normalize());
      this.#raycaster.far = dist - 0.15;
      const hit = this.#raycaster.intersectObjects(groups, true)[0];
      if (hit && (hit.object.userData.target as HitTarget | undefined)?.kind === 'building' && (hit.object.userData.target as { placed: Placed }).placed.id !== b.placed.id) {
        this.#hiddenSigns.add(b.placed.id);
      }
    }
    this.#raycaster.far = Infinity;
  }

  /** Protocol logos over the sign boards, when the sign faces the camera. */
  #signLogos(c: CanvasRenderingContext2D): void {
    if (this.#distance > 75) return;
    c.imageSmoothingEnabled = true;
    for (const b of this.#buildings) {
      const s = b.sign;
      if (s === undefined) continue;
      if (this.#camera.position.z - s.z < 0.5) continue; // seen from behind
      if (this.#hiddenSigns.has(b.placed.id)) continue; // another building is in the way
      let img = this.#logos.get(s.url);
      if (img === undefined) {
        img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = s.url;
        this.#logos.set(s.url, img);
      }
      if (!img.complete || img.naturalWidth === 0) continue;
      const a = this.#project(s.x - 0.27, s.z, s.y + 0.27);
      const d = this.#project(s.x + 0.27, s.z, s.y - 0.27);
      if (a === null || d === null) continue;
      const size = Math.max(Math.abs(d[0] - a[0]), Math.abs(d[1] - a[1]));
      if (size < 6) continue;
      c.drawImage(img, (a[0] + d[0]) / 2 - size / 2, (a[1] + d[1]) / 2 - size / 2, size, size);
    }
  }

  /** Bell rings, coins, smoke and alarms, drawn in screen space at their 3D spot. */
  #effect(c: CanvasRenderingContext2D, e: Effect): void {
    const k = e.age / e.ttl;
    const zoom = Math.max(0.5, Math.min(2.5, 50 / this.#distance));
    switch (e.kind) {
      case 'ring': {
        const tower = this.#buildings.find((b) => b.placed.kind === 'tower');
        const p = this.#project(e.x, e.y, (tower?.top ?? 6) - 1.6);
        if (!p) return;
        c.strokeStyle = `rgba(255,236,160,${(1 - k) * 0.9})`;
        c.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const r = (8 + (k + i * 0.15) * 70) * zoom;
          c.beginPath();
          c.ellipse(p[0], p[1], r, r * 0.45, 0, 0, Math.PI * 2);
          c.stroke();
        }
        return;
      }
      case 'coins':
      case 'sparkle': {
        const p = this.#project(e.x, e.y, 0.8);
        if (!p) return;
        const n = 6 + e.drama * 6;
        c.globalAlpha = 1 - k;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = k * (20 + e.drama * 14) * zoom;
          c.fillStyle = e.color ?? (e.kind === 'sparkle' ? (i % 2 ? '#fff6c0' : '#a0e8ff') : '#f5c518');
          c.fillRect(p[0] + Math.cos(ang) * r - 2, p[1] - Math.sin(ang) * r * 0.6 - k * 20 - 2, 4, 4);
        }
        c.globalAlpha = 1;
        return;
      }
      case 'smoke': {
        const p = this.#project(e.x, e.y, 0.8);
        if (!p) return;
        for (let i = 0; i < 5; i++) {
          c.fillStyle = `rgba(90,90,90,${0.5 * (1 - k)})`;
          c.beginPath();
          c.arc(p[0] + Math.sin(i * 2) * 8, p[1] - k * 30 - i * 4, (5 + k * 8) * zoom, 0, Math.PI * 2);
          c.fill();
        }
        return;
      }
      case 'key': {
        const p = this.#project(e.x, e.y, 1.6 + k);
        if (!p) return;
        c.globalAlpha = 1 - k;
        c.fillStyle = e.color ?? '#ffd166';
        c.fillRect(p[0] - 8, p[1], 6, 6);
        c.fillRect(p[0] - 2, p[1] + 2, 10, 2);
        c.fillRect(p[0] + 6, p[1] + 2, 2, 4);
        c.globalAlpha = 1;
        return;
      }
      case 'alarm': {
        if (Math.floor(e.age * 6) % 2 !== 0) return;
        const tower = this.#buildings.find((b) => b.placed.kind === 'tower');
        const p = this.#project(e.x, e.y + 2, tower?.top ?? 6);
        if (!p) return;
        c.strokeStyle = 'rgba(255,70,50,0.9)';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(p[0], p[1], (20 + e.drama * 10) * zoom, (9 + e.drama * 4) * zoom, 0, 0, Math.PI * 2);
        c.stroke();
        return;
      }
      default:
        return;
    }
  }

  /** Where a hero stands on screen (CSS px in the canvas), for tests: the middle of its body or rider. */
  heroOnScreen(address?: string): [number, number] | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const a of this.#sim.agents) {
      if (a.kind !== 'hero' || !a.hero || (address !== undefined && a.hero.address !== address)) continue;
      const p = this.#project(a.x, a.y, a.alt + (a.hero.tier >= 2 ? 0.9 : 0.6));
      if (p && p[0] > 40 && p[1] > 40 && p[0] < w - 40 && p[1] < h - 40) return p;
    }
    return null;
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    const ndc = new THREE.Vector2((sx / this.canvas.clientWidth) * 2 - 1, -(sy / this.canvas.clientHeight) * 2 + 1);
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const heroes: THREE.Object3D[] = [...this.#sprites.values()].map((p) => p.body).filter((s) => s.visible && s.userData.target !== undefined);
    for (const p of this.#persons.values()) if (p.proxy) heroes.push(p.proxy);
    const hitHero = this.#raycaster.intersectObjects(heroes, false)[0];
    if (hitHero) return hitHero.object.userData.target as HitTarget;
    const hit = this.#raycaster.intersectObjects(this.#buildings.map((b) => b.group), true)[0];
    return hit ? ((hit.object.userData.target as HitTarget | undefined) ?? null) : null;
  }
}
