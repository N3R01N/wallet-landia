/**
 * What a token flies as when goods change hands (docs/batches/27-tokens.md),
 * so a swap reads at a glance: ETH and its wrappers as little ETH diamonds,
 * stablecoins as folded banknotes, bitcoin wrappers as gold ingots, and every
 * other token as a coin with its own icon on both faces and its rim in its
 * colour.
 *
 * The colours are each token's brand colour, read from the icons Zerion
 * serves (2026-10), with a few set by hand where an icon is mostly white or
 * black (Uniswap's pink, Bitcoin's orange). A token not listed here gets its
 * colour measured from its icon once it has loaded (iconColor).
 */

export type TokenLook = 'eth' | 'note' | 'ingot' | 'coin';

export interface TokenStyle {
  look: TokenLook;
  /** The model it flies as (the coin when the theme lacks it). */
  model: string;
  /** Its colour (`Tint` for the diamond and the note, `Trim` for a coin's rim), or null: measure it from the icon. */
  color: string | null;
}

/** ETH's own blue-violet, and its wrappers' colours (a wrapper not listed flies as plain ETH). */
const ETH_COLORS: Record<string, string> = {
  ETH: '#627eea',
  WETH: '#8a92b2', // the classic grey diamond: ETH, wrapped
  STETH: '#00a3ff',
  WSTETH: '#00a3ff',
  RETH: '#ff6e30',
  CBETH: '#0052ff',
  WEETH: '#6e5fe8',
  EETH: '#6e5fe8',
  OSETH: '#1e2240',
  METH: '#c4f04c',
  EZETH: '#bff04c',
  RSETH: '#0b3d91',
  SFRXETH: '#4a4a4a',
  FRXETH: '#4a4a4a',
};

/** Stablecoins: a banknote in the brand colour (null: measured from the icon). */
const STABLE_COLORS: Record<string, string | null> = {
  USDC: '#2775ca',
  USDT: '#009393',
  DAI: '#f5ac37',
  USDS: null,
  PYUSD: '#1f2933',
  USDE: '#1c1c1c',
  SUSDE: '#1c1c1c',
  GHO: '#2ec05c',
  CRVUSD: '#1e7a4c',
  FRAX: '#4a4a4a',
  FRXUSD: '#4a4a4a',
  LUSD: '#1aa8d8',
  BOLD: null,
  FDUSD: '#1c1c1c',
  TUSD: '#002868',
  USDP: '#00845d',
  BUSD: '#f0b90b',
  SUSD: '#1e1a31',
  RLUSD: null,
  USD0: null,
  EURC: '#2775ca',
};

/** Bitcoin, wrapped: a gold ingot stamped with the token's icon. */
const BITCOINS = new Set(['BTC', 'WBTC', 'CBBTC', 'TBTC', 'LBTC', 'SOLVBTC', 'FBTC']);

/** Other prominent tokens: a coin with their icon, its rim in their colour. */
const COIN_COLORS: Record<string, string> = {
  LINK: '#2a5ada',
  UNI: '#ff007a',
  AAVE: '#9391f7',
  ARB: '#28a0f0',
  OP: '#ff0420',
  MKR: '#1aab9b',
  LDO: '#f69988',
  ENS: '#5298ff',
  PEPE: '#4c9a2a',
  SHIB: '#f0900f',
  POL: '#8247e5',
  MATIC: '#8247e5',
  EIGEN: '#1a0c6d',
  CRV: '#e7c400',
  CVX: '#3a3a3a',
  COMP: '#00d395',
  SNX: '#00d1ff',
  APE: '#0054fa',
  GRT: '#6747ed',
  RPL: '#ff6e30',
  PENDLE: '#1b3b78',
  MORPHO: '#2470ff',
  DOGE: '#c2a633',
  ENA: '#1c1c1c',
  ETHFI: '#6e5fe8',
  SAFE: '#12ff80',
  BAL: '#1e1e1e',
  YFI: '#0657f9',
  SUSHI: '#d65892',
  '1INCH': '#2f4f87',
};

/** How a token flies. Pure. */
export function tokenStyle(symbol: string): TokenStyle {
  const s = symbol.toUpperCase();
  if (s === '' || s in ETH_COLORS) return { look: 'eth', model: 'fx.eth', color: ETH_COLORS[s] ?? ETH_COLORS['ETH']! };
  if (s in STABLE_COLORS) return { look: 'note', model: 'fx.banknote', color: STABLE_COLORS[s] ?? null };
  if (BITCOINS.has(s)) return { look: 'ingot', model: 'fx.ingot', color: '#f7931a' };
  // a liquid-staking or restaking ETH we don't list: still ETH
  if (/^[A-Z]*ETH$/.test(s) && s.length <= 7) return { look: 'eth', model: 'fx.eth', color: ETH_COLORS['ETH']! };
  return { look: 'coin', model: 'fx.coin', color: COIN_COLORS[s] ?? null };
}

/** Whether a token is a stablecoin (it flies as a banknote). Pure. */
export function isStable(symbol: string): boolean {
  return symbol.toUpperCase() in STABLE_COLORS;
}

/**
 * A token's colour from its icon's pixels (RGBA, as a canvas gives them): the
 * average of its clearly coloured pixels, or of its dark ones for a black
 * icon; null for an icon with neither (all white or see-through). Pure.
 */
export function iconColor(rgba: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let dr = 0;
  let dg = 0;
  let db = 0;
  let dn = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 200) continue;
    const R = rgba[i]! / 255;
    const G = rgba[i + 1]! / 255;
    const B = rgba[i + 2]! / 255;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const l = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (sat > 0.35 && l > 0.15 && l < 0.85) {
      r += R;
      g += G;
      b += B;
      n++;
    } else if (l < 0.25) {
      dr += R;
      dg += G;
      db += B;
      dn++;
    }
  }
  const hex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  // a few coloured pixels are an accent on a black icon; a black icon is a dark token
  if (n >= 12) return `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`;
  if (dn >= 12) return `#${hex(dr / dn)}${hex(dg / dn)}${hex(db / dn)}`;
  return null;
}
