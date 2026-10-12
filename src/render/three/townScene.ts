/**
 * The 3D town that stands still: ground or terrain, buildings (merged per
 * material), signs and boards, fog of war, smoke, critters and lamps. Built
 * from a sim's plan and guild; a later sim with the same town only repoints it
 * (see `matches`), so most live updates rebuild nothing. Whatever a build made
 * is freed on the next one.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tier } from '../../domain/tiers.js';
import { crestColors } from '../../util/rng.js';
import { MAP_H, MAP_W, type Placed, type Pt } from '../../world/layout.js';
import type { Effect, Sim } from '../../world/sim.js';
import type { Rot } from '../../world/townLayout.js';
import { heatColor, tollOf } from '../../world/chain.js';
import { brandColor } from '../buildings.js';
import { bakeTopGround, scatterProps } from '../ground.js';
import { marketLines, tollLines } from '../overlay.js';
import { P } from '../pixel.js';
import { BuildingFactory, type BuildingSpec, type BuiltBuilding } from './buildingFactory.js';
import { buildGrass, buildLamps, buildPropMeshes, placeLamps, type LampSet } from './scenery.js';
import type { Theme } from './themes.js';
import { FogBank } from './fogBank.js';
import { Beacon3D, harvestPile, TollBoard3D } from './towerSigns.js';
import { Smoke, type Emitter } from './smoke.js';
import { rippling } from './water.js';
import { tileSurfaces, townSite } from './townSite.js';
import { moveDoor, type DoorRig } from './doors.js';
import { Critters, type Roosts } from './critters.js';
import { disposeTree, keep, resourceMark, type ResourceMark } from './dispose.js';
import { FLUTTER, flutterDepth, flutterMaterial } from './flags.js';
import { litWindowMaterial, seedWindows } from './windowLights.js';
import { BlockPulse } from './blockPulse.js';
import { shadeClouds } from './clouds.js';

// scratch for merging cloth
const _lin = new THREE.Matrix3();
const _ax = new THREE.Vector3();

/** The turn about y (radians) that brings a building's front (+z) to face `rot` (quarter turns from facing south: 1 west, 2 north, 3 east). */
export const turnAngle = (rot: Rot): number => (-rot * Math.PI) / 2;

/** An offset (x, z) in a building's own frame (front +z), in the town's frame once turned `rot`. */
export function turnOffset(x: number, z: number, rot: Rot): { x: number; z: number } {
  switch (rot) {
    case 0:
      return { x, z };
    case 1:
      return { x: -z, z: x };
    case 2:
      return { x: -x, z: -z };
    case 3:
      return { x: z, z: -x };
  }
}

/** A building turned a quarter is built across: its own width runs along the footprint's depth. */
export const ownSize = (w: number, h: number, rot: Rot): { w: number; h: number } => (rot % 2 === 1 ? { w: h, h: w } : { w, h });

export interface BuildingInfo {
  placed: Placed;
  /** What the pointer hits on this building (shared by its parts; repointed when a live update keeps the town). */
  target: { kind: 'building'; placed: Placed };
  group: THREE.Group;
  /** Height of the roof top in tiles, for markers. */
  top: number;
  /** Where the sign hangs (world tiles; y is up) and whose logo goes on it. */
  sign?: { x: number; y: number; z: number; url: string };
  /** Chimney and stack tops (world tiles). */
  smoke?: Emitter[];
  /** The door people use (the one nearest the door tile); others stay shut. */
  door?: DoorRig;
  /** Where people go in (told to each new sim), or null: no way in. */
  doorway: Pt | null;
}

