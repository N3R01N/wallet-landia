/**
 * Goods changing hands, as games show collecting (docs/plans/goods-exchange.md):
 * a burst of coins pops out of the giver, arcs and streams to the taker with a
 * tink each (rising when the guild receives, falling when it pays), and a
 * floating label says what moved. An NFT travels as a little framed picture
 * of itself (the real image through our picture proxy, else a stylised
 * painting), lifting, spinning once and arcing over with a shimmer.
 *
 * The coin and frame models come from the theme (`fx.coin`, `fx.nft.frame`)
 * when it has them; until then simple stand-ins of the same size.
 */

import * as THREE from 'three';
import type { Goods } from '../../domain/model.js';

export interface ExchangeHost {
  /** A copy of a theme model, or null when the theme has none. */
  model(name: string): THREE.Object3D | null;
  add(obj: THREE.Object3D): void;
  /** Where a world point shows on the page (null: behind the camera). */
  screen(p: THREE.Vector3): { x: number; y: number } | null;
  /** The element the labels go in (over the canvas). */
  labels: HTMLElement;
  /** A coin landed (its number in the stream, of how many; whether the guild receives). */
  onCoin(index: number, of: number, incoming: boolean): void;
  /** An NFT set out, and landed. */
  onNft(landed: boolean): void;
  /** A sparkle burst where goods land (`fx.sparkle.burst`; nothing without it). */
  burst?(at: THREE.Vector3): void;
}

interface Flying {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  apex: number;
  /** Starts after this many seconds, takes this long. */
  delay: number;
  duration: number;
  age: number;
  spin: number;
  done: () => void;
  /** An NFT frame: it turns once round on the way. */
  frame?: boolean;
}

/** Coins and frames fly bigger than life (as in collecting games): readable from the game's camera. */
const COIN_SCALE = 2.4;
const FRAME_SCALE = 2.2;
/** Stablecoins travel as silver. */
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'FRAX', 'LUSD', 'PYUSD', 'GHO', 'USDE', 'CRVUSD', 'TUSD', 'USDP', 'BUSD', 'SUSD']);
const GOLD = new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.75, roughness: 0.32, emissive: 0x6b4a10, emissiveIntensity: 0.35 });
const SILVER = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.8, roughness: 0.3, emissive: 0x404a58, emissiveIntensity: 0.3 });
const COIN = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20).rotateX(Math.PI / 2);
const FRAME_GOLD = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 0.6, roughness: 0.4 });
const FRAME_BORDER = new THREE.BoxGeometry(0.56, 0.66, 0.05);
const PICTURE = new THREE.PlaneGeometry(0.46, 0.56);

/** What a coin of this token shows: Ξ for ether, ₿ for bitcoin, $ for a stablecoin, else its symbol (up to four letters; a toll shows Ξ). Pure. */
export function coinMark(symbol: string): string {
  const s = symbol.toUpperCase();
  if (!s || s === 'ETH' || s === 'WETH' || s.endsWith('ETH')) return 'Ξ';
  if (s === 'BTC' || s === 'WBTC' || s === 'CBBTC' || s === 'TBTC') return '₿';
  if (STABLES.has(s)) return '$';
  return s.slice(0, 4);
}

/** How many coins a value shows as: more for more, never a slow trickle. */
export function coinCount(usd: number | null): number {
  const v = Math.abs(usd ?? 0);
  return Math.max(3, Math.min(14, Math.round(Math.log10(v + 1) * 3)));
}

/** A short label for goods: "+0.52 ETH", "−1,200 USDC", "+1 Elders #29". Pure. */
export function goodsLabel(g: Goods, incoming: boolean): string {
  const sign = incoming ? '+' : '−';
  // value only (a toll, goods with no token named)
  if (!g.symbol) return `${sign}$${Math.abs(g.usd ?? 0) < 1 ? Math.abs(g.usd ?? 0).toFixed(2) : Math.round(Math.abs(g.usd ?? 0)).toLocaleString('en-US')}${g.name ? ` ${g.name}` : ''}`;
  if (g.isNft) return `${sign}${g.quantity > 1 ? `${g.quantity} ` : ''}${g.name ?? g.symbol}`;
  const q = g.quantity;
  const shown = q >= 1000 ? Math.round(q).toLocaleString('en-US') : q >= 1 ? q.toLocaleString('en-US', { maximumFractionDigits: 2 }) : q.toPrecision(2);
  return `${sign}${shown} ${g.symbol}`;
}

