import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/assets/catalog.js';
import { referencedFiles, safePath, validatePack } from '../src/assets/pack.js';
import { AssetRegistry } from '../src/assets/registry.js';

const sample = JSON.parse(readFileSync(resolve(__dirname, '../public/packs/ember-frost/pack.json'), 'utf8'));

describe('slot catalogue', () => {
  it('has unique keys and covers every family', () => {
    const keys = catalog().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of ['hero', 'npc', 'caravan', 'item', 'prop', 'building', 'word']) expect(catalog().some((s) => s.family === f)).toBe(true);
    expect(keys).toContain('hero.t3.merchant');
    expect(keys).toContain('building.bank');
    expect(keys).toContain('word.district.temple');
  });
});

describe('pack validation (data only, nothing trusted)', () => {
  it('accepts the bundled sample pack and lists its files', () => {
    const { manifest, problems } = validatePack(sample);
    expect(problems).toEqual([]);
    expect(manifest?.id).toBe('ember-frost');
    expect(referencedFiles(manifest!)).toContain('vault.gltf');
  });

  it('rejects paths that leave the pack or name another origin', () => {
    expect(safePath('owl.svg', 'image')).toBe('owl.svg');
    expect(safePath('art/owl.png', 'image')).toBe('art/owl.png');
    for (const bad of ['../x.png', 'a/../../x.png', '/etc/x.png', 'https://evil.example/x.png', 'javascript:alert(1).png', 'data:image/png;base64,AA', 'x.js', 'x.html', 'a\\b.png', 'a//b.png']) {
      expect(safePath(bad, 'image'), bad).toBeNull();
    }
    expect(safePath('model.glb', 'model')).toBe('model.glb');
    expect(safePath('model.png', 'model')).toBeNull();
  });

  it('drops unknown slots and wrong forms, with reasons', () => {
    const { manifest, problems } = validatePack({
      ...sample,
      slots: {
        'npc.raven': { sprite: { src: 'owl.svg', ax: 10, ay: 20 } },
        'not.a.slot': { sprite: { src: 'x.png', ax: 0, ay: 0 } },
        'word.building.bank': { word: 'x'.repeat(80) },
        'item.native': { model: { src: 'coin.glb' } },
      },
    });
    expect(Object.keys(manifest!.slots)).toEqual(['npc.raven']);
    expect(problems.join(' ')).toContain('unknown slot "not.a.slot"');
    expect(problems.join(' ')).toContain('word.building.bank.word');
    expect(problems.join(' ')).toContain('item.native.model');
  });

  it('refuses a manifest without identity, or the reserved id', () => {
    expect(validatePack({ format: 'wallet-landia-pack/1', id: 'x', name: 'n', author: 'a', version: '1' }).manifest).toBeNull();
    expect(validatePack({ ...sample, id: 'default' }).manifest).toBeNull();
    expect(validatePack({ ...sample, format: 'other/1' }).manifest).toBeNull();
    expect(validatePack(null).manifest).toBeNull();
  });
});

describe('registry resolution', () => {
  const registry = (): AssetRegistry => {
    const r = new AssetRegistry();
    const { manifest } = validatePack({
      ...sample,
      slots: { ...sample.slots, 'hero.t3': { sprite: { src: 'owl.svg', ax: 1, ay: 1 } }, 'hero.t3.monk': { sprite: { src: 'sled.svg', ax: 2, ay: 2 } } },
    });
    r.add({ manifest: manifest!, source: 'bundled', files: referencedFiles(manifest!), url: (p) => `/packs/ember-frost/${p}` });
    return r;
  };

  it('uses the built-in art until the player chooses a pack', () => {
    const r = registry();
    expect(r.resolve(['building.bank'], 'model')).toBeNull();
    expect(r.word('building.bank', 'Counting House')).toBe('Counting House');
  });

  it('“use everywhere” fills every slot the pack provides, words included', () => {
    const r = registry();
    r.useEverywhere('ember-frost');
    expect(r.word('building.bank', 'Counting House')).toBe('Frost Vault');
    expect(r.word('district.temple', 'Temple Hill')).toBe('Ember Shrine Hill');
    expect(r.word('district.market', 'Market District')).toBe('Market District');
    expect(r.model(['building.bank'])?.url).toBe('/packs/ember-frost/vault.gltf');
  });

  it('resolves from specific to general, and per-slot choices win', () => {
    const r = registry();
    r.choose('hero.t3', 'ember-frost');
    expect(r.resolve(['hero.t3.monk', 'hero.t3'], 'sprite')?.key).toBe('hero.t3');
    r.choose('hero.t3.monk', 'ember-frost');
    expect(r.resolve(['hero.t3.monk', 'hero.t3'], 'sprite')?.key).toBe('hero.t3.monk');
    r.choose('hero.t3.monk', 'default');
    expect(r.resolve(['hero.t3.monk', 'hero.t3'], 'sprite')?.key).toBe('hero.t3');
  });

  it('removing a pack forgets its loadout entries', () => {
    const r = registry();
    r.useEverywhere('ember-frost');
    r.remove('ember-frost');
    expect(r.loadout).toEqual({});
    expect(r.word('building.bank', 'Counting House')).toBe('Counting House');
  });
});
