/**
 * The growth moment (docs/ENGAGEMENT.md A6): a piece of the castle that
 * reached a higher tier gets scaffolding round it (`fx.scaffold`, rise), a
 * ribbon in front in the new tier's colour that is cut (`fx.ribbon`, cut), a
 * burst of sparkles, and the scaffolding comes down (fall); a toast says what
 * grew. A theme without those models plays the burst and the toast only.
 * Played over the scene through its stage, one piece after another.
 */

import * as THREE from 'three';
import type { Stage } from './castleView.js';
import type { Loaded } from '../assets/models.js';
import { tierColor } from '../assets/manifest.js';
import type { Growth } from '../world/growth.js';

/** Seconds into a moment (the scaffolding rises at 0): the ribbon is cut, the sparkles, the scaffolding comes down, the end. */
const CUT = 1.6;
const BURST = 2.1;
const FALL = 2.8;
const END = 3.8;
/** Without the scaffolding and ribbon: the burst at once. */
const PLAIN_END = 1.4;
/** Seconds between two pieces' moments. */
const NEXT = 2.6;
/** How long a toast stays (s). */
const TOAST = 4;
const BURST_SCALE = 4;

interface GrowthPiece {
  /** The piece's object in the scene. */
  obj: THREE.Object3D;
  tier: number;
  line: string;
  /** For the tests: what grew ('keep', or 'wallet0'). */
  id: string;
}

interface Playing {
  piece: GrowthPiece;
  t: number;
  /** Whether the theme has the scaffolding and the ribbon. */
  full: boolean;
  parts: { obj: THREE.Object3D; mixer: THREE.AnimationMixer | null; clips: THREE.AnimationClip[] }[];
  done: Set<string>;
}

/** Plays growth moments over a scene view; stops by itself once they have played. */
export class GrowthMoments {
  readonly #stage: Stage;
  readonly #host: HTMLElement;
  readonly #toasts: HTMLElement;
  readonly #group = new THREE.Group();
  readonly #models = new Map<string, Loaded | null>();
  readonly #materials: THREE.Material[] = [];
  #queue: GrowthPiece[] = [];
  #playing: Playing[] = [];
  #wait = 0;
  #stop: (() => void) | null = null;

  /** `host`: the view's element (the toasts go over it). */
  constructor(stage: Stage, host: HTMLElement) {
    this.#stage = stage;
    this.#host = host;
    this.#toasts = document.createElement('div');
    this.#toasts.className = 'growth-toasts';
    this.#toasts.setAttribute('role', 'status');
  }

  /** Plays a moment for each piece that grew, one after another; `line` is its toast. */
  async play(grown: readonly Growth[], line: (g: Growth) => string): Promise<void> {
    const pieces = grown.flatMap((g): GrowthPiece[] => {
      const obj = this.#find(g.piece);
      return obj ? [{ obj, tier: g.to, line: line(g), id: g.piece === 'keep' ? 'keep' : `wallet${g.piece}` }] : [];
    });
    if (!pieces.length) return;
    await Promise.all(['fx.scaffold', 'fx.ribbon', 'fx.sparkle.burst'].map(async (n) => this.#models.set(n, await this.#stage.load(n))));
    this.#queue.push(...pieces);
    if (this.#stop) return;
    this.#stage.scene.add(this.#group);
    this.#host.append(this.#toasts);
    this.#stop = this.#stage.onFrame((dt) => this.#update(dt));
  }

  /** The keep, or a wallet's hall (castleView marks them for their taps). */
  #find(piece: Growth['piece']): THREE.Object3D | null {
    if (piece === 'keep') return this.#stage.placed('keep')[0] ?? null;
    let found: THREE.Object3D | null = null;
    this.#stage.scene.traverse((o) => {
      if (!found && o.userData.walletIndex === piece && o.userData.reacts) found = o;
    });
    return found;
  }

