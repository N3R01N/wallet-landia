/**
 * A house's inside for the 2D and isometric views: drawn with the same pixel
 * palette and icons as the town (render/pixel.ts, render/icons.ts), at the
 * town's own pixel scale. Holdings use the town's treasure icons: coins for
 * ETH, a sealed chest for wrapped holdings, a blessed-gold halo for rewards;
 * pictures show the NFT in a frame.
 */

import { P, poly, px, type Ctx, type Sprite } from '../render/pixel.js';
import { heroArt } from '../assets/art.js';
import { assets } from '../assets/registry.js';
import type { HeroLook } from '../render/characters.js';
import type { Room, RoomObject } from '../world/roomLayout.js';
import { roomRemark } from '../world/roomTalk.js';
import { el, safeHref } from './dom.js';
import { openShell } from './roomShell.js';

/** The room in town pixels: a little wider than the screen at 1×, so it can be looked around. */
export const ROOM2D = { w: 320, h: 180, floor: 128 } as const;

/**
 * Paint the room (its wall, windows, floor, door, and each object) into a context at town pixels.
 * `t`: seconds, for the things that move (glints, the bobbing reward, the swaying scale, the dust, the villager).
 */
export function paintRoom2d(g: Ctx, room: Room, pictures: ReadonlyMap<string, HTMLCanvasElement>, t = 0, speaker: Sprite | null = null): void {
  const { w, h, floor } = ROOM2D;
  g.clearRect(0, 0, w, h);
  // the wall: plaster, with a wainscot along its foot
  px(g, 0, 0, w, floor, P.plaster);
  for (let y = 10; y < floor; y += 22) px(g, 0, y, w, 1, P.plasterDark);
  px(g, 0, floor - 14, w, 14, P.wood);
  px(g, 0, floor - 14, w, 2, P.woodDark);
  for (let x = 0; x < w; x += 16) px(g, x, floor - 6, 1, 6, P.woodDark);
  // two windows, with the sky and a cross
  for (const wx of [44, 232]) {
    px(g, wx - 2, 20, 52, 46, P.woodDark);
    px(g, wx, 22, 48, 42, P.glass);
    px(g, wx, 22, 48, 10, P.white);
    px(g, wx + 23, 22, 2, 42, P.woodDark);
    px(g, wx, 43, 48, 2, P.woodDark);
  }
  // the floor: planks, their joints staggered row by row
  for (let y = floor, row = 0; y < h; y += 8, row++) {
    px(g, 0, y, w, 8, row % 2 === 0 ? P.wood : P.woodDark);
    px(g, 0, y, w, 1, P.woodDark);
    for (let x = (row % 2) * 24; x < w; x += 48) px(g, x, y, 1, 8, P.woodDark);
  }
  // the door at the far end, with its gold handle
  px(g, w - 34, 48, 26, floor - 48 - 14, P.woodDark);
  px(g, w - 32, 50, 22, floor - 52 - 14, P.wood);
  px(g, w - 14, floor - 40, 2, 2, P.gold);

  // dust in the light: more of it in an empty room
  for (let k = 0; k < (room.empty ? 14 : 6); k++) {
    const dx = (k * 53 + t * 5) % w;
    const dy = 20 + ((k * 37 - t * 3 + 400) % 90);
    px(g, dx, Math.floor(dy), 1, 1, '#fff8dc');
  }
  for (const o of [...room.objects].sort((a, b) => a.y - b.y)) drawObject(g, o, pictures, t);
  drawSpeaker(g, room, t, speaker);
}

/**
 * The hero whose house it is, at the front of the room, talking about the house (its own sprite: the same
 * figure as in the town); a protocol's room has no one standing in it, only the words.
 */
function drawSpeaker(g: Ctx, room: Room, t: number, speaker: Sprite | null): void {
  const x = 46;
  const y = 170;
  const bob = Math.round(Math.sin(t * 6) * 0.6);
  let top = y - 40;
  if (speaker !== null) {
    g.drawImage(speaker.canvas, x - speaker.ax, y - speaker.ay + bob);
    top = y - speaker.canvas.height - 2 + bob;
  }
  // the speech bubble above
  const words = roomRemark(room);
  g.font = 'bold 7px system-ui, sans-serif';
  const width = Math.min(150, Math.ceil(g.measureText(words).width) + 8);
  const bx = Math.min(x + 6, ROOM2D.w - width - 4);
  const by = top - 12;
  px(g, bx - 1, by - 1, width + 2, 11, P.outline);
  px(g, bx, by, width, 9, '#fffcf0');
  g.fillStyle = P.outline;
  g.textBaseline = 'middle';
  g.fillText(words, bx + 4, by + 5);
}

