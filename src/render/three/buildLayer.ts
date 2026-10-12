/**
 * What build mode draws over the 3D town: a faint tile grid, the land outside
 * the player's darkened behind a bright edge, and the building in hand as a
 * see-through ghost (green: it may stand there, red: not) with its door tile
 * marked and the tiles its road would take striped.
 *
 * The grid, land, footprint, door and road are one flat mesh with one shader
 * over the (flat) town ground; the marks are a tiny tile texture rewritten
 * when the ghost moves. Ghost models are built once per building and only moved
 * and retinted after. Made on entering build mode and freed on leaving it, or
 * when the town's look changes: while not building it costs nothing.
 */

import * as THREE from 'three';
import { MAP_H, MAP_W } from '../../world/layout.js';
import type { Sim } from '../../world/sim.js';
import type { BuildGhost, BuildOverlay } from '../view.js';
import { disposeTree, resourceMark } from './dispose.js';
import { turnAngle, type TownScene } from './townScene.js';

const OK = new THREE.Color('#5fe08a');
const NOT_OK = new THREE.Color('#ff5a4a');
/** Ghost models kept for picking the same building again. */
const CACHE = 6;

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec4 uLand;      // x0, z0, x1, z1 (tiles)
uniform sampler2D uMarks; // per tile: r road, g footprint, b door
uniform vec3 uTint;
uniform vec3 uEdge;
uniform float uTime;
varying vec2 vXZ;

