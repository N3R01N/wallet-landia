/**
 * A snapshot of each protocol family's value locked on Ethereum, from
 * DefiLlama, for sizing the town's buildings by real economic size (a protocol
 * holding billions dwarfs a castle worth a million). Run now and then:
 *
 *   npm run tvl
 *
 * Writes src/castle/world/tvl.json (families with at least $1M on Ethereum).
 * The game never asks DefiLlama itself: the snapshot ships with it.
 */

import { writeFileSync } from 'node:fs';
import { protocolFamily } from '../src/castle/assets/manifest.js';

interface LlamaProtocol {
  slug?: string;
  name?: string;
  parentProtocol?: string | null;
  chainTvls?: Record<string, number>;
}

const MIN_USD = 1_000_000;

async function main(): Promise<void> {
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error(`DefiLlama answered ${res.status}`);
  const list = (await res.json()) as LlamaProtocol[];
  const tvl: Record<string, number> = {};
  for (const p of list) {
    const usd = p.chainTvls?.Ethereum ?? 0;
    if (!(usd > 0) || !p.slug) continue;
    // a protocol's versions (Aave V2, V3) count together under their parent
    const key = protocolFamily(p.parentProtocol ? p.parentProtocol.replace(/^parent#/, '') : p.slug);
    tvl[key] = (tvl[key] ?? 0) + usd;
  }
  const kept = Object.fromEntries(
    Object.entries(tvl)
      .filter(([, usd]) => usd >= MIN_USD)
      .sort((a, b) => b[1] - a[1])
      .map(([k, usd]) => [k, Math.round(usd)]),
  );
  const out = { source: 'DefiLlama (api.llama.fi/protocols), Ethereum TVL by protocol family', updated: new Date().toISOString().slice(0, 10), tvl: kept };
  writeFileSync(new URL('../src/castle/world/tvl.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
  console.log(`${Object.keys(kept).length} protocol families with ≥ $1M on Ethereum written to src/castle/world/tvl.json`);
}

void main();