  #update(dt: number): void {
    // a view taken off the page: done
    if (!this.#host.isConnected) return this.dispose();
    this.#wait -= dt;
    if (this.#wait <= 0 && this.#queue.length) {
      this.#start(this.#queue.shift()!);
      this.#wait = NEXT;
    }
    for (const p of this.#playing) {
      p.t += dt;
      for (const part of p.parts) part.mixer?.update(dt);
      if (p.full) {
        this.#at(p, 'cut', CUT, () => this.#clip(p.parts[1], 'cut'));
        this.#at(p, 'burst', BURST, () => this.#celebrate(p));
        this.#at(p, 'fall', FALL, () => this.#clip(p.parts[0], 'fall'));
      } else this.#at(p, 'burst', 0, () => this.#celebrate(p));
    }
    this.#playing = this.#playing.filter((p) => {
      if (p.t < (p.full ? END : PLAIN_END)) return true;
      for (const part of p.parts) this.#drop(part);
      return false;
    });
    if (!this.#queue.length && !this.#playing.length) this.dispose();
  }

  /** Once, when the moment reaches `time`. */
  #at(p: Playing, what: string, time: number, act: () => void): void {
    if (p.t < time || p.done.has(what)) return;
    p.done.add(what);
    act();
  }

  #start(piece: GrowthPiece): void {
    const scaffold = this.#models.get('fx.scaffold');
    const ribbon = this.#models.get('fx.ribbon');
    const full = !!scaffold?.clips.some((c) => c.name === 'rise') && !!ribbon?.clips.some((c) => c.name === 'cut');
    const playing: Playing = { piece, t: 0, full, parts: [], done: new Set() };
    this.#host.dataset.growth = [this.#host.dataset.growth, `${piece.id}:${full ? 'full' : 'plain'}`].filter(Boolean).join(' ');
    if (full) {
      const box = shownBounds(piece.obj);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      // the scaffolding (1 m each way) wraps the piece, a little wider than it
      const s = this.#part(scaffold!);
      s.obj.position.set(centre.x, box.min.y, centre.z);
      s.obj.scale.set(size.x * 1.08 + 0.4, size.y + 0.4, size.z * 1.08 + 0.4);
      this.#clip(s, 'rise');
      // the ribbon on the side towards the camera, facing it, in the new tier's colour
      const r = this.#part(ribbon!);
      const toward = this.#stage.camera.getWorldPosition(new THREE.Vector3()).sub(centre).setY(0);
      if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
      toward.normalize();
      const reach = Math.max(size.x, size.z) / 2 + 1.2;
      r.obj.position.set(centre.x + toward.x * reach, box.min.y, centre.z + toward.z * reach);
      r.obj.rotation.y = Math.atan2(toward.x, toward.z);
      r.obj.scale.setScalar(Math.max(1, Math.min(2.5, Math.max(size.x, size.z) / 4)));
      this.#tint(r.obj, tierColor(piece.tier));
      // held at its first frame until it is cut
      const cut = r.clips.find((c) => c.name === 'cut');
      if (cut && r.mixer) {
        const a = r.mixer.clipAction(cut);
        a.play();
        a.paused = true;
      }
      playing.parts.push(s, r);
    }
    this.#playing.push(playing);
  }

  #part(model: Loaded): Playing['parts'][number] {
    const obj = model.scene.clone(true);
    this.#group.add(obj);
    return { obj, mixer: model.clips.length ? new THREE.AnimationMixer(obj) : null, clips: model.clips };
  }

  /** Plays a clip once, held at its end. */
  #clip(part: Playing['parts'][number] | undefined, name: string): void {
    const clip = part?.clips.find((c) => c.name === name);
    if (!part?.mixer || !clip) return;
    part.mixer.stopAllAction();
    const a = part.mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().play();
  }

  /** The sparkles over the piece and the toast. */
  #celebrate(p: Playing): void {
    const burst = this.#models.get('fx.sparkle.burst');
    const pop = burst?.clips.find((c) => c.name === 'pop');
    if (burst && pop) {
      const box = shownBounds(p.piece.obj);
      const part = this.#part(burst);
      part.obj.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.5, (box.min.z + box.max.z) / 2);
      part.obj.scale.setScalar(BURST_SCALE);
      this.#clip(part, 'pop');
      p.parts.push(part);
    }
    const toast = document.createElement('div');
    toast.className = 'growth-toast';
    toast.style.setProperty('--tier', tierColor(p.piece.tier));
    toast.textContent = `✨ ${p.piece.line}`;
    this.#toasts.append(toast);
    setTimeout(() => toast.remove(), TOAST * 1000);
  }

  /** The ribbon's Tint in the tier's colour (its own copy of the material). */
  #tint(root: THREE.Object3D, color: string): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        if (m.name !== 'Tint') return m;
        const own = m.clone();
        (own as THREE.MeshStandardMaterial).color?.set(color);
        this.#materials.push(own);
        return own;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  #drop(part: Playing['parts'][number]): void {
    part.mixer?.stopAllAction();
    part.mixer?.uncacheRoot(part.obj);
    part.obj.removeFromParent();
  }

  dispose(): void {
    this.#stop?.();
    this.#stop = null;
    for (const p of this.#playing) for (const part of p.parts) this.#drop(part);
    this.#playing = [];
    this.#queue = [];
    for (const m of this.#materials) m.dispose();
    this.#materials.length = 0;
    this.#group.removeFromParent();
    // the last toast may still be showing: it goes by itself
    setTimeout(() => this.#toasts.remove(), TOAST * 1000);
  }
}

/** A piece's bounds from what is shown of it (its hidden tier, damage and far-away parts left out). */
function shownBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return box.isEmpty() ? box.setFromObject(root) : box;
}
