/**
 * People and creatures. Shared by both projections: characters are upright
 * billboards in top-down and isometric alike. All face right; the renderer
 * mirrors them for left.
 *
 * Slots: hero.class.<class>, mount.t<tier>, npc.<kind>, caravan.t<tier>.
 */

import type { HeroClass } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import { P, px, shade, sprite, type Ctx, type Sprite } from './pixel.js';

interface Look {
  tunic: string;
  legs: string;
  hair: string;
  skin: string;
}

const CLASS_TUNIC: Record<HeroClass, string> = {
  merchant: '#3f8f5a',
  monk: '#9b6a3c',
  paladin: '#c8ced8',
  bard: '#8e5bd0',
  ranger: '#4f7a3a',
  adventurer: '#3f6fb0',
  sleeper: '#7c86a8',
};

function person(c: Ctx, fx: number, fy: number, look: Look, frame: number, cls: HeroClass | null, crest: string): void {
  const step = frame % 2;
  // legs
  px(c, fx - 2, fy - 3, 1, 3 - step, look.legs);
  px(c, fx + 1, fy - 3, 1, 2 + step, look.legs);
  px(c, fx - 2, fy - 1 + 0, 2, 1, P.woodDark);
  // body
  px(c, fx - 3, fy - 8, 6, 5, look.tunic);
  px(c, fx - 3, fy - 5, 6, 1, shade(look.tunic, -0.35));
  px(c, fx - 4, fy - 8, 1, 4, shade(look.tunic, -0.2));
  px(c, fx + 3, fy - 8, 1, 4, shade(look.tunic, -0.2));
  px(c, fx - 4, fy - 4, 1, 1, look.skin);
  px(c, fx + 3, fy - 4, 1, 1, look.skin);
  // head
  px(c, fx - 2, fy - 12, 4, 4, look.skin);
  px(c, fx - 2, fy - 13, 4, 1, look.hair);
  px(c, fx - 3, fy - 12, 1, 3, look.hair);
  px(c, fx + 1, fy - 11, 1, 1, '#2a1a10');
  if (cls !== null) accessory(c, fx, fy, cls, crest, step);
}

function accessory(c: Ctx, fx: number, fy: number, cls: HeroClass, crest: string, step: number): void {
  switch (cls) {
    case 'merchant': // cloak + coin purse
      px(c, fx - 4, fy - 9, 2, 6, '#2d6b42');
      px(c, fx + 3, fy - 5, 2, 2, P.gold);
      px(c, fx - 3, fy - 14, 6, 1, '#6b4a2a');
      px(c, fx - 2, fy - 15, 4, 1, '#6b4a2a');
      break;
    case 'monk': // staff + hood
      px(c, fx + 4, fy - 13, 1, 12, P.woodLight);
      px(c, fx + 3, fy - 14, 3, 1, P.gold);
      px(c, fx - 3, fy - 13, 6, 1, '#7a5230');
      break;
    case 'paladin': // helmet + shield with crest
      px(c, fx - 2, fy - 14, 4, 2, P.silverDark);
      px(c, fx - 1, fy - 15, 2, 1, P.red);
      px(c, fx - 6, fy - 9, 3, 5, crest);
      px(c, fx - 6, fy - 9, 3, 1, P.silver);
      break;
    case 'bard': // feathered hat + lute
      px(c, fx - 3, fy - 14, 6, 1, '#5a2f8a');
      px(c, fx - 2, fy - 15, 4, 1, '#5a2f8a');
      px(c, fx + 2, fy - 17, 1, 3, '#f0d060');
      px(c, fx + 3, fy - 7, 3, 3, P.woodLight);
      px(c, fx + 5, fy - 10, 1, 4, P.woodDark);
      break;
    case 'ranger': // hood + bow
      px(c, fx - 3, fy - 14, 6, 2, '#3a5a2a');
      px(c, fx - 6, fy - 11, 1, 8, P.woodDark);
      px(c, fx - 5, fy - 12, 1, 1, P.woodDark);
      px(c, fx - 5, fy - 3, 1, 1, P.woodDark);
      break;
    case 'adventurer': // sword
      px(c, fx + 4, fy - 9 + step, 1, 6, P.silver);
      px(c, fx + 3, fy - 4 + step, 3, 1, P.goldDark);
      break;
    case 'sleeper': // nightcap
      px(c, fx - 2, fy - 14, 4, 2, '#d0d8f0');
      px(c, fx + 2, fy - 14, 2, 1, '#d0d8f0');
      px(c, fx + 4, fy - 13, 1, 1, P.white);
      break;
  }
}

