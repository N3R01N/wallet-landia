/**
 * The 3D view: a diorama of the same town. Buildings are low-poly meshes built
 * from the same style table as the 2D sprites; people stay pixel-art billboards
 * (an "HD-2D" look), so the character art is shared across all three views.
 *
 * Loaded on demand — `three` only ships to players who open the 3D view.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import type { Tier } from '../../domain/tiers.js';
import { crestColors, hashString, makeRng } from '../../util/rng.js';
import { MAP_H, MAP_W, type Placed } from '../../world/layout.js';
import type { Agent, Effect, Sim } from '../../world/sim.js';
import { brandColor, drawEmblem, plate, styleFor, type Style } from '../buildings.js';
import { caravanSprite, heroSprite, npcSprite, villagerSprite } from '../characters.js';
import { bakeTopGround, scatterProps, type Prop } from '../ground.js';
import { districtLabels, floatingText, markers, nameTags, nightFactor, route, weather, type Project } from '../overlay.js';
import { P, sprite, type Sprite } from '../pixel.js';
import type { HitTarget, WorldView } from '../view.js';

/** Art pixels per tile, so sprites keep their 2D proportions. */
const ART_PER_TILE = 16;
/** 2D wall/roof heights are in art px; this turns them into tiles. */
const HEIGHT_SCALE = 1 / 12;

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
  #mats = new Map<string, THREE.MeshStandardMaterial>();
  #windowMat = new THREE.MeshStandardMaterial({ color: P.glass, emissive: new THREE.Color(P.glassLit), emissiveIntensity: 0, roughness: 0.3 });
  #fireMat = new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 1.2 });
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

  constructor(sim: Sim) {
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
    this.#gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#gl.outputColorSpace = THREE.SRGBColorSpace;

    this.#scene.background = this.#sky;
    this.#scene.fog = new THREE.Fog(this.#sky, 110, 230);
    this.#scene.add(this.#hemi, this.#sun, this.#sun.target, this.#world);
    this.#sun.position.set(MAP_W / 2 - 22, 42, MAP_H / 2 + 26);
    this.#sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    this.#sun.castShadow = true;
    this.#sun.shadow.mapSize.set(2048, 2048);
    const sc = this.#sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 120;
    this.#sun.shadow.bias = -0.0008;

    this.#ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 40),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    this.#ring.rotation.x = -Math.PI / 2;
    this.#ring.visible = false;
    this.#scene.add(this.#ring);

    this.#build();
  }

  setSim(sim: Sim): void {
    this.#sim = sim;
    this.#build();
  }

  // --- camera ----------------------------------------------------------------

  fit(): void {
    this.#target.set(MAP_W / 2, 0, MAP_H / 2 + 1);
    this.#yaw = -0.55;
    this.#pitch = 0.85;
    const aspect = Math.max(0.5, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.#distance = Math.min(110, 52 / Math.min(1, aspect / 1.4));
  }

  pan(dx: number, dy: number): void {
    const f = this.#distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.#yaw), 0, -Math.sin(this.#yaw));
    const forward = new THREE.Vector3(-Math.sin(this.#yaw), 0, -Math.cos(this.#yaw));
    this.#target.addScaledVector(right, -dx * f).addScaledVector(forward, dy * f);
    this.#target.x = Math.max(-5, Math.min(MAP_W + 5, this.#target.x));
    this.#target.z = Math.max(-5, Math.min(MAP_H + 5, this.#target.z));
  }

  zoomAt(_sx: number, _sy: number, factor: number): void {
    this.#distance = Math.max(10, Math.min(130, this.#distance / factor));
  }

  rotate(dx: number, dy: number): void {
    this.#yaw -= dx * 0.006;
    this.#pitch = Math.max(0.3, Math.min(1.45, this.#pitch + dy * 0.004));
  }

  /** Look at a tile position, coming a little closer if far away. */
  focus(x: number, y: number): void {
    this.#target.set(x, 0, y);
    this.#distance = Math.min(this.#distance, 40);
  }

  #placeCamera(): void {
    const c = Math.cos(this.#pitch);
    this.#camera.position.set(
      this.#target.x + Math.sin(this.#yaw) * c * this.#distance,
      this.#target.y + Math.sin(this.#pitch) * this.#distance,
      this.#target.z + Math.cos(this.#yaw) * c * this.#distance,
    );
    this.#camera.lookAt(this.#target);
  }

  // --- scene -----------------------------------------------------------------

  #mat(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
    let m = this.#mats.get(key);
    if (m === undefined) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
      if (opts.emissive) {
        m.emissive = new THREE.Color(opts.emissive);
        m.emissiveIntensity = opts.emissiveIntensity ?? 0.4;
      }
      if (opts.transparent) {
        m.transparent = true;
        m.opacity = opts.opacity ?? 0.6;
      }
      this.#mats.set(key, m);
    }
    return m;
  }

  #build(): void {
    this.#world.clear();
    this.#buildings = [];
    for (const s of this.#sprites.values()) {
      s.body.removeFromParent();
      s.caravan.removeFromParent();
    }
    this.#sprites.clear();
    const plan = this.#sim.plan;

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
      this.#mat('#7a5a3a'),
      this.#mat('#6a4a2a'),
      this.#mat('#78b856'),
      this.#mat('#4a3420'),
      this.#mat('#8a6a4a'),
      this.#mat('#6a4a2a'),
    ]);
    slab.position.set(MAP_W / 2, -0.81, MAP_H / 2);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), this.#waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(42.5, 0.04, 32.5);
    this.#world.add(ground, slab, water);

    for (const b of plan.buildings) {
      const info = this.#buildBuilding(b);
      this.#world.add(info.group);
      this.#buildings.push(info);
    }
    this.#buildProps(scatterProps(plan));
  }

  #buildBuilding(b: Placed): BuildingInfo {
    const sim = this.#sim;
    const protocol = b.protocolId !== undefined ? sim.guild.protocols.get(b.protocolId) : undefined;
    const hero = b.heroAddress !== undefined ? sim.guild.heroes.find((h) => h.address === b.heroAddress) : undefined;
    const tier = (hero?.tier ?? 0) as Tier;
    const st = styleFor(b.kind, tier);
    const roof = st.roof ?? (protocol ? brandColor(protocol.id) : '#a0522d');
    const guildColor = sim.guild.heroes[0] ? crestColors(sim.guild.heroes[0].address)[0] : P.red;
    const banner = b.kind === 'guildhall' || hero ? guildColor : P.red;

    const g = new THREE.Group();
    g.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    g.userData.target = { kind: 'building', placed: b } satisfies HitTarget;
    const W = b.w - (b.kind === 'tower' ? 1.3 : 0.6);
    const D = b.h - (b.kind === 'tower' ? 1.3 : 0.6);
    const H = Math.max(0.2, st.wallH * HEIGHT_SCALE * (b.kind === 'tower' ? 1.25 : 1));
    const R = st.roofH * HEIGHT_SCALE;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    let top = H + R;

    if (b.kind === 'gate') {
      const stone = this.#mat(P.stone);
      add(new THREE.BoxGeometry(0.6, 2.4, 0.6), stone, -1.1, 1.2, 0);
      add(new THREE.BoxGeometry(0.6, 2.4, 0.6), stone, 1.1, 1.2, 0);
      add(new THREE.BoxGeometry(3, 0.45, 0.7), this.#mat(P.stoneDark), 0, 2.55, 0);
      add(new THREE.BoxGeometry(0.08, 1, 0.08), this.#mat(P.woodDark), 0.4, 0.5, -0.6);
      add(new THREE.BoxGeometry(0.7, 0.2, 0.05), this.#mat(P.woodLight), 0.6, 0.9, -0.6);
      return { placed: b, group: g, top: 2.8 };
    }
    if (b.kind === 'home' && tier === 0) {
      add(new THREE.BoxGeometry(1.2, 0.12, 0.6), this.#mat('#8a3a2a'), -0.3, 0.06, 0);
      add(new THREE.BoxGeometry(0.35, 0.13, 0.62), this.#mat('#e0d0b0'), -0.75, 0.07, 0);
      add(new THREE.ConeGeometry(0.18, 0.4, 5), this.#fireMat, 0.8, 0.2, 0.4, false);
      for (const r of [0, 1.1, 2.2]) {
        const log = add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), this.#mat(P.woodDark), 0.8, 0.05, 0.4);
        log.rotation.set(Math.PI / 2, 0, r);
      }
      return { placed: b, group: g, top: 0.6 };
    }

    const wall = this.#mat(st.wall);
    const roofMat = this.#mat(roof, st.extra === 'glow' ? { emissive: '#ffe9a0', emissiveIntensity: 0.15 } : {});
    const trim = this.#mat(st.trim);

    const hasBody = st.roofKind !== 'tent' || st.wallH > 6;
    if (hasBody) {
      add(new THREE.BoxGeometry(W, H, D), wall, 0, H / 2, 0);
      add(new THREE.BoxGeometry(W + 0.06, 0.12, D + 0.06), trim, 0, 0.06, 0);
    }

    // roof
    switch (st.roofKind) {
      case 'gable': {
        const shape = new THREE.Shape([new THREE.Vector2(-D / 2 - 0.18, 0), new THREE.Vector2(D / 2 + 0.18, 0), new THREE.Vector2(0, R)]);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: W + 0.3, bevelEnabled: false });
        geo.rotateY(Math.PI / 2);
        geo.translate(-(W + 0.3) / 2, 0, 0);
        add(geo, roofMat, 0, H, 0);
        break;
      }
      case 'pyramid': {
        const geo = new THREE.ConeGeometry(Math.max(W, D) * 0.78, R, 4);
        geo.rotateY(Math.PI / 4);
        add(geo, roofMat, 0, H + R / 2, 0);
        break;
      }
      case 'spire': {
        const r = W * (b.kind === 'tower' ? 0.72 : 0.5);
        const h = R * 1.7;
        const geo = new THREE.ConeGeometry(r, h, b.kind === 'tower' ? 4 : 8);
        if (b.kind === 'tower') geo.rotateY(Math.PI / 4);
        add(geo, roofMat, 0, H + h / 2, 0);
        top = H + h;
        break;
      }
      case 'dome': {
        add(new THREE.SphereGeometry(Math.min(W, D) * 0.48, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roofMat, 0, H, 0);
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), this.#mat(P.gold, { emissive: P.gold, emissiveIntensity: 0.3 }), 0, H + Math.min(W, D) * 0.48 + 0.3, 0);
        top = H + Math.min(W, D) * 0.48 + 0.6;
        break;
      }
      case 'tent': {
        const h = R + (hasBody ? 0 : H) + 0.4;
        add(new THREE.ConeGeometry(W * 0.62, h, 8), roofMat, 0, (hasBody ? H : 0) + h / 2, 0);
        add(new THREE.ConeGeometry(W * 0.2, h * 0.35, 8), this.#mat('#2a1a2a'), 0, h * 0.17, W * 0.5, false);
        add(new THREE.BoxGeometry(0.4, 0.25, 0.02), trim, 0.2, (hasBody ? H : 0) + h + 0.2, 0);
        top = (hasBody ? H : 0) + h;
        break;
      }
      case 'crenel':
      case 'flat': {
        add(new THREE.BoxGeometry(W + 0.12, 0.14, D + 0.12), this.#mat(st.roofKind === 'crenel' ? st.trim : roof), 0, H + 0.07, 0);
        if (st.roofKind === 'crenel') {
          for (let i = 0; i < 6; i++) {
            const u = -W / 2 + (i + 0.5) * (W / 6);
            add(new THREE.BoxGeometry(0.22, 0.28, 0.22), wall, u, H + 0.28, D / 2);
            add(new THREE.BoxGeometry(0.22, 0.28, 0.22), wall, u, H + 0.28, -D / 2);
            add(new THREE.BoxGeometry(0.22, 0.28, 0.22), wall, W / 2, H + 0.28, u * (D / W));
            add(new THREE.BoxGeometry(0.22, 0.28, 0.22), wall, -W / 2, H + 0.28, u * (D / W));
          }
          top = H + 0.45;
        }
        if (b.kind === 'home' && tier === 6) {
          for (const sx of [-1, 1]) {
            add(new THREE.CylinderGeometry(0.42, 0.42, H + 1, 10), this.#mat(P.stone), sx * (W / 2), (H + 1) / 2, D / 2);
            add(new THREE.ConeGeometry(0.55, 1.1, 10), this.#mat('#4a5a8a'), sx * (W / 2), H + 1.55, D / 2);
          }
          top = H + 2.1;
        }
        break;
      }
      case 'awning': {
        const stripes = 8;
        for (let i = 0; i < stripes; i++) {
          const m = add(new THREE.BoxGeometry(W / stripes, 0.05, D * 0.75), i % 2 === 0 ? roofMat : this.#mat(P.white), -W / 2 + (i + 0.5) * (W / stripes), H + R * 0.35, 0.15);
          m.rotation.x = 0.35;
        }
        top = H + R * 0.7;
        break;
      }
    }

    // door, windows, sign on the front (+z, the street side)
    const front = D / 2 + 0.02;
    if (hasBody && st.wallH >= 8) {
      const big = b.kind === 'tower' || b.kind === 'guildhall' || b.kind === 'bank';
      const dh = Math.min(0.85, H - 0.15);
      add(new THREE.BoxGeometry(big ? 0.7 : 0.5, dh, 0.06), this.#mat(P.woodDark), 0, dh / 2, front, false);
      add(new THREE.BoxGeometry(big ? 0.8 : 0.6, 0.08, 0.08), trim, 0, dh + 0.04, front, false);
    }
    if (hasBody && st.wallH >= 11) {
      const wy = Math.min(H - 0.35, 0.95);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.34, 0.3, 0.05), this.#windowMat, sx * W * 0.3, wy, front, false);
        add(new THREE.BoxGeometry(0.05, 0.3, 0.34), this.#windowMat, sx * (W / 2 + 0.02), wy, 0, false);
      }
      for (let y = wy + 0.9; y < H - 0.4; y += 0.9) {
        add(new THREE.BoxGeometry(0.28, 0.32, 0.05), this.#windowMat, 0, y, front, false);
      }
    }

    switch (st.extra) {
      case 'columns':
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.07, 0.07, H, 6), this.#mat(P.white), -W / 2 + 0.25 + (i * (W - 0.5)) / 3, H / 2, front + 0.2);
        add(new THREE.BoxGeometry(W + 0.2, 0.12, 0.45), this.#mat(P.stoneLight), 0, H, front + 0.12);
        break;
      case 'chimneyFire':
        add(new THREE.BoxGeometry(0.35, 0.9, 0.35), this.#mat(P.stoneDark), W * 0.3, H + R * 0.6, -D * 0.15);
        add(new THREE.BoxGeometry(0.25, 0.2, 0.25), this.#fireMat, W * 0.3, H + R * 0.6 + 0.55, -D * 0.15, false);
        break;
      case 'smoke':
        add(new THREE.IcosahedronGeometry(0.18), this.#mat('#9af0b0', { emissive: '#5fe08a', emissiveIntensity: 0.6, transparent: true, opacity: 0.7 }), 0.25, top + 0.25, 0, false);
        break;
      case 'banners':
        for (const sx of [-1, 1]) {
          add(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), this.#mat(P.woodDark), sx * (W / 2 - 0.1), H + 0.45, front + 0.05);
          add(new THREE.BoxGeometry(0.02, 0.38, 0.3), this.#mat(banner), sx * (W / 2 - 0.1), H + 0.78, front + 0.22);
        }
        break;
      case 'pier':
        add(new THREE.BoxGeometry(1.8, 0.08, 0.7), this.#mat(P.woodDark), W / 2 + 0.9, 0.08, 0.3);
        break;
      case 'crates':
        add(new THREE.BoxGeometry(0.35, 0.35, 0.35), this.#mat(P.woodLight), -W / 2 - 0.15, 0.18, front);
        add(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.#mat(P.wood), W / 2 + 0.1, 0.15, front + 0.1);
        break;
      case 'stalls':
        for (const [sx, col] of [[-0.75, '#e05050'], [0.75, '#f0c040']] as const) {
          add(new THREE.BoxGeometry(0.6, 0.35, 0.35), this.#mat(P.woodLight), sx, 0.18, front + 0.45);
          add(new THREE.BoxGeometry(0.5, 0.08, 0.28), this.#mat(col), sx, 0.4, front + 0.45);
        }
        break;
      case 'bell':
        add(new THREE.CylinderGeometry(0.18, 0.3, 0.38, 8), this.#mat(P.gold, { emissive: P.goldDark, emissiveIntensity: 0.3 }), 0, H - 0.35, front + 0.05);
        add(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), this.#mat(P.white), 0, H - 1.1, front + 0.02, false).rotation.x = Math.PI / 2;
        break;
      case 'fog':
        add(new THREE.CylinderGeometry(W * 0.9, W * 0.9, 0.3, 16), this.#mat('#e8e0ff', { transparent: true, opacity: 0.25 }), 0, 0.15, 0, false);
        break;
      default:
        break;
    }

    let signInfo: BuildingInfo['sign'];
    if (b.kind !== 'home' && b.kind !== 'tower') {
      const sy = hasBody ? Math.min(H - 0.15, 1.35) : 0.9;
      const sz = hasBody ? front + 0.04 : W * 0.65;
      add(new THREE.BoxGeometry(0.66, 0.66, 0.05), this.#mat(P.woodDark), 0, sy, sz, false);
      add(new THREE.PlaneGeometry(0.56, 0.56), new THREE.MeshStandardMaterial({ map: this.#emblemTexture(st), roughness: 0.8 }), 0, sy, sz + 0.03, false);
      if (protocol?.iconUrl) signInfo = { x: g.position.x, y: sy, z: g.position.z + sz + 0.04, url: protocol.iconUrl };
    }

    g.traverse((o) => {
      o.userData.target = g.userData.target;
    });
    return signInfo ? { placed: b, group: g, top, sign: signInfo } : { placed: b, group: g, top };
  }

  #emblemTexture(st: Style): THREE.Texture {
    const s = sprite(`emblem-plate:${st.emblem}`, 13, 13, 0, 0, (c) => {
      plate(c, 1, 1, 11, 11);
      drawEmblem(c, st.emblem, 2, 2);
    });
    const t = new THREE.CanvasTexture(s.canvas);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  #buildProps(props: Prop[]): void {
    const rng = makeRng(11);
    const parts: Record<string, { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[] }> = {
      trunk: { geo: new THREE.CylinderGeometry(0.08, 0.11, 0.6, 5), mat: this.#mat(P.woodDark), list: [] },
      crown: { geo: new THREE.IcosahedronGeometry(0.5, 0), mat: this.#mat('#4a9a42'), list: [] },
      crown2: { geo: new THREE.IcosahedronGeometry(0.38, 0), mat: this.#mat('#5aaa4a'), list: [] },
      pine: { geo: new THREE.ConeGeometry(0.5, 1.1, 6), mat: this.#mat('#2f6a3a'), list: [] },
      pineTop: { geo: new THREE.ConeGeometry(0.36, 0.8, 6), mat: this.#mat('#3a7a44'), list: [] },
      bush: { geo: new THREE.IcosahedronGeometry(0.28, 0), mat: this.#mat('#4a9a42'), list: [] },
      rock: { geo: new THREE.DodecahedronGeometry(0.22, 0), mat: this.#mat(P.stoneDark), list: [] },
    };
    const put = (key: string, x: number, y: number, z: number, s: number, ry = 0): void => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
      parts[key]?.list.push(m);
    };
    for (const p of props) {
      const s = 0.8 + rng() * 0.5;
      const x = p.x + (rng() - 0.5) * 0.4;
      const z = p.y - 0.3 + (rng() - 0.5) * 0.4;
      switch (p.kind) {
        case 'tree':
          put('trunk', x, 0.3 * s, z, s);
          put('crown', x, 0.95 * s, z, s, rng() * 3);
          put('crown2', x + 0.15, 1.3 * s, z - 0.1, s, rng() * 3);
          break;
        case 'pine':
          put('trunk', x, 0.3 * s, z, s * 0.8);
          put('pine', x, 0.85 * s, z, s);
          put('pineTop', x, 1.35 * s, z, s);
          break;
        case 'bush':
          put('bush', x, 0.2, z, s);
          break;
        case 'rock':
          put('rock', x, 0.1, z, s, rng() * 3);
          break;
      }
    }
    for (const part of Object.values(parts)) {
      if (part.list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, part.list.length);
      part.list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.#world.add(mesh);
    }
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
      mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false });
      this.#spriteMats.set(tex, mat);
    }
    return mat;
  }

  #placeSprite(obj: THREE.Sprite, s: Sprite, x: number, y: number, lift: number, flip: boolean): void {
    obj.material = this.#texture(s.canvas, flip);
    const w = s.canvas.width / ART_PER_TILE;
    const h = s.canvas.height / ART_PER_TILE;
    obj.scale.set(w, h, 1);
    obj.center.set(flip ? 1 - s.ax / s.canvas.width : s.ax / s.canvas.width, 1 - s.ay / s.canvas.height);
    obj.position.set(x, lift, y);
  }

  #syncAgents(): void {
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
    }
    for (const [id, pair] of this.#sprites) {
      if (seen.has(id)) continue;
      pair.body.removeFromParent();
      pair.caravan.removeFromParent();
      this.#sprites.delete(id);
    }
  }

  #drawAgent(a: Agent, body: THREE.Sprite, caravan: THREE.Sprite): void {
    const moving = a.path.length > 0;
    const frame = moving ? Math.floor(a.phase) : 0;
    const flip = a.facing < 0;
    const lift = (a.flying && (moving || a.kind === 'raven') ? 0.7 + Math.sin(a.phase) * 0.1 : 0) + (moving ? 0 : Math.abs(Math.sin(a.phase * 2)) * 0.02);
    let s: Sprite;
    if (a.kind === 'hero' && a.hero) {
      const h = hashString(a.hero.address);
      s = heroSprite({ address: a.hero.address, cls: this.classOf(a.hero.address), tier: a.hero.tier, crest: crestColors(a.hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 }, frame);
    } else if (a.kind === 'villager') {
      s = villagerSprite(hashString(a.id), frame, true);
    } else {
      s = npcSprite(a.kind === 'raven' ? 'raven' : a.kind === 'herald' ? 'herald' : 'bailiff', frame);
    }
    this.#placeSprite(body, s, a.x, a.y, lift, flip);

    const back = a.trail[a.flying ? 6 : 9];
    const cs = a.kind === 'hero' && a.carrying !== null && a.carrying > 0 ? caravanSprite(a.carrying, frame) : null;
    caravan.visible = back !== undefined && cs !== null;
    if (back && cs) this.#placeSprite(caravan, cs, back.x, back.y, lift * 0.6, flip);
  }

  // --- frame -----------------------------------------------------------------

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const gl = this.#gl.domElement;
    if (gl.width !== Math.round(w * dpr) || gl.height !== Math.round(h * dpr)) {
      this.#gl.setPixelRatio(dpr);
      this.#gl.setSize(w, h, false);
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
    }
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }

    this.#lighting();
    this.#placeCamera();
    this.#syncAgents();
    this.#highlight();
    this.#gl.render(this.#scene, this.#camera);
    this.#overlay(dpr, w, h);
  }

  #lighting(): void {
    const sim = this.#sim;
    const night = nightFactor();
    const gloom = sim.gloom;
    const day = new THREE.Color('#9fd3f0');
    const dusk = new THREE.Color('#1c2450');
    this.#sky.copy(day).lerp(dusk, night).lerp(new THREE.Color('#3a3e48'), gloom * 0.8);
    this.#sun.intensity = 2.2 * (1 - night * 0.8) * (1 - gloom * 0.6);
    this.#sun.color.set(night > 0.5 ? '#9fb0ff' : '#fff1d6');
    this.#hemi.intensity = 1.1 * (1 - night * 0.55) * (1 - gloom * 0.4);
    this.#windowMat.emissiveIntensity = night * 1.4;
    this.#waterMat.opacity = 0.8 + Math.sin(sim.elapsed * 1.3) * 0.06;
    // a little shake for the big moments
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
    if (this.#distance < 55) nameTags(c, sim, (x, y, flying) => this.#project(x, y, flying ? 3.3 : 2.6));
  }

  /** Protocol logos over the sign boards, when the sign faces the camera. */
  #signLogos(c: CanvasRenderingContext2D): void {
    if (this.#distance > 75) return;
    c.imageSmoothingEnabled = true;
    for (const b of this.#buildings) {
      const s = b.sign;
      if (s === undefined) continue;
      if (this.#camera.position.z - s.z < 0.5) continue; // seen from behind
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

  hitTest(sx: number, sy: number): HitTarget | null {
    const ndc = new THREE.Vector2((sx / this.canvas.clientWidth) * 2 - 1, -(sy / this.canvas.clientHeight) * 2 + 1);
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const heroes = [...this.#sprites.values()].map((p) => p.body).filter((s) => s.userData.target !== undefined);
    const hitHero = this.#raycaster.intersectObjects(heroes, false)[0];
    if (hitHero) return hitHero.object.userData.target as HitTarget;
    const hit = this.#raycaster.intersectObjects(this.#buildings.map((b) => b.group), true)[0];
    return hit ? ((hit.object.userData.target as HitTarget | undefined) ?? null) : null;
  }
}
