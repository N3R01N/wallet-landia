import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import type { Item, Stash, StashEntry } from '../src/domain/model.js';
import { MaterialLibrary } from '../src/render/three/grammar/materials.js';
import { buildRoom3d, ROOM3D } from '../src/render/three/room3d.js';
import { roomFor, type RoomSource } from '../src/world/roomLayout.js';

const token = (symbol: string, usd: number, id = symbol): Item =>
  ({ id, chainId: 'ethereum', name: symbol, symbol, category: 'token', quantity: 2, usd, tier: 1, iconUrl: null }) as unknown as Item;
const nft = (name: string, i: number): Item =>
  ({ id: `n${i}`, chainId: 'ethereum', name, symbol: 'COL', category: 'nft', quantity: 1, usd: null, tier: 1, iconUrl: 'https://example.com/p.png' }) as unknown as Item;
const entry = (kind: StashEntry['kind'], usd: number): StashEntry => ({ name: '', symbol: 'X', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });
const stash = (protocolId: string, netUsd: number, entries: StashEntry[]): Stash =>
  ({ protocolId, entries, netUsd, grossUsd: Math.abs(netUsd), tier: 1, hasRewards: false, hasDebt: false }) as Stash;
const src = (over: Partial<RoomSource> = {}): RoomSource => ({ kind: 'home', title: 'x', tokens: [], nfts: [], positions: [], ...over });

// (the writer merges parts per material, so count the vertices they make)
const vertices = (g: THREE.Group): number => {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n += (o as THREE.Mesh).geometry.getAttribute('position').count;
  });
  return n;
};

describe('the 3D room', () => {
  it('an empty room is the shell alone; holdings add pieces to it', () => {
    const lib = new MaterialLibrary({});
    const empty = vertices(buildRoom3d(roomFor(src()), lib).group);
    const full = vertices(
      buildRoom3d(
        roomFor(src({ tokens: [token('ETH', 900), token('USDC', 100)], nfts: [nft('A', 1), nft('B', 2)], positions: [{ owner: 'Ada', stash: stash('aave', -300, [entry('loan', -300)]) }] })),
        lib,
      ).group,
    );
    expect(empty).toBeGreaterThan(500);
    expect(full).toBeGreaterThan(empty);
  });

  it('the room is built to its stated size, with the camera inside it', () => {
    expect(ROOM3D.w).toBe(6);
    expect(ROOM3D.d).toBe(5);
    expect(ROOM3D.h).toBeGreaterThan(3);
  });
});
