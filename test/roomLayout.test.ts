import { describe, expect, it } from 'vitest';
import type { Item, Stash, StashEntry } from '../src/domain/model.js';
import { roomFor, type RoomSource } from '../src/world/roomLayout.js';

const token = (symbol: string, usd: number, id = symbol): Item =>
  ({ id, chainId: 'ethereum', name: symbol, symbol, category: 'token', quantity: 2, usd, tier: 1, iconUrl: null }) as unknown as Item;
const nft = (name: string, i: number): Item =>
  ({ id: `n${i}`, chainId: 'ethereum', name, symbol: 'COL', category: 'nft', quantity: 1, usd: null, tier: 1, iconUrl: null }) as unknown as Item;
const entry = (kind: StashEntry['kind'], usd: number): StashEntry => ({ name: '', symbol: 'X', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });
const stash = (protocolId: string, netUsd: number, entries: StashEntry[], extra: Partial<Stash> = {}): Stash =>
  ({ protocolId, entries, netUsd, grossUsd: Math.abs(netUsd), tier: 1, hasRewards: false, hasDebt: false, ...extra }) as Stash;
const src = (over: Partial<RoomSource> = {}): RoomSource => ({ kind: 'home', title: "Ada's home", tokens: [], nfts: [], positions: [], ...over });

describe('a house\'s room', () => {
  it('an empty house is an empty room', () => {
    const r = roomFor(src());
    expect(r.empty).toBe(true);
    expect(r.objects).toEqual([]);
  });

  it('the biggest tokens sit on the table, ETH as coins and the rest as sacks; the others go in a pouch', () => {
    const tokens = [token('USDC', 100), token('ETH', 900), token('PEPE', 5), token('AAVE', 50), token('LINK', 20), token('UNI', 10)];
    const r = roomFor(src({ tokens }));
    const table = r.objects.filter((o) => o.zone === 'table' && o.kind !== 'pouch');
    expect(table.map((o) => o.label.split(':')[0])).toEqual(['ETH', 'USDC', 'AAVE', 'LINK']);
    expect(table[0]!.kind).toBe('coins');
    expect(table[1]!.kind).toBe('sack');
    const pouch = r.objects.find((o) => o.kind === 'pouch')!;
    expect(pouch.label).toBe('2 small holdings');
    expect(r.moreTokens).toBe(2);
  });

  it('the largest holding is the full size, the smallest still visible', () => {
    const r = roomFor(src({ tokens: [token('ETH', 1000), token('USDC', 1)] }));
    const sizes = r.objects.filter((o) => o.kind !== 'pouch').map((o) => o.size);
    expect(Math.max(...sizes)).toBe(1);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.3);
  });

  it('pictures hang on the wall, up to eight, and the rest are counted', () => {
    const nfts = Array.from({ length: 10 }, (_, i) => nft(`Pic ${i}`, i));
    const r = roomFor(src({ nfts }));
    const pictures = r.objects.filter((o) => o.kind === 'picture');
    expect(pictures).toHaveLength(8);
    expect(pictures.every((o) => o.zone === 'wall')).toBe(true);
    expect(pictures.every((o) => o.image === undefined)).toBe(true);
    expect(r.morePictures).toBe(2);
  });

  it('a loan is the Banker\'s Scale on the counter, with its health in words', () => {
    const loan = stash('aave', 200, [entry('deposit', 1000), entry('loan', -500)], { hasDebt: true });
    const r = roomFor(src({ kind: 'protocol', title: 'Aave', positions: [{ owner: 'Ada', stash: loan }] }));
    const scale = r.objects.find((o) => o.kind === 'scale')!;
    expect(scale.zone).toBe('counter');
    expect(scale.label).toContain("Ada's loan");
    expect(scale.label).toMatch(/health ≈/);
    expect(scale.tone).toBeDefined();
  });

  it('other positions are chests on the floor at the front; rewards to claim are harvest piles by the door', () => {
    const earning = stash('lido', 300, [entry('staked', 300)], { hasRewards: true });
    const r = roomFor(src({ kind: 'protocol', title: 'Lido', positions: [{ owner: 'Bo', stash: earning }] }));
    expect(r.objects.find((o) => o.kind === 'chest')!.zone).toBe('floor');
    const harvest = r.objects.find((o) => o.kind === 'harvest')!;
    expect(harvest.zone).toBe('door');
    expect(harvest.label).toContain('rewards to claim');
  });

  it('every place is inside the room box', () => {
    const tokens = Array.from({ length: 9 }, (_, i) => token(`T${i}`, 10 + i, `t${i}`));
    const nfts = Array.from({ length: 9 }, (_, i) => nft(`P${i}`, i));
    const positions = Array.from({ length: 6 }, (_, i) => ({ owner: `H${i}`, stash: stash('p', 100 + i, [entry('deposit', 100)], { hasRewards: i % 2 === 0 }) }));
    const r = roomFor(src({ tokens, nfts, positions }));
    for (const o of r.objects) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(1);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(1);
    }
  });

  it('a sleeper\'s bench makes the home a room with something in it', () => {
    const r = roomFor(src({ cls: 'sleeper' }));
    expect(r.empty).toBe(false);
    expect(r.objects.map((o) => o.kind)).toEqual(['bench']);
  });

  it('the same holdings always lay out the same way', () => {
    const input = src({ tokens: [token('ETH', 5), token('USDC', 9)], nfts: [nft('A', 1)] });
    expect(roomFor(input)).toEqual(roomFor(input));
  });
});
