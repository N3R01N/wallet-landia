/**
 * Inventory item icons, one per asset category (slot item.<category>). The
 * rarity frame is applied by the UI from the value tier, not baked in.
 */

import type { AssetCategory } from '../domain/catalog.js';
import { P, poly, px, sprite, type Sprite } from './pixel.js';

export function itemIcon(cat: AssetCategory | 'spam' | 'pouch'): Sprite {
  return sprite(`item:${cat}`, 16, 16, 0, 0, (c) => {
    switch (cat) {
      case 'native': // gold coins
        for (const [x, y] of [[3, 8], [7, 9], [5, 5], [9, 6]] as const) {
          px(c, x, y, 5, 4, P.goldDark);
          px(c, x, y, 5, 3, P.gold);
          px(c, x + 1, y, 2, 1, '#fff2a0');
        }
        break;
      case 'stable': // silver bars
        poly(c, [[2, 11], [12, 11], [14, 8], [4, 8]], P.silver);
        poly(c, [[2, 11], [12, 11], [12, 13], [2, 13]], P.silverDark);
        poly(c, [[4, 7], [12, 7], [13, 5], [5, 5]], P.silver);
        poly(c, [[4, 7], [12, 7], [12, 8], [4, 8]], P.silverDark);
        break;
      case 'wrapped': // a sealed chest
        px(c, 2, 6, 12, 8, P.wood);
        px(c, 2, 5, 12, 3, P.woodLight);
        px(c, 2, 8, 12, 1, P.goldDark);
        px(c, 7, 7, 2, 3, P.gold);
        break;
      case 'governance': // a sealed charter
        px(c, 3, 2, 10, 12, '#f0e0b0');
        px(c, 3, 2, 10, 1, '#c8a870');
        px(c, 5, 5, 6, 1, '#8a6a4a');
        px(c, 5, 7, 6, 1, '#8a6a4a');
        px(c, 8, 10, 4, 4, P.red);
        break;
      case 'meme': // a frog in a jar
        px(c, 4, 3, 8, 2, P.woodLight);
        px(c, 3, 5, 10, 9, 'rgba(180,220,240,0.6)');
        px(c, 5, 8, 6, 5, '#5fbf4a');
        px(c, 5, 7, 2, 2, '#5fbf4a');
        px(c, 9, 7, 2, 2, '#5fbf4a');
        px(c, 5, 7, 1, 1, '#1a1a1a');
        px(c, 10, 7, 1, 1, '#1a1a1a');
        break;
      case 'lst': // blessed gold: coins with a halo
        c.fillStyle = 'rgba(255,240,150,0.5)';
        c.beginPath();
        c.arc(8, 8, 7, 0, Math.PI * 2);
        c.fill();
        px(c, 4, 6, 8, 6, P.goldDark);
        px(c, 4, 6, 8, 5, P.gold);
        px(c, 7, 2, 2, 3, '#fffbe0');
        break;
      case 'receipt': // a deed
        px(c, 3, 2, 10, 12, '#f6eed8');
        px(c, 3, 2, 10, 1, '#b8a888');
        px(c, 5, 4, 6, 1, '#6a5a4a');
        px(c, 5, 6, 6, 1, '#6a5a4a');
        px(c, 5, 8, 4, 1, '#6a5a4a');
        px(c, 9, 10, 3, 3, P.blue);
        break;
      case 'debt': // red-sealed IOU with a chain
        px(c, 3, 2, 10, 10, '#f0e0c8');
        px(c, 5, 4, 6, 1, '#7a3a2a');
        px(c, 5, 6, 6, 1, '#7a3a2a');
        px(c, 9, 8, 4, 4, P.red);
        for (let i = 0; i < 4; i++) px(c, 2 + i * 2, 13, 2, 2, i % 2 === 0 ? '#6a6a72' : '#8a8a92');
        break;
      case 'token': // a gem pouch
        px(c, 4, 6, 8, 8, '#9a6a3a');
        px(c, 5, 5, 6, 1, '#6b4a2a');
        px(c, 6, 2, 4, 3, '#7ad0ff');
        break;
      case 'nft': // a framed painting
        px(c, 1, 2, 14, 12, P.goldDark);
        px(c, 2, 3, 12, 10, '#7ab0e0');
        px(c, 2, 9, 12, 4, '#5fbf4a');
        px(c, 9, 4, 3, 3, '#fff2a0');
        break;
      case 'spam': // cursed junk
        px(c, 3, 9, 10, 5, '#5a5a4a');
        px(c, 5, 6, 4, 4, '#6a4a6a');
        px(c, 9, 5, 3, 3, '#8a8a5a');
        px(c, 7, 2, 1, 3, '#a060d0');
        break;
      case 'pouch': // odds and ends
        px(c, 3, 5, 10, 9, '#b08a5a');
        px(c, 5, 3, 6, 2, '#8a6a3a');
        px(c, 6, 8, 1, 1, P.gold);
        px(c, 9, 10, 1, 1, P.silver);
        break;
    }
  });
}