/** A merchant's ledger, open on the counter. */
function ledger(g: Ctx, x: number, y: number): void {
  px(g, x - 9, y, 18, ROOM2D.floor - y, P.woodLight); // the desk it lies on
  px(g, x - 9, y, 18, 1, P.woodDark);
  boxed(g, x - 6, y - 6, 12, 6, P.woodDark);
  px(g, x - 5, y - 5, 5, 4, P.plaster);
  px(g, x + 1, y - 5, 4, 4, P.plaster);
  px(g, x - 4, y - 4, 3, 1, P.plasterDark);
}

/** A bard's lute on the wall. */
function lute(g: Ctx, x: number, y: number): void {
  boxed(g, x - 1, y - 24, 3, 12, P.woodDark); // neck
  boxed(g, x - 5, y - 13, 11, 13, P.woodLight); // body
  px(g, x - 2, y - 9, 4, 4, P.outline); // sound hole
  px(g, x - 3, y - 26, 5, 3, P.woodDark); // head
}

/** A bench for a sleeper, with cobwebs in the corner. */
function bench(g: Ctx, x: number, y: number): void {
  boxed(g, x - 14, y - 9, 28, 4, P.wood);
  px(g, x - 12, y - 5, 3, 5, P.woodDark);
  px(g, x + 9, y - 5, 3, 5, P.woodDark);
  // cobwebs: a few pale threads in the corner
  px(g, x + 12, y - 22, 1, 6, '#e8e8e8');
  px(g, x + 13, y - 16, 1, 1, '#e8e8e8');
  px(g, x + 14, y - 18, 2, 1, '#e8e8e8');
}

/** A filled rectangle with a one-pixel dark outline round it. */
function boxed(g: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  px(g, x - 1, y - 1, w + 2, h + 2, P.outline);
  px(g, x, y, w, h, fill);
}

/** A pile of coins standing on (x, y): each coin a gold disc, lit on top, darker underneath. */
function coinPile(g: Ctx, x: number, y: number, n: number, t: number): void {
  // two columns, the second one stepping up: a heap, not a column
  for (let i = 0; i < n; i++) {
    const cx = x - 9 + (i % 2) * 7;
    const cy = y - 3 - Math.floor(i / 2) * 3 - (i % 2);
    px(g, cx, cy - 1, 11, 4, P.goldDark);
    px(g, cx, cy - 1, 11, 2, P.gold);
    px(g, cx + 2, cy - 1, 3, 1, '#fff2a0');
    // a glint that runs across each coin in turn
    const glint = (Math.floor(t * 4) + i * 3) % 14;
    if (glint < 11) px(g, cx + glint, cy - 1, 1, 1, '#ffffff');
  }
  px(g, x - 10, y - 1, 19, 1, P.outline);
}

/** A treasure chest: a domed lid, iron-banded body and a gold lock, 24 pixels wide. */
function chest(g: Ctx, x: number, y: number): void {
  boxed(g, x - 12, y - 16, 24, 16, P.woodDark);
  px(g, x - 11, y - 15, 22, 5, P.woodLight); // lid
  px(g, x - 9, y - 17, 18, 2, P.woodLight);
  px(g, x - 11, y - 10, 22, 1, P.outline); // the seam
  px(g, x - 8, y - 9, 2, 8, P.silverDark); // iron bands
  px(g, x + 6, y - 9, 2, 8, P.silverDark);
  px(g, x - 2, y - 11, 5, 5, P.gold); // the lock
  px(g, x - 1, y - 10, 3, 2, P.goldDark);
}

/** A sack tied at the neck: burlap, darker where it is shaded. */
function sack(g: Ctx, x: number, y: number, dark: boolean): void {
  const cloth = dark ? '#9a7442' : P.thatch;
  boxed(g, x - 6, y - 16, 12, 16, cloth);
  px(g, x - 5, y - 16, 10, 1, P.outline); // (the neck is the cut-out at the top)
  px(g, x - 6, y - 2, 12, 2, dark ? '#6f5234' : P.woodLight);
  px(g, x - 2, y - 19, 4, 3, P.wood); // the neck
  px(g, x - 3, y - 17, 6, 1, P.woodDark); // the tie
}

