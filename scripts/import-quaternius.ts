/**
 * Turn the Quaternius CC0 downloads in assets-src/quaternius/*.zip into the
 * compact assets the medieval theme loads, in public/themes/medieval/.
 *
 *   npm run assets:quaternius
 *
 * - picks only the files we use out of each zip (no unzip tool needed);
 * - textures → WebP, base colour ≤ 1024 px, normal/roughness ≤ 512 px;
 * - the animation library keeps only the clips we play, without its mannequin;
 * - everything is written as self-contained .glb, plus a manifest the sandbox reads.
 *
 * All source assets are CC0 1.0 (see CREDITS.md written next to the output).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readZip, unzipEntry } from './lib/zip.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'assets-src/quaternius');
const OUT = join(ROOT, 'public/themes/medieval');

/** Animation clips the game plays (the library has 43). */
const CLIPS = [
  'Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Sitting_Idle_Loop', 'Interact', 'PickUp_Table', 'Fixing_Kneeling', 'Dance_Loop',
  'Sword_Idle', 'Sword_Attack', 'Spell_Simple_Shoot', 'Hit_Chest', 'Death01', 'Push_Loop',
];

/** Extract every entry under `prefix` into `dest` (flat, by file name). */
function extractDir(zipName: string, prefix: string, dest: string): string[] {
  const zip = readZip(join(SRC, zipName));
  mkdirSync(dest, { recursive: true });
  const out: string[] = [];
  for (const e of zip.entries.values()) {
    if (!e.name.startsWith(prefix) || e.name.endsWith('/')) continue;
    const rel = e.name.slice(prefix.length);
    if (rel.includes('/')) continue; // only this folder
    writeFileSync(join(dest, rel), unzipEntry(zip, e));
    out.push(rel);
  }
  if (out.length === 0) throw new Error(`nothing under "${prefix}" in ${zipName}`);
  return out;
}

// --- optimisation ------------------------------------------------------------

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/**
 * Some packs reference textures under a slightly different name than the file
 * they ship (e.g. "T_Eye_Normal_png.png" for "T_Eye_Normal.png"). Make the
 * referenced name exist before reading, so nothing silently goes untextured.
 */
function repairImageRefs(gltfPath: string, searchDirs: string[]): void {
  if (!gltfPath.endsWith('.gltf')) return;
  const json = JSON.parse(readFileSync(gltfPath, 'utf8')) as { images?: { uri?: string }[] };
  const dir = dirname(gltfPath);
  for (const img of json.images ?? []) {
    const uri = img.uri;
    if (uri === undefined || uri.startsWith('data:') || existsSync(join(dir, uri))) continue;
    const candidates = [uri, uri.replace(/_png\.png$/, '.png')];
    const found = searchDirs.flatMap((d) => candidates.map((c) => join(d, c))).find((f) => existsSync(f));
    if (!found) throw new Error(`${gltfPath}: texture "${uri}" not found`);
    copyFileSync(found, join(dir, uri));
    console.log(`  repaired texture reference ${uri} ← ${found.split('/').slice(-1)[0]}`);
  }
}

async function slimTextures(doc: Document): Promise<void> {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/, resize: [512, 512], quality: 80 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(baseColorTexture|emissiveTexture)$/, resize: [1024, 1024], quality: 85 }),
    dedup(),
    prune(),
  );
}

async function convert(src: string, dest: string, edit?: (doc: Document) => void, searchDirs: string[] = []): Promise<number> {
  repairImageRefs(src, [dirname(src), ...searchDirs]);
  const doc = await io.read(src);
  edit?.(doc);
  await slimTextures(doc);
  // Fewer keyframes (resample drops redundant ones) and compact buffers.
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  // These kits are authored for close-ups (~50k triangles a person); a town
  // seen from above needs a fraction of that. Keep silhouettes, drop density.
  if (doc.getRoot().listMeshes().length > 0) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.002 }));
  await doc.transform(resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  mkdirSync(dirname(dest), { recursive: true });
  await io.write(dest, doc);
  return statSync(dest).size;
}

const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;

async function triangles(path: string): Promise<number> {
  await MeshoptDecoder.ready;
  const doc = await io.read(path);
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  return Math.round(t);
}

