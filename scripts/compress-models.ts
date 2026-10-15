/**
 * Compresses the built site's models for players: meshopt (EXT_meshopt_compression,
 * level high: quantized vertices and filters), after merging duplicate data. The sources in public/
 * stay as the design agents made them (their checker reads them); only the
 * copies in dist/ shrink. The game decodes them with three.js's own meshopt
 * decoder (models.ts). Runs after `vite build`:
 *
 *   vite-node scripts/compress-models.ts [dir=dist/themes]
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

function glbs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...glbs(p));
    else if (name.endsWith('.glb')) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? 'dist/themes';
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  let before = 0;
  let after = 0;
  for (const file of glbs(dir)) {
    const doc = await io.read(file);
    // already compressed (a second run): leave it
    if (doc.getRoot().listExtensionsUsed().some((e) => e instanceof EXTMeshoptCompression)) continue;
    const size = statSync(file).size;
    // never merge materials: the game recolours `Tint` and `Trim` by name, and two may look alike
    await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune({ keepLeaves: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await io.write(file, doc);
    before += size;
    after += statSync(file).size;
  }
  console.log(`models: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
}

void main();