/** Seated rider: top half of a person. */
function rider(c: Ctx, fx: number, seat: number, look: Look, cls: HeroClass, crest: string): void {
  px(c, fx - 3, seat - 5, 6, 5, look.tunic);
  px(c, fx - 1, seat, 2, 2, look.legs);
  px(c, fx - 2, seat - 9, 4, 4, look.skin);
  px(c, fx - 2, seat - 10, 4, 1, look.hair);
  px(c, fx - 3, seat - 9, 1, 3, look.hair);
  px(c, fx + 1, seat - 8, 1, 1, '#2a1a10');
  accessory(c, fx, seat + 3, cls, crest, 0);
}

function quadruped(c: Ctx, fx: number, fy: number, body: string, len: number, tall: number, frame: number, opts: { mane?: string; armor?: string; crest?: string } = {}): number {
  const legH = tall;
  const top = fy - legH - 5;
  const step = frame % 2;
  const x0 = fx - Math.floor(len / 2);
  // legs (animated)
  const legs = [x0 + 1, x0 + 3, x0 + len - 4, x0 + len - 2];
  legs.forEach((lx, i) => px(c, lx, fy - legH, 1, legH - ((i + step) % 2), shade(body, -0.25)));
  // body
  px(c, x0, top, len, 5, body);
  px(c, x0, top + 4, len, 1, shade(body, -0.2));
  // neck + head
  px(c, x0 + len - 2, top - 3, 2, 4, body);
  px(c, x0 + len - 1, top - 4, 4, 3, body);
  px(c, x0 + len + 2, top - 3, 1, 1, '#2a1a10');
  px(c, x0 + len - 1, top - 5, 1, 1, shade(body, -0.3));
  // tail
  px(c, x0 - 1, top + 1, 1, 3, opts.mane ?? shade(body, -0.35));
  if (opts.mane) px(c, x0 + len - 3, top - 4, 2, 4, opts.mane);
  if (opts.armor) {
    px(c, x0, top, len, 4, opts.crest ?? opts.armor);
    px(c, x0, top + 4, len, 1, P.gold);
    px(c, x0 + len - 1, top - 4, 3, 2, opts.armor);
  }
  return top + 1;
}

function wings(c: Ctx, x: number, y: number, color: string, span: number, frame: number): void {
  const up = frame % 2 === 0;
  for (let i = 0; i < span; i++) {
    const h = up ? span - i : Math.floor(i / 2) + 1;
    px(c, x - i, y - (up ? h : 0), 1, up ? h : h, i % 3 === 0 ? shade(color, -0.2) : color);
  }
}

export interface HeroLook {
  address: string;
  cls: HeroClass;
  tier: Tier;
  crest: string;
  skin: number;
  hair: number;
}