export class TownScene {
  /** Everything built; the renderer adds it to its scene. */
  readonly world = new THREE.Group();
  buildings: BuildingInfo[] = [];
  /** The buildings' groups, for picking and sign occlusion. */
  buildingGroups: THREE.Object3D[] = [];
  smoke: Smoke | null = null;
  /** Birds, butterflies and fireflies. */
  critters: Critters | null = null;
  lamps: LampSet | null = null;
  #theme: Theme | null = null;
  #factory = new BuildingFactory();
  #waterMat = keep(new THREE.MeshStandardMaterial({ color: '#4a90c8', transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 }));
  /** Deep, glossy water that mirrors the sky (themed towns are lit by an HDRI). */
  #themedWater = keep(rippling(new THREE.MeshStandardMaterial({ color: '#27506a', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 })));
  #proxyMat = keep(new THREE.MeshBasicMaterial({ visible: false }));
  /** The Chronicle bell: a pivot that swings on every block. */
  #bell: THREE.Object3D | null = null;
  #bellSwing = { t: 99, amp: 0 };
  #rungRings = new WeakSet<Effect>();
  /** Light running out along the streets from the tower on each block, and the ring that sent it (with its block's fullness). */
  pulse: BlockPulse | null = null;
  #pulseFrom: { ring: Effect; busy: number } | null = null;
  /** The Chronicle Tower's toll board and beacon: how busy and how dear the chain is. */
  #tollBoard: TollBoard3D | null = null;
  /** ETH since the player's last visit, on a board in the square. */
  #marketBoard: TollBoard3D | null = null;
  #beacon: Beacon3D | null = null;
  /** Harvest piles at doors, hidden while their building is in fog. */
  #harvestPiles: { placed: Placed; object: THREE.Object3D }[] = [];
  /** Fog of war over unvisited buildings, and which buildings it covers. */
  #fog: FogBank | null = null;
  #fogged: Placed[] = [];
  /** When the town now standing began to be built: what it made since is its own, freed on the next build. */
  #builtFrom: ResourceMark | undefined;
  /** What the standing town was built from (`#keyOf`); a sim with the same keeps it. */
  #townKey = '';
  /** Which harvest piles stand (building and size), so a live update leaves unchanged ones be. */
  #pileKey = '';

  /** Materials dimmed or lit at night: the theme's, else the built-in look's. */
  get windowMaterial(): THREE.MeshStandardMaterial {
    return this.#theme?.windowMaterial ?? this.#factory.windowMat;
  }

  get fireMaterial(): THREE.MeshStandardMaterial {
    return this.#theme?.fireMaterial ?? this.#factory.fireMat;
  }

  /** The Chronicle Tower, if the town has one. */
  get tower(): BuildingInfo | undefined {
    return this.buildings.find((b) => b.placed.kind === 'tower');
  }

  /** Whether this town is what `sim` would build with `theme` (then `refresh` will do). */
  matches(sim: Sim, theme: Theme | null): boolean {
    return this.#townKey === this.#keyOf(sim, theme);
  }