vec4 over(vec4 dst, vec3 c, float a) {
  return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

void main() {
  vec2 p = vXZ;
  vec4 o = vec4(0.0);

  // the land: a box; outside it darker
  vec2 c = (uLand.xy + uLand.zw) * 0.5;
  vec2 q = abs(p - c) - (uLand.zw - uLand.xy) * 0.5;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  bool inside = sd <= 0.0;
  if (!inside) o = over(o, vec3(0.0), 0.4);

  // the grid: one-pixel lines on tile edges, fainter off the land
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  o = over(o, vec3(1.0), line * (inside ? 0.22 : 0.08));

  // the building in hand: footprint, road (dashed, running), door
  vec2 tile = floor(p);
  vec4 m = texture2D(uMarks, (tile + 0.5) / vec2(${MAP_W}.0, ${MAP_H}.0));
  vec2 f = fract(p) - 0.5;
  float box = max(abs(f.x), abs(f.y));
  if (m.g > 0.5) o = over(o, uTint, 0.28);
  if (m.r > 0.5) {
    float dash = step(0.5, fract((p.x + p.y) * 1.4 - uTime * 0.9));
    o = over(o, vec3(1.0, 0.93, 0.7), 0.18 + 0.22 * dash);
    o = over(o, vec3(1.0, 0.93, 0.7), smoothstep(0.4, 0.47, box) * 0.5);
  }
  if (m.b > 0.5) {
    o = over(o, uTint, 0.3);
    o = over(o, uTint, smoothstep(0.26, 0.3, box) * (1.0 - smoothstep(0.4, 0.44, box)) * 0.95);
  }

  // the land's edge: a bright line
  float fw = max(fwidth(sd), 1e-4);
  o = over(o, uEdge, (1.0 - smoothstep(0.05, 0.05 + fw, abs(sd))) * 0.9);

  if (o.a < 0.003) discard;
  gl_FragColor = vec4(o.rgb / o.a, o.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Ghost {
  root: THREE.Group;
  /** The ghost's own materials (see-through clones) and the colour each started from. */
  mats: { mat: THREE.MeshStandardMaterial | THREE.Material; base: THREE.Color | null }[];
  ok: boolean | null;
}

export class BuildLayer {
  readonly group = new THREE.Group();
  readonly #ground: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly #marks = new Uint8Array(MAP_W * MAP_H * 4);
  readonly #marksTex: THREE.DataTexture;
  readonly #door: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  /** Ghost models by what they are (most recent last). */
  readonly #ghosts = new Map<string, Ghost>();
  #shown: Ghost | null = null;
  #marksKey = '';
  #landKey = '';

  constructor() {
    this.group.name = 'build-overlay';
    this.#marksTex = new THREE.DataTexture(this.#marks, MAP_W, MAP_H, THREE.RGBAFormat);
    this.#marksTex.magFilter = THREE.NearestFilter;
    this.#marksTex.minFilter = THREE.NearestFilter;
    this.#marksTex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(MAP_W, MAP_H);
    geo.rotateX(-Math.PI / 2);
    geo.translate(MAP_W / 2, 0.04, MAP_H / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uLand: { value: new THREE.Vector4() },
        uMarks: { value: this.#marksTex },
        uTint: { value: OK.clone() },
        uEdge: { value: new THREE.Color('#ffd27a') },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.#ground = new THREE.Mesh(geo, mat);
    this.#ground.name = 'build-grid';
    this.#ground.renderOrder = 2;
    this.#ground.frustumCulled = false;
    // a little arrow over the door tile, pointing down
    this.#door = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), new THREE.MeshBasicMaterial({ color: OK.clone(), transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.#door.rotation.x = Math.PI;
    this.#door.renderOrder = 3;
    this.#door.visible = false;
    this.group.add(this.#ground, this.#door);
  }

  /** Draw `build` for this frame (`town` and `sim`: to make a ghost model the first time). */
  update(build: BuildOverlay, town: TownScene, sim: Sim, themeId: string, elapsed: number): void {
    const u = this.#ground.material.uniforms;
    const l = build.land;
    const landKey = `${l.x0},${l.y0},${l.x1},${l.y1}`;
    if (landKey !== this.#landKey) {
      this.#landKey = landKey;
      (u.uLand!.value as THREE.Vector4).set(l.x0, l.y0, l.x1, l.y1);
    }
    u.uTime!.value = elapsed;
    const gh = build.ghost;
    this.#setMarks(gh);
    if (gh === null) {
      if (this.#shown) this.#shown.root.visible = false;
      this.#shown = null;
      this.#door.visible = false;
      return;
    }
    const tint = gh.ok ? OK : NOT_OK;
    (u.uTint!.value as THREE.Color).copy(tint);
    this.#door.material.color.copy(tint);
    this.#door.visible = true;
    this.#door.position.set(gh.door.x + 0.5, 0.55 + Math.sin(elapsed * 3) * 0.08, gh.door.y + 0.5);
    this.#door.rotation.y = elapsed * 1.5;

    const ghost = this.#ghost(gh, town, sim, themeId);
    if (this.#shown !== ghost) {
      if (this.#shown) this.#shown.root.visible = false;
      this.#shown = ghost;
    }
    ghost.root.visible = true;
    ghost.root.position.set(gh.x + gh.w / 2, 0, gh.y + gh.h / 2);
    ghost.root.rotation.y = turnAngle(gh.rot);
    if (ghost.ok !== gh.ok) {
      ghost.ok = gh.ok;
      for (const { mat, base } of ghost.mats) tintMaterial(mat, base, tint);
    }
  }

  /** The footprint, door and road tiles into the marks texture (only when they changed). */
  #setMarks(gh: BuildGhost | null): void {
    const key = gh === null ? '' : `${gh.x},${gh.y},${gh.w},${gh.h},${gh.door.x},${gh.door.y},${gh.road.join(',')}`;
    if (key === this.#marksKey) return;
    this.#marksKey = key;
    const d = this.#marks;
    d.fill(0);
    if (gh !== null) {
      const put = (x: number, y: number, ch: number): void => {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) d[(y * MAP_W + x) * 4 + ch] = 255;
      };
      for (let y = gh.y; y < gh.y + gh.h; y++) for (let x = gh.x; x < gh.x + gh.w; x++) put(x, y, 1);
      for (const i of gh.road) put(i % MAP_W, Math.floor(i / MAP_W), 0);
      put(gh.door.x, gh.door.y, 2);
    }
    this.#marksTex.needsUpdate = true;
  }

  /** The ghost model for this building: made once (as the town would build it), then reused. */
  #ghost(gh: BuildGhost, town: TownScene, sim: Sim, themeId: string): Ghost {
    const what: Parameters<TownScene['specOf']>[0] = { kind: gh.kind, w: gh.w, h: gh.h, rot: gh.rot };
    if (gh.protocolId !== undefined) what.protocolId = gh.protocolId;
    if (gh.heroAddress !== undefined) what.heroAddress = gh.heroAddress;
    // (what it is built from too, so a hero's new tier or a protocol's colour makes it anew)
    const key = `${themeId}|${JSON.stringify(town.specOf(what, sim))}`;
    let ghost = this.#ghosts.get(key);
    if (ghost) {
      // most recent last
      this.#ghosts.delete(key);
      this.#ghosts.set(key, ghost);
      return ghost;
    }
    const from = resourceMark();
    const built = town.makeBuilding(what, sim);
    const root = new THREE.Group();
    root.name = 'build-ghost';
    root.add(built.group);
    // everything it made is its own: freed with it (the shared materials and textures it drew on are older, and stay)
    root.userData.born = from;
    ghost = { root, mats: seeThrough(root), ok: null };
    this.group.add(root);
    this.#ghosts.set(key, ghost);
    if (this.#ghosts.size > CACHE) {
      const [oldKey, old] = this.#ghosts.entries().next().value!;
      this.#ghosts.delete(oldKey);
      this.#free(old);
    }
    return ghost;
  }

  #free(g: Ghost): void {
    if (this.#shown === g) this.#shown = null;
    g.root.removeFromParent();
    disposeTree(g.root, g.root.userData.born as ReturnType<typeof resourceMark>);
  }

  /** Forget the ghost models (the town's look changed: they would be in the old one). */
  dropGhosts(): void {
    for (const g of this.#ghosts.values()) this.#free(g);
    this.#ghosts.clear();
  }

  /** Free everything (build mode is over). */
  dispose(): void {
    this.dropGhosts();
    this.group.removeFromParent();
    disposeTree(this.#ground);
    disposeTree(this.#door);
  }
}

/** Swap every material in a ghost for a see-through clone (shared originals are left untouched). */
function seeThrough(root: THREE.Object3D): Ghost['mats'] {
  const clones = new Map<THREE.Material, THREE.Material>();
  const out: Ghost['mats'] = [];
  const ghostOf = (m: THREE.Material): THREE.Material => {
    let c = clones.get(m);
    if (c === undefined) {
      c = m.clone();
      c.transparent = true;
      c.opacity = 0.55;
      c.depthWrite = true;
      if ('fog' in c) (c as THREE.MeshStandardMaterial).fog = false;
      const col = (c as THREE.MeshStandardMaterial).color as THREE.Color | undefined;
      out.push({ mat: c, base: col?.isColor ? col.clone() : null });
      clones.set(m, c);
    }
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ghostOf) : ghostOf(mesh.material);
  });
  return out;
}

function tintMaterial(m: THREE.Material, base: THREE.Color | null, tint: THREE.Color): void {
  const s = m as THREE.MeshStandardMaterial;
  if (base && s.color?.isColor) s.color.copy(base).lerp(tint, 0.55);
  if (s.emissive?.isColor) {
    s.emissive.copy(tint);
    s.emissiveIntensity = 0.35;
  }
}
