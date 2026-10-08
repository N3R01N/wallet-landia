/**
 * The slot catalogue: every place in the world a pack may fill
 * (World Bible §8). The game never says "draw a donkey", it asks for
 * `hero.t2`; the built-in "Hearth & Harvest" art answers when no pack does.
 *
 * Resolution goes from specific to general: `hero.t3.merchant` → `hero.t3`
 * → built-in. Art scale is 16 art pixels per tile in every view.
 */

import { BUILDING_NAMES, type AssetCategory, type BuildingKind } from '../domain/catalog.js';
import { CLASS_LABEL, type HeroClass } from '../domain/model.js';
import { DISTRICT_NAMES, type District } from '../world/layout.js';

export type SlotFamily = 'hero' | 'npc' | 'caravan' | 'item' | 'prop' | 'building' | 'word';
/** Which forms a slot can take: a billboard/icon sprite, 2D building sprites per projection, a 3D model, or a word. */
export type SlotForm = 'sprite' | 'top' | 'iso' | 'model' | 'word';

export interface SlotInfo {
  key: string;
  family: SlotFamily;
  label: string;
  forms: SlotForm[];
}

export const FAMILY_LABEL: Record<SlotFamily, string> = {
  hero: 'Heroes & mounts',
  npc: 'Townsfolk',
  caravan: 'Caravans',
  item: 'Treasure icons',
  prop: 'Scenery',
  building: 'Buildings',
  word: 'Names (lexicon)',
};

const TIERS = [0, 1, 2, 3, 4, 5, 6] as const;
const MOUNTS = ['barefoot', 'on foot', 'donkey', 'horse', 'warhorse', 'griffin', 'dragon'];
const CLASSES = Object.keys(CLASS_LABEL) as HeroClass[];
const ITEMS: (AssetCategory | 'spam' | 'pouch')[] = ['native', 'stable', 'wrapped', 'governance', 'meme', 'lst', 'receipt', 'debt', 'token', 'nft', 'spam', 'pouch'];
const BUILDINGS = Object.keys(BUILDING_NAMES) as BuildingKind[];
const LANDMARKS = { tower: 'Chronicle Tower', guildhall: 'Guild Hall', gate: 'Town Gate' } as const;

let built: SlotInfo[] | null = null;

export function catalog(): SlotInfo[] {
  if (built) return built;
  const out: SlotInfo[] = [];
  for (const t of TIERS) {
    out.push({ key: `hero.t${t}`, family: 'hero', label: `Hero, tier ${t} (${MOUNTS[t]})`, forms: ['sprite'] });
    for (const c of CLASSES) out.push({ key: `hero.t${t}.${c}`, family: 'hero', label: `Hero, tier ${t}, ${CLASS_LABEL[c]}`, forms: ['sprite'] });
  }
  for (const n of ['raven', 'herald', 'bailiff', 'villager']) out.push({ key: `npc.${n}`, family: 'npc', label: n[0]!.toUpperCase() + n.slice(1), forms: ['sprite'] });
  for (const t of TIERS.slice(1)) out.push({ key: `caravan.t${t}`, family: 'caravan', label: `Caravan, tier ${t}`, forms: ['sprite'] });
  for (const i of ITEMS) out.push({ key: `item.${i}`, family: 'item', label: `Item: ${i}`, forms: ['sprite'] });
  for (const p of ['tree', 'pine', 'bush', 'rock']) out.push({ key: `prop.${p}`, family: 'prop', label: `Scenery: ${p}`, forms: ['sprite', 'model'] });
  for (const b of BUILDINGS) {
    out.push({ key: `building.${b}`, family: 'building', label: BUILDING_NAMES[b], forms: ['top', 'iso', 'model'] });
    out.push({ key: `word.building.${b}`, family: 'word', label: `Name of the ${BUILDING_NAMES[b]}`, forms: ['word'] });
  }
  for (const [k, name] of Object.entries(LANDMARKS)) {
    out.push({ key: `building.${k}`, family: 'building', label: name, forms: ['top', 'iso', 'model'] });
    out.push({ key: `word.building.${k}`, family: 'word', label: `Name of the ${name}`, forms: ['word'] });
  }
  for (const t of TIERS) out.push({ key: `building.home.t${t}`, family: 'building', label: `Home, tier ${t}`, forms: ['top', 'iso', 'model'] });
  for (const d of Object.keys(DISTRICT_NAMES) as District[]) out.push({ key: `word.district.${d}`, family: 'word', label: `Name of ${DISTRICT_NAMES[d]}`, forms: ['word'] });
  built = out;
  return out;
}

const index = new Map<string, SlotInfo>();
export function slotInfo(key: string): SlotInfo | undefined {
  if (index.size === 0) for (const s of catalog()) index.set(s.key, s);
  return index.get(key);
}
