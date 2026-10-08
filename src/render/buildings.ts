/**
 * Buildings in both projections, from one style table.
 *
 * Slots: building.<kind>, home.t<tier>, plus tower / guildhall / gate. Each
 * style is an archetype; the protocol supplies the roof colour (brand) and the
 * logo on the sign, so thousands of protocols need no hand-drawn art.
 */

import type { Tier } from '../domain/tiers.js';
import type { PlacedKind } from '../world/layout.js';
import { P, hsl2hex, poly, px, shade, sprite, type Ctx, type Sprite } from './pixel.js';

export type Emblem = 'coin' | 'scroll' | 'key' | 'flask' | 'swords' | 'ship' | 'gem' | 'question' | 'bell' | 'anvil' | 'frame' | 'star' | 'scale' | 'crate' | 'flag';

export type RoofKind = 'gable' | 'flat' | 'dome' | 'spire' | 'tent' | 'crenel' | 'awning' | 'pyramid';

export interface Style {
  wall: string;
  roofKind: RoofKind;
  /** null = use the protocol's brand colour */
  roof: string | null;
  wallH: number;
  roofH: number;
  emblem: Emblem;
  trim: string;
  extra?: 'columns' | 'chimneyFire' | 'smoke' | 'banners' | 'frames' | 'pier' | 'crates' | 'stalls' | 'bell' | 'glow' | 'fog';
}

const STYLES: Record<string, Style> = {
  bazaar: { wall: P.plaster, roofKind: 'awning', roof: null, wallH: 14, roofH: 8, emblem: 'scale', trim: P.woodDark, extra: 'stalls' },
  broker: { wall: '#e8d8b8', roofKind: 'gable', roof: null, wallH: 16, roofH: 12, emblem: 'scroll', trim: P.woodDark },
  bank: { wall: P.stoneLight, roofKind: 'pyramid', roof: null, wallH: 20, roofH: 10, emblem: 'coin', trim: P.stoneDark, extra: 'columns' },
  temple: { wall: P.white, roofKind: 'dome', roof: null, wallH: 18, roofH: 16, emblem: 'star', trim: P.gold, extra: 'glow' },
  barracks: { wall: P.stone, roofKind: 'crenel', roof: null, wallH: 20, roofH: 6, emblem: 'swords', trim: P.stoneDark, extra: 'banners' },
  alchemist: { wall: '#7c6a9a', roofKind: 'spire', roof: null, wallH: 26, roofH: 18, emblem: 'flask', trim: '#4a3a6a', extra: 'smoke' },
  auction: { wall: '#f0e0c8', roofKind: 'gable', roof: null, wallH: 18, roofH: 12, emblem: 'frame', trim: P.goldDark, extra: 'frames' },
  harbour: { wall: P.woodLight, roofKind: 'gable', roof: null, wallH: 14, roofH: 10, emblem: 'ship', trim: P.woodDark, extra: 'pier' },
  council: { wall: P.stoneLight, roofKind: 'gable', roof: null, wallH: 20, roofH: 12, emblem: 'flag', trim: P.stoneDark, extra: 'columns' },
  names: { wall: '#e8dcc0', roofKind: 'gable', roof: null, wallH: 15, roofH: 11, emblem: 'scroll', trim: P.woodDark },
  packing: { wall: P.woodLight, roofKind: 'gable', roof: null, wallH: 15, roofH: 9, emblem: 'crate', trim: P.woodDark, extra: 'crates' },
  forge: { wall: P.stoneDark, roofKind: 'gable', roof: null, wallH: 14, roofH: 10, emblem: 'anvil', trim: '#3a3430', extra: 'chimneyFire' },
  herald: { wall: P.red, roofKind: 'tent', roof: null, wallH: 10, roofH: 14, emblem: 'gem', trim: P.gold, extra: 'banners' },
  tent: { wall: '#5a4a6a', roofKind: 'tent', roof: '#6a4a8a', wallH: 8, roofH: 16, emblem: 'question', trim: '#3a2a4a', extra: 'fog' },
  tower: { wall: P.stone, roofKind: 'spire', roof: '#4a5a7a', wallH: 44, roofH: 18, emblem: 'bell', trim: P.stoneDark, extra: 'bell' },
  guildhall: { wall: P.plaster, roofKind: 'gable', roof: '#8a3a2a', wallH: 22, roofH: 16, emblem: 'flag', trim: P.woodDark, extra: 'banners' },
};