/** A reward mound: gold, with the top coins catching the light. */
function harvest(g: Ctx, x: number, y: number, t: number): void {
  y -= Math.round(Math.sin(t * 2.2) * 0.6); // a gentle bob
  px(g, x - 12, y - 7, 24, 7, P.outline);
  px(g, x - 11, y - 6, 22, 6, P.goldDark);
  px(g, x - 10, y - 8, 20, 2, P.gold);
  px(g, x - 7, y - 10, 14, 2, P.gold);
  px(g, x - 4, y - 12, 8, 2, '#fff2a0');
  px(g, x - 3, y - 4, 2, 2, P.gold);
  px(g, x + 3, y - 3, 2, 2, P.gold);
}

function drawObject(g: Ctx, o: RoomObject, pictures: ReadonlyMap<string, HTMLCanvasElement>, t: number): void {
  const x = Math.round(o.x * ROOM2D.w);
  const y = Math.round(o.y * ROOM2D.h);
  // a pack's own picture for this thing, when it has one (a slot: room.<kind>)
  if (o.kind !== 'picture') {
    const packed = assets.sprite([`room.${o.kind}`], 'sprite');
    if (packed) {
      g.drawImage(packed.canvas, x - packed.ax, y - packed.ay);
      return;
    }
  }
  switch (o.kind) {
    case 'ledger':
      ledger(g, x, y);
      return;
    case 'lute':
      lute(g, x, y);
      return;
    case 'bench':
      bench(g, x, y);
      return;
    case 'coins':
      coinPile(g, x, y, 2 + Math.round(o.size * 4), t);
      return;
    case 'sack':
      sack(g, x, y, false);
      return;
    case 'pouch':
      sack(g, x, y, true);
      return;
    case 'chest':
      chest(g, x, y);
      return;
    case 'harvest':
      harvest(g, x, y, t);
      return;
    case 'scale':
      drawScale(g, x, y, o.tone ?? 'safe', t);
      return;
    case 'picture':
      drawPicture(g, x, y, o, pictures.get(o.id));
      return;
  }
}

/** The Banker's Scale: a beam that tips toward the debt, its pans red when in danger. */
function drawScale(g: Ctx, x: number, y: number, tone: 'safe' | 'watch' | 'danger' | 'critical', t: number): void {
  // a tipped beam sways a pixel either way; a level one hangs still
  const tilt = { safe: 0, watch: 1, danger: 2, critical: 3 }[tone] + (tone === 'safe' ? 0 : Math.round(Math.sin(t * 1.4)));
  const hot = tone === 'danger' || tone === 'critical';
  const top = y - 16;
  // the counter it stands on, down to the floor
  px(g, x - 16, y - 2, 32, ROOM2D.floor - (y - 2), P.woodLight);
  px(g, x - 16, y - 2, 32, 1, P.woodDark);
  px(g, x - 17, y - 2, 1, ROOM2D.floor - (y - 2), P.outline);
  px(g, x + 16, y - 2, 1, ROOM2D.floor - (y - 2), P.outline);
  px(g, x + 9, top + 3, 2, 12, P.woodDark); // post
  px(g, x + 3, y - 4, 14, 2, P.woodDark); // foot
  const left = top + 3 - tilt;
  const right = top + 3 + tilt;
  poly(g, [[x + 2, left], [x + 19, right], [x + 19, right + 1], [x + 2, left + 1]], P.woodDark);
  px(g, x + 1, left + 1, 1, 3, P.silverDark); // chains
  px(g, x + 19, right + 1, 1, 3, P.silverDark);
  px(g, x - 1, left + 4, 5, 2, hot ? P.red : P.silver); // pans
  px(g, x + 16, right + 4, 5, 2, P.silver);
}

/** A picture's frame and inside, drawn at town pixels: a bevelled wooden frame and a cream mat round the picture. */
const PIC = { w: 22, h: 28, inner: 18, innerH: 24 } as const;

