/**
 * The 3D town's people: every agent as a pixel-art billboard with a soft
 * contact shadow; in a themed town, the theme's rigged people up close (only
 * the nearest few, made when they qualify and freed a while after), its
 * figures baked to sprites beyond, and 3D couriers and caravans.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import type { Tier } from '../../domain/tiers.js';
import { crestColors, hashString } from '../../util/rng.js';
import { CARAVAN_BACK, type Agent, type Sim } from '../../world/sim.js';
import { caravanArt, heroArt, npcArt, villagerArt } from '../../assets/art.js';
import type { Sprite } from '../pixel.js';
import type { HitTarget } from '../view.js';
import type { CharacterLook, CharacterProvider, SandboxCharacter, Theme } from './themes.js';
import type { Companion } from './grammar/companions.js';
import { ImpostorStudio, sideSeen } from './impostor.js';
import { disposeTree, keep } from './dispose.js';
import { SpriteMaterials } from './spriteMaterials.js';

/** Art pixels per tile, so sprites keep their 2D proportions. */
const ART_PER_TILE = 16;
/** People read better a little larger than the buildings' scale. */
const HERO_SCALE = 1.35;

/**
 * One of the theme's people standing in for an agent (themed towns): how it moves, and its
 * rigged model only while it is among the nearest (see RIG); the impostor sprite otherwise.
 */
interface Person {
  /** The rigged model and an invisible stand-in the pointer can hit (skinned meshes raycast poorly). */
  rig: { char: SandboxCharacter; proxy: THREE.Mesh | null } | null;
  /** Its look (`lookKey`): a live update that changes it (a new tier) makes a new person. */
  look: string;
  x: number;
  y: number;
  speed: number;
  heading: number;
  state: 'idle' | 'walk' | 'run';
  /** Drawn as a rigged model now (else the sprite stands in). */
  shown: boolean;
  /** Casting shadows now. */
  shadow: boolean;
  /** When it last switched between model and sprite (seconds, renderer clock). */
  switchedAt: number;
}

const lookKey = (l: CharacterLook): string => `${l.kind}|${l.cls}|${l.tier}|${l.crest}|${l.seed}`;

/** Above this many tiles per second a rigged person runs. */
const RUN_FROM = 1.7;
/**
 * Level of detail for people (tiles from the camera): rigged models up close,
 * sprites beyond; only so many rigged at once, the nearest first; only the
 * nearest cast shadows. The gap between show and hide stops flicker.
 */
const RIG = { show: 70, hide: 78, max: 20, shadow: 42, shadowMax: 8, keep: 8, newPerFrame: 4 };
// (keep: a model out of use this many seconds is freed, so one hovering at the edge is not
// made and freed over and over; newPerFrame: models made in one frame, so a crowd coming
// into view, or the theme's people arriving, costs a few frames rather than one long one)

/** A courier or caravan gone: its own geometries freed (theme materials are shared and stay). */
function dropCompanion(c: Companion): void {
  c.object.removeFromParent();
  disposeTree(c.object);
}

/** One agent's debugging view (see `Renderer3D.debugPeople`). */
export interface PersonDebug {
  id: string;
  kind: string;
  x: number;
  y: number;
  alt: number;
  moving: boolean;
  shown: boolean | null;
  state: string | null;
  ox: number | null;
  oz: number | null;
  inside: boolean;
  doorway: string | null;
}

