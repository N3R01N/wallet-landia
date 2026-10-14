/**
 * Each protocol family's logo, for the logo plates on its building
 * (docs/STYLEGUIDE_V2.md §8.1): a DefiLlama snapshot (logos.json, written by
 * `npm run logos`), the pictures in the art theme's `logos/` folder.
 */

import snapshot from './logos.json';
import { protocolFamily } from '../assets/manifest.js';

const FILES: Readonly<Record<string, string>> = (snapshot as { files: Record<string, string> }).files;

/** A protocol's logo file in the theme (by its Zerion id), or null when the snapshot has none. */
export function logoPath(protocolId: string): string | null {
  const file = FILES[protocolFamily(protocolId)];
  return file ? `logos/${file}` : null;
}
