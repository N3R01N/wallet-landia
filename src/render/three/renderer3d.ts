/**
 * The 3D view: a diorama of the same town. Built in, buildings are low-poly
 * meshes from the same style table as the 2D sprites and people are pixel-art
 * billboards (an "HD-2D" look). With a theme bundle (Phase 7) the town gets the
 * theme's grammar-built buildings, terrain, woods, props and lanterns, PBR
 * ground, sky lighting, and rigged people on their mounts.
 *
 * This class ties the parts together: the camera (CameraRig), the standing
 * town (TownScene), its people (PeopleLayer), the light (DayNight) and the 2D
 * layer on top (Overlay3D).
 *
 * Loaded on demand — `three` only ships to players who open the 3D view.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import { crestColors, hashString } from '../../util/rng.js';
import type { Sim } from '../../world/sim.js';
import { ImagePipeline, type DebugView, type Quality } from './pipeline.js';
import { bundleTheme, type Theme } from './themes.js';
import type { ThemeBundle } from '../../assets/themeBundles.js';
import { PortraitStudio } from './portrait.js';
import type { HitTarget, WorldView } from '../view.js';
import { spriteCharacters } from './spriteCharacters.js';
import { CameraRig } from './cameraRig.js';
import { TownScene } from './townScene.js';
import { PeopleLayer, type PersonDebug } from './peopleLayer.js';
import { DayNight } from './dayNight.js';
import { Overlay3D } from './overlay3d.js';

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
  #cam = new CameraRig();
  #light: DayNight;
  #town = new TownScene();
  #people: PeopleLayer;
  #overlay: Overlay3D;
  #ring: THREE.Mesh;
  #raycaster = new THREE.Raycaster();
  /** The theme bundle drawing the town, or null for the built-in look. */
  #theme: Theme | null = null;

  #pipeline: ImagePipeline;
  #lastSize = '';
  #lastFrame = performance.now();
  #frame = 0;
  // scratch for picking: no garbage on every pointer move
  #ndc = new THREE.Vector2();
  #pickList: THREE.Object3D[] = [];

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
    // count every pass of a frame (shadows, post) together; reset in draw()
    this.#gl.info.autoReset = false;
    const camera = this.#cam.camera;
    this.#pipeline = new ImagePipeline(this.#gl, this.#scene, camera, quality);
    this.#people = new PeopleLayer(this.#scene, camera, (a) => this.classOf(a));
    this.#overlay = new Overlay3D(this.canvas, camera);
    this.#pipeline.aoExclusions = () => {
      const out: THREE.Object3D[] = [];
      this.#people.aoExclusions(out);
      if (this.#town.smoke) out.push(this.#town.smoke.points);
      if (this.#town.critters) out.push(this.#town.critters.glow);
      if (this.#town.lamps) out.push(this.#town.lamps.pools);
      return out;
    };

    this.#light = new DayNight(this.#gl, this.#scene);
    this.#scene.add(this.#town.world);
    this.#light.applyShadowTier(this.#pipeline.quality);

    this.#ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 40),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    this.#ring.rotation.x = -Math.PI / 2;
    this.#ring.visible = false;
    this.#scene.add(this.#ring);

    this.#build();
  }

  /**
   * A new sim (a live update, a realm or window change). Most live updates bring the same
   * town (same plan, same buildings in the same tiers and brands): then the town stands and
   * only what the sim itself holds is redone. The same sim again means something it does
   * not hold changed (packs, crests): built anew.
   */
  setSim(sim: Sim): void {
    const same = sim === this.#sim;
    this.#sim = sim;
    if (same || !this.#town.matches(sim, this.#theme)) this.#build();
    else {
      this.#town.refresh(sim);
      this.#people.refresh(sim);
    }
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
    const old = this.#theme;
    this.#theme = theme;
    this.#people.setTheme(theme);
    // for tests and debugging: which theme draws the town, and whether its people are in
    this.element.dataset.theme = theme?.id ?? '';
    this.element.dataset.people = 'sprites';
    this.#light.setTheme(theme);
    this.#build();
    // nothing draws with the old theme now (its town and people are gone): free its materials and textures
    old?.dispose?.();
    if (theme?.prepare) {
      await theme.prepare();
      if (this.#theme !== theme) return; // switched again meanwhile
    }
    // a theme without characters keeps the town's own sprites (tinted at night, one contact shadow)
    const rigged = theme && theme.characters !== spriteCharacters ? theme.characters : null;
    this.#people.ready(rigged);
    if (rigged) this.element.dataset.people = 'rigged';
  }

  setQuality(q: Quality): void {
    this.#pipeline.setQuality(q);
    this.#light.applyShadowTier(q);
    this.#lastSize = '';
  }

  /** Validation views: final, no post, AO only, no grade. */
  setDebug(view: DebugView): void {
    this.#pipeline.debug = view;
  }

  // --- camera ----------------------------------------------------------------

  #aspect(): number {
    return Math.max(0.5, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
  }

  fit(): void {
    this.#cam.fit(this.#aspect());
  }

  /** Fixed views for visual validation. */
  bookmark(name: 'near' | 'design' | 'far'): void {
    this.#cam.bookmark(name, this.#aspect());
  }

  pan(dx: number, dy: number): void {
    this.#cam.pan(dx, dy);
  }

  zoomAt(_sx: number, _sy: number, factor: number): void {
    this.#cam.zoom(factor);
  }

  rotate(dx: number, dy: number): void {
    this.#cam.rotate(dx, dy);
  }

  /** Glide to a tile position, coming a little closer if far away. */
  focus(x: number, y: number): void {
    this.#cam.focus(x, y);
  }

  /**
   * Keep someone in view (Quest Replay): a hero, or the raven or herald that
   * brings them something; `then` (a hero) once they have left town. Null to
   * stop; panning also stops it.
   */
  follow(key: string | null, then: string | null = null): void {
    this.#cam.follow(key, then);
  }

  /** Who the camera keeps in view (null: no one; panning lets go). */
  get following(): string | null {
    return this.#cam.following;
  }

  // --- scene -----------------------------------------------------------------

  /** The whole town anew: its people too. */
  #build(): void {
    this.#people.clear();
    this.#town.build(this.#sim, this.#theme);
    if (this.#town.smoke) this.#lastSize = ''; // size the puffs to the viewport
  }

  // --- frame -----------------------------------------------------------------

  draw(): void {
    this.#people.bakeNext();
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const size = `${w}x${h}@${dpr}`;
    const camera = this.#cam.camera;
    if (size !== this.#lastSize) {
      this.#lastSize = size;
      this.#pipeline.setSize(w, h, dpr);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      this.#town.smoke?.setViewport(h * dpr, camera.fov);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }

    this.#gl.info.reset();
    const town = this.#town;
    this.#light.update(dt, this.#sim, this.#theme, { windows: town.windowMaterial, fire: town.fireMaterial }, this.#people.spriteMats, this.#pipeline);
    town.animate(this.#sim, dt, this.#light.night, this.#light.gloom);
    this.#cam.shake(this.#sim.shake);
    this.#cam.place(dt, this.#sim);
    this.#people.sync(this.#sim, dt, this.#cam.yaw);
    this.#highlight();
    if (this.#frame++ % 10 === 0) this.#overlay.occludeSigns(town);
    this.#pipeline.render();
    this.#overlay.draw(dpr, w, h, this.#sim, town, this.#cam.distance);
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

  /** What the last frame cost (all passes), for tests and tuning. `persons`: rigged models made. */
  stats(): { calls: number; triangles: number; geometries: number; textures: number; persons: number; agents: number } {
    const i = this.#gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, persons: this.#people.rigCount(), agents: this.#sim.agents.length };
  }

  /** Agents and their rigged stand-ins (`ox`/`oz`: the model, if one is made), for tests and tuning tools only. */
  debugPeople(): PersonDebug[] {
    return this.#people.debug(this.#sim);
  }

  /** Build the whole town again, as a new town or theme would (tests only: GPU resources must not grow with rebuilds). */
  debugRebuild(): void {
    this.#build();
  }

  /** A live update that leaves the town as it is (tests only): the town stands; piles and people are redone. */
  debugRefresh(): void {
    this.#town.refresh(this.#sim, true);
    this.#people.refresh(this.#sim);
  }

  /** The scene, for tests and tuning tools only. */
  debugScene(): THREE.Scene {
    return this.#scene;
  }

  #portraits: PortraitStudio | null = null;

  /**
   * A portrait of a hero in the theme's own look (its rigged character), as an
   * image URL; null when the town is drawn in the built-in look or its people
   * have not loaded yet.
   */
  portrait(address: string, cls: HeroClass): string | null {
    const people = this.#people.provider;
    if (people === null || this.#theme === null) return null;
    const crest = crestColors(address)[0];
    const seed = hashString(address);
    this.#portraits ??= new PortraitStudio();
    // on foot: a mount would fill the frame
    return this.#portraits.shoot(`${this.#theme.id}:${cls}:${crest}:${seed}`, () => people.create({ id: `portrait:${address}`, kind: 'hero', cls, tier: 0, crest, seed }));
  }

  /** Put the camera somewhere at once (tuning tools only): looking at (x, y) from `distance` tiles. */
  debugCamera(x: number, y: number, distance: number, yaw: number, pitch: number): void {
    this.#cam.set(x, y, distance, yaw, pitch);
  }

  /** Where a hero stands on screen (CSS px in the canvas), for tests: the middle of its body or rider. */
  heroOnScreen(address?: string): [number, number] | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const a of this.#sim.agents) {
      if (a.kind !== 'hero' || !a.hero || a.inside || (address !== undefined && a.hero.address !== address)) continue;
      const p = this.#overlay.project(a.x, a.y, a.alt + (a.hero.tier >= 2 ? 0.9 : 0.6));
      if (p && p[0] > 40 && p[1] > 40 && p[0] < w - 40 && p[1] < h - 40) return p;
    }
    return null;
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    // runs on every pointer move: scratch vector and list, no garbage
    this.#raycaster.setFromCamera(this.#ndc.set((sx / this.canvas.clientWidth) * 2 - 1, -(sy / this.canvas.clientHeight) * 2 + 1), this.#cam.camera);
    const heroes = this.#pickList;
    heroes.length = 0;
    this.#people.pickables(heroes);
    const hitHero = this.#raycaster.intersectObjects(heroes, false)[0];
    heroes.length = 0;
    if (hitHero) return hitHero.object.userData.target as HitTarget;
    const hit = this.#raycaster.intersectObjects(this.#town.buildingGroups, true)[0];
    return hit ? ((hit.object.userData.target as HitTarget | undefined) ?? null) : null;
  }
}