export function heroSprite(h: HeroLook, frame: number): Sprite {
  const look: Look = {
    tunic: CLASS_TUNIC[h.cls],
    legs: '#4a3a2e',
    skin: P.skin[h.skin % P.skin.length] ?? P.skin[0],
    hair: P.hair[h.hair % P.hair.length] ?? P.hair[0],
  };
  const f = frame % 2;
  const key = `hero:${h.cls}:${h.tier}:${h.crest}:${h.skin}:${h.hair}:${f}`;
  const W = 44;
  const H = 40;
  const fx = 22;
  const fy = 38;
  return sprite(key, W, H, fx, fy, (c) => {
    // a soft ground shadow
    c.fillStyle = P.shadow;
    c.beginPath();
    c.ellipse(fx, fy, h.tier >= 5 ? 9 : 6, 2, 0, 0, Math.PI * 2);
    c.fill();
    switch (h.tier) {
      case 0: // barefoot, walking stick
        person(c, fx, fy, { ...look, tunic: shade(look.tunic, -0.3), legs: look.skin }, f, h.cls, h.crest);
        px(c, fx + 5, fy - 10, 1, 10, P.woodDark);
        break;
      case 1: // on foot with a pack
        person(c, fx, fy, look, f, h.cls, h.crest);
        px(c, fx - 6, fy - 9, 3, 5, '#9a6a3a');
        break;
      case 2: {
        const seat = quadruped(c, fx, fy, '#9a958c', 10, 4, f, { mane: '#5a554c' });
        rider(c, fx - 1, seat, look, h.cls, h.crest);
        break;
      }
      case 3: {
        const seat = quadruped(c, fx, fy, '#8a5230', 12, 6, f, { mane: '#3a2010' });
        rider(c, fx - 1, seat, look, h.cls, h.crest);
        break;
      }
      case 4: {
        const seat = quadruped(c, fx, fy, '#6e6a70', 13, 6, f, { mane: '#2a2a30', armor: P.silver, crest: h.crest });
        rider(c, fx - 1, seat, look, h.cls, h.crest);
        break;
      }
      case 5: {
        // griffin: tawny lion body, eagle head, flapping wings
        const seat = quadruped(c, fx, fy - 3, '#c49a4a', 13, 5, f);
        px(c, fx + 5, seat - 7, 4, 4, '#f0ead6');
        px(c, fx + 9, seat - 6, 2, 1, P.gold);
        wings(c, fx - 1, seat - 1, '#a0743a', 9, f);
        rider(c, fx - 2, seat, look, h.cls, h.crest);
        break;
      }
      case 6: {
        // dragon: crimson, gold belly, great wings, horns
        const top = fy - 14;
        px(c, fx - 10, top + 6, 4, 2, '#a02820'); // tail
        px(c, fx - 13, top + 7, 3, 1, '#a02820');
        px(c, fx - 7, top, 16, 7, '#c0392b');
        px(c, fx - 6, top + 6, 14, 2, P.gold);
        [fx - 5, fx - 2, fx + 3, fx + 6].forEach((lx, i) => px(c, lx, top + 8, 2, 5 - ((i + f) % 2), '#8a2018'));
        px(c, fx + 8, top - 4, 3, 6, '#c0392b');
        px(c, fx + 9, top - 7, 6, 4, '#c0392b');
        px(c, fx + 13, top - 6, 1, 1, P.gold);
        px(c, fx + 10, top - 9, 1, 2, P.white);
        px(c, fx + 12, top - 9, 1, 2, P.white);
        wings(c, fx, top, '#8a1e18', 13, f);
        rider(c, fx - 1, top + 1, look, h.cls, h.crest);
        break;
      }
    }
  });
}

export function villagerSprite(seed: number, frame: number, dim: boolean): Sprite {
  const tunics = ['#a07050', '#7090a0', '#90a070', '#b08090', '#8080a8', '#a89060'];
  const t = tunics[seed % tunics.length] ?? '#a07050';
  const key = `villager:${seed % 24}:${frame % 2}:${dim}`;
  return sprite(key, 16, 18, 8, 17, (c) => {
    c.globalAlpha = dim ? 0.75 : 1;
    person(
      c,
      8,
      17,
      { tunic: t, legs: '#4a3a2e', skin: P.skin[seed % 4] ?? P.skin[0], hair: P.hair[(seed >> 2) % 6] ?? P.hair[0] },
      frame,
      null,
      '#fff',
    );
  });
}

