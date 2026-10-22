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
import { iconColor, isStable, tokenStyle, type TokenLook, type TokenStyle } from './tokens.js';
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
  /** The turn (about y) that faces a model's front (+Z) to the camera. */
  facing?(): number;
  /** A theme model's clips (the banknote's flutter). */
  clips?(name: string): readonly THREE.AnimationClip[];
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
  /** An NFT frame: its picture turned to the camera on the way, with a wobble. */
  frame?: boolean;
  /** Bigger than usual (a coin seen from far off). */
  size?: number;
  /** What token piece it is (a coin when not said): how it moves and how big it flies. */
  look?: TokenLook;
  /** Its own clip playing (a banknote's flutter). */
  mixer?: THREE.AnimationMixer;
}

/** Coins and frames fly bigger than life (as in collecting games): readable from the game's camera. */
const COIN_SCALE = 2.4;
/** An NFT's picture is drawn down to this many pixels across at most. */
const PICTURE_PX = 512;
const FRAME_SCALE = 2.2;
/** How much an NFT's picture lights itself (0: only by the scene's light). */
const PICTURE_GLOW = 0.55;
/** Each token piece's size against the coin's (docs/batches/27-tokens.md: the diamond 0.24 m tall, the note 0.30 m, the ingot 0.20 m, the coin 0.145 m). */
/** How far the ETH diamond tips back to face the camera's look from above (rad). */
const ETH_TIP = 0.55;
const LOOK_SCALE: Record<TokenLook, number> = { coin: 1, eth: 1.5, note: 0.75, ingot: 0.85 };
/** A token's icon is drawn down to this many pixels for a coin's face. */
const ICON_PX = 128;
/** A gold ingot's gold, and a coin's rim when the token's colour is not known. */
const INGOT_GOLD = 0xe8b440;
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
  if (isStable(s)) return '$';
  return s.slice(0, 4);
}

const LOCK_GOLD = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.35 });
const LOCK_IRON = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.6, roughness: 0.45 });

/** A padlock hung on a frame's lower edge (the frame's origin is its handle's grip at the top). */
function padlock(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'padlock';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.06), LOCK_GOLD);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12, Math.PI), LOCK_IRON);
  shackle.position.y = 0.065;
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.065, 8).rotateX(Math.PI / 2), LOCK_IRON);
  g.add(body, shackle, hole);
  g.position.set(0, -0.6, 0.06);
  return g;
}

/** How many coins a value shows as: more for more, never a slow trickle. */
export function coinCount(usd: number | null): number {
  const v = Math.abs(usd ?? 0);
  return Math.max(3, Math.min(14, Math.round(Math.log10(v + 1) * 3)));
}

/** A short label for goods: "+0.52 ETH", "−1,200 USDC", "+1 Elders #29", "🔒 Elders #29". Pure. */
export function goodsLabel(g: Goods, incoming: boolean): string {
  // a loan's collateral: held (coming home) or released (going back)
  if (g.collateral) return `${incoming ? '🔒 Collateral' : '🔓 Back'}: ${g.name ?? g.symbol}`;
  const sign = incoming ? '+' : '−';
  // value only (a toll, goods with no token named)
  if (!g.symbol) return `${sign}$${Math.abs(g.usd ?? 0) < 1 ? Math.abs(g.usd ?? 0).toFixed(2) : Math.round(Math.abs(g.usd ?? 0)).toLocaleString('en-US')}${g.name ? ` ${g.name}` : ''}`;
  if (g.isNft) return `${sign}${g.quantity > 1 ? `${g.quantity} ` : ''}${g.name ?? g.symbol}`;
  const q = g.quantity;
  const shown = q >= 1000 ? Math.round(q).toLocaleString('en-US') : q >= 1 ? q.toLocaleString('en-US', { maximumFractionDigits: 2 }) : q.toPrecision(2);
  return `${sign}${shown} ${g.symbol}`;
}