export class Exchange {
  readonly #host: ExchangeHost;
  readonly #flying: Flying[] = [];
  readonly #labels: { el: HTMLElement; at: THREE.Vector3; age: number }[] = [];
  readonly #pictures = new Map<string, Promise<THREE.Texture | null>>();
  readonly #mine: THREE.Material[] = [];
  readonly #textures: THREE.Texture[] = [];
  readonly #scratch = new THREE.Vector3();

  constructor(host: ExchangeHost) {
    this.#host = host;
  }

  /**
   * Goods from one place to another: coins for tokens (by value), frames for
   * NFTs. `incoming`: the guild receives (brighter, rising sound; a green label).
   * Returns how long until the last lands (s).
   */
  send(from: THREE.Vector3, to: THREE.Vector3, goods: readonly Goods[], incoming: boolean, delay = 0): number {
    let end = 0;
    let at = delay;
    for (const g of goods.slice(0, 3)) {
      const took = g.isNft ? this.#frame(from, to, g, at, incoming) : this.#coins(from, to, g, at, incoming);
      end = Math.max(end, took);
      at += 0.25;
    }
    return end;
  }

  #coins(from: THREE.Vector3, to: THREE.Vector3, g: Goods, delay: number, incoming: boolean): number {
    const n = coinCount(g.usd);
    const silver = STABLES.has(g.symbol.toUpperCase());
    let last = 0;
    for (let i = 0; i < n; i++) {
      const model = this.#host.model('fx.coin');
      if (model) this.#dressCoin(model, g.symbol, silver);
      const obj = model ?? new THREE.Mesh(COIN, silver ? SILVER : GOLD);
      obj.scale.setScalar(COIN_SCALE);
      obj.visible = false;
      this.#host.add(obj);
      // a fountain first: each coin pops a little sideways, then streams
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      const start = from.clone().add(spread);
      const d = delay + i * 0.06;
      const duration = 0.55 + Math.random() * 0.15;
      last = Math.max(last, d + duration);
      this.#flying.push({
        obj,
        from: start,
        to: to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25)),
        apex: 1.4 + Math.random() * 0.8 + from.distanceTo(to) * 0.15,
        delay: d,
        duration,
        age: 0,
        spin: 10 + Math.random() * 6,
        done: () => {
          this.#host.onCoin(i, n, incoming);
          if (i === n - 1) {
            this.#label(to, goodsLabel(g, incoming), incoming);
            if (incoming) this.#host.burst?.(to);
          }
        },
      });
    }
    return last;
  }

  #frame(from: THREE.Vector3, to: THREE.Vector3, g: Goods, delay: number, incoming: boolean): number {
    const obj = this.frame(g);
    obj.visible = false;
    this.#host.add(obj);
    const duration = 1.1;
    this.#flying.push({
      obj,
      from: from.clone().add(new THREE.Vector3(0, 0.6, 0)),
      to: to.clone(),
      apex: 2.2 + from.distanceTo(to) * 0.12,
      delay,
      duration,
      age: 0,
      spin: 0,
      frame: true,
      done: () => {
        this.#host.onNft(true);
        this.#label(to, goodsLabel(g, incoming), incoming);
        this.#host.burst?.(to);
      },
    });
    setTimeout(() => this.#host.onNft(false), delay * 1000);
    return delay + duration;
  }

  /** A framed picture of an NFT (its own image when it can be had, else a stylised painting), for carrying or sending. */
  frame(g: Goods): THREE.Object3D {
    const obj = this.#host.model('fx.nft.frame') ?? this.#standinFrame();
    void this.#picture(g).then((tex) => {
      if (!tex) return;
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m.name === 'Picture') {
          const mine = m.clone();
          mine.map = tex;
          mine.color.set(0xffffff);
          this.#mine.push(mine);
          mesh.material = mine;
        }
      });
    });
    return obj;
  }

  /** The coin model's faces show the token (Ξ, $, its symbol) and its rim (`Trim`) is gold, or silver for a stablecoin; one material per kind, shared. */
  #dressCoin(coin: THREE.Object3D, symbol: string, silver: boolean): void {
    const key = `${coinMark(symbol)}|${silver}`;
    coin.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        if (m.name === 'Logo') return this.#coinMaterial(`face|${key}`, m, (mine) => (mine.map = this.#coinFace(symbol, silver)));
        if (m.name === 'Trim') return this.#coinMaterial(`rim|${silver}`, m, (mine) => mine.color.set(silver ? 0xdfe6ee : 0xe8b440));
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  readonly #coinMaterials = new Map<string, THREE.Material>();

  #coinMaterial(key: string, from: THREE.Material, dress: (m: THREE.MeshStandardMaterial) => void): THREE.Material {
    let m = this.#coinMaterials.get(key);
    if (!m) {
      const mine = from.clone() as THREE.MeshStandardMaterial;
      mine.color?.set(0xffffff);
      dress(mine);
      this.#mine.push(mine);
      this.#coinMaterials.set(key, mine);
      m = mine;
    }
    return m;
  }

  /** A coin face: the token's mark struck on gold (or silver). */
  #coinFace(symbol: string, silver: boolean): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = silver ? '#dfe6ee' : '#f2c14e';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = silver ? '#9aa6b4' : '#b8862a';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    const mark = coinMark(symbol);
    g.fillStyle = silver ? '#4a5664' : '#6b4a10';
    g.font = `bold ${mark.length <= 1 ? 72 : mark.length === 2 ? 52 : mark.length === 3 ? 40 : 32}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(mark, 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.#textures.push(t);
    return t;
  }

  /** A gilt frame with a picture face named `Picture` (the model's own when the theme has one). */
  #standinFrame(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(FRAME_BORDER, FRAME_GOLD));
    const pic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    pic.name = 'Picture';
    pic.map = this.#painting();
    this.#mine.push(pic);
    const face = new THREE.Mesh(PICTURE, pic);
    face.position.z = 0.027;
    const back = new THREE.Mesh(PICTURE, pic);
    back.position.z = -0.027;
    back.rotation.y = Math.PI;
    g.add(face, back);
    return g;
  }

  /** A stylised painting (a hill, a sun, a sky) for an NFT whose picture cannot be had. */
  #painting(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 80;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 80);
    sky.addColorStop(0, '#7fb6e0');
    sky.addColorStop(1, '#f3ead6');
    g.fillStyle = sky;
    g.fillRect(0, 0, 64, 80);
    g.fillStyle = '#f2c14e';
    g.beginPath();
    g.arc(46, 22, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7fae4a';
    g.beginPath();
    g.ellipse(24, 80, 44, 30, 0, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.#textures.push(t);
    return t;
  }

  /** The NFT's own picture (through our picture proxy), once per picture; null when it cannot be read. */
  #picture(g: Goods): Promise<THREE.Texture | null> {
    const url = g.image;
    if (!url) return Promise.resolve(null);
    let p = this.#pictures.get(url);
    if (!p) {
      p = new THREE.TextureLoader()
        .loadAsync(`/api/image?u=${encodeURIComponent(url)}`)
        .then((t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          this.#textures.push(t);
          return t;
        })
        .catch(() => null);
      this.#pictures.set(url, p);
    }
    return p;
  }

  #label(at: THREE.Vector3, text: string, incoming: boolean): void {
    const el = document.createElement('div');
    el.className = `exchange-label ${incoming ? 'in' : 'out'}`;
    el.textContent = text;
    this.#host.labels.append(el);
    this.#labels.push({ el, at: at.clone().add(new THREE.Vector3(0, 1.8, 0)), age: 0 });
  }

  update(dt: number): void {
    for (const f of [...this.#flying]) {
      f.age += dt;
      const t = (f.age - f.delay) / f.duration;
      if (t < 0) continue;
      f.obj.visible = true;
      if (t >= 1) {
        f.obj.removeFromParent();
        this.#flying.splice(this.#flying.indexOf(f), 1);
        f.done();
        continue;
      }
      // eased along, a parabola up and over
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      f.obj.position.lerpVectors(f.from, f.to, e);
      f.obj.position.y += 1.0 + Math.sin(Math.PI * t) * f.apex;
      if (f.frame) {
        f.obj.rotation.y = t * Math.PI * 2;
        f.obj.scale.setScalar(FRAME_SCALE * (0.8 + Math.sin(Math.PI * t) * 0.5));
      } else {
        f.obj.rotation.y += f.spin * dt;
        f.obj.scale.setScalar(COIN_SCALE * (t > 0.85 ? 1 - (t - 0.85) * 4 : 1));
      }
    }
    for (const l of [...this.#labels]) {
      l.age += dt;
      this.#scratch.copy(l.at);
      this.#scratch.y += l.age * 1.2;
      const p = this.#host.screen(this.#scratch);
      if (!p || l.age > 1.8) {
        l.el.remove();
        this.#labels.splice(this.#labels.indexOf(l), 1);
        continue;
      }
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      l.el.style.opacity = String(l.age < 1.2 ? 1 : 1 - (l.age - 1.2) / 0.6);
    }
  }

  dispose(): void {
    for (const f of this.#flying) f.obj.removeFromParent();
    this.#flying.length = 0;
    for (const l of this.#labels) l.el.remove();
    this.#labels.length = 0;
    for (const m of this.#mine) m.dispose();
    for (const t of this.#textures) t.dispose();
  }
}