export class PeopleLayer {
  /** Soft contact shadows under everyone, one instanced mesh. */
  readonly shadows: THREE.InstancedMesh;
  readonly #scene: THREE.Scene;
  readonly #camera: THREE.Camera;
  readonly #classOf: (address: string) => HeroClass;
  #sprites = new Map<string, { body: THREE.Sprite; caravan: THREE.Sprite }>();
  /** People's billboards (pixel art and impostors), the most recently used kept. */
  readonly spriteMats = new SpriteMaterials();
  /** The theme drawing the town, or null for the built-in look. */
  #theme: Theme | null = null;
  /** Rigged people, once the theme's characters have loaded. */
  #people: CharacterProvider | null = null;
  /** The theme's assets are in (its people, 3D couriers and caravans may come out). */
  #themeReady = false;
  #persons = new Map<string, Person>();
  /** Rigged models made this frame (see RIG.newPerFrame). */
  #madeThisFrame = 0;
  /** Themed towns: 3D couriers and caravans in place of their sprites. */
  #couriers = new Map<string, { c: Companion; x: number; y: number; yaw: number }>();
  #caravans = new Map<string, { c: Companion; tier: number; x: number; y: number }>();
  #proxyGeo = keep(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 8).translate(0, 0.9, 0));
  #proxyMat = keep(new THREE.MeshBasicMaterial({ visible: false }));
  /** Last screen-facing per agent, so idle sprites keep their side. */
  #facing = new Map<string, boolean>();
  #shadowGeo = new THREE.CircleGeometry(0.32, 16);
  #shadowMatrix = new THREE.Matrix4();
  /** Bakes the theme's people into sprites for those beyond the nearest few. */
  #impostors: ImpostorStudio | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera, classOf: (address: string) => HeroClass) {
    this.#scene = scene;
    this.#camera = camera;
    this.#classOf = classOf;
    this.shadows = new THREE.InstancedMesh(this.#shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }), 400);
    this.#shadowGeo.rotateX(-Math.PI / 2);
    // instances move every frame but the bounds are computed once: never cull on them
    this.shadows.frustumCulled = false;
    scene.add(this.shadows);
  }

  /** The rigged characters drawing people now, if any (portraits use them too). */
  get provider(): CharacterProvider | null {
    return this.#people;
  }

  /** A new theme (or none): its people come with `ready`; the old one's figures are dropped. */
  setTheme(theme: Theme | null): void {
    this.#theme = theme;
    this.#people = null;
    this.#themeReady = false;
    // a new theme, new figures: one studio (one WebGL context) for good, its shots and their textures dropped
    this.#impostors?.reset();
    this.spriteMats.dropSmooth();
    this.clear();
  }

  /** The theme's assets are in; `people` its rigged characters (null: the town's own sprites). */
  ready(people: CharacterProvider | null): void {
    this.#themeReady = this.#theme !== null;
    this.#people = people;
  }

