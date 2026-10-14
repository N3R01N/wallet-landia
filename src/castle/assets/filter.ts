/** Pure helpers for the asset gallery: which assets to show, and how many are ready. */

import type { AssetSpec } from './manifest.js';
import { assetFolder } from './manifest.js';

export type GalleryFilter = 'all' | 'required' | 'ready' | 'standin';

export function groupsOf(assets: readonly AssetSpec[]): string[] {
  return [...new Set(assets.map((a) => assetFolder(a.name)))];
}

/** `ready` is the set of asset names whose file exists in the theme. */
export function filterAssets(
  assets: readonly AssetSpec[],
  opts: { group?: string; filter: GalleryFilter; ready: ReadonlySet<string> },
): AssetSpec[] {
  return assets.filter((a) => {
    if (opts.group && opts.group !== 'all' && assetFolder(a.name) !== opts.group) return false;
    switch (opts.filter) {
      case 'required':
        return a.required;
      case 'ready':
        return opts.ready.has(a.name);
      case 'standin':
        return !opts.ready.has(a.name);
      default:
        return true;
    }
  });
}

export function summarize(assets: readonly AssetSpec[], ready: ReadonlySet<string>): { total: number; required: number; ready: number; requiredReady: number } {
  const required = assets.filter((a) => a.required);
  return {
    total: assets.length,
    required: required.length,
    ready: assets.filter((a) => ready.has(a.name)).length,
    requiredReady: required.filter((a) => ready.has(a.name)).length,
  };
}
