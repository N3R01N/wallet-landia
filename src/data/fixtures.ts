/**
 * Fixtures: raw Zerion captures checked into the repo. Real captures live in
 * fixtures/*.json (written by `npm run capture`); the synthetic demo set in
 * fixtures/demo/ is used only when there are none.
 */

import type { RawWallet } from './zerion/endpoints.js';

const captured = import.meta.glob<RawWallet>('/fixtures/*.json', { import: 'default' });
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
