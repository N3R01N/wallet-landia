/**
 * Low-poly buildings from the shared style table. Used by the town's 3D view
 * and by the sandbox. A building is built at the origin (footprint centred on
 * x/z, ground at y = 0, +z facing the street); callers place it.
 */

import * as THREE from 'three';
import type { Tier } from '../../domain/tiers.js';
import type { PlacedKind } from '../../world/layout.js';
import { drawEmblem, plate, styleFor, type Style } from '../buildings.js';
import { P, sprite } from '../pixel.js';
import { buildingChain } from '../../assets/art.js';
import { packModel } from './models.js';

/** 2D wall/roof heights are in art px; this turns them into tiles. */
export const HEIGHT_SCALE = 1 / 12;

export interface BuildingSpec {
  kind: PlacedKind;
  /** Footprint in tiles. */
  w: number;
  h: number;
  /** Home tier (value); 0 for other buildings. */
  tier: Tier;
  /** Roof colour (a protocol's brand colour). */
  roof?: string;
  /** Banner colour (the guild's). */
  banner?: string;
  /** A protocol logo for the sign, drawn on the overlay by the renderer. */
  iconUrl?: string | null;
}

export interface BuiltBuilding {
  group: THREE.Group;
  /** Height of the roof top in tiles. */
  top: number;
  /** Sign position, local to the group. */
  sign?: { x: number; y: number; z: number; url: string };
  /** The Chronicle bell's pivot, so the renderer can swing it. */
  bell?: THREE.Object3D;
  /** Chimneys and stacks: where smoke rises (local to the group, tiles) and its colour. */
  smoke?: { x: number; y: number; z: number; color: string }[];
}

