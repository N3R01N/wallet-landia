/**
 * Capture the famous castles: snapshots of the well-known public wallets in
 * scripts/famous.json, into public/famous/<address>.json plus the list the
 * page reads, public/famous/index.json.
 *
 *   npm run famous                 # every entry
 *   npm run famous -- vitalik      # only these slugs (the others keep their snapshot)
 *
 * Only positions worth $1 or more are kept (trimForSnapshot). A wallet Zerion
 * will not answer for (some old, huge ones are "untrackable") is skipped with
 * a warning, keeping its earlier snapshot if it has one; the list is written
 * after each wallet, so what was captured is never lost to a later failure.
 *
 * ENS names are resolved through the public Ethereum node. The Zerion key comes
 * from the environment (or .env.local via Vite's loadEnv) and is never written
 * to disk. Each wallet costs ~5 requests of the 2,000/day budget.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { ZerionClient, ZerionError } from '../src/data/zerion/client.js';
import { fetchRawWallet } from '../src/data/zerion/endpoints.js';
import { toAddress } from '../src/data/ens.js';
import { parseFamousIndex, trimForSnapshot, type FamousCastle } from '../src/data/famous.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/famous');

interface Entry {
  slug: string;
  /** An ENS name or an address. */
  who: string;
  name: string;
  about: string;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const entries = JSON.parse(await readFile(resolve(ROOT, 'scripts/famous.json'), 'utf8')) as Entry[];
  for (const slug of only) if (!entries.some((e) => e.slug === slug)) fail(`not in scripts/famous.json: ${slug}`);

  const env = { ...loadEnv('development', ROOT, ''), ...process.env };
  const apiKey = env['ZERION_API_KEY'];
  if (apiKey === undefined || apiKey === '') fail('ZERION_API_KEY is not set.');
  const client = new ZerionClient({ apiKey, transport: 'direct' });

  await mkdir(OUT, { recursive: true });
  const kept = new Map(parseFamousIndex(await readFile(resolve(OUT, 'index.json'), 'utf8').then(JSON.parse, () => [])).map((c) => [c.slug, c]));
  // in the list's order: each wallet's latest snapshot, or its earlier one
  const index = new Map<string, FamousCastle>();
  const keep = (entry: Entry): void => {
    const before = kept.get(entry.slug);
    if (before) index.set(entry.slug, { ...before, name: entry.name, about: entry.about });
  };
  const write = () => writeFile(resolve(OUT, 'index.json'), `${JSON.stringify(entries.flatMap((e) => index.get(e.slug) ?? []), null, 2)}\n`, 'utf8');
  const skipped: string[] = [];
  for (const entry of entries) {
    // not asked for: keep its snapshot, with the list's current words
    if (only.length > 0 && !only.includes(entry.slug)) {
      keep(entry);
      continue;
    }
    try {
      const address = await toAddress(entry.who);
      console.log(`capturing ${entry.slug} (${entry.who} → ${address})…`);
      const capturedAt = Date.now();
      const full = await fetchRawWallet(client, address, {
        label: `Snapshot ${new Date(capturedAt).toISOString().slice(0, 10)}`,
        onWarn: (m) => console.warn(`  warning: ${m}`),
      });
      const raw = trimForSnapshot(full);
      const text = JSON.stringify(raw);
      await writeFile(resolve(OUT, `${raw.address}.json`), text, 'utf8');
      console.log(
        `  ${raw.simple.length} tokens (of ${full.simple.length}), ${raw.complex.length} protocol positions (of ${full.complex.length}), ` +
          `${raw.nfts.length} NFTs, ${raw.transactions.length} transactions, ${Math.round(text.length / 1024)} KB`,
      );
      index.set(entry.slug, { slug: entry.slug, address: raw.address, name: entry.name, about: entry.about, capturedAt });
    } catch (error) {
      console.warn(`  skipped ${entry.slug}: ${error instanceof Error ? error.message : String(error)}`);
      skipped.push(entry.slug);
      keep(entry);
    }
    await write();
  }
  await write();
  console.log(`wrote public/famous/index.json: ${index.size} castles`);
  if (skipped.length > 0) fail(`not captured: ${skipped.join(', ')} (an earlier snapshot, if any, was kept)`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  if (error instanceof ZerionError) fail(`${error.kind}: ${error.message}`);
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