async function main(): Promise<void> {
  const zips = readdirSync(SRC).filter((f) => f.endsWith('.zip'));
  const need = (start: string): string => {
    const z = zips.find((f) => f.startsWith(start));
    if (!z) throw new Error(`missing download: "${start}…" zip in assets-src/quaternius`);
    return z;
  };
  const tmp = join(tmpdir(), `quaternius-${process.pid}`);
  const manifest: Record<string, unknown> = { source: 'Quaternius (CC0 1.0)', clips: CLIPS };
  let total = 0;

  // animations: only the clips we play, no mannequin mesh
  {
    const dir = join(tmp, 'ual');
    extractDir(need('Universal Animation Library'), 'Universal Animation Library[Standard]/Unreal-Godot/', dir);
    const size = await convert(join(dir, 'UAL1_Standard.glb'), join(OUT, 'anim/ual.glb'), (doc) => {
      const root = doc.getRoot();
      for (const a of root.listAnimations()) if (!CLIPS.includes(a.getName())) a.dispose();
      for (const n of root.listNodes()) {
        n.setMesh(null);
        n.setSkin(null);
      }
    });
    console.log(`anim/ual.glb  ${kb(size)}`);
    total += size;
  }

  // base bodies (the head is cut out at runtime), hair rigged to the head bone, outfits
  const groups: [string, string, string, string[]][] = [
    ['base', 'Universal Base Characters', 'Universal Base Characters[Standard]/Base Characters/Godot - UE/', ['Superhero_Male_FullBody', 'Superhero_Female_FullBody']],
    ['hair', 'Universal Base Characters', 'Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/', ['Hair_Beard', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted', 'Eyebrows_Female', 'Eyebrows_Regular']],
    ['outfits', 'Modular Character Outfits', 'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/', ['Male_Peasant', 'Female_Peasant', 'Male_Ranger', 'Female_Ranger']],
  ];
  for (const [group, zip, prefix, names] of groups) {
    const dir = join(tmp, group);
    extractDir(need(zip), prefix, dir);
    // textures that live in sibling folders
    const extra = join(tmp, `${group}-extra`);
    if (group === 'hair') extractDir(need(zip), 'Universal Base Characters[Standard]/Hairstyles/Textures/', dir);
    if (group === 'base') {
      extractDir(need(zip), 'Universal Base Characters[Standard]/Base Characters/Textures/', extra);
      extractDir(need(zip), 'Universal Base Characters[Standard]/Base Characters/Textures/Normals Unity - Godot/', join(extra, 'normals'));
    }
    manifest[group] = names;
    for (const name of names) {
      const size = await convert(join(dir, `${name}.gltf`), join(OUT, `${group}/${name}.glb`), undefined, [extra, join(extra, 'normals')]);
      console.log(`${group}/${name}.glb  ${kb(size)}  ${(await triangles(join(OUT, `${group}/${name}.glb`))).toLocaleString('en-US')} triangles`);
      total += size;
    }
  }

  // the horse (FBX only in this pack; loaded with FBXLoader)
  {
    const zip = readZip(join(SRC, need('Farm Animals')));
    const e = [...zip.entries.values()].find((x) => x.name.endsWith('FBX/Horse.fbx'));
    if (!e) throw new Error('Horse.fbx not found');
    const buf = unzipEntry(zip, e);
    mkdirSync(join(OUT, 'animals'), { recursive: true });
    writeFileSync(join(OUT, 'animals/Horse.fbx'), buf);
    manifest.animals = ['Horse'];
    console.log(`animals/Horse.fbx  ${kb(buf.length)}`);
    total += buf.length;
  }

  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(OUT, 'CREDITS.md'),
    `# Medieval theme assets\n\nModels and animations by **Quaternius** (https://quaternius.com), released under **CC0 1.0** (public domain).\n\n- Universal Animation Library (Standard): a subset of clips, no mannequin\n- Universal Base Characters (Standard): Superhero male/female bodies (head used), hairstyles rigged to the head bone\n- Modular Character Outfits – Fantasy (Standard): Peasant and Ranger, male and female\n- Farm Animals Animated: Horse\n\nConverted by \`scripts/import-quaternius.ts\` (textures → WebP, ≤ 1024 px).\n`,
  );
  console.log(`\ntotal ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