export function npcSprite(kind: 'raven' | 'herald' | 'bailiff', frame: number): Sprite {
  const f = frame % 2;
  return sprite(`npc:${kind}:${f}`, 20, 22, 10, 20, (c) => {
    if (kind === 'raven') {
      px(c, 6, 10, 7, 3, '#1e1e26');
      px(c, 12, 9, 3, 3, '#1e1e26');
      px(c, 15, 10, 2, 1, P.gold);
      px(c, 13, 10, 1, 1, P.white);
      if (f === 0) {
        px(c, 6, 5, 2, 5, '#2e2e3a');
        px(c, 8, 7, 2, 3, '#2e2e3a');
      } else {
        px(c, 6, 13, 3, 3, '#2e2e3a');
      }
      px(c, 4, 11, 2, 1, '#1e1e26');
      // letter in beak
      px(c, 15, 12, 3, 2, P.white);
      return;
    }
    if (kind === 'herald') {
      person(c, 10, 20, { tunic: P.red, legs: '#f0d060', skin: P.skin[0], hair: P.hair[2] ?? '#d8b25a' }, f, null, '#fff');
      px(c, 7, 13, 6, 1, P.gold);
      px(c, 13, 9, 5, 1, P.gold);
      px(c, 17, 8, 2, 3, P.gold);
      return;
    }
    person(c, 10, 20, { tunic: '#3a3a44', legs: '#22222a', skin: P.skin[1] ?? '#d9a066', hair: '#22222a' }, f, null, '#fff');
    px(c, 7, 14, 6, 1, P.red);
    px(c, 8, 6, 4, 2, '#22222a');
    px(c, 14, 8, 1, 9, P.woodDark);
    px(c, 13, 7, 3, 2, P.silverDark);
  });
}

/** What follows a hero, sized by the value tier of the journey. */
export function caravanSprite(tier: Tier, frame: number): Sprite | null {
  if (tier === 0) return null;
  const f = frame % 2;
  return sprite(`caravan:${tier}:${f}`, 36, 26, 18, 24, (c) => {
    c.fillStyle = P.shadow;
    c.beginPath();
    c.ellipse(18, 24, tier >= 4 ? 10 : 5, 2, 0, 0, Math.PI * 2);
    c.fill();
    switch (tier) {
      case 1: // a floating coin pouch
        px(c, 15, 16 - f, 6, 5, '#9a6a3a');
        px(c, 16, 15 - f, 4, 1, '#6b4a2a');
        px(c, 17, 18 - f, 2, 1, P.gold);
        break;
      case 2: // a porter with a sack
        person(c, 18, 24, { tunic: '#8a7a5a', legs: '#4a3a2e', skin: P.skin[1] ?? '#d9a066', hair: P.hair[0] ?? '#3b2a1a' }, f, null, '#fff');
        px(c, 12, 11, 5, 6, '#c8b088');
        break;
      case 3: {
        const top = quadruped(c, 18, 24, '#7a6a5a', 10, 4, f);
        px(c, 13, top - 4, 4, 5, '#c8b088');
        px(c, 18, top - 4, 4, 5, '#a88a58');
        break;
      }
      case 4:
      case 5:
      case 6: {
        const len = tier === 4 ? 16 : 22;
        const x0 = 18 - len / 2;
        const body = tier === 6 ? P.gold : P.woodLight;
        // wheels
        px(c, x0 + 2, 20, 4, 4, P.woodDark);
        px(c, x0 + len - 6, 20, 4, 4, P.woodDark);
        px(c, x0 + 3 + f, 21, 2, 2, P.woodLight);
        px(c, x0 + len - 5 + f, 21, 2, 2, P.woodLight);
        px(c, x0, 14, len, 6, body);
        px(c, x0, 19, len, 1, shade(body, -0.3));
        if (tier === 4) {
          px(c, x0 + 2, 9, 5, 5, '#c8a060');
          px(c, x0 + 8, 10, 5, 4, '#a88040');
          px(c, x0 + 4, 7, 4, 2, P.gold);
        } else if (tier === 5) {
          poly(c, [[x0 + 1, 14], [x0 + len - 1, 14], [x0 + len - 3, 6], [x0 + 3, 6]], '#efe6cc');
          px(c, x0 + 6, 8, 2, 6, '#d8ccaa');
          px(c, x0 + 14, 8, 2, 6, '#d8ccaa');
        } else {
          poly(c, [[x0 + 1, 14], [x0 + len - 1, 14], [x0 + len - 4, 5], [x0 + 4, 5]], '#8e1c2a');
          px(c, x0 + 9, 2, 4, 3, P.gold);
          px(c, x0 + 3, 9, 3, 3, P.gold);
          px(c, x0 + len - 6, 9, 3, 3, P.gold);
        }
        break;
      }
    }
  });
}

function poly(c: Ctx, pts: [number, number][], fill: string): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

export const MOUNT_NAMES = ['Barefoot', 'On foot', 'Donkey', 'Horse', 'Armoured warhorse', 'Griffin', 'Dragon'] as const;
