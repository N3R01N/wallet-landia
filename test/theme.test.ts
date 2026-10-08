import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { referencedFiles, validatePack } from '../src/assets/pack.js';
import { mergeTheme, resolveTheme, resolveUses, themeFiles, validateTheme } from '../src/assets/theme.js';
import { linkBundles, rawBundle } from '../src/assets/themeBundles.js';

const dir = (id: string): string => resolve(__dirname, `../public/themes/${id}`);
const read = (id: string): unknown => JSON.parse(readFileSync(`${dir(id)}/pack.json`, 'utf8'));

describe('theme bundles (pack format 2)', () => {
  it('the medieval bundle validates cleanly and every file it names is there', () => {
    const { manifest, problems } = validatePack(read('medieval'));
    expect(problems).toEqual([]);
    expect(manifest?.theme?.characters?.mounts.t3?.model).toBe('animals/Horse.fbx');
    const files = referencedFiles(manifest!);
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) expect(existsSync(`${dir('medieval')}/${f}`), f).toBe(true);
  });

  it('every bundled theme validates and its files are there', () => {
    const ids = JSON.parse(readFileSync(resolve(__dirname, '../public/themes/index.json'), 'utf8')) as string[];
    expect(ids).toEqual(expect.arrayContaining(['medieval', 'highland', 'modern', 'scifi']));
    for (const id of ids) {
      const { manifest, problems } = validatePack(read(id));
      expect(problems, id).toEqual([]);
      for (const f of referencedFiles(manifest!)) expect(existsSync(`${dir(id)}/${f}`), `${id}: ${f}`).toBe(true);
    }
  });

  it('modern and sci-fi build on medieval: their own styles, vehicles as mounts, the parent\'s people', () => {
    const ids = ['medieval', 'modern', 'scifi'];
    const raws = ids.map((id) => rawBundle(validatePack(read(id)).manifest!, (p) => `/themes/${id}/${p}`, 'bundled')!);
    const [, modern, scifi] = linkBundles(raws);
    for (const b of [modern!, scifi!]) {
      expect(b.problems).toEqual([]);
      expect(b.spec.characters?.bodies.male).toBe('/themes/medieval/base/Superhero_Male_FullBody.glb');
      expect(b.spec.characters?.outfits.default).toBeDefined();
    }
    expect(modern!.spec.buildings?.style).toBe('modern');
    expect(modern!.spec.characters?.mounts.t4?.vehicle).toBe('motorbike');
    expect(modern!.spec.materials.asphalt?.color).toBe('/themes/modern/materials/asphalt/color.webp');
    expect(modern!.spec.materials.grass?.color).toBe('/themes/medieval/materials/grass/color.webp');
    expect(scifi!.spec.surroundings?.lamps).toBe('beacon');
    expect(scifi!.spec.characters?.mounts.t6?.vehicle).toBe('starship');
  });

  it('a character patch needs parent characters', () => {
    const problems: string[] = [];
    const spec = validateTheme({ extends: 'nowhere', materials: {}, characters: { mounts: { t3: { vehicle: 'hoverbike' } } } }, problems)!;
    expect(spec.characters).toBeUndefined();
    expect(spec.charactersPatch?.mounts?.t3?.vehicle).toBe('hoverbike');
    const [b] = linkBundles([rawBundle(validatePack({ format: 'wallet-landia-pack/2', id: 'lone', name: 'L', author: 'a', version: '1', theme: { materials: {} } }).manifest!, (p) => p, 'imported')!].map((r) => ({ ...r, resolved: { ...spec, extends: undefined as unknown as string } })));
    expect(b!.problems.join(' ')).toContain('no parent characters');
    expect(validateTheme({ materials: {}, characters: { mounts: { t3: { vehicle: 'tank' } } } }, []).characters).toBeUndefined();
  });

  it('the bundle index lists folders that exist', () => {
    const ids = JSON.parse(readFileSync(resolve(__dirname, '../public/themes/index.json'), 'utf8')) as string[];
    for (const id of ids) expect(validatePack(read(id)).manifest?.id).toBe(id);
  });

  it('a variant extends its parent: inherits characters, retints, and `use` swaps textures', () => {
    const raws = ['medieval', 'highland'].map((id) => rawBundle(validatePack(read(id)).manifest!, (p) => `/themes/${id}/${p}`, 'bundled')!);
    const [medieval, highland] = linkBundles(raws);
    expect(highland!.problems).toEqual([]);
    const h = highland!.spec;
    expect(h.extends).toBeUndefined();
    expect(h.sky).toBe('overcast');
    expect(h.characters?.bodies.male).toBe('/themes/medieval/base/Superhero_Male_FullBody.glb');
    // plaster uses stone's files and size, with its own tint
    expect(h.materials.plaster?.color).toBe('/themes/medieval/materials/stone/color.webp');
    expect(h.materials.plaster?.size).toBe(medieval!.spec.materials.stone?.size);
    expect(h.materials.plaster?.tint).toBe('#d8d4cc');
    // a tint-only override keeps the parent's files
    expect(h.materials.thatch?.color).toBe('/themes/medieval/materials/thatch/color.webp');
    expect(h.materials.thatch?.tint).toBe('#a89880');
    expect(h.surroundings?.relief).toBe(1.7);
    expect(h.surroundings?.lamps).toBe('lantern'); // inherited field
  });

  it('reports a missing parent and a loop instead of failing', () => {
    const mk = (id: string, parent: string) => rawBundle(validatePack({ format: 'wallet-landia-pack/2', id, name: id, author: 'a', version: '1', theme: { extends: parent, materials: {} } }).manifest!, (p) => p, 'imported')!;
    const [a, b, c] = linkBundles([mk('aa', 'bb'), mk('bb', 'aa'), mk('cc', 'nowhere')]);
    expect(a!.problems.join(' ') + b!.problems.join(' ')).toContain('loop');
    expect(c!.problems.join(' ')).toContain('no such theme');
  });
});