/** Homes grow with the hero's value tier: bedroll → castle. */
const HOME_STYLES: Style[] = [
  { wall: P.woodLight, roofKind: 'flat', roof: '#8a6a4a', wallH: 0, roofH: 0, emblem: 'star', trim: P.woodDark },
  { wall: '#c8b088', roofKind: 'tent', roof: '#c8b088', wallH: 4, roofH: 12, emblem: 'star', trim: P.woodDark },
  { wall: P.plaster, roofKind: 'gable', roof: P.thatch, wallH: 11, roofH: 9, emblem: 'star', trim: P.woodDark },
  { wall: P.plaster, roofKind: 'gable', roof: '#a0522d', wallH: 14, roofH: 11, emblem: 'star', trim: P.woodDark },
  { wall: '#f0e6d0', roofKind: 'gable', roof: P.slate, wallH: 20, roofH: 13, emblem: 'star', trim: P.woodDark, extra: 'banners' },
  { wall: P.stone, roofKind: 'crenel', roof: P.stoneDark, wallH: 28, roofH: 6, emblem: 'star', trim: P.stoneDark, extra: 'banners' },
  { wall: P.stoneLight, roofKind: 'crenel', roof: P.stone, wallH: 30, roofH: 6, emblem: 'star', trim: P.stoneDark, extra: 'banners' },
];

const KNOWN_BRANDS: [RegExp, string][] = [
  [/uniswap/, '#ff3d8b'],
  [/aave/, '#9a5bd0'],
  [/lido/, '#3aa0ff'],
  [/compound/, '#00b88a'],
  [/curve/, '#d04a3a'],
  [/opensea/, '#2081e2'],
  [/ens/, '#5298ff'],
  [/1inch/, '#2a4a8a'],
  [/cow/, '#1a3a6a'],
  [/eigen/, '#2a2a6a'],
  [/maker|sky/, '#1aab9b'],
  [/rocket/, '#e85a2a'],
  [/pendle/, '#3ab0c0'],
  [/morpho/, '#2a6ae0'],
  [/balancer/, '#4a4a4a'],
  [/blur/, '#ff8a00'],
];