  /** Everyone gone (a new town): sprites, models, couriers and caravans. */
  clear(): void {
    this.#dropSprites();
    for (const p of this.#persons.values()) p.rig?.char.dispose();
    this.#persons.clear();
    this.#dropCompanions();
  }

  /**
   * A new sim over the same town: sprites, couriers and caravans are the new sim's; people
   * whose look is unchanged keep their models, placed where the new sim has them.
   */
  refresh(sim: Sim): void {
    this.#dropSprites();
    this.#dropCompanions();
    const agents = new Map(sim.agents.map((a) => [a.id, a]));
    for (const [id, p] of this.#persons) {
      const a = agents.get(id);
      if (a && a.kind !== 'raven' && lookKey(this.#lookOf(a)) === p.look) {
        // (no stride across town in one frame)
        p.x = a.x;
        p.y = a.y;
        p.speed = 0;
        continue;
      }
      p.rig?.char.dispose();
      this.#persons.delete(id);
    }
  }

  #dropSprites(): void {
    for (const s of this.#sprites.values()) {
      s.body.removeFromParent();
      s.caravan.removeFromParent();
    }
    this.#sprites.clear();
  }

  #dropCompanions(): void {
    for (const c of this.#couriers.values()) dropCompanion(c.c);
    this.#couriers.clear();
    for (const c of this.#caravans.values()) dropCompanion(c.c);
    this.#caravans.clear();
  }

  /** One more of the theme's figures baked into a sprite, if any wait (never more than one a frame). */
  bakeNext(): void {
    this.#impostors?.bakeNext();
  }

  /** What ambient occlusion must leave out: the billboards and the contact shadows. */
  aoExclusions(out: THREE.Object3D[]): void {
    out.push(this.shadows);
    for (const p of this.#sprites.values()) out.push(p.body, p.caravan);
  }

  /** What the pointer can pick: visible hero sprites and the shown models' stand-ins. */
  pickables(out: THREE.Object3D[]): void {
    for (const p of this.#sprites.values()) if (p.body.visible && p.body.userData.target !== undefined) out.push(p.body);
    for (const p of this.#persons.values()) if (p.rig?.proxy && p.shown && p.rig.char.object.visible) out.push(p.rig.proxy);
  }

  /** People drawn with a rigged model made (shown or kept a while). */
  rigCount(): number {
    let n = 0;
    for (const p of this.#persons.values()) if (p.rig) n++;
    return n;
  }

  debug(sim: Sim): PersonDebug[] {
    return sim.agents.map((a) => {
      const p = this.#persons.get(a.id);
      return { id: a.id, kind: a.kind, x: a.x, y: a.y, alt: a.alt, moving: a.path.length > 0, shown: p ? p.shown : null, state: p ? p.state : null, ox: p?.rig ? p.rig.char.object.position.x : null, oz: p?.rig ? p.rig.char.object.position.z : null, inside: a.inside, doorway: a.doorway };
    });
  }

  /** Everyone for this frame; `yaw` the camera's, so sprites face the way they walk on screen. */
  sync(sim: Sim, dt: number, yaw: number): void {
    this.shadows.count = 0;
    this.#madeThisFrame = 0;
    const seen = new Set<string>();
    // people nearest the camera get the rigged models (see RIG)
    const cam = this.#camera.position;
    const ranks = new Map<string, { dist: number; rank: number }>();
    if (this.#people) {
      // Whoever is drawn as a model now keeps a head start, so two people near
      // the cut-off do not trade places (and looks) every frame as they move.
      const near = sim.agents
        .filter((a) => a.kind !== 'raven')
        .map((a) => {
          const d = Math.hypot(a.x - cam.x, a.alt - cam.y, a.y - cam.z);
          const shown = this.#persons.get(a.id)?.shown === true;
          return [a.id, d, shown ? d * 0.6 - 6 : d] as const;
        })
        .sort((x, y) => x[2] - y[2]);
      near.forEach(([id, d], i) => ranks.set(id, { dist: i < RIG.max ? d : Infinity, rank: i }));
    }
    for (const a of sim.agents) {
      seen.add(a.id);
      let pair = this.#sprites.get(a.id);
      if (pair === undefined) {
        pair = { body: new THREE.Sprite(), caravan: new THREE.Sprite() };
        pair.body.userData.agent = a.id;
        if (a.kind === 'hero' && a.hero) pair.body.userData.target = { kind: 'hero', address: a.hero.address } satisfies HitTarget;
        this.#scene.add(pair.body, pair.caravan);
        this.#sprites.set(a.id, pair);
      }
      this.#drawAgent(sim, a, pair.body, pair.caravan, yaw);
      // themed towns: a rigged person stands in for the hero's or villager's sprite
      const person = this.#people && a.kind !== 'raven' ? this.#person(a) : null;
      const rigged = person !== null && this.#lod(a, person, ranks.get(a.id) ?? { dist: Infinity, rank: Infinity });
      pair.body.visible = !rigged && !a.inside;
      if (person) {
        // indoors: out of sight (the model keeps its LOD state for when they come out)
        if (person.rig) person.rig.char.object.visible = person.shown && !a.inside;
        this.#movePerson(person, a, dt);
      }
      // farther off, the theme's own figure as a sprite (the pixel sprite only until it is baked)
      if (person && !rigged && !a.inside) this.#impostor(a, person, pair.body);
      const companions = this.#theme?.companions;
      if (companions && this.#themeReady) {
        if (a.kind === 'raven') {
          this.#moveCourier(a, dt, companions.courier);
          pair.body.visible = false;
        }
        if (this.#moveCaravan(a, dt, companions.caravan)) pair.caravan.visible = false;
      }
    }
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const [id, pair] of this.#sprites) {
      if (seen.has(id)) continue;
      this.#facing.delete(id);
      pair.body.removeFromParent();
      pair.caravan.removeFromParent();
      this.#sprites.delete(id);
    }
    for (const [id, p] of this.#persons) {
      if (seen.has(id)) continue;
      p.rig?.char.dispose();
      this.#persons.delete(id);
    }
    for (const [id, c] of this.#couriers) {
      if (seen.has(id)) continue;
      dropCompanion(c.c);
      this.#couriers.delete(id);
    }
    for (const [id, c] of this.#caravans) {
      if (seen.has(id)) continue;
      dropCompanion(c.c);
      this.#caravans.delete(id);
    }
  }

  /** How an agent looks as one of the theme's people (heralds and bailiffs dress like a bard and a paladin, on foot). */
  #lookOf(a: Agent): CharacterLook {
    const hero = a.kind === 'hero' ? a.hero : undefined;
    const npc = a.kind === 'herald' ? 'bard' : a.kind === 'bailiff' ? 'paladin' : null;
    return {
      id: a.id,
      kind: hero || npc ? 'hero' : 'villager',
      cls: hero ? this.#classOf(hero.address) : (npc ?? 'adventurer'),
      tier: hero?.tier ?? 0,
      crest: hero ? crestColors(hero.address)[0] : '#888888',
      seed: hashString(hero?.address ?? a.id),
    };
  }

  /**
   * A themed person beyond the nearest few: the theme's own figure, baked to
   * a sprite from the side the camera sees. False until its look is baked.
   */
  #impostor(a: Agent, p: Person, body: THREE.Sprite): boolean {
    const people = this.#people;
    if (people === null || this.#theme === null) return false;
    const look = this.#lookOf(a);
    this.#impostors ??= new ImpostorStudio();
    const imp = this.#impostors.get(`${this.#theme.id}|${look.kind}|${look.cls}|${look.tier}|${look.crest}|${look.seed}`, () => people.create({ ...look, id: `impostor:${a.id}` }));
    if (imp === null) return false;
    const cam = this.#camera.position;
    const yaw = Math.atan2(Math.cos(p.heading), Math.sin(p.heading));
    const side = sideSeen(yaw, cam.x - a.x, cam.z - a.y);
    const pose = p.state === 'idle' ? 0 : 1 + (Math.floor(a.phase) % 2);
    const frame = imp.frames[side]?.[pose];
    if (!frame) return false;
    body.material = this.spriteMats.get(frame.canvas, false, true);
    body.scale.set(imp.width, imp.height, 1);
    body.center.set(0.5, imp.foot);
    body.position.set(a.x, a.alt, a.y);
    return true;
  }

  /** The agent's person: a light record; its model comes when it qualifies (`#lod`). */
  #person(a: Agent): Person | null {
    if (this.#people === null) return null;
    let p = this.#persons.get(a.id);
    if (p === undefined) {
      p = { rig: null, look: lookKey(this.#lookOf(a)), x: a.x, y: a.y, speed: 0, heading: 0, state: 'idle', shown: false, shadow: true, switchedAt: -1e9 };
      this.#persons.set(a.id, p);
    }
    return p;
  }

  /** Make a person's rigged model, in its current state. */
  #rig(a: Agent, p: Person, people: CharacterProvider): NonNullable<Person['rig']> {
    const hero = a.kind === 'hero' ? a.hero : undefined;
    const char = people.create(this.#lookOf(a));
    let proxy: THREE.Mesh | null = null;
    if (hero) {
      proxy = new THREE.Mesh(this.#proxyGeo, this.#proxyMat);
      proxy.userData.target = { kind: 'hero', address: hero.address } satisfies HitTarget;
      // mounted heroes are bigger targets
      if (hero.tier >= 2) proxy.scale.set(1.6, 1.3, 1.6);
      char.object.add(proxy);
    }
    this.#scene.add(char.object);
    char.setState(p.state);
    p.shadow = true; // a new model casts shadows: `#lod` sets them as they should be
    return { char, proxy };
  }

  /** The courier (raven or drone) flying with its agent. */
  #moveCourier(a: Agent, dt: number, make: () => Companion): void {
    let c = this.#couriers.get(a.id);
    if (!c) {
      c = { c: make(), x: a.x, y: a.y, yaw: 0 };
      this.#scene.add(c.c.object);
      this.#couriers.set(a.id, c);
    }
    const dx = a.x - c.x;
    const dz = a.y - c.y;
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    if (Math.hypot(dx, dz) > 1e-4) c.yaw = Math.atan2(dx, dz);
    c.x = a.x;
    c.y = a.y;
    c.c.object.position.set(a.x, a.alt + 0.4 + Math.sin(a.phase) * 0.08, a.y);
    c.c.object.rotation.y = c.yaw;
    c.c.update(dt, speed);
  }

  /** A hero's caravan, following its trail. Returns whether one is shown. */
  #moveCaravan(a: Agent, dt: number, make: (tier: Tier, crest: string) => Companion): boolean {
    const back = a.trail[CARAVAN_BACK];
    const tier = a.kind === 'hero' && a.carrying !== null && a.carrying > 0 ? a.carrying : 0;
    let c = this.#caravans.get(a.id);
    if (!back || tier === 0) {
      if (c) c.c.object.visible = false;
      return false;
    }
    if (!c || c.tier !== tier) {
      if (c) dropCompanion(c.c);
      c = { c: make(tier as Tier, a.hero ? crestColors(a.hero.address)[0] : '#a0522d'), tier, x: back.x, y: back.y };
      this.#scene.add(c.c.object);
      this.#caravans.set(a.id, c);
    }
    const speed = dt > 0 ? Math.hypot(back.x - c.x, back.y - c.y) / dt : 0;
    c.x = back.x;
    c.y = back.y;
    c.c.object.visible = true;
    c.c.object.position.set(back.x, 0, back.y); // on the ground, behind
    // face the leader
    if (Math.hypot(a.x - back.x, a.y - back.y) > 0.05) c.c.object.rotation.y = Math.atan2(a.x - back.x, a.y - back.y);
    c.c.update(dt, speed);
    return true;
  }

  /**
   * Rigged or sprite, shadows or not, for this frame. `dist` is Infinity past the cap; `rank` 0
   * is the nearest. The model is made when the person first qualifies (at most RIG.newPerFrame
   * a frame: the rest wait a frame as sprites) and freed once out of use for RIG.keep seconds.
   */
  #lod(a: Agent, p: Person, { dist, rank }: { dist: number; rank: number }): boolean {
    const now = performance.now() / 1000;
    let show = dist < (p.shown ? RIG.hide : RIG.show);
    // and no switching back and forth: a model stays at least 3 s, a sprite at least 1 s
    if (show !== p.shown && now - p.switchedAt < (p.shown ? 3 : 1)) show = p.shown;
    if (show && !p.rig) {
      if (this.#people === null || this.#madeThisFrame >= RIG.newPerFrame) show = false;
      else {
        this.#madeThisFrame++;
        p.rig = this.#rig(a, p, this.#people);
      }
    }
    if (show !== p.shown) {
      p.shown = show;
      p.switchedAt = now;
      if (p.rig) p.rig.char.object.visible = show;
    }
    const rig = p.rig;
    if (rig === null) return false;
    if (!show && now - p.switchedAt > RIG.keep) {
      rig.char.dispose();
      p.rig = null;
      return false;
    }
    // real shadows only for the nearest few; everyone keeps the soft contact blob
    const shadow = show && dist < RIG.shadow && rank < RIG.shadowMax;
    if (shadow !== p.shadow) {
      p.shadow = shadow;
      rig.char.object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o !== rig.proxy) o.castShadow = shadow;
      });
    }
    return show;
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
      p.rig?.char.setState(state);
    }
    const char = p.rig?.char;
    if (!char || !p.shown || a.inside) return; // a sprite stands in (or nobody to see): no need to animate
    char.gesture?.(a.acting?.gesture ?? null);
    char.object.position.set(a.x, a.alt + (a.alt > 0.05 ? Math.sin(a.phase) * 0.1 : 0), a.y);
    const face = a.face && Math.hypot(a.face.x - a.x, a.face.y - a.y) > 0.05 ? Math.atan2(a.face.y - a.y, a.face.x - a.x) : undefined;
    char.update(dt, p.speed, p.heading, this.#camera, face);
  }

  #placeSprite(obj: THREE.Sprite, s: Sprite, x: number, y: number, lift: number, flip: boolean, scale = 1): void {
    obj.material = this.spriteMats.get(s.canvas, flip);
    const w = (s.canvas.width / ART_PER_TILE) * scale;
    const h = (s.canvas.height / ART_PER_TILE) * scale;
    obj.scale.set(w, h, 1);
    obj.center.set(flip ? 1 - s.ax / s.canvas.width : s.ax / s.canvas.width, 1 - s.ay / s.canvas.height);
    obj.position.set(x, lift, y);
  }

  #drawAgent(sim: Sim, a: Agent, body: THREE.Sprite, caravan: THREE.Sprite, yaw: number): void {
    const moving = a.path.length > 0;
    const frame = moving ? Math.floor(a.phase) : 0;
    // Face the way the agent moves *on screen*: orbiting the camera must not
    // make people walk backwards.
    const next = a.path[0] ?? (a.face && !moving ? a.face : undefined);
    let flip = this.#facing.get(a.id) ?? a.facing < 0;
    if (next !== undefined) {
      const dx = next.x - a.x;
      const dz = next.y - a.y;
      const screenRight = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      if (Math.abs(screenRight) > 0.001) flip = screenRight < 0;
      this.#facing.set(a.id, flip);
    }
    // Height comes from the simulation: flyers cruise above the rooftops. Sprites hop to cheer or catch.
    const g = a.acting?.gesture;
    const hop = g === 'cheer' ? Math.abs(Math.sin(sim.elapsed * 9)) * 0.22 : g === 'pickup' ? Math.abs(Math.sin(sim.elapsed * 7)) * 0.08 : g === 'talk' ? Math.abs(Math.sin(sim.elapsed * 5)) * 0.03 : 0;
    const lift = a.alt + hop + (a.alt > 0.05 ? Math.sin(a.phase) * 0.1 : moving ? 0 : Math.abs(Math.sin(a.phase * 2)) * 0.02);
    let s: Sprite;
    if (a.kind === 'hero' && a.hero) {
      const h = hashString(a.hero.address);
      s = heroArt({ address: a.hero.address, cls: this.#classOf(a.hero.address), tier: a.hero.tier, crest: crestColors(a.hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 }, frame, false);
    } else if (a.kind === 'villager') {
      s = villagerArt(hashString(a.id), frame, true);
    } else {
      s = npcArt(a.kind === 'raven' ? 'raven' : a.kind === 'herald' ? 'herald' : 'bailiff', frame);
    }
    const scale = a.kind === 'hero' ? HERO_SCALE : a.kind === 'villager' ? 1.1 : 1.2;
    this.#placeSprite(body, s, a.x, a.y, lift, flip, scale);
    if (!a.inside) this.#shadow(a.x, a.y, a.kind === 'hero' ? (a.hero && a.hero.tier >= 5 ? 1.7 : 1.15) : a.kind === 'raven' ? 0.5 : 0.8, lift);

    const back = a.trail[CARAVAN_BACK];
    const cs = a.kind === 'hero' && a.carrying !== null && a.carrying > 0 ? caravanArt(a.carrying, frame, false) : null;
    caravan.visible = back !== undefined && cs !== null;
    if (back && cs) {
      this.#placeSprite(caravan, cs, back.x, back.y, 0, flip, HERO_SCALE);
      this.#shadow(back.x, back.y, a.carrying !== null && a.carrying >= 4 ? 1.6 : 0.9, 0);
    }
  }

  /** A soft contact shadow on the ground, smaller as the thing lifts off. */
  #shadow(x: number, y: number, size: number, lift: number): void {
    const i = this.shadows.count;
    if (i >= this.shadows.instanceMatrix.count) return;
    const s = size / (1 + lift * 0.8);
    this.#shadowMatrix.makeScale(s, 1, s * 0.75).setPosition(x, 0.03, y);
    this.shadows.setMatrixAt(i, this.#shadowMatrix);
    this.shadows.count = i + 1;
  }
}
