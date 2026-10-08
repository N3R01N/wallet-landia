/**
 * Installed packs, the player's loadout (slot → pack), and resolution.
 *
 * Resolution walks a chain of keys from specific to general (`hero.t3.merchant`
 * → `hero.t3`) and returns the first slot whose chosen pack provides the
 * needed form. Anything unresolved — or not loaded yet — falls back to the
 * built-in art, so a missing or broken pack can never break the town.
 */

import type { ModelRef, PackManifest, SlotEntry, SpriteRef } from './pack.js';
import type { Sprite } from '../render/pixel.js';

export const DEFAULT_PACK = 'default';

export interface LoadedPack {
  manifest: PackManifest;
  source: 'bundled' | 'imported';
  /** Maps a path inside the pack to a URL the browser can load. */
  url(path: string): string;
  /** Every file path in the pack (lets loaders resolve files a model refers to). */
  files: string[];
}

export interface Resolved<T> {
  pack: LoadedPack;
  key: string;
  ref: T;
}

type Listener = () => void;

export class AssetRegistry {
  readonly packs = new Map<string, LoadedPack>();
  /** slot key → pack id. Missing or 'default' means the built-in art. */
  loadout: Record<string, string> = {};
  /** Bumped whenever what resolves may have changed (pack added, image loaded). */
  version = 0;

  #listeners = new Set<Listener>();
  #images = new Map<string, HTMLImageElement>();
  #sprites = new Map<string, Sprite>();

  onChange(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed(): void {
    this.version++;
    this.#sprites.clear();
    for (const fn of this.#listeners) fn();
  }

  /** Something resolvable finished loading elsewhere (e.g. a 3D model). */
  notify(): void {
    this.#changed();
  }

  add(pack: LoadedPack): void {
    this.packs.set(pack.manifest.id, pack);
    this.#changed();
  }

  remove(id: string): void {
    this.packs.delete(id);
    for (const [k, v] of Object.entries(this.loadout)) if (v === id) delete this.loadout[k];
    this.#changed();
  }

  setLoadout(loadout: Record<string, string>): void {
    this.loadout = { ...loadout };
    this.#changed();
  }

  /** Use a pack for every slot it fills. */
  useEverywhere(id: string): void {
    const p = this.packs.get(id);
    if (!p) return;
    for (const k of Object.keys(p.manifest.slots)) this.loadout[k] = id;
    this.#changed();
  }

  choose(key: string, packId: string): void {
    if (packId === DEFAULT_PACK) delete this.loadout[key];
    else this.loadout[key] = packId;
    this.#changed();
  }

  /** Packs that can fill a slot, for the loadout picker. */
  providers(key: string): LoadedPack[] {
    return [...this.packs.values()].filter((p) => p.manifest.slots[key] !== undefined);
  }

  resolve<F extends keyof SlotEntry>(chain: readonly string[], form: F): Resolved<NonNullable<SlotEntry[F]>> | null {
    for (const key of chain) {
      const id = this.loadout[key];
      if (id === undefined || id === DEFAULT_PACK) continue;
      const pack = this.packs.get(id);
      const ref = pack?.manifest.slots[key]?.[form];
      if (pack && ref !== undefined) return { pack, key, ref: ref as NonNullable<SlotEntry[F]> };
    }
    return null;
  }

  /** A word from the lexicon, or the built-in name. */
  word(key: string, fallback: string): string {
    return this.resolve([`word.${key}`], 'word')?.ref ?? fallback;
  }

  model(chain: readonly string[]): { url: string; ref: ModelRef; pack: LoadedPack } | null {
    const r = this.resolve(chain, 'model');
    return r ? { url: r.pack.url(r.ref.src), ref: r.ref, pack: r.pack } : null;
  }

  /**
   * A pack sprite as a Sprite (same shape as the built-in art), or null while
   * the image is loading or when no pack fills the chain.
   */
  sprite(chain: readonly string[], form: 'sprite' | 'top' | 'iso', frame = 0): Sprite | null {
    const r = this.resolve(chain, form);
    if (r === null) return null;
    const url = r.pack.url(r.ref.src);
    const frames = r.ref.frames ?? 1;
    const f = frame % frames;
    const cacheKey = `${url}#${f}`;
    const hit = this.#sprites.get(cacheKey);
    if (hit) return hit;
    const img = this.#image(url);
    if (!img.complete || img.naturalWidth === 0) return null;
    const w = Math.floor(img.naturalWidth / frames);
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (c === null) return null;
    c.imageSmoothingEnabled = false;
    c.drawImage(img, f * w, 0, w, h, 0, 0, w, h);
    const s: Sprite = { canvas, ax: (r.ref as SpriteRef).ax, ay: (r.ref as SpriteRef).ay };
    if ((r.ref as SpriteRef).sign) s.sign = (r.ref as SpriteRef).sign!;
    this.#sprites.set(cacheKey, s);
    return s;
  }

  #image(url: string): HTMLImageElement {
    let img = this.#images.get(url);
    if (img === undefined) {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => this.#changed();
      img.src = url;
      this.#images.set(url, img);
    }
    return img;
  }
}

/** The one registry the app uses. */
export const assets = new AssetRegistry();