/** The NFT's picture, shrunk once to fit the frame's inside, centred (smoothed, so it reads as a picture, not noise). */
function thumbnail(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PIC.inner;
  c.height = PIC.innerH;
  const t = c.getContext('2d');
  if (t === null) return c;
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'high';
  // contain: the whole picture, centred in the inside, the mat colour round any spare space
  t.fillStyle = '#efe2c4';
  t.fillRect(0, 0, PIC.inner, PIC.innerH);
  const scale = Math.min(PIC.inner / img.naturalWidth, PIC.innerH / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  t.drawImage(img, (PIC.inner - dw) / 2, (PIC.innerH - dh) / 2, dw, dh);
  return c;
}

/** A picture in a wooden frame: the NFT's own image when it has loaded, else a pattern from its name. */
function drawPicture(g: Ctx, x: number, y: number, o: RoomObject, thumb: HTMLCanvasElement | undefined): void {
  const left = x - PIC.w / 2;
  const top = y - PIC.h;
  // the frame: lit on the top left, shaded on the bottom right
  px(g, left, top, PIC.w, PIC.h, P.woodDark);
  px(g, left, top, PIC.w - 1, 1, P.woodLight);
  px(g, left, top, 1, PIC.h - 1, P.woodLight);
  px(g, left + 1, top + PIC.h - 1, PIC.w - 1, 1, P.outline);
  px(g, left + PIC.w - 1, top + 1, 1, PIC.h - 1, P.outline);
  // the mat, then the picture
  const ix = left + 2;
  const iy = top + 2;
  px(g, ix - 1, iy - 1, PIC.inner + 2, PIC.innerH + 2, P.plaster);
  if (thumb !== undefined) {
    g.drawImage(thumb, ix, iy);
    return;
  }
  // no picture: a checker of two colours, from the NFT's name
  const colours = [P.red, P.blue, P.green, P.purple, P.gold, P.glass];
  let hash = 0;
  for (const ch of o.label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const ia = hash % colours.length;
  const a = colours[ia]!;
  const b = colours[(ia + 1 + ((hash >> 4) % (colours.length - 1))) % colours.length]!;
  for (let j = 0; j < PIC.innerH; j += 4) {
    for (let i = 0; i < PIC.inner; i += 4) {
      px(g, ix + i, iy + j, 4, 4, (i / 4 + j / 4) % 2 === 0 ? a : b);
    }
  }
}

/** The room, scaled to the window, in a pannable view. */
export function openRoom2d(room: Room, look: HeroLook | null = null): () => void {
  const speaker = look === null ? null : heroArt(look, 0);
  const k = Math.max(1, Math.min(4, Math.floor((window.innerHeight - 56) / ROOM2D.h)));
  const canvas = el('canvas', { class: 'room-canvas', role: 'img', 'aria-label': room.empty ? `${room.title}: nothing here yet` : `${room.title}: the inside` });
  canvas.width = ROOM2D.w;
  canvas.height = ROOM2D.h;
  canvas.style.width = `${ROOM2D.w * k}px`;
  canvas.style.height = `${ROOM2D.h * k}px`;
  const g = canvas.getContext('2d');
  if (g === null) return () => undefined;
  g.imageSmoothingEnabled = false;

  // NFT pictures load into the room as they arrive (a page's own image, drawn into a canvas, needs no CORS)
  const pictures = new Map<string, HTMLCanvasElement>();
  // (people who ask for less motion get one still frame)
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const draw = (): void => paintRoom2d(g, room, pictures, still ? 0 : (performance.now() - t0) / 1000, speaker);
  for (const o of room.objects) {
    const src = o.kind === 'picture' ? safeHref(o.image ?? null) : null;
    if (src === null) continue;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      pictures.set(o.id, thumbnail(img));
      draw();
    };
    img.src = src;
  }
  let frame = 0;
  const loop = (): void => {
    draw();
    frame = requestAnimationFrame(loop);
  };
  if (still) draw();
  else loop();

  const pan = el('div', { class: 'room-pan' }, el('div', { class: 'room-scene' }, canvas));
  const step = (dir: -1 | 1): void => {
    pan.scrollBy({ left: dir * 120 * k, behavior: 'smooth' });
  };
  // drag to look around; a wheel turns it sideways
  let from: { x: number; left: number } | null = null;
  pan.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, left: pan.scrollLeft };
    pan.setPointerCapture(e.pointerId);
    pan.classList.add('dragging');
  });
  pan.addEventListener('pointermove', (e) => {
    if (from !== null) pan.scrollLeft = from.left - (e.clientX - from.x);
  });
  const release = (): void => {
    from = null;
    pan.classList.remove('dragging');
  };
  pan.addEventListener('pointerup', release);
  pan.addEventListener('pointercancel', release);
  pan.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      pan.scrollLeft += e.deltaY + e.deltaX;
    },
    { passive: false },
  );
  const close = openShell(room.title, pan, { hint: 'drag, or ← → to look around · Esc to leave', step });
  return () => {
    cancelAnimationFrame(frame);
    close();
  };
}
