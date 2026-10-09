import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addDressWeights, dressFor, wardrobeGear } from '../src/render/three/wardrobe.js';
import { validateTheme } from '../src/assets/theme.js';
import { bornCrest, hslHex } from '../src/util/rng.js';

const look = (over: Partial<Parameters<typeof dressFor>[0]> = {}) => ({ id: 'a', kind: 'hero' as const, cls: 'paladin' as const, tier: 0 as const, crest: '#3366cc', seed: 7, ...over });

describe('clothes made in code', () => {
  it('sorts each vertex into skin, top, forearm, hips, shins or feet by the bones that move it', () => {
    const names = ['Head', 'spine_03', 'lowerarm_l', 'thigh_l', 'calf_l', 'foot_l', 'hand_l'];
    const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
    const geo = new THREE.BufferGeometry();
    // one vertex per bone, fully weighted to it
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(names.flatMap((_, i) => [i, 0, 0, 0]), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(names.flatMap(() => [1, 0, 0, 0]), 4));
    addDressWeights(geo, bones);
    const a = geo.getAttribute('dressA');
    const b = geo.getAttribute('dressB');
    const at = (v: number) => [a.getX(v), a.getY(v), a.getZ(v), a.getW(v), b.getX(v)];
    expect(at(0)).toEqual([0, 0, 0, 0, 0]); // head: skin
    expect(at(1)).toEqual([1, 0, 0, 0, 0]); // torso: top
    expect(at(2)).toEqual([0, 1, 0, 0, 0]); // forearm
    expect(at(3)).toEqual([0, 0, 1, 0, 0]); // thigh: hips
    expect(at(4)).toEqual([0, 0, 0, 1, 0]); // calf: shins
    expect(at(5)).toEqual([0, 0, 0, 0, 1]); // foot
    expect(at(6)).toEqual([0, 0, 0, 0, 0]); // hand: skin
  });

  it('dresses a person the same way every time; heroes by class and crest', () => {
    expect(dressFor(look(), 'modern')).toEqual(dressFor(look(), 'modern'));
    expect(dressFor(look(), 'modern').top).toBe('#3366cc'); // a modern hero wears their crest
    const suit = dressFor(look(), 'scifi');
    expect(suit.trim).toBe('#3366cc'); // a sci-fi hero's seams glow in it
    expect(suit.glow).toBeGreaterThan(0);
    expect(dressFor(look({ cls: 'monk' }), 'scifi').top).not.toBe(suit.top); // callings have their colours
  });

  it('gives accessories on the bones of the universal skeleton', () => {
    const bones = new Set(['Head', 'spine_03', 'hand_r', 'lowerarm_l', 'upperarm_l', 'upperarm_r', 'pelvis']);
    for (const cls of ['paladin', 'monk', 'merchant', 'ranger', 'bard', 'adventurer', 'sleeper'] as const) {
      for (const w of ['modern', 'scifi'] as const) for (const g of wardrobeGear(look({ cls }), w)) expect(bones.has(g.bone)).toBe(true);
    }
    expect(wardrobeGear(look(), 'scifi').some((g) => g.bone === 'Head')).toBe(true); // the visor
  });

  it('is chosen by a theme (modern or scifi only)', () => {
    const problems: string[] = [];
    const spec = validateTheme({ extends: 'medieval', materials: {}, characters: { wardrobe: 'scifi', mounts: {} } }, problems)!;
    expect(spec.charactersPatch?.wardrobe).toBe('scifi');
    const bad: string[] = [];
    validateTheme({ extends: 'medieval', materials: {}, characters: { wardrobe: 'gothic', mounts: {} } }, bad);
    expect(bad.join(' ')).toContain('wardrobe');
  });
});

describe('crest colours', () => {
  it('are hex, which every renderer reads (hsl() with spaces fell back to white in 3D)', () => {
    for (const c of bornCrest('0xabc')) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(hslHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslHex(120, 1, 0.25)).toBe('#008000');
  });
});