/** What burned goods' label says: 🔥 and what went into the fire. */
export function burnedLabel(g: Goods): string {
  return `🔥 ${goodsLabel(g, false).replace(/^−/, '')}`;
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

  /** Coins and frames in flight. */
  get flying(): number {
    return this.#flying.length;
  }

  /**
   * Goods from one place to another: coins for tokens (by value), frames for
   * NFTs. `incoming`: the guild receives (brighter, rising sound; a green label).
   * Returns how long until the last lands (s). `size`: coins this many times
   * their usual size (to be seen from a camera far off).
   */
  send(from: THREE.Vector3, to: THREE.Vector3, goods: readonly Goods[], incoming: boolean, delay = 0, size = 1, quiet = false): number {
    let end = 0;
    let at = delay;
    for (const g of goods.slice(0, 3)) {
      const took = g.isNft ? this.#frame(from, to, g, at, incoming, quiet) : this.#coins(from, to, g, at, incoming, size, quiet);
      end = Math.max(end, took);
      at += 0.25;
    }
    return end;
  }

  /** (`quiet`: no label, sound or sparkle where they land: goods thrown into the furnace's fire.) */
  #coins(from: THREE.Vector3, to: THREE.Vector3, g: Goods, delay: number, incoming: boolean, size: number, quiet: boolean): number {
    const n = coinCount(g.usd);
    const silver = isStable(g.symbol);
    const style = tokenStyle(g.symbol);
    let last = 0;
    for (let i = 0; i < n; i++) {
      // its own piece (the ETH diamond, a banknote, an ingot), else the coin, else a plain disc
      let look: TokenLook = style.look;
      let model = this.#host.model(style.model);
      if (!model && look !== 'coin') {
        look = 'coin';
        model = this.#host.model('fx.coin');
      }
      if (model) this.#dressToken(model, g, style, look);
      const obj = model ?? new THREE.Mesh(COIN, silver ? SILVER : GOLD);
      const flutter = look === 'note' ? this.#host.clips?.(style.model).find((c) => c.name === 'flutter') : undefined;
      let mixer: THREE.AnimationMixer | undefined;
      if (flutter) {
        mixer = new THREE.AnimationMixer(obj);
        mixer.clipAction(flutter).play();
        mixer.setTime(Math.random() * flutter.duration);
      }
      obj.scale.setScalar(COIN_SCALE * LOOK_SCALE[look] * size);
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
        size,
        look,
        ...(mixer ? { mixer } : {}),
        done: () => {
          if (quiet) return;
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

  #frame(from: THREE.Vector3, to: THREE.Vector3, g: Goods, delay: number, incoming: boolean, quiet: boolean): number {
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
        if (quiet) return;
        this.#host.onNft(true);
        this.#label(to, goodsLabel(g, incoming), incoming);
        this.#host.burst?.(to);
      },
    });
    if (!quiet) setTimeout(() => this.#host.onNft(false), delay * 1000);
    return delay + duration;
  }

  /** A framed picture of an NFT (its own image when it can be had, else a stylised painting), for carrying or sending. */
  frame(g: Goods): THREE.Object3D {
    const model = this.#host.model('fx.nft.frame');
    // its moulding (`Trim`) gilt
    model?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => (m.name === 'Trim' ? this.#coinMaterial('frame|gilt', m, (mine) => mine.color.set(0xd9a93a)) : m);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    const obj = model ?? this.#standinFrame();
    // a loan's collateral: a padlock on the frame (held while the loan runs)
    if (g.collateral) obj.add(padlock());
    void this.#picture(g).then((tex) => {
      if (!tex) return;
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m.name === 'Picture') {
          const mine = m.clone();
          mine.map = this.#gltfWay(tex);
          mine.color.set(0xffffff);
          // lit like a gallery painting: dark art (and any art at night) still reads in the courier's hands
          mine.emissiveMap = mine.map;
          mine.emissive.set(0xffffff);
          mine.emissiveIntensity = PICTURE_GLOW;
          this.#mine.push(mine);
          mesh.material = mine;
        }
      });
    });
    return obj;
  }

  /** A picture as a glTF model's UVs want it (not flipped: they run top-down), once per picture. */
  #gltfWay(tex: THREE.Texture): THREE.Texture {
    if (!tex.flipY) return tex;
    let mine = this.#unflipped.get(tex);
    if (!mine) {
      mine = tex.clone();
      mine.flipY = false;
      mine.needsUpdate = true;
      this.#textures.push(mine);
      this.#unflipped.set(tex, mine);
    }
    return mine;
  }

  readonly #unflipped = new Map<THREE.Texture, THREE.Texture>();

  /**
   * A token piece in the token's look: its `Logo` faces (a coin's, a note's
   * seal, an ingot's stamp) show its icon (its mark, Ξ $ ₿ or its symbol,
   * until the icon has loaded, or when it has none); its colour goes on the
   * diamond's and the note's `Tint` and on a coin's `Trim` rim (an ingot's is
   * gold). A colour not known is measured from the icon. One material per
   * token and part, shared, so a late icon or colour reaches every piece.
   */
  #dressToken(piece: THREE.Object3D, g: Goods, style: TokenStyle, look: TokenLook): void {
    const sym = g.symbol.toUpperCase();
    const silver = isStable(sym);
    const color = (): THREE.ColorRepresentation => style.color ?? this.#measured.get(sym) ?? (look === 'note' ? 0x7e9a7c : silver ? 0xdfe6ee : INGOT_GOLD);
    piece.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        if (m.name === 'Logo') {
          return this.#coinMaterial(`face|${look}|${sym}|${g.icon ?? ''}`, m, (mine) => {
            mine.map = this.#coinFace(g.symbol, silver);
            if (g.icon) this.#iconOnto(mine, g.icon, sym);
          });
        }
        if (m.name === 'Tint' && look === 'eth') {
          // crisp facets (flat, each its own shade) and a little glow of its own colour, so it reads as the logo, not a blob
          return this.#coinMaterial(`tint|eth|${sym}`, m, (mine) => {
            this.#colorOf(mine, sym, color);
            mine.flatShading = true;
            mine.roughness = 0.35;
            mine.metalness = 0.1;
            mine.emissive.set(color());
            mine.emissiveIntensity = 0.28;
          });
        }
        if (m.name === 'Tint' && look === 'note') return this.#coinMaterial(`tint|note|${sym}`, m, (mine) => this.#colorOf(mine, sym, color));
        if (m.name === 'Trim') {
          if (look === 'ingot') return this.#coinMaterial('rim|ingot', m, (mine) => mine.color.set(INGOT_GOLD));
          // a note's edge bands: the paper's cream edge, not its colour
          if (look === 'note') return this.#coinMaterial('rim|note', m, (mine) => mine.color.set(0xf2ead6));
          return this.#coinMaterial(`rim|${look}|${sym}`, m, (mine) => this.#colorOf(mine, sym, color));
        }
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /** A token's colours measured from its icon, by symbol; and the materials waiting for one. */
  readonly #measured = new Map<string, string>();
  readonly #awaitingColor = new Map<string, THREE.MeshStandardMaterial[]>();

  #colorOf(m: THREE.MeshStandardMaterial, sym: string, color: () => THREE.ColorRepresentation): void {
    m.color.set(color());
    if (!this.#measured.has(sym)) this.#awaitingColor.set(sym, [...(this.#awaitingColor.get(sym) ?? []), m]);
  }

  /** The token's icon (through our picture proxy) onto a face, once loaded; its colour measured from it on the way. */
  #iconOnto(m: THREE.MeshStandardMaterial, url: string, sym: string): void {
    let p = this.#icons.get(url);
    if (!p) {
      p = new THREE.ImageLoader()
        .loadAsync(`/api/image?u=${encodeURIComponent(url)}`)
        .then((img) => {
          const c = document.createElement('canvas');
          c.width = c.height = ICON_PX;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          // on the coin's own gold: an icon's see-through corners show the metal, not black
          ctx.fillStyle = '#f2e3b8';
          ctx.fillRect(0, 0, ICON_PX, ICON_PX);
          ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false; // on the models' glTF UVs
          this.#textures.push(t);
          const probe = document.createElement('canvas');
          probe.width = probe.height = 32;
          const pctx = probe.getContext('2d', { willReadFrequently: true })!;
          pctx.drawImage(img, 0, 0, 32, 32);
          return { texture: t as THREE.Texture, color: iconColor(pctx.getImageData(0, 0, 32, 32).data) };
        })
        .catch(() => null);
      this.#icons.set(url, p);
    }
    void p.then((got) => {
      if (!got) return;
      m.map = got.texture;
      m.needsUpdate = true;
      if (got.color && !this.#measured.has(sym)) {
        this.#measured.set(sym, got.color);
        for (const waiting of this.#awaitingColor.get(sym) ?? []) waiting.color.set(tokenStyle(sym).color ?? got.color);
        this.#awaitingColor.delete(sym);
      }
    });
  }

  readonly #icons = new Map<string, Promise<{ texture: THREE.Texture; color: string | null } | null>>();

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
    t.flipY = false; // on the coin model's glTF UVs
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

  /** The NFT's own picture: its preview, else its full-size picture; null when neither can be read. */
  async #picture(g: Goods): Promise<THREE.Texture | null> {
    return (g.image ? await this.#pictureAt(g.image) : null) ?? (g.imageFull ? await this.#pictureAt(g.imageFull) : null);
  }

  /** A picture (through our picture proxy), once per address; null when it cannot be read. */
  #pictureAt(url: string): Promise<THREE.Texture | null> {
    let p = this.#pictures.get(url);
    if (!p) {
      // a picture kept in the metadata itself (data:) loads as it is; the rest through our proxy. Drawn down to
      // PICTURE_PX on a canvas: NFT art can be thousands of pixels, far too much texture for a frame on a phone
      p = new THREE.ImageLoader()
        .loadAsync(url.startsWith('data:') ? url : `/api/image?u=${encodeURIComponent(url)}`)
        .then((img) => {
          const scale = Math.min(1, PICTURE_PX / Math.max(img.width || PICTURE_PX, img.height || PICTURE_PX));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round((img.width || PICTURE_PX) * scale));
          c.height = Math.max(1, Math.round((img.height || PICTURE_PX) * scale));
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          this.#textures.push(t);
          return t as THREE.Texture;
        })
        .catch(() => null);
      this.#pictures.set(url, p);
    }
    return p;
  }

  /** A floating label of one's own (goods burned). */
  say(at: THREE.Vector3, text: string): void {
    this.#label(at, text, false);
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
        // the picture to the camera (its back is a plain board), swaying as it flies
        f.obj.rotation.y = (this.#host.facing?.() ?? 0) + Math.sin(Math.PI * 2 * t) * 0.35;
        f.obj.scale.setScalar(FRAME_SCALE * (0.8 + Math.sin(Math.PI * t) * 0.5));
      } else {
        const look = f.look ?? 'coin';
        if (look === 'note') {
          // a banknote sways and flutters down its arc rather than spinning
          f.mixer?.update(dt);
          f.obj.rotation.y += f.spin * 0.2 * dt;
          f.obj.rotation.z = Math.sin(f.age * 7 + f.spin) * 0.35;
        } else if (look === 'ingot') {
          // an ingot tumbles end over end
          f.obj.rotation.x += f.spin * 0.45 * dt;
          f.obj.rotation.y += f.spin * 0.25 * dt;
        } else if (look === 'eth') {
          // the logo to the camera, as a frame's picture: its face turned to the camera and tipped back to meet its
          // look from above (the V and the gap only read from the front), swaying a little as it flies
          f.obj.rotation.order = 'YXZ';
          f.obj.rotation.y = (this.#host.facing?.() ?? 0) + Math.sin(f.age * 3 + f.spin) * 0.45;
          f.obj.rotation.x = -ETH_TIP;
        } else f.obj.rotation.y += f.spin * dt;
        f.obj.scale.setScalar(COIN_SCALE * LOOK_SCALE[look] * (f.size ?? 1) * (t > 0.85 ? 1 - (t - 0.85) * 4 : 1));
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