export class BuildingFactory {
  readonly windowMat = new THREE.MeshStandardMaterial({ color: P.glass, emissive: new THREE.Color(P.glassLit), emissiveIntensity: 0, roughness: 0.3 });
  readonly fireMat = new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 1.2 });
  #mats = new Map<string, THREE.MeshStandardMaterial>();

  mat(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshStandardMaterial {
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

  build(b: BuildingSpec): BuiltBuilding {
    const tier = b.tier;
    const st = styleFor(b.kind, tier);
    const roof = st.roof ?? b.roof ?? '#a0522d';
    const banner = b.banner ?? P.red;
    let bell: THREE.Object3D | undefined;

    const g = new THREE.Group();
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

    // A pack model for this building replaces the built-in mesh entirely.
    const model = packModel(buildingChain(b.kind, tier));
    if (model) {
      const m = model.scene.clone(true);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      // Fit the footprint (tiles), keep proportions, stand on the ground.
      const fit = (Math.min(b.w, b.h) - 0.3) / Math.max(0.001, Math.max(size.x, size.z));
      const s = Math.min(fit, model.scale);
      m.scale.multiplyScalar(s);
      m.position.y = -box.min.y * s;
      g.add(m);
      return { group: g, top: size.y * s };
    }

    if (b.kind === 'gate') {
      const stone = this.mat(P.stone);
      add(new THREE.BoxGeometry(0.6, 2.4, 0.6), stone, -1.1, 1.2, 0);
      add(new THREE.BoxGeometry(0.6, 2.4, 0.6), stone, 1.1, 1.2, 0);
      add(new THREE.BoxGeometry(3, 0.45, 0.7), this.mat(P.stoneDark), 0, 2.55, 0);
      add(new THREE.BoxGeometry(0.08, 1, 0.08), this.mat(P.woodDark), 0.4, 0.5, -0.6);
      add(new THREE.BoxGeometry(0.7, 0.2, 0.05), this.mat(P.woodLight), 0.6, 0.9, -0.6);
      return { group: g, top: 2.8 };
    }
    if (b.kind === 'home' && tier === 0) {
      add(new THREE.BoxGeometry(1.2, 0.12, 0.6), this.mat('#8a3a2a'), -0.3, 0.06, 0);
      add(new THREE.BoxGeometry(0.35, 0.13, 0.62), this.mat('#e0d0b0'), -0.75, 0.07, 0);
      add(new THREE.ConeGeometry(0.18, 0.4, 5), this.fireMat, 0.8, 0.2, 0.4, false);
      for (const r of [0, 1.1, 2.2]) {
        const log = add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), this.mat(P.woodDark), 0.8, 0.05, 0.4);
        log.rotation.set(Math.PI / 2, 0, r);
      }
      return { group: g, top: 0.6 };
    }

    const wall = this.mat(st.wall);
    const roofMat = this.mat(roof, st.extra === 'glow' ? { emissive: '#ffe9a0', emissiveIntensity: 0.15 } : {});
    const trim = this.mat(st.trim);

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
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), this.mat(P.gold, { emissive: P.gold, emissiveIntensity: 0.3 }), 0, H + Math.min(W, D) * 0.48 + 0.3, 0);
        top = H + Math.min(W, D) * 0.48 + 0.6;
        break;
      }
      case 'tent': {
        const h = R + (hasBody ? 0 : H) + 0.4;
        add(new THREE.ConeGeometry(W * 0.62, h, 8), roofMat, 0, (hasBody ? H : 0) + h / 2, 0);
        add(new THREE.ConeGeometry(W * 0.2, h * 0.35, 8), this.mat('#2a1a2a'), 0, h * 0.17, W * 0.5, false);
        add(new THREE.BoxGeometry(0.4, 0.25, 0.02), trim, 0.2, (hasBody ? H : 0) + h + 0.2, 0);
        top = (hasBody ? H : 0) + h;
        break;
      }
      case 'crenel':
      case 'flat': {
        add(new THREE.BoxGeometry(W + 0.12, 0.14, D + 0.12), this.mat(st.roofKind === 'crenel' ? st.trim : roof), 0, H + 0.07, 0);
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
            add(new THREE.CylinderGeometry(0.42, 0.42, H + 1, 10), this.mat(P.stone), sx * (W / 2), (H + 1) / 2, D / 2);
            add(new THREE.ConeGeometry(0.55, 1.1, 10), this.mat('#4a5a8a'), sx * (W / 2), H + 1.55, D / 2);
          }
          top = H + 2.1;
        }
        break;
      }
      case 'awning': {
        const stripes = 8;
        for (let i = 0; i < stripes; i++) {
          const m = add(new THREE.BoxGeometry(W / stripes, 0.05, D * 0.75), i % 2 === 0 ? roofMat : this.mat(P.white), -W / 2 + (i + 0.5) * (W / stripes), H + R * 0.35, 0.15);
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
      add(new THREE.BoxGeometry(big ? 0.7 : 0.5, dh, 0.06), this.mat(P.woodDark), 0, dh / 2, front, false);
      add(new THREE.BoxGeometry(big ? 0.8 : 0.6, 0.08, 0.08), trim, 0, dh + 0.04, front, false);
    }
    if (hasBody && st.wallH >= 11) {
      const wy = Math.min(H - 0.35, 0.95);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.34, 0.3, 0.05), this.windowMat, sx * W * 0.3, wy, front, false);
        add(new THREE.BoxGeometry(0.05, 0.3, 0.34), this.windowMat, sx * (W / 2 + 0.02), wy, 0, false);
      }
      for (let y = wy + 0.9; y < H - 0.4; y += 0.9) {
        add(new THREE.BoxGeometry(0.28, 0.32, 0.05), this.windowMat, 0, y, front, false);
      }
    }

    switch (st.extra) {
      case 'columns':
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.07, 0.07, H, 6), this.mat(P.white), -W / 2 + 0.25 + (i * (W - 0.5)) / 3, H / 2, front + 0.2);
        add(new THREE.BoxGeometry(W + 0.2, 0.12, 0.45), this.mat(P.stoneLight), 0, H, front + 0.12);
        break;
      case 'chimneyFire':
        add(new THREE.BoxGeometry(0.35, 0.9, 0.35), this.mat(P.stoneDark), W * 0.3, H + R * 0.6, -D * 0.15);
        add(new THREE.BoxGeometry(0.25, 0.2, 0.25), this.fireMat, W * 0.3, H + R * 0.6 + 0.55, -D * 0.15, false);
        break;
      case 'smoke':
        add(new THREE.IcosahedronGeometry(0.18), this.mat('#9af0b0', { emissive: '#5fe08a', emissiveIntensity: 0.6, transparent: true, opacity: 0.7 }), 0.25, top + 0.25, 0, false);
        break;
      case 'banners':
        for (const sx of [-1, 1]) {
          add(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), this.mat(P.woodDark), sx * (W / 2 - 0.1), H + 0.45, front + 0.05);
          add(new THREE.BoxGeometry(0.02, 0.38, 0.3), this.mat(banner), sx * (W / 2 - 0.1), H + 0.78, front + 0.22);
        }
        break;
      case 'pier':
        add(new THREE.BoxGeometry(1.8, 0.08, 0.7), this.mat(P.woodDark), W / 2 + 0.9, 0.08, 0.3);
        break;
      case 'crates':
        add(new THREE.BoxGeometry(0.35, 0.35, 0.35), this.mat(P.woodLight), -W / 2 - 0.15, 0.18, front);
        add(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.mat(P.wood), W / 2 + 0.1, 0.15, front + 0.1);
        break;
      case 'stalls':
        for (const [sx, col] of [[-0.75, '#e05050'], [0.75, '#f0c040']] as const) {
          add(new THREE.BoxGeometry(0.6, 0.35, 0.35), this.mat(P.woodLight), sx, 0.18, front + 0.45);
          add(new THREE.BoxGeometry(0.5, 0.08, 0.28), this.mat(col), sx, 0.4, front + 0.45);
        }
        break;
      case 'bell': {
        // A pivot at the top of the bell, so it can swing on every block.
        const pivot = new THREE.Group();
        pivot.position.set(0, H - 0.18, front + 0.12);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.4, 10), this.mat(P.gold, { emissive: P.goldDark, emissiveIntensity: 0.25 }));
        cup.position.y = -0.22;
        cup.castShadow = true;
        pivot.add(cup);
        g.add(pivot);
        bell = pivot;
        add(new THREE.BoxGeometry(0.9, 0.08, 0.3), this.mat(P.stoneDark), 0, H - 0.12, front + 0.1);
        add(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), this.mat(P.white), 0, H - 1.1, front + 0.02, false).rotation.x = Math.PI / 2;
        break;
      }
      case 'fog':
        add(new THREE.CylinderGeometry(W * 0.9, W * 0.9, 0.3, 16), this.mat('#e8e0ff', { transparent: true, opacity: 0.25 }), 0, 0.15, 0, false);
        break;
      default:
        break;
    }

    let signInfo: BuiltBuilding['sign'];
    if (b.kind !== 'home' && b.kind !== 'tower') {
      const sy = hasBody ? Math.min(H - 0.15, 1.35) : 0.9;
      const sz = hasBody ? front + 0.04 : W * 0.65;
      add(new THREE.BoxGeometry(0.66, 0.66, 0.05), this.mat(P.woodDark), 0, sy, sz, false);
      add(new THREE.PlaneGeometry(0.56, 0.56), new THREE.MeshStandardMaterial({ map: this.emblemTexture(st), roughness: 0.8 }), 0, sy, sz + 0.03, false);
      if (b.iconUrl) signInfo = { x: 0, y: sy, z: sz + 0.04, url: b.iconUrl };
    }

    const out: BuiltBuilding = { group: g, top };
    if (signInfo) out.sign = signInfo;
    if (bell) out.bell = bell;
    return out;
  }

  emblemTexture(st: Style): THREE.Texture {
    const s = sprite(`emblem-plate:${st.emblem}`, 13, 13, 0, 0, (c) => {
      plate(c, 1, 1, 11, 11);
      drawEmblem(c, st.emblem, 2, 2);
    });
    const t = new THREE.CanvasTexture(s.canvas);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

}
