/**
 * Billboard materials, one per art canvas (and its mirror image). New villagers
 * and new frames keep arriving for as long as the town runs, so only the most
 * recently used are kept: past `cap` the oldest are freed (their textures too).
 * Billboards are unlit; every material carries the shared `tint` (night, storm).
 */

import * as THREE from 'three';

interface Entry {
  /** Facing as drawn, and mirrored. */
  mats: [THREE.SpriteMaterial, THREE.SpriteMaterial];
  /** A rendered picture (an impostor), smoothly filtered; pixel art stays crisp. */
  smooth: boolean;
}

export class SpriteMaterials {
  /** Set it, then `retint()`. */
  readonly tint = new THREE.Color('#ffffff');
  readonly #byCanvas = new Map<HTMLCanvasElement, Entry>();
  readonly #cap: number;

  /** `cap` well above the canvases drawn in one frame, or they would be freed and made again every frame. */
  constructor(cap = 1024) {
    this.#cap = cap;
  }

  get(canvas: HTMLCanvasElement, flip: boolean, smooth = false): THREE.SpriteMaterial {
    let e = this.#byCanvas.get(canvas);
    if (e === undefined) {
      const mk = (f: boolean): THREE.SpriteMaterial => {
        const t = new THREE.CanvasTexture(canvas);
        t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
        t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        if (f) {
          t.wrapS = THREE.RepeatWrapping;
          t.repeat.x = -1;
        }
        return new THREE.SpriteMaterial({ map: t, alphaTest: 0.5, transparent: false, color: this.tint.clone() });
      };
      e = { mats: [mk(false), mk(true)], smooth };
      this.#byCanvas.set(canvas, e);
      // a Map keeps insertion order: the first is the least recently used
      for (const [c, old] of this.#byCanvas) {
        if (this.#byCanvas.size <= this.#cap) break;
        this.#drop(c, old);
      }
    } else {
      // used again: to the back of the line
      this.#byCanvas.delete(canvas);
      this.#byCanvas.set(canvas, e);
    }
    return e.mats[flip ? 1 : 0];
  }

  /** Give every material the current `tint`. */
  retint(): void {
    for (const e of this.#byCanvas.values()) for (const m of e.mats) m.color.copy(this.tint);
  }

  /** Free the impostors (a theme's figures, gone with it). */
  dropSmooth(): void {
    for (const [c, e] of this.#byCanvas) if (e.smooth) this.#drop(c, e);
  }

  #drop(canvas: HTMLCanvasElement, e: Entry): void {
    this.#byCanvas.delete(canvas);
    for (const m of e.mats) {
      m.map?.dispose();
      m.dispose();
    }
  }
}
