/**
 * The battlefield buildings in the town (spec: "Buildings on the battlefield"):
 * a capture ring round each (fx.capture.ring, 24 segments filling as a side
 * takes it) and the owner's banner beside it (prop.banner.owner, in the
 * owner's colour), both in the team colours.
 */

import * as THREE from 'three';
import type { Stage } from '../../castle/scene/castleView.js';
import { CAPTURE_RADIUS, type CapturePoint } from '../core/battle.js';
import type { SideId } from '../core/types.js';
import { TEAM_COLORS } from './battleView.js';

const SEGMENTS = 24;
const NEUTRAL = '#d9cdb0';

interface Marker {
  point: CapturePoint;
  ring: THREE.Object3D;
  segments: THREE.Object3D[];
  ringMats: THREE.Material[];
  banner: THREE.Object3D | null;
  bannerMats: THREE.Material[];
}

export class FieldMarkers {
  readonly #stage: Stage;
  readonly #group = new THREE.Group();
  #markers: Marker[] = [];

  constructor(stage: Stage) {
    this.#stage = stage;
    stage.scene.add(this.#group);
  }

  async place(points: readonly CapturePoint[]): Promise<void> {
    const [ring, banner] = await Promise.all([this.#stage.load('fx.capture.ring'), this.#stage.load('prop.banner.owner')]);
    this.#clear();
    for (const p of points) {
      const r = ring ? ring.scene.clone(true) : fallbackRing();
      r.position.set(p.x, 0.02, p.z);
      r.scale.setScalar(CAPTURE_RADIUS);
      const segments: THREE.Object3D[] = [];
      r.traverse((o) => {
        const name = (o.userData.name as string | undefined) ?? o.name;
        if (/^seg\.?\d\d$/.test(name)) segments.push(o);
      });
      segments.sort((a, b) => segName(a) - segName(b));
      const ringMats = ownTint(r);
      this.#group.add(r);
      let b: THREE.Object3D | null = null;
      let bannerMats: THREE.Material[] = [];
      if (banner) {
        b = banner.scene.clone(true);
        // beside the point, towards the lane's outside
        b.position.set(p.x + (p.x >= 0 ? 1.4 : -1.4), 0, p.z + 1.2);
        bannerMats = ownTint(b);
        b.visible = false;
        this.#group.add(b);
      }
      this.#markers.push({ point: p, ring: r, segments, ringMats, banner: b, bannerMats });
    }
  }

  /** Who holds each building: its banner, and a full ring in its colour (an empty one when no one does). */
  setOwners(owners: Readonly<Record<string, SideId | null>>): void {
    for (const m of this.#markers) {
      const owner = owners[m.point.id] ?? null;
      this.#fill(m, owner ? 1 : 0, owner);
      if (m.banner) {
        m.banner.visible = owner !== null;
        if (owner) setColor(m.bannerMats, TEAM_COLORS[owner]);
      }
    }
  }

  /** A capture under way: the ring fills in the capturing side's colour. */
  progress(id: string, side: SideId, share: number): void {
    const m = this.#markers.find((x) => x.point.id === id);
    if (m) this.#fill(m, share, side);
  }

  dispose(): void {
    this.#clear();
    this.#group.removeFromParent();
  }

  #fill(m: Marker, share: number, side: SideId | null): void {
    const n = Math.round(Math.max(0, Math.min(1, share)) * SEGMENTS);
    if (m.segments.length > 0) m.segments.forEach((s, i) => (s.visible = i < n || n === 0));
    setColor(m.ringMats, n === 0 || !side ? NEUTRAL : TEAM_COLORS[side]);
  }

  #clear(): void {
    for (const m of this.#markers) {
      for (const mat of [...m.ringMats, ...m.bannerMats]) mat.dispose();
      m.ring.removeFromParent();
      m.banner?.removeFromParent();
    }
    this.#markers = [];
  }
}

function segName(o: THREE.Object3D): number {
  const name = (o.userData.name as string | undefined) ?? o.name;
  return Number(/(\d\d)$/.exec(name)?.[1] ?? 0);
}

/** Gives an object its own copy of its Tint material (colours set per marker). */
function ownTint(root: THREE.Object3D): THREE.Material[] {
  const mats: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (m.name !== 'Tint') return m;
      const c = m.clone();
      mats.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return mats;
}

function setColor(mats: readonly THREE.Material[], color: string): void {
  for (const m of mats) if ('color' in m) (m as THREE.MeshStandardMaterial).color.set(color);
}

/** Without the model: a plain ring on the ground. */
function fallbackRing(): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({ color: NEUTRAL });
  mat.name = 'Tint';
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2), mat);
  return mesh;
}
