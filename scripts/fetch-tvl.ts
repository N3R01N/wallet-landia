/**
 * A snapshot of each protocol family's value locked on Ethereum, from
 * DefiLlama, for sizing the town's buildings by real economic size (a protocol
 * holding billions dwarfs a castle worth a million). Run now and then:
 *
 *   npm run tvl
 *
 * Writes src/castle/world/tvl.json (families with at least $1M on Ethereum).
 * The game never asks DefiLlama itself: the snapshot ships with it.
 *
 * Standing: value locked is the wrong yardstick for a marketplace or a name
 * registry (OpenSea locks almost nothing and is one of the great protocols).
 * For the few families in STANDING, the snapshot also keeps a standing of
 * FEES_MULTIPLE × a year's fees (roughly how protocols are valued against what
 * they earn); the game sizes them by whichever is larger. Each family here has
 * a landmark built for the class its standing gives (docs/batches/26).
 *
 *   npm run tvl -- --standing     # the standing only, keeping the TVL snapshot
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { protocolFamily } from '../src/castle/assets/manifest.js';

interface LlamaProtocol {
  slug?: string;
  name?: string;
  parentProtocol?: string | null;
  chainTvls?: Record<string, number>;
}

const MIN_USD = 1_000_000;

/** Protocol family → its DefiLlama slug, for the families sized by their fees (see the header). */
const STANDING: Record<string, string> = { opensea: 'opensea', ens: 'ens', gondi: 'gondi' };
const FEES_MULTIPLE = 10;

/** FEES_MULTIPLE × each STANDING family's fees over the last year (all chains, DefiLlama). */
async function standing(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [family, slug] of Object.entries(STANDING)) {
    const res = await fetch(`https://api.llama.fi/summary/fees/${slug}?dataType=dailyFees`);
    if (!res.ok) throw new Error(`DefiLlama answered ${res.status} for ${slug}'s fees`);
    const year = ((await res.json()) as { total1y?: number }).total1y;
    if (typeof year !== 'number' || !(year > 0)) throw new Error(`DefiLlama has no year of fees for ${slug}`);
    out[family] = Math.round(year * FEES_MULTIPLE);
  }
  return out;
}

const OUT = new URL('../src/castle/world/tvl.json', import.meta.url);
const STANDING_SOURCE = `${FEES_MULTIPLE} × fees over the last year (DefiLlama api.llama.fi/summary/fees, all chains), for protocols value locked cannot measure`;

function write(out: object): void {
  writeFileSync(OUT, `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--standing')) {
    const kept = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>;
    write({ ...kept, standingSource: STANDING_SOURCE, standingUpdated: new Date().toISOString().slice(0, 10), standing: await standing() });
    console.log(`standing written for ${Object.keys(STANDING).join(', ')} (TVL snapshot kept)`);
    return;
  }
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
  const today = new Date().toISOString().slice(0, 10);
  write({ source: 'DefiLlama (api.llama.fi/protocols), Ethereum TVL by protocol family', updated: today, tvl: kept, standingSource: STANDING_SOURCE, standingUpdated: today, standing: await standing() });
  console.log(`${Object.keys(kept).length} protocol families with ≥ $1M on Ethereum written to src/castle/world/tvl.json`);
}

void main();