  build(sim: Sim, theme: Theme | null): void {
    // free what the last build made (detaching frees nothing on the GPU); the caches it drew on stay
    disposeTree(this.world, this.#builtFrom);
    this.world.clear();
    this.#builtFrom = resourceMark();
    this.#theme = theme;
    this.buildings = [];
    const plan = sim.plan;
    this.#townKey = this.#keyOf(sim, theme);

    this.#bell = null;
    for (const b of plan.buildings) {
      const info = this.#buildBuilding(b, sim);
      this.world.add(info.group);
      this.buildings.push(info);
    }
    // the tower's real height (its `top` has headroom for markers), measured before its parts are merged away
    const towerInfo = this.tower;
    const towerTip = towerInfo ? new THREE.Box3().setFromObject(towerInfo.group).max.y : 0;
    this.#mergeBuildings();
    this.buildingGroups = this.buildings.map((b) => b.group);
    const emitters = this.buildings.flatMap((b) => b.smoke ?? []);
    this.smoke = emitters.length > 0 ? new Smoke(emitters) : null;
    this.critters = new Critters(plan, this.#roosts(towerTip));
    this.world.add(this.critters.group);
    this.pulse = new BlockPulse(plan);
    this.#pulseFrom = null;
    this.world.add(this.pulse.mesh);
    if (this.smoke) this.world.add(this.smoke.points);
    // the tower's signs: a beacon on its top, a toll board by its door
    const tower = this.tower;
    if (tower) {
      const t = tower.placed;
      this.#beacon = new Beacon3D();
      this.#beacon.object.position.set(t.x + t.w / 2, towerTip + 0.05, t.y + t.h / 2);
      // either side of its door, in front (turned with the tower)
      const rot = t.rot ?? 0;
      const own = ownSize(t.w, t.h, rot);
      const stand = (board: TollBoard3D, x: number, z: number, yaw: number): void => {
        const o = turnOffset(x, z, rot);
        board.object.position.set(t.x + t.w / 2 + o.x, 0, t.y + t.h / 2 + o.z);
        board.object.rotation.y = yaw + turnAngle(rot);
      };
      this.#tollBoard = new TollBoard3D(theme?.board ?? 'wood');
      stand(this.#tollBoard, own.w / 2 + 0.25, own.h / 2 + 0.75, -0.35); // turned a little towards the street
      this.world.add(this.#beacon.object, this.#tollBoard.object);
      this.#marketBoard = new TollBoard3D(theme?.board ?? 'wood');
      this.#marketBoard.object.name = 'market-board';
      stand(this.#marketBoard, -own.w / 2 - 2.2, own.h / 2 + 0.75, 0.35);
      this.world.add(this.#marketBoard.object);
    } else {
      this.#beacon = null;
      this.#tollBoard = null;
      this.#marketBoard = null;
    }
    // rewards ready to claim, heaped by the doors
    this.#harvestPiles = [];
    this.#pileKey = '';
    this.#placePiles(sim);
    // fog of war can cover any protocol's building (shown or not as the replay goes)
    const fogged = this.buildings.filter((b) => b.placed.protocolId !== undefined);
    this.#fogged = fogged.map((b) => b.placed);
    this.#fog = fogged.length > 0 ? new FogBank(fogged.map((b) => ({ x: b.placed.x, z: b.placed.y, w: b.placed.w, d: b.placed.h, top: b.top }))) : null;
    if (this.#fog) this.world.add(this.#fog.mesh);

    if (theme?.surroundings) {
      // the theme's world: terrain, woods, props and lanterns around the town, PBR ground
      const s = theme.surroundings(townSite(plan, placeLamps(plan)));
      this.world.add(s.group);
      this.lamps = s.lamps;
      const surface = (w: 'road' | 'plaza' | 'path'): THREE.Material => theme.groundMaterial?.(w) ?? this.#factory.mat(w === 'path' ? '#8a7556' : '#9a8f80');
      // (the harbour's water comes with the surroundings, in its dug basin)
      for (const m of tileSurfaces(plan, { paved: surface('road'), plaza: surface('plaza'), trodden: surface('path'), water: this.#themedWater })) if (m.name !== 'ground-water' || !s.group.getObjectByName('harbour')) this.world.add(m);
      shadeClouds(this.world);
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
    this.world.add(ground, slab, water);
    for (const o of buildPropMeshes(scatterProps(plan), (c) => this.#factory.mat(c))) this.world.add(o);
    this.world.add(buildGrass(plan));
    this.lamps = buildLamps(placeLamps(plan));
    this.world.add(this.lamps.group);
    shadeClouds(this.world);
  }

  /**
   * Same town, new sim: the buildings stay; they point at the new plan's places, and the new
   * sim learns the doors. Harvest piles follow the new harvests (`relay`: laid again regardless).
   */
  refresh(sim: Sim, relay = false): void {
    const byId = new Map(sim.plan.buildings.map((b) => [b.id, b]));
    for (const info of this.buildings) {
      const placed = byId.get(info.placed.id);
      if (!placed) continue; // (same key: same ids)
      info.placed = info.target.placed = placed;
      sim.setDoorway(placed.id, info.doorway);
    }
    this.#fogged = this.buildings.filter((b) => b.placed.protocolId !== undefined).map((b) => b.placed);
    if (relay) this.#pileKey = '';
    this.#placePiles(sim);
  }

  /** The town's own motion and lights for this frame: bell, doors, critters, lamps, smoke, fog, boards, water. */
  animate(sim: Sim, dt: number, night: number, gloom: number): void {
    this.#swingBell(sim, dt);
    // (a ring the sim no longer holds, as after a live update brought a new sim, has stopped ageing: done)
    if (this.#pulseFrom && !sim.effects.includes(this.#pulseFrom.ring)) this.#pulseFrom = null;
    const ring = this.#pulseFrom?.ring;
    const tower = this.tower?.placed;
    this.pulse?.update(ring && tower ? ring.age / ring.ttl : null, tower ? tower.x + tower.w / 2 : 0, tower ? tower.y + tower.h / 2 : 0, this.#pulseFrom?.busy ?? 0, night);
    if (ring && ring.age >= ring.ttl) this.#pulseFrom = null;
    for (const b of this.buildings) if (b.door) moveDoor(b.door, sim.doorOpen(b.placed.id), dt);
    this.critters?.update(sim.elapsed, dt, night, gloom);
    this.lamps?.setNight(night);
    this.smoke?.setNight(night);
    this.#fog?.update(sim.elapsed, night, (i) => sim.fogOver(this.#fogged[i]!));
    if (this.#beacon || this.#tollBoard) {
      const toll = tollOf(sim.chain, sim.ethUsd);
      this.#beacon?.update(sim.elapsed, toll.heat, heatColor(toll.heat), night);
      this.#tollBoard?.update(tollLines(sim));
    }
    const market = marketLines(sim);
    if (this.#marketBoard) {
      this.#marketBoard.object.visible = market !== null;
      if (market) this.#marketBoard.update(market);
    }
    for (const p of this.#harvestPiles) p.object.visible = sim.fogOver(p.placed) <= 0.5;
    this.#waterMat.opacity = 0.8 + Math.sin(sim.elapsed * 1.3) * 0.06;
  }

  /**
   * The bell swings as a damped oscillation each time a block lands, and locks
   * exactly at rest once the envelope is spent (procedural-animation skill:
   * time-based, with a terminal lock rather than endless tiny residuals).
   */
  #swingBell(sim: Sim, dt: number): void {
    for (const e of sim.effects) {
      if (e.kind !== 'ring' || this.#rungRings.has(e)) continue;
      this.#rungRings.add(e);
      this.#bellSwing = { t: 0, amp: 0.55 };
      // the block's news runs down the streets, and the pigeons on the roofs round about take off
      this.#pulseFrom = { ring: e, busy: sim.chain.busy };
      this.critters?.flush(sim.elapsed);
    }
    const b = this.#bell;
    if (b === null) return;
    const st = this.#bellSwing;
    st.t += dt;
    const envelope = Math.exp(-st.t / 1.1);
    b.rotation.x = envelope < 0.01 ? 0 : st.amp * envelope * Math.sin((st.t * Math.PI * 2) / 1.05);
  }

  /**
   * What a building is built from: its tier (the hero's), brand colour and logo, the guild's banner.
   * Its size is its own (turned a quarter, it is built across the footprint).
   */
  specOf(b: Pick<Placed, 'kind' | 'w' | 'h' | 'protocolId' | 'heroAddress' | 'rot'>, sim: Sim): BuildingSpec {
    const protocol = b.protocolId !== undefined ? sim.guild.protocols.get(b.protocolId) : undefined;
    const hero = b.heroAddress !== undefined ? sim.guild.heroes.find((h) => h.address === b.heroAddress) : undefined;
    const guildColor = sim.guild.heroes[0] ? crestColors(sim.guild.heroes[0].address)[0] : P.red;
    const own = ownSize(b.w, b.h, b.rot ?? 0);
    return {
      kind: b.kind,
      w: own.w,
      h: own.h,
      tier: (hero?.tier ?? 0) as Tier,
      roof: protocol ? brandColor(protocol.id) : '#a0522d',
      banner: b.kind === 'guildhall' || hero ? guildColor : P.red,
      iconUrl: protocol?.iconUrl ?? null,
    };
  }

  /**
   * Everything the standing town is made of: the theme, the tiles and every building's place
   * and spec. (Cheap next to a build: a string of a few thousand tiles and ~40 buildings.)
   */
  #keyOf(sim: Sim, theme: Theme | null): string {
    const plan = sim.plan;
    return `${theme?.id ?? ''}|${plan.tiles.join(',')}|${JSON.stringify(plan.buildings.map((b) => [b, this.specOf(b, sim)]))}`;
  }

  /** Harvest piles by the doors, laid again only when the harvests changed. */
  #placePiles(sim: Sim): void {
    const key = JSON.stringify([...sim.harvests].map(([id, crop]) => [id, crop.size]));
    if (key === this.#pileKey) return;
    this.#pileKey = key;
    for (const p of this.#harvestPiles) {
      p.object.removeFromParent();
      disposeTree(p.object); // each pile's materials and geometries are its own
    }
    this.#harvestPiles = [];
    for (const [id, crop] of sim.harvests) {
      const b = sim.plan.buildings.find((x) => x.id === id);
      if (!b) continue;
      const pile = harvestPile(crop.size);
      // beside the door, along the street (turned with the building)
      const o = turnOffset(0.85, -0.15, b.rot ?? 0);
      pile.position.set(b.doorAt.x + o.x, 0, b.doorAt.y + o.z);
      this.world.add(pile);
      this.#harvestPiles.push({ placed: b, object: pile });
    }
  }

  /**
   * Bake every static building mesh into a few big meshes, one per material
   * (a town is ~40 buildings × ~8 parts: hundreds of draw calls, twice over
   * with shadows). The bell keeps swinging on its own; each building keeps an
   * invisible footprint box for hover, click and sign occlusion.
   */
  #mergeBuildings(): void {
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; cloth: boolean; geos: THREE.BufferGeometry[]; sources: THREE.Mesh[] }>();
    const bell = this.#bell;
    for (const b of this.buildings) {
      b.group.updateMatrixWorld(true);
      b.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material)) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === bell || p.userData.animated === true) return;
        const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        if (!src.getAttribute('normal')) src.computeVertexNormals();
        // plain floats, whatever a pack's glTF stored (quantised, normalised, interleaved), so every part merges
        const geo = new THREE.BufferGeometry();
        // (cloth keeps its flutter, in its own bucket: see flags.ts)
        const cloth = src.getAttribute(FLUTTER) !== undefined;
        for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ...(cloth ? [[FLUTTER, 4] as const] : [])] as const) {
          const a = src.getAttribute(name);
          const out = new Float32Array(src.getAttribute('position').count * size);
          if (a) for (let v = 0; v < a.count; v++) for (let k = 0; k < size; k++) out[v * size + k] = a.getComponent(v, k);
          geo.setAttribute(name, new THREE.Float32BufferAttribute(out, size));
        }
        geo.applyMatrix4(mesh.matrixWorld);
        // the flutter axis turns and scales with the part (metres to tiles), like a direction
        if (cloth) {
          const f = geo.getAttribute(FLUTTER) as THREE.BufferAttribute;
          _lin.setFromMatrix4(mesh.matrixWorld);
          for (let v = 0; v < f.count; v++) {
            _ax.set(f.getX(v), f.getY(v), f.getZ(v)).applyMatrix3(_lin);
            f.setXYZ(v, _ax.x, _ax.y, _ax.z);
          }
        }
        const mat = mesh.material;
        const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}|${cloth ? 'cloth' : ''}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { mat, cast: mesh.castShadow, cloth, geos: [], sources: [] };
          buckets.set(key, bucket);
        }
        bucket.geos.push(geo);
        bucket.sources.push(mesh);
      });
      // the stand-in the pointer and the sign rays hit
      const own = ownSize(b.placed.w, b.placed.h, b.placed.rot ?? 0); // (in the group's own, turned frame)
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, own.w - 0.4), Math.max(0.5, b.top), Math.max(0.5, own.h - 0.4)), this.#proxyMat);
      proxy.position.set(0, Math.max(0.5, b.top) / 2, 0);
      proxy.userData.target = b.target;
      b.group.add(proxy);
    }
    const windows = this.windowMaterial;
    for (const { mat, cast, cloth, geos, sources } of buckets.values()) {
      const geo = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!geo) continue; // the parts stay as they are rather than vanish
      // merged: the parts give way to the one mesh (never drawn, so they hold nothing on the GPU)
      for (const m of sources) m.removeFromParent();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      // flags ripple; windows light one by one (on patched clones of their materials, kept with them)
      if (cloth) {
        mesh.material = flutterMaterial(mat);
        if (cast) mesh.customDepthMaterial = flutterDepth();
      } else if (mat === windows) {
        seedWindows(geo);
        mesh.material = litWindowMaterial(windows);
      }
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = 'buildings';
      this.world.add(mesh);
    }
  }

  /**
   * Where pigeons sit: roof tops round the Chronicle Tower (the nearest few, and the tower
   * itself), chosen by distance alone, so a frozen replay always has the same.
   */
  #roosts(towerTip: number): Roosts | null {
    const t = this.tower;
    if (!t) return null;
    const tx = t.placed.x + t.placed.w / 2;
    const tz = t.placed.y + t.placed.h / 2;
    const near = this.buildings
      .filter((b) => b !== t && b.placed.kind !== 'gate' && b.top > 0.9)
      .map((b) => ({ x: b.placed.x + b.placed.w / 2, y: b.top, z: b.placed.y + b.placed.h / 2 }))
      .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz) || a.x - b.x)
      .slice(0, 5);
    return { spots: [...near, { x: tx, y: towerTip * 0.8, z: tz }], tower: { x: tx, z: tz, top: towerTip } };
  }

  /** A building as the town would build it now (the build mode's ghost): at the origin, unturned, built across if `rot` is odd. */
  makeBuilding(b: Pick<Placed, 'kind' | 'w' | 'h' | 'protocolId' | 'heroAddress' | 'rot'>, sim: Sim): BuiltBuilding {
    const spec = this.specOf(b, sim);
    return this.#theme ? this.#theme.building(spec) : this.#factory.build(spec);
  }

  #buildBuilding(b: Placed, sim: Sim): BuildingInfo {
    const rot = b.rot ?? 0;
    const built = this.makeBuilding(b, sim);
    const g = built.group;
    // turned about the footprint's middle: its front (+z) to the door tile
    g.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    g.rotation.y = turnAngle(rot);
    const at = (p: { x: number; z: number }): { x: number; z: number } => {
      const o = turnOffset(p.x, p.z, rot);
      return { x: g.position.x + o.x, z: g.position.z + o.z };
    };
    const target: BuildingInfo['target'] = { kind: 'building', placed: b };
    g.traverse((o) => {
      o.userData.target = target;
    });
    if (built.bell) this.#bell = built.bell;
    const info: BuildingInfo = { placed: b, target, group: g, top: built.top, doorway: null };
    if (built.smoke) info.smoke = built.smoke.map((e) => ({ ...e, ...at(e), y: g.position.y + e.y }));
    if (built.sign) info.sign = { ...built.sign, ...at(built.sign) };
    // the door nearest the door tile is the one people use; the sim walks them in through it
    let door: DoorRig | undefined;
    let best = Infinity;
    for (const d of built.doors ?? []) {
      const p = at(d.at);
      const dist = Math.hypot(p.x - b.doorAt.x, p.z - b.doorAt.y);
      if (dist < best) {
        best = dist;
        door = d;
      }
    }
    if (door) {
      info.door = door;
      // a step out from the leaf, so whoever goes in vanishes into the open doorway, not the wall
      const p = at({ x: door.at.x + door.out.x * 0.12, z: door.at.z + door.out.z * 0.12 });
      info.doorway = { x: p.x, y: p.z };
    }
    sim.setDoorway(b.id, info.doorway);
    return info;
  }
}
