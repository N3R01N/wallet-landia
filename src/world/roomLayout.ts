/**
 * Where things stand in a house's room (the cutaway, step 1): a pure layout
 * from what the house holds to a list of objects with places in a 0–1 room
 * box. No drawing and no randomness, so the same holdings always lay out the
 * same way. Each object names what it is in plain words, for its hover text.
 */

import type { HeroClass, Item, Stash } from '../domain/model.js';
import { loanHealth, type LoanLevel } from '../domain/risk.js';

export type RoomObjectKind = 'coins' | 'sack' | 'pouch' | 'picture' | 'scale' | 'chest' | 'harvest' | 'ledger' | 'lute' | 'bench';
export type RoomZone = 'wall' | 'shelf' | 'table' | 'floor' | 'counter' | 'door';

export interface RoomObject {
  id: string;
  kind: RoomObjectKind;
  zone: RoomZone;
  /** Place in the room box, 0 (left, top) to 1 (right, bottom). */
  x: number;
  y: number;
  /** How big the thing is: 0 (a little) to 1 (the most in this room). */
  size: number;
  /** What it is, in plain words (the hover text's first line). */
  label: string;
  /** The USD value it stands for, when it has one. */
  usd: number | null;
  /** A loan's health level (the scale tips with it). */
  tone?: LoanLevel;
  /** A picture's image address (https), when it has one. */
  image?: string;
}

export interface RoomSource {
  kind: 'home' | 'protocol';
  /** A hero's class: a home gets the props of its class (the world bible's props). */
  cls?: HeroClass;
  /** The house's name: the hero's home, or the protocol. */
  title: string;
  tokens: Item[];
  nfts: Item[];
  /** Protocol positions held here, with whose they are. */
  positions: { owner: string; stash: Stash }[];
}

export interface Room {
  title: string;
  /** Nothing at all is held here: the room shows its empty state. */
  empty: boolean;
  objects: RoomObject[];
  /** Pictures that did not fit on the wall. */
  morePictures: number;
  /** Tokens that did not fit on the table, folded into the pouch (also in `objects`). */
  moreTokens: number;
}

/** Where the things go, in room coordinates (0–1). */
const TABLE_X = [0.2, 0.4, 0.6, 0.8];
const WALL_PICTURES = 8;
const PICTURE_X = (i: number): number => 0.1 + i * 0.11;
const FRONT_X = [0.25, 0.42, 0.6, 0.76];
const DOOR_X = 0.9;

/** A size from a value, relative to the largest in the room (never below a visible minimum). */
function sizeOf(usd: number, most: number): number {
  if (most <= 0) return 0.3;
  return Math.min(1, Math.max(0.3, Math.abs(usd) / most));
}

export function roomFor(src: RoomSource): Room {
  const objects: RoomObject[] = [];
  const tokens = [...src.tokens].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const nfts = [...src.nfts];
  const positions = [...src.positions].sort((a, b) => Math.abs(b.stash.netUsd) - Math.abs(a.stash.netUsd));
  const empty = tokens.length === 0 && nfts.length === 0 && positions.length === 0;

  // tokens: the biggest on the table (ETH and its wrapper as coins, the rest as sacks); the rest in a pouch
  const top = tokens.slice(0, TABLE_X.length);
  const most = Math.max(0, ...top.map((t) => t.usd ?? 0));
  top.forEach((t, i) => {
    objects.push({
      id: `token:${t.chainId}:${t.id}`,
      kind: t.symbol === 'ETH' || t.symbol === 'WETH' ? 'coins' : 'sack',
      zone: 'table',
      x: TABLE_X[i]!,
      y: 0.7,
      size: sizeOf(t.usd ?? 0, most),
      label: `${t.symbol}: ${t.quantity.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`,
      usd: t.usd,
    });
  });
  const rest = tokens.slice(TABLE_X.length);
  if (rest.length > 0) {
    const usd = rest.reduce((s, t) => s + (t.usd ?? 0), 0);
    objects.push({ id: 'pouch', kind: 'pouch', zone: 'table', x: 0.92, y: 0.7, size: sizeOf(usd, most), label: `${rest.length} small holdings`, usd });
  }

  // NFTs: framed pictures on the wall, as many as fit
  const shown = nfts.slice(0, WALL_PICTURES);
  shown.forEach((n, i) => {
    objects.push({
      id: `nft:${n.chainId}:${n.id}`,
      kind: 'picture',
      zone: 'wall',
      x: PICTURE_X(i),
      y: 0.6,
      size: 1,
      label: n.name || n.symbol,
      usd: n.usd,
      ...(n.iconUrl ? { image: n.iconUrl } : {}),
    });
  });

  // positions: a loan is the Banker's Scale on the counter; anything else a chest on the shelf
  const positionMost = Math.max(0, ...positions.map((p) => Math.abs(p.stash.netUsd)));
  let front = 0;
  let door = 0;
  for (const p of positions) {
    const loan = loanHealth(p.stash);
    if (loan !== null) {
      objects.push({
        id: `scale:${p.stash.protocolId}:${p.owner}`,
        kind: 'scale',
        zone: 'counter',
        x: 0.5,
        y: 0.55,
        size: 1,
        label: `${p.owner}'s loan, health ≈ ${loan.health >= 10 ? '10+' : loan.health.toFixed(2)} (${loan.level})`,
        usd: p.stash.netUsd,
        tone: loan.level,
      });
    } else {
      objects.push({
        id: `chest:${p.stash.protocolId}:${p.owner}`,
        kind: 'chest',
        zone: 'floor',
        x: FRONT_X[front++ % FRONT_X.length]!,
        y: 0.92,
        size: sizeOf(p.stash.netUsd, positionMost),
        label: `${p.owner}'s position`,
        usd: p.stash.netUsd,
      });
    }
    // rewards waiting to be claimed: a harvest pile by the door
    if (p.stash.hasRewards && door < 3) {
      objects.push({ id: `harvest:${p.stash.protocolId}:${p.owner}`, kind: 'harvest', zone: 'door', x: DOOR_X, y: 0.85 - door * 0.12, size: 0.5, label: `${p.owner}'s rewards to claim`, usd: null });
      door++;
    }
  }

  // a hero's class brings its props into the home: a merchant's ledger, a bard's lute, a sleeper's bench
  if (src.kind === 'home' && src.cls !== undefined) {
    if (src.cls === 'merchant') objects.push({ id: 'prop:ledger', kind: 'ledger', zone: 'counter', x: 0.75, y: 0.55, size: 0.6, label: 'the merchant\'s ledger', usd: null });
    if (src.cls === 'bard') objects.push({ id: 'prop:lute', kind: 'lute', zone: 'wall', x: 0.92, y: 0.6, size: 0.7, label: 'a lute on the wall', usd: null });
    if (src.cls === 'sleeper') objects.push({ id: 'prop:bench', kind: 'bench', zone: 'floor', x: 0.12, y: 0.8, size: 0.8, label: 'a bench, cobwebs and all', usd: null });
  }

  return {
    title: src.title,
    // (a room with only a prop in it is not empty)
    empty: objects.length === 0 && empty,
    objects,
    morePictures: Math.max(0, nfts.length - WALL_PICTURES),
    moreTokens: Math.max(0, rest.length),
  };
}
