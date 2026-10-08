/**
 * Capture real Zerion data for one or more wallets into fixtures/<address>.json.
 *
 *   ZERION_API_KEY=zk_... npm run capture -- 0xabc... 0xdef...
 *
 * The key comes from the environment (or .env.local via Vite's loadEnv) and is
 * never written to disk. Each wallet costs ~5 requests of the 300/day budget.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { ZerionClient, ZerionError } from '../src/data/zerion/client.js';
import { fetchRawWallet } from '../src/data/zerion/endpoints.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const addresses = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (addresses.length === 0) fail('usage: npm run capture -- <address> [<address> ...]');
  for (const a of addresses) if (!/^0x[a-fA-F0-9]{40}$/.test(a)) fail(`not an address: ${a}`);

  const env = { ...loadEnv('development', ROOT, ''), ...process.env };
  const apiKey = env['ZERION_API_KEY'];
  if (apiKey === undefined || apiKey === '') fail('ZERION_API_KEY is not set.');

  const client = new ZerionClient({
    apiKey,
    transport: 'direct',
    onRateLimit: (l) => {
      if (l.dayRemaining !== null) process.stderr.write(`\r  day budget remaining: ${l.dayRemaining}   `);
    },
  });

  await mkdir(resolve(ROOT, 'fixtures'), { recursive: true });
  for (const address of addresses) {
    console.log(`\ncapturing ${address}…`);
    const raw = await fetchRawWallet(client, address, {
      label: `Captured ${new Date().toISOString().slice(0, 10)}`,
      onWarn: (m) => console.warn(`\n  warning: ${m}`),
    });
    const path = resolve(ROOT, 'fixtures', `${raw.address}.json`);
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    console.log(
      `\n  wrote ${path}: ${raw.simple.length} tokens, ${raw.complex.length} protocol positions, ` +
        `${raw.nfts.length} NFTs, ${raw.transactions.length} transactions`,
    );
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  if (error instanceof ZerionError) fail(`\n${error.kind}: ${error.message}`);
  fail(`\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
});
