import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ASSETS, BRAND_COLORS, SIGNATURE_PROTOCOLS, brandColor, TIER_COLORS, assetFolder, assetPath, findAsset, protocolFamily, tierColor, tierFallbacks } from '../src/castle/assets/manifest.js';
import { filterAssets, groupsOf, summarize } from '../src/castle/assets/filter.js';
import { buildStandin } from '../src/castle/assets/standin.js';

describe('castle asset manifest', () => {
  it('names are unique and every name starts with a known group', () => {
    const names = ASSETS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    const groups = new Set(['castle', 'moat', 'bridge', 'town', 'path', 'building', 'courier', 'person', 'fx', 'ui', 'badge', 'rank', 'scenery', 'prop', 'animal', 'app']);
    for (const n of names) expect(groups.has(assetFolder(n)), n).toBe(true);
  });

  it('every model has a standin and a file under models/<group>/', () => {
    for (const a of ASSETS.filter((x) => x.kind === 'model')) {
      expect(a.standin.shape).toBeTruthy();
      expect(assetPath(a).startsWith(`models/${assetFolder(a.name)}/`), a.name).toBe(true);
      expect(assetPath(a).endsWith('.glb')).toBe(true);
    }
  });

  it('file paths follow the spec rule: first word is the folder, the rest is the file', () => {
    expect(assetPath({ name: 'castle.keep.t0', kind: 'model' })).toBe('models/castle/keep.t0.glb');
    expect(assetPath({ name: 'building.category.lending.t0', kind: 'model' })).toBe('models/building/category.lending.t0.glb');
    expect(assetPath({ name: 'path.tile.straight', kind: 'model' })).toBe('models/path/tile.straight.glb');
    expect(assetPath({ name: 'ui.icon.bell', kind: 'art' })).toBe('art/ui/icon.bell.svg');
    expect(assetPath({ name: 'badge.first-steps', kind: 'art' })).toBe('art/badge/first-steps.svg');
    expect(assetPath({ name: 'rank.knight', kind: 'art' })).toBe('art/rank/knight.svg');
    expect(assetPath({ name: 'fx.dust', kind: 'fx' })).toBe('art/fx/dust.png');
  });

  it('the spec’s required items are there: keep tiers 0, 3 and 6, the drawbridge clips, the courier clips', () => {
    for (const t of [0, 3, 6]) expect(findAsset(`castle.keep.t${t}`)?.required).toBe(true);
    expect(findAsset('bridge.drawbridge')?.clips).toEqual(['lower', 'raise']);
    expect(findAsset('bridge.drawbridge')?.attach).toEqual(['hinge']);
    expect(findAsset('courier.base')?.clips).toEqual(['idle', 'walk', 'hand-over', 'toll']);
    expect(findAsset('castle.tollbooth.barrier')?.clips).toEqual(['lift', 'drop']);
    expect(findAsset('town.tower.bell')?.clips).toEqual(['ring']);
    expect(findAsset('person.npc.base')?.clips).toEqual(['idle', 'emerge', 'receive', 'return']);
  });

  it('the castle, tollbooth and buildings have the spec’s attach points', () => {
    expect(findAsset('building.category.dex.t3')?.attach).toEqual(['door', 'sign']);
    expect(findAsset('castle.tollbooth')?.attach).toEqual(['sign']);
  });

  it('the six wings, six ranks and 27 badges (22 medals plus five proposed) are all listed', () => {
    expect(ASSETS.filter((a) => a.name.startsWith('castle.wing.'))).toHaveLength(6);
    expect(ASSETS.filter((a) => a.name.startsWith('rank.'))).toHaveLength(6);
    expect(ASSETS.filter((a) => a.name.startsWith('badge.'))).toHaveLength(27);
    expect(ASSETS.filter((a) => a.name.startsWith('ui.icon.'))).toHaveLength(9);
  });

  it('the building kit has the seven categories at tiers 0 and 3 required', () => {
    for (const cat of ['lending', 'dex', 'staking', 'nft', 'governance', 'bridge', 'other']) {
      for (const t of [0, 3]) expect(findAsset(`building.category.${cat}.t${t}`)?.required, `${cat} t${t}`).toBe(true);
    }
  });

  it('a missing tier falls back to the nearest tier, lower first at equal distance', () => {
    expect(tierFallbacks('castle.keep.t2').slice(0, 4)).toEqual(['castle.keep.t2', 'castle.keep.t1', 'castle.keep.t3', 'castle.keep.t0']);
    expect(tierFallbacks('castle.keep.t6')).toEqual(['castle.keep.t6', 'castle.keep.t5', 'castle.keep.t4', 'castle.keep.t3', 'castle.keep.t2', 'castle.keep.t1', 'castle.keep.t0']);
    expect(tierFallbacks('castle.gatehouse')).toEqual(['castle.gatehouse']);
  });

  it('protocol families drop the version and follow aliases, so one signature building serves every version', () => {
    expect(protocolFamily('aave-v3')).toBe('aave');
    expect(protocolFamily('aave-v2')).toBe('aave');
    expect(protocolFamily('uniswap-v4')).toBe('uniswap');
    expect(protocolFamily('seaport')).toBe('opensea');
    expect(protocolFamily('rocket-pool')).toBe('rocket-pool');
    for (const id of Object.keys(SIGNATURE_PROTOCOLS)) expect(findAsset(`building.protocol.${id}`)?.attach).toEqual(['door', 'sign']);
  });

  it('every signature protocol has a brand colour, found by any version of its id', () => {
    for (const id of Object.keys(SIGNATURE_PROTOCOLS)) expect(BRAND_COLORS[id], id).toMatch(/^#[0-9a-f]{6}$/);
    expect(brandColor('uniswap-v4')).toBe('#ff007a');
    expect(brandColor('seaport')).toBe(BRAND_COLORS.opensea);
    expect(brandColor('some-new-protocol')).toBeNull();
  });

  it('tier colours clamp to the seven tiers', () => {
    expect(TIER_COLORS).toHaveLength(7);
    expect(tierColor(-1)).toBe(TIER_COLORS[0]);
    expect(tierColor(99)).toBe(TIER_COLORS[6]);
    expect(tierColor(6)).toBe('#c9a24a');
  });

  it('the groups list each folder once', () => {
    const g = groupsOf(ASSETS);
    expect(new Set(g).size).toBe(g.length);
    expect(g).toContain('castle');
    expect(g).toContain('badge');
  });
});

describe('gallery filters', () => {
  const ready = new Set(['castle.keep.t0', 'rank.knight']);
  it('filters by group, requirement and readiness', () => {
    expect(filterAssets(ASSETS, { group: 'rank', filter: 'all', ready })).toHaveLength(6);
    expect(filterAssets(ASSETS, { group: 'all', filter: 'ready', ready })).toHaveLength(2);
    expect(filterAssets(ASSETS, { group: 'all', filter: 'standin', ready })).toHaveLength(ASSETS.length - 2);
    const req = filterAssets(ASSETS, { group: 'all', filter: 'required', ready });
    expect(req.every((a) => a.required)).toBe(true);
  });

  it('summarises the handoff progress', () => {
    const s = summarize(ASSETS, ready);
    expect(s.total).toBe(ASSETS.length);
    expect(s.ready).toBe(2);
    expect(s.requiredReady).toBe(2);
    expect(s.required).toBe(ASSETS.filter((a) => a.required).length);
  });
});

describe('standins', () => {
  it('match their spec size, with the origin on the ground at the footprint centre', () => {
    const spec = findAsset('castle.keep.t3')!;
    const obj = buildStandin(spec);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(spec.size[0], 3);
    expect(size.z).toBeCloseTo(spec.size[1], 3);
    expect(size.y).toBeCloseTo(spec.size[2], 3);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 3);
  });

  it('the drawbridge deck runs from its hinge (z = 0) towards the town, like the model', () => {
    const obj = buildStandin(findAsset('bridge.drawbridge')!);
    const box = new THREE.Box3().setFromObject(obj);
    expect(box.min.z).toBeCloseTo(0, 3);
    expect(box.max.z).toBeCloseTo(2, 3);
    expect(box.max.x - box.min.x).toBeCloseTo(3, 3);
  });

  it('every standin builds without error', () => {
    for (const a of ASSETS) {
      const obj = buildStandin(a);
      expect(obj.children.length, a.name).toBe(1);
    }
  });
});
