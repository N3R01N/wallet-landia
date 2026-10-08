/**
 * What the renderers and panels draw with: each function asks the registry for
 * pack art first and falls back to the built-in "Hearth & Harvest" art drawn
 * in code. Call sites never know which one they got.
 */

import type { AssetCategory, BuildingKind } from '../domain/catalog.js';
import { BUILDING_NAMES } from '../domain/catalog.js';
import type { Tier } from '../domain/tiers.js';
import { DISTRICT_NAMES, type District, type PlacedKind } from '../world/layout.js';
import { isoBuilding, topBuilding } from '../render/buildings.js';
import { caravanSprite, heroSprite, npcSprite, villagerSprite, type HeroLook } from '../render/characters.js';
import { propSprite, type Prop } from '../render/ground.js';
import { itemIcon } from '../render/icons.js';
import type { Sprite } from '../render/pixel.js';
import { assets } from './registry.js';

export function heroArt(look: HeroLook, frame: number, groundShadow = true): Sprite {
  return assets.sprite([`hero.t${look.tier}.${look.cls}`, `hero.t${look.tier}`], 'sprite', frame) ?? heroSprite(look, frame, groundShadow);
}

export function npcArt(kind: 'raven' | 'herald' | 'bailiff', frame: number): Sprite {
  return assets.sprite([`npc.${kind}`], 'sprite', frame) ?? npcSprite(kind, frame);
}

export function villagerArt(seed: number, frame: number, dim: boolean): Sprite {
  return assets.sprite(['npc.villager'], 'sprite', frame) ?? villagerSprite(seed, frame, dim);
}

export function caravanArt(tier: Tier, frame: number, groundShadow = true): Sprite | null {
  if (tier === 0) return null;
  return assets.sprite([`caravan.t${tier}`], 'sprite', frame) ?? caravanSprite(tier, frame, groundShadow);
}

export function itemArt(cat: AssetCategory | 'spam' | 'pouch'): Sprite {
  return assets.sprite([`item.${cat}`], 'sprite') ?? itemIcon(cat);
}

export function propArt(kind: Prop['kind']): Sprite {
  return assets.sprite([`prop.${kind}`], 'sprite') ?? propSprite(kind);
}

export function buildingChain(kind: PlacedKind, homeTier: Tier): string[] {
  return kind === 'home' ? [`building.home.t${homeTier}`] : [`building.${kind}`];
}

export function buildingArt(projection: 'top' | 'iso', kind: PlacedKind, w: number, h: number, roof: string, homeTier: Tier, variant: string): Sprite {
  const pack = assets.sprite(buildingChain(kind, homeTier), projection);
  if (pack) return pack;
  return projection === 'top' ? topBuilding(kind, w, h, roof, homeTier, variant) : isoBuilding(kind, w, h, roof, homeTier, variant);
}

const LANDMARK_NAMES = { tower: 'Chronicle Tower', guildhall: 'Guild Hall', gate: 'Town Gate' } as const;

export function buildingName(kind: BuildingKind | keyof typeof LANDMARK_NAMES): string {
  const fallback = kind in LANDMARK_NAMES ? LANDMARK_NAMES[kind as keyof typeof LANDMARK_NAMES] : BUILDING_NAMES[kind as BuildingKind];
  return assets.word(`building.${kind}`, fallback);
}

export function districtName(d: District): string {
  return assets.word(`district.${d}`, DISTRICT_NAMES[d]);
}