export function brandColor(protocolId: string): string {
  for (const [re, c] of KNOWN_BRANDS) if (re.test(protocolId)) return c;
  let h = 0;
  for (let i = 0; i < protocolId.length; i++) h = (h * 31 + protocolId.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hsl2hex(hue, 45, 48);
}

export function styleFor(kind: PlacedKind, homeTier: Tier = 0): Style {
  if (kind === 'home') return HOME_STYLES[homeTier] ?? HOME_STYLES[2] as Style;
  return STYLES[kind] ?? (STYLES.tent as Style);
}

// --- emblems -----------------------------------------------------------------

export function drawEmblem(c: Ctx, e: Emblem, x: number, y: number): void {
  // 7×7 glyphs centred in a 9×9 plate at (x, y)
  const g = (gx: number, gy: number, w: number, h: number, col: string): void => px(c, x + 1 + gx, y + 1 + gy, w, h, col);
  switch (e) {
    case 'coin':
      g(1, 0, 5, 7, P.goldDark);
      g(0, 1, 7, 5, P.goldDark);
      g(1, 1, 5, 5, P.gold);
      g(3, 2, 1, 3, P.goldDark);
      break;
    case 'scroll':
      g(1, 0, 5, 7, '#f0e0b0');
      g(0, 0, 7, 1, '#c8a870');
      g(0, 6, 7, 1, '#c8a870');
      g(2, 2, 3, 1, '#8a6a4a');
      g(2, 4, 3, 1, '#8a6a4a');
      break;
    case 'key':
      g(0, 1, 3, 3, P.gold);
      g(3, 2, 4, 1, P.gold);
      g(5, 3, 1, 2, P.gold);
      break;
    case 'flask':
      g(3, 0, 1, 3, '#d0d8e0');
      g(1, 3, 5, 4, '#5fe08a');
      g(2, 2, 3, 1, '#d0d8e0');
      break;
    case 'swords':
      for (let i = 0; i < 7; i++) {
        g(i, i, 1, 1, P.silver);
        g(6 - i, i, 1, 1, P.silver);
      }
      break;
    case 'ship':
      g(0, 4, 7, 2, P.woodDark);
      g(3, 0, 1, 4, P.woodDark);
      g(4, 0, 2, 3, P.white);
      break;
    case 'gem':
      g(2, 0, 3, 1, '#7ad0ff');
      g(1, 1, 5, 2, '#4ab0f0');
      g(2, 3, 3, 2, '#2a80d0');
      g(3, 5, 1, 1, '#2a80d0');
      break;
    case 'question':
      g(2, 0, 3, 1, '#e0d0ff');
      g(5, 1, 1, 2, '#e0d0ff');
      g(3, 3, 2, 1, '#e0d0ff');
      g(3, 4, 1, 1, '#e0d0ff');
      g(3, 6, 1, 1, '#e0d0ff');
      break;
    case 'bell':
      g(2, 0, 3, 1, P.goldDark);
      g(1, 1, 5, 4, P.gold);
      g(0, 5, 7, 1, P.goldDark);
      g(3, 6, 1, 1, P.goldDark);
      break;
    case 'anvil':
      g(0, 1, 7, 2, '#4a4a52');
      g(2, 3, 3, 2, '#3a3a42');
      g(1, 5, 5, 2, '#4a4a52');
      break;
    case 'frame':
      g(0, 0, 7, 7, P.goldDark);
      g(1, 1, 5, 5, '#7ab0e0');
      g(1, 4, 5, 2, '#5fbf4a');
      break;
    case 'star':
      g(3, 0, 1, 7, P.gold);
      g(0, 3, 7, 1, P.gold);
      g(2, 2, 3, 3, P.gold);
      break;
    case 'scale':
      g(3, 0, 1, 6, P.goldDark);
      g(0, 1, 7, 1, P.goldDark);
      g(0, 2, 2, 2, P.gold);
      g(5, 2, 2, 2, P.gold);
      g(2, 6, 3, 1, P.goldDark);
      break;
    case 'crate':
      g(0, 1, 7, 6, P.woodLight);
      g(0, 1, 7, 1, P.woodDark);
      g(3, 1, 1, 6, P.woodDark);
      break;
    case 'flag':
      g(0, 0, 1, 7, P.woodDark);
      g(1, 0, 5, 4, P.red);
      g(2, 1, 2, 1, P.gold);
      break;
  }
}

export function plate(c: Ctx, x: number, y: number, w: number, h: number): void {
  px(c, x - 1, y - 1, w + 2, h + 2, P.woodDark);
  px(c, x, y, w, h, '#f6eed8');
}

// --- top-down (3/4 front view, Stardew-like) -------------------------------

const T = 16; // art px per tile

export function topBuilding(kind: PlacedKind, w: number, h: number, roofColor: string, homeTier: Tier = 0, variant = ''): Sprite {
  const st = styleFor(kind, homeTier);
  const roof = st.roof ?? roofColor;
  const W = w * T;
  const footH = h * T;
  const up = Math.max(0, st.wallH + st.roofH + 6 - footH + 10);
  const H = footH + up;
  const base = H - 3;
  const key = `top:${kind}:${w}x${h}:${roof}:${homeTier}:${variant}`;
  return sprite(key, W, H, 0, H, (c) => {
    let sign: Sprite['sign'] | undefined;
    // shadow
    c.fillStyle = P.shadow;
    c.fillRect(3, base - 2, W - 3, 5);

    if (kind === 'gate') {
      for (const x of [2, W - 10]) {
        px(c, x, base - 30, 8, 30, P.stone);
        px(c, x, base - 30, 8, 2, P.stoneLight);
        px(c, x + 1, base - 33, 6, 3, P.stoneDark);
      }
      px(c, 2, base - 34, W - 4, 6, P.stoneDark);
      px(c, 4, base - 33, W - 8, 4, P.stone);
      // signpost to followed towns
      px(c, W / 2 - 1, base - 26, 2, 12, P.woodDark);
      px(c, W / 2 - 8, base - 26, 12, 4, P.woodLight);
      return;
    }
    if (kind === 'home' && homeTier === 0) {
      // bedroll and campfire
      px(c, 8, base - 8, 18, 6, '#8a3a2a');
      px(c, 8, base - 8, 5, 6, '#e0d0b0');
      px(c, 32, base - 6, 6, 3, P.woodDark);
      px(c, 33, base - 10, 4, 4, '#ff9a2a');
      px(c, 34, base - 12, 2, 2, '#ffd36a');
      return;
    }

    const wx = 3;
    const ww = W - 6;
    const wallTop = base - st.wallH;

    if (st.extra === 'pier') {
      px(c, W - 10, base - 6, 12, 4, P.woodDark);
      px(c, W - 8, base - 12, 1, 6, P.woodDark);
    }

    // walls
    if (st.roofKind !== 'tent' || st.wallH > 6) {
      px(c, wx, wallTop, ww, st.wallH, st.wall);
      px(c, wx, wallTop, ww, 1, shade(st.wall, 0.15));
      px(c, wx, base - 2, ww, 2, shade(st.wall, -0.25));
      px(c, wx, wallTop, 1, st.wallH, shade(st.wall, -0.15));
      px(c, wx + ww - 1, wallTop, 1, st.wallH, shade(st.wall, -0.25));
    }
    if (st.extra === 'columns') {
      for (let x = wx + 3; x < wx + ww - 2; x += 6) {
        px(c, x, wallTop + 2, 2, st.wallH - 3, P.white);
        px(c, x + 2, wallTop + 2, 1, st.wallH - 3, P.stoneDark);
      }
    }
    // timber framing for plastered buildings
    if (st.wall === P.plaster || st.wall === '#f0e6d0' || st.wall === '#e8dcc0') {
      px(c, wx, wallTop + Math.floor(st.wallH / 2), ww, 1, st.trim);
      for (let x = wx + 6; x < wx + ww - 2; x += 10) px(c, x, wallTop, 1, st.wallH, st.trim);
    }
    if (st.wall === P.stone || st.wall === P.stoneLight || st.wall === P.stoneDark) {
      for (let y = wallTop + 3; y < base - 2; y += 4)
        for (let x = wx + ((y / 4) % 2 === 0 ? 2 : 5); x < wx + ww - 2; x += 7) px(c, x, y, 4, 1, shade(st.wall, -0.12));
    }

    // windows
    if (st.wallH >= 11) {
      const wy = wallTop + 3;
      const winH = Math.min(6, st.wallH - 9);
      for (const x of [wx + 4, wx + ww - 10]) {
        px(c, x - 1, wy - 1, 8, winH + 2, st.trim);
        px(c, x, wy, 6, winH, P.glass);
        px(c, x, wy, 3, 2, shade(P.glass, 0.4));
      }
      if (st.wallH >= 26) {
        for (let y = wy + 10; y < base - 14; y += 10) px(c, W / 2 - 2, y, 4, 5, P.glass);
      }
    }

    // door
    if (st.wallH >= 8) {
      const dw = kind === 'tower' || kind === 'guildhall' || kind === 'bank' ? 10 : 7;
      const dh = Math.min(11, st.wallH - 2);
      px(c, W / 2 - dw / 2 - 1, base - dh - 1, dw + 2, dh + 1, st.trim);
      px(c, W / 2 - dw / 2, base - dh, dw, dh, P.woodDark);
      px(c, W / 2 - dw / 2 + 1, base - dh + 1, dw - 2, 1, P.wood);
      px(c, W / 2 + dw / 2 - 2, base - dh / 2, 1, 1, P.gold);
    }

    // roof
    const rTop = wallTop - st.roofH;
    switch (st.roofKind) {
      case 'gable':
      case 'pyramid': {
        const inset = st.roofKind === 'pyramid' ? 10 : 5;
        poly(c, [[0, wallTop + 2], [W, wallTop + 2], [W - inset, rTop], [inset, rTop]], roof);
        for (let y = rTop + 3; y < wallTop + 2; y += 3) px(c, 2, y, W - 4, 1, shade(roof, -0.15));
        px(c, 0, wallTop + 1, W, 2, shade(roof, -0.35));
        px(c, inset, rTop, W - inset * 2, 1, shade(roof, 0.25));
        break;
      }
      case 'flat':
        px(c, wx - 1, wallTop - 3, ww + 2, 4, roof);
        break;
      case 'crenel':
        px(c, wx - 1, wallTop - 3, ww + 2, 4, shade(st.wall, -0.1));
        for (let x = wx - 1; x < wx + ww; x += 5) px(c, x, wallTop - 6, 3, 3, shade(st.wall, -0.05));
        if (kind === 'home' && homeTier === 6) {
          for (const x of [0, W - 9]) {
            px(c, x, wallTop - 14, 9, st.wallH + 14, P.stone);
            poly(c, [[x - 1, wallTop - 14], [x + 10, wallTop - 14], [x + 4.5, wallTop - 26]], roof === P.stone ? '#4a5a8a' : roof);
          }
        }
        break;
      case 'dome': {
        c.fillStyle = roof;
        c.beginPath();
        c.ellipse(W / 2, wallTop, ww / 2 - 2, st.roofH, 0, Math.PI, 0);
        c.fill();
        px(c, W / 2 - 1, rTop - 6, 2, 6, P.gold);
        px(c, W / 2 - 3, rTop - 4, 6, 1, P.gold);
        break;
      }
      case 'spire': {
        const sw = kind === 'tower' ? ww : ww - 6;
        poly(c, [[W / 2 - sw / 2 - 2, wallTop + 1], [W / 2 + sw / 2 + 2, wallTop + 1], [W / 2, rTop]], roof);
        poly(c, [[W / 2, wallTop + 1], [W / 2 + sw / 2 + 2, wallTop + 1], [W / 2, rTop]], shade(roof, -0.2));
        break;
      }
      case 'tent': {
        const tw = st.wallH > 6 ? ww + 4 : ww;
        poly(c, [[W / 2 - tw / 2, base], [W / 2 + tw / 2, base], [W / 2, rTop - (st.wallH > 6 ? 0 : st.wallH)]], roof);
        for (let i = 0; i < 4; i++) {
          const x0 = W / 2 - tw / 2 + (i * tw) / 4;
          poly(c, [[x0, base], [x0 + tw / 8, base], [W / 2, rTop]], shade(roof, i % 2 === 0 ? 0.2 : -0.1));
        }
        px(c, W / 2 - 3, base - 7, 6, 7, '#2a1a2a');
        px(c, W / 2 - 1, rTop - 5, 1, 5, P.woodDark);
        px(c, W / 2, rTop - 5, 4, 3, st.trim);
        break;
      }
      case 'awning': {
        for (let x = 0; x < W; x += 6) {
          poly(c, [[x, wallTop + 4], [x + 6, wallTop + 4], [x + 6, rTop], [x, rTop]], (x / 6) % 2 === 0 ? roof : P.white);
        }
        for (let x = 0; x < W; x += 6) {
          c.fillStyle = (x / 6) % 2 === 0 ? roof : P.white;
          c.beginPath();
          c.arc(x + 3, wallTop + 4, 3, 0, Math.PI);
          c.fill();
        }
        break;
      }
    }

    // extras
    switch (st.extra) {
      case 'stalls':
        px(c, 4, base - 6, 10, 4, P.woodLight);
        px(c, 5, base - 8, 3, 2, '#e05050');
        px(c, 9, base - 8, 3, 2, '#f0c040');
        px(c, W - 14, base - 6, 10, 4, P.woodLight);
        px(c, W - 13, base - 8, 3, 2, '#60b050');
        px(c, W - 9, base - 8, 3, 2, '#e08a30');
        break;
      case 'chimneyFire':
        px(c, W - 12, rTop - 6, 6, 12, P.stoneDark);
        px(c, W - 11, rTop - 9, 4, 3, '#ff8a2a');
        px(c, W - 10, rTop - 11, 2, 2, '#ffd36a');
        break;
      case 'smoke':
        px(c, W / 2 + 6, rTop + 4, 3, 2, '#9af0b0');
        px(c, W / 2 + 8, rTop, 3, 3, 'rgba(154,240,176,0.7)');
        break;
      case 'banners':
        for (const x of [wx + 1, wx + ww - 5]) {
          px(c, x + 1, wallTop - 10, 1, 12, P.woodDark);
          px(c, x + 2, wallTop - 10, 4, 7, variant !== '' ? variant : P.red);
          px(c, x + 2, wallTop - 4, 2, 1, variant !== '' ? variant : P.red);
        }
        break;
      case 'frames':
        px(c, wx + 3, wallTop + 3, 6, 5, P.goldDark);
        px(c, wx + 4, wallTop + 4, 4, 3, '#7ab0e0');
        break;
      case 'crates':
        px(c, 1, base - 7, 6, 6, P.woodLight);
        px(c, 1, base - 7, 6, 1, P.woodDark);
        px(c, W - 8, base - 6, 6, 5, P.woodLight);
        break;
      case 'bell':
        px(c, W / 2 - 8, rTop + st.roofH - 4, 16, 3, P.stoneDark);
        px(c, W / 2 - 3, wallTop + 2, 6, 5, P.gold);
        px(c, W / 2 - 4, wallTop + 7, 8, 1, P.goldDark);
        break;
      case 'glow':
        c.fillStyle = 'rgba(255,240,180,0.25)';
        c.beginPath();
        c.ellipse(W / 2, wallTop, ww / 2 + 3, st.roofH + 4, 0, Math.PI, 0);
        c.fill();
        break;
      case 'fog':
        c.fillStyle = 'rgba(230,220,255,0.35)';
        c.fillRect(0, base - 6, W, 6);
        break;
      default:
        break;
    }

    // sign (logo goes here at runtime; emblem as fallback)
    if (kind !== 'home' && kind !== 'tower') {
      const sw = 11;
      const sx = Math.round(W / 2 - sw / 2);
      const sy = Math.max(2, (st.roofKind === 'tent' ? rTop + 4 : wallTop - 13));
      plate(c, sx, sy, sw, sw);
      drawEmblem(c, st.emblem, sx + 1, sy + 1);
      sign = { x: sx, y: sy, w: sw, h: sw };
    }
    if (kind === 'tower') {
      // a clock face
      c.fillStyle = P.white;
      c.beginPath();
      c.arc(W / 2, wallTop + 16, 5, 0, Math.PI * 2);
      c.fill();
      px(c, W / 2, wallTop + 12, 1, 4, '#2a1a10');
      px(c, W / 2, wallTop + 16, 3, 1, '#2a1a10');
    }
    return sign !== undefined ? { sign } : {};
  });
}

// --- isometric ---------------------------------------------------------------

export const ISO_W = 16; // half tile width in art px
export const ISO_H = 8; // half tile height in art px

/** Footprint-local tile coords (+ height) → sprite pixel coords. */
function iso(tx: number, ty: number, z: number, ox: number, oy: number): [number, number] {
  return [ox + (tx - ty) * ISO_W, oy + (tx + ty) * ISO_H - z];
}

export function isoBuilding(kind: PlacedKind, w: number, h: number, roofColor: string, homeTier: Tier = 0, variant = ''): Sprite {
  const st = styleFor(kind, homeTier);
  const roof = st.roof ?? roofColor;
  const zW = Math.round(st.wallH * 1.15);
  const zR = Math.round(st.roofH * 1.2);
  const top = zW + zR + 22;
  const W = (w + h) * ISO_W;
  const H = (w + h) * ISO_H + top;
  // origin = footprint's top corner (tile x, y) in sprite px
  const ox = h * ISO_W;
  const oy = top;
  const key = `iso:${kind}:${w}x${h}:${roof}:${homeTier}:${variant}`;
  return sprite(key, W, H, ox, oy, (c) => {
    let sign: Sprite['sign'] | undefined;
    const P0 = (x: number, y: number, z = 0): [number, number] => iso(x, y, z, ox, oy);
    // shadow on the ground
    poly(c, [P0(0, 0), P0(w, 0), P0(w + 0.3, h + 0.3), P0(0, h)], 'rgba(30,20,10,0.18)');

    if (kind === 'gate') {
      for (const [gx, gy] of [[0.2, 0.6], [2.4, 0.6]] as const) {
        poly(c, [P0(gx, gy + 0.6), P0(gx + 0.6, gy + 0.6), P0(gx + 0.6, gy + 0.6, 34), P0(gx, gy + 0.6, 34)], P.stone);
        poly(c, [P0(gx + 0.6, gy), P0(gx + 0.6, gy + 0.6), P0(gx + 0.6, gy + 0.6, 34), P0(gx + 0.6, gy, 34)], P.stoneDark);
      }
      poly(c, [P0(0.2, 1.2, 34), P0(3, 1.2, 34), P0(3, 1.2, 40), P0(0.2, 1.2, 40)], P.stoneDark);
      return;
    }
    if (kind === 'home' && homeTier === 0) {
      poly(c, [P0(0.8, 1.2), P0(2, 1.2), P0(2, 1.8), P0(0.8, 1.8)], '#8a3a2a');
      const [fx, fy] = P0(2.2, 2.2);
      px(c, fx - 3, fy - 5, 6, 3, P.woodDark);
      px(c, fx - 2, fy - 9, 4, 4, '#ff9a2a');
      return;
    }

    const i0 = 0.25;
    const x1 = w - 0.25;
    const y1 = h - 0.25;
    const wallL = st.wall;
    const wallR = shade(st.wall, -0.22);

    if (st.extra === 'pier') poly(c, [P0(x1, 1), P0(w + 1.2, 1), P0(w + 1.2, 1.8), P0(x1, 1.8)], P.woodDark);

    if (st.roofKind !== 'tent' || st.wallH > 6) {
      // left face (along y = y1) and right face (along x = x1)
      poly(c, [P0(i0, y1), P0(x1, y1), P0(x1, y1, zW), P0(i0, y1, zW)], wallL);
      poly(c, [P0(x1, i0), P0(x1, y1), P0(x1, y1, zW), P0(x1, i0, zW)], wallR);
      // a base course
      poly(c, [P0(i0, y1), P0(x1, y1), P0(x1, y1, 2), P0(i0, y1, 2)], shade(wallL, -0.3));
      poly(c, [P0(x1, i0), P0(x1, y1), P0(x1, y1, 2), P0(x1, i0, 2)], shade(wallR, -0.3));
      if (st.extra === 'columns') {
        for (let u = i0 + 0.3; u < x1 - 0.1; u += 0.45) {
          const [a, b] = P0(u, y1, 2);
          px(c, a, b - zW + 4, 2, zW - 6, P.white);
        }
      }
      // windows on both faces
      if (st.wallH >= 11) {
        for (const u of [0.25, 0.75]) {
          const lx = i0 + (x1 - i0) * u;
          const ly = i0 + (y1 - i0) * u;
          const [a, b] = P0(lx, y1, zW - 6);
          px(c, a - 3, b - 1, 6, 5, st.trim);
          px(c, a - 2, b, 4, 3, P.glass);
          const [d, e] = P0(x1, ly, zW - 6);
          px(c, d - 3, e - 1, 6, 5, st.trim);
          px(c, d - 2, e, 4, 3, shade(P.glass, -0.2));
        }
      }
      // door, centred on the left face (the side that faces the street)
      if (st.wallH >= 8) {
        const [a, b] = P0((i0 + x1) / 2, y1, 0);
        const dh = Math.min(12, zW - 3);
        px(c, a - 4, b - dh - 1, 8, dh + 1, st.trim);
        px(c, a - 3, b - dh, 6, dh, P.woodDark);
      }
    }

    // roof
    const cx = w / 2;
    const cy = h / 2;
    switch (st.roofKind) {
      case 'flat':
        poly(c, [P0(i0, i0, zW), P0(x1, i0, zW), P0(x1, y1, zW), P0(i0, y1, zW)], roof);
        break;
      case 'crenel': {
        poly(c, [P0(i0, i0, zW), P0(x1, i0, zW), P0(x1, y1, zW), P0(i0, y1, zW)], shade(st.wall, 0.1));
        for (let u = i0; u < x1; u += 0.5) {
          const [a, b] = P0(u, y1, zW);
          px(c, a - 1, b - 4, 3, 4, shade(st.wall, -0.05));
          const [d, e] = P0(x1, u, zW);
          px(c, d - 1, e - 4, 3, 4, shade(st.wall, -0.25));
        }
        if (kind === 'home' && homeTier === 6) {
          const [a, b] = P0(i0 + 0.3, y1 - 0.3, zW);
          px(c, a - 5, b - 22, 10, 22, P.stone);
          poly(c, [[a - 6, b - 22], [a + 6, b - 22], [a, b - 36]], '#4a5a8a');
        }
        break;
      }
      case 'gable': {
        // ridge along x at the footprint's middle y
        const ridge = zW + zR;
        poly(c, [P0(i0 - 0.1, y1 + 0.1, zW), P0(x1 + 0.1, y1 + 0.1, zW), P0(x1 + 0.1, cy, ridge), P0(i0 - 0.1, cy, ridge)], roof);
        poly(c, [P0(x1, i0, zW), P0(x1, y1, zW), P0(x1, cy, ridge)], wallR);
        poly(c, [P0(x1 + 0.1, cy, ridge), P0(x1 + 0.1, i0 - 0.1, zW), P0(x1 + 0.1, y1 + 0.1, zW)], shade(roof, -0.25));
        for (let u = 0.2; u < 1; u += 0.25) {
          const a = P0(i0, y1 + (cy - y1) * u, zW + (ridge - zW) * u);
          const b = P0(x1, y1 + (cy - y1) * u, zW + (ridge - zW) * u);
          c.strokeStyle = shade(roof, -0.15);
          c.beginPath();
          c.moveTo(a[0], a[1]);
          c.lineTo(b[0], b[1]);
          c.stroke();
        }
        break;
      }
      case 'pyramid':
      case 'spire': {
        const apex = zW + (st.roofKind === 'spire' ? zR * 1.6 : zR);
        const ap = P0(cx, cy, apex);
        poly(c, [P0(i0 - 0.1, y1 + 0.1, zW), P0(x1 + 0.1, y1 + 0.1, zW), ap], roof);
        poly(c, [P0(x1 + 0.1, y1 + 0.1, zW), P0(x1 + 0.1, i0 - 0.1, zW), ap], shade(roof, -0.25));
        break;
      }
      case 'dome': {
        const [a, b] = P0(cx, cy, zW);
        c.fillStyle = roof;
        c.beginPath();
        c.ellipse(a, b, (w - 0.5) * ISO_W * 0.7, zR + 4, 0, Math.PI, 0);
        c.fill();
        c.fillStyle = shade(roof, -0.2);
        c.beginPath();
        c.ellipse(a, b, (w - 0.5) * ISO_W * 0.7, (w - 0.5) * ISO_H * 0.7, 0, 0, Math.PI);
        c.fill();
        px(c, a - 1, b - zR - 12, 2, 8, P.gold);
        px(c, a - 3, b - zR - 10, 6, 1, P.gold);
        break;
      }
      case 'tent': {
        const apex = (st.wallH > 6 ? zW : 0) + zR + 8;
        const ap = P0(cx, cy, apex);
        poly(c, [P0(0.2, y1), P0(x1, y1), ap], roof);
        poly(c, [P0(x1, y1), P0(x1, 0.2), ap], shade(roof, -0.25));
        const [a, b] = P0(cx, y1, 0);
        poly(c, [[a - 4, b], [a + 4, b], [a, b - 10]], '#2a1a2a');
        break;
      }
      case 'awning': {
        poly(c, [P0(i0 - 0.2, y1 + 0.4, zW - 2), P0(x1 + 0.2, y1 + 0.4, zW - 2), P0(x1 + 0.2, cy, zW + zR), P0(i0 - 0.2, cy, zW + zR)], roof);
        for (let u = 0; u < 1; u += 0.2) {
          const a = P0(i0 + (x1 - i0) * u, y1 + 0.4, zW - 2);
          const b = P0(i0 + (x1 - i0) * (u + 0.1), y1 + 0.4, zW - 2);
          const d = P0(i0 + (x1 - i0) * (u + 0.1), cy, zW + zR);
          const e = P0(i0 + (x1 - i0) * u, cy, zW + zR);
          poly(c, [a, b, d, e], P.white);
        }
        poly(c, [P0(x1 + 0.2, y1 + 0.4, zW - 2), P0(x1 + 0.2, i0, zW - 2), P0(x1 + 0.2, cy, zW + zR)], shade(roof, -0.25));
        break;
      }
    }

    switch (st.extra) {
      case 'chimneyFire': {
        const [a, b] = P0(x1 - 0.5, cy, zW + zR);
        px(c, a - 3, b - 8, 6, 12, P.stoneDark);
        px(c, a - 2, b - 12, 4, 4, '#ff8a2a');
        break;
      }
      case 'smoke': {
        const [a, b] = P0(cx, cy, zW + zR * 1.6);
        px(c, a + 3, b + 4, 3, 2, '#9af0b0');
        break;
      }
      case 'banners': {
        for (const u of [i0 + 0.1, x1 - 0.3]) {
          const [a, b] = P0(u, y1, zW);
          px(c, a, b - 12, 1, 14, P.woodDark);
          px(c, a + 1, b - 12, 4, 7, variant !== '' ? variant : P.red);
        }
        break;
      }
      case 'bell': {
        const [a, b] = P0(x1, cy, zW - 12);
        px(c, a - 7, b - 4, 6, 6, P.gold);
        break;
      }
      case 'glow': {
        const [a, b] = P0(cx, cy, zW);
        c.fillStyle = 'rgba(255,240,180,0.25)';
        c.beginPath();
        c.ellipse(a, b - 6, w * ISO_W * 0.8, zR + 12, 0, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'stalls': {
        const [a, b] = P0(0.3, y1 + 0.6, 0);
        px(c, a, b - 6, 10, 4, P.woodLight);
        px(c, a + 1, b - 8, 3, 2, '#e05050');
        px(c, a + 5, b - 8, 3, 2, '#f0c040');
        break;
      }
      case 'crates': {
        const [a, b] = P0(x1 + 0.4, y1 - 0.4, 0);
        px(c, a - 3, b - 6, 6, 6, P.woodLight);
        break;
      }
      default:
        break;
    }

    // upright sign by the door: logo at runtime, emblem as fallback
    if (kind !== 'home' && kind !== 'tower') {
      const [a, b] = P0(i0 + 0.15, y1 + 0.45, 0);
      px(c, a - 1, b - 12, 2, 12, P.woodDark);
      const sx = Math.round(a - 6);
      const sy = Math.round(b - 26);
      plate(c, sx, sy, 11, 11);
      drawEmblem(c, st.emblem, sx + 1, sy + 1);
      sign = { x: sx, y: sy, w: 11, h: 11 };
    }
    return sign !== undefined ? { sign } : {};
  });
}
