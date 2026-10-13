/**
 * Stepping inside a house: the panel's button opens the house's room in the
 * view the player is looking at (2D pixel room, or the 3D room in a 3D theme).
 * A hero's house has the hero in it, as the town draws them. The app keeps
 * `roomHost` up to date with which view is on screen and how to make figures.
 */

import type { HeroClass } from '../domain/model.js';
import type { Tier } from '../domain/tiers.js';
import type { HeroLook } from '../render/characters.js';
import type { SandboxCharacter } from '../render/three/themes.js';
import type { MaterialLibrary } from '../render/three/grammar/materials.js';
import { crestColors, hashString } from '../util/rng.js';
import { roomFor, type Room, type RoomSource } from '../world/roomLayout.js';
import { el } from './dom.js';
import { openRoom2d } from './room2d.js';

/** The hero whose house it is. */
export interface HouseHero {
  address: string;
  cls: HeroClass;
  tier: Tier;
}

/** Which view is on screen, the 3D theme's materials, and how to make a hero's figure there. */
export const roomHost: {
  threeD: boolean;
  materials: () => MaterialLibrary | null;
  figure: (hero: HouseHero) => SandboxCharacter | null;
} = { threeD: false, materials: () => null, figure: () => null };

/** The hero as the town draws them (the same look: crest, skin and hair from the address). */
export function lookOf(hero: HouseHero): HeroLook {
  const h = hashString(hero.address);
  // on foot: the house's hero stands in the room without their mount
  return { address: hero.address, cls: hero.cls, tier: 0, crest: crestColors(hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 };
}

export function openInside(room: Room, hero: HouseHero | null = null): void {
  if (roomHost.threeD) {
    import('../render/three/room3dView.js')
      .then(({ openRoom3d }) => openRoom3d(room, roomHost.materials(), hero === null ? null : roomHost.figure(hero)))
      .catch((e: unknown) => console.warn('the inside of the house could not be opened', e));
  } else {
    openRoom2d(room, hero === null ? null : lookOf(hero));
  }
}

/** For the browser tests: `openInsideDemo(holdings)` opens a room with any holdings, to see every kind of thing in it. */
export function exposeRoomDemo(): void {
  (window as unknown as { openInsideDemo: (src: RoomSource, hero?: HouseHero) => void }).openInsideDemo = (src, hero) => openInside(roomFor(src), hero ?? null);
}

/** The panel's entry to the room: a summary and the button that steps inside. */
export function stepInside(room: Room, hero: HouseHero | null = null): HTMLElement {
  const things = room.objects.length;
  const summary = room.empty ? 'Nothing here yet.' : `${things} ${things === 1 ? 'thing' : 'things'} to see inside${room.morePictures > 0 ? ` · ${room.morePictures} more pictures in the gallery` : ''}.`;
  const go = el('button', { class: 'btn' }, 'Step inside');
  go.onclick = () => openInside(room, hero);
  return el('div', { class: 'inside-entry' }, el('p', { class: 'muted' }, summary), go);
}
