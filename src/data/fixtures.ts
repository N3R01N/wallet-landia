/**
 * Fixtures: raw Zerion captures checked into the repo. Real captures live in
 * fixtures/*.json (written by `npm run capture`) and are used in development;
 * the public build (and any build without them) shows the synthetic demo set
 * in fixtures/demo/.
 */

import type { RawWallet } from './zerion/endpoints.js';

// Captured wallets are real people's (usually the developer's own): only in a
// development build, never in the public site, unless a build asks for them
// on purpose (VITE_INCLUDE_CAPTURED=1, e.g. for a private demo).
const captured: Record<string, () => Promise<RawWallet>> =
  import.meta.env.DEV || import.meta.env.VITE_INCLUDE_CAPTURED === '1' ? import.meta.glob<RawWallet>('/fixtures/*.json', { import: 'default' }) : {};
const demo = import.meta.glob<RawWallet>('/fixtures/demo/*.json', { import: 'default' });

export interface FixtureSet {
  kind: 'captured' | 'demo';
  wallets: RawWallet[];
}

export async function loadFixtures(): Promise<FixtureSet> {
  const real = Object.values(captured);
  const loaders = real.length > 0 ? real : Object.values(demo);
  const wallets = await Promise.all(loaders.map((load) => load()));
  wallets.sort((a, b) => a.address.localeCompare(b.address));
  return { kind: real.length > 0 ? 'captured' : 'demo', wallets };
}