describe('theme validation (data only, nothing trusted)', () => {
  it('drops paths that leave the pack, unknown roles, bad colours and unknown fields', () => {
    const problems: string[] = [];
    const spec = validateTheme(
      {
        materials: {
          stone: { color: '../../etc/x.webp', normal: 'https://evil.example/n.webp', size: 1.2, tint: 'red' },
          lava: { color: 'lava.webp' },
          plaster: { color: 'p.webp', size: 9999 },
        },
        weather: 'rain',
      },
      problems,
    )!;
    expect(spec.materials.stone).toEqual({ size: 1.2 });
    expect(spec.materials.plaster).toEqual({ color: 'p.webp' });
    expect(Object.keys(spec.materials)).not.toContain('lava');
    const all = problems.join(' | ');
    expect(all).toContain('theme.materials.stone.color');
    expect(all).toContain('theme.materials.stone.normal');
    expect(all).toContain('tint');
    expect(all).toContain('lava');
    expect(all).toContain('theme.weather');
  });

  it('characters need the universal skeleton, animations, bodies and clips', () => {
    const problems: string[] = [];
    const spec = validateTheme({ materials: {}, characters: { skeleton: 'mixamo', animations: 'a.glb' } }, problems)!;
    expect(spec.characters).toBeUndefined();
    expect(problems.join(' ')).toContain('ue5-universal');
  });

  it('mounts may be FBX, other models may not', () => {
    const problems: string[] = [];
    const base = { skeleton: 'ue5-universal', animations: 'a.glb', clips: { idle: 'I', walk: 'W', run: 'R', sit: 'S' }, bodies: { male: 'm.glb', female: 'f.glb' } };
    const spec = validateTheme({ materials: {}, characters: { ...base, mounts: { t3: { model: 'h.fbx', height: 2, clips: { idle: 'Idle' } } }, hair: { male: ['x.fbx'] } } }, problems)!;
    expect(spec.characters?.mounts.t3?.model).toBe('h.fbx');
    expect(spec.characters?.mounts.t3?.clips.idle).toEqual(['Idle']);
    expect(spec.characters?.hair.male).toEqual([]);
    expect(problems.join(' ')).toContain('hair.male[0]');
  });

  it('a theme block needs format 2; format 1 packs still load without it', () => {
    const { manifest, problems } = validatePack({ format: 'wallet-landia-pack/1', id: 'old', name: 'Old', author: 'a', version: '1', theme: { materials: {} } });
    expect(manifest?.theme).toBeUndefined();
    expect(problems.join(' ')).toContain('format');
  });

  it('resolving turns every path into a URL and notes FBX mounts', () => {
    const { manifest } = validatePack(read('medieval'));
    const spec = resolveTheme(manifest!.theme!, (p) => `blob:${p}`);
    expect(themeFiles(spec).every((u) => u.startsWith('blob:'))).toBe(true);
    expect(spec.characters?.mounts.t2?.format).toBe('fbx');
    // the manifest itself is untouched
    expect(manifest!.theme!.materials.stone?.color).toBe('materials/stone/color.webp');
  });

  it('merging overrides field by field', () => {
    const parent = { materials: { stone: { color: 's.webp', size: 1 } }, surroundings: { style: 'medieval' as const, relief: 1, woods: 1 } };
    const child = { materials: { stone: { tint: '#808080' } }, surroundings: { style: 'medieval' as const, relief: 2 } };
    const m = mergeTheme(parent, child);
    expect(m.materials.stone).toEqual({ color: 's.webp', size: 1, tint: '#808080' });
    expect(m.surroundings).toEqual({ style: 'medieval', relief: 2, woods: 1 });
    expect(resolveUses({ stone: { color: 's.webp', size: 1 }, plaster: { use: 'stone', tint: '#ffffff', size: 5 } }).plaster).toEqual({ color: 's.webp', size: 1, tint: '#ffffff' });
  });
});
