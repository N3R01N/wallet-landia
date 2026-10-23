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
import { fetchRawWallet, getTransactions, type RawWallet } from '../src/data/zerion/endpoints.js';
import type { TransactionResource } from '../src/data/zerion/types.js';
import { DEFAULT_RPC } from '../src/data/rpc.js';
import { toAddress } from '../src/data/ens.js';
import { inputText, parseFamousIndex, SNAPSHOT_MIN_USD, trimForSnapshot, type FamousCastle } from '../src/data/famous.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/famous');

interface Entry {
  slug: string;
  /** An ENS name or an address. */
  who: string;
  name: string;
  about: string;
  /** 'full': every transaction, not only the newest page (a story told from its beginning). */
  history?: 'full';
  /** Places and beats of a guided replay (see FamousStory); its messages are read from the chain. */
  story?: { labels: unknown[]; beats: unknown[] };
}

/** Strangers' notes kept for the crowd at the gate (the newest dropped past this). */
const CROWD_MAX = 150;
const LINK = /https?:\/\/|www\.|\.(com|io|xyz|net|org|finance|app)\b/i;

/** Input data of transactions, from the public node, in batches. */
async function inputsOf(hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < hashes.length; i += 40) {
    const batch = hashes.slice(i, i + 40);
    const res = await fetch(DEFAULT_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch.map((h, id) => ({ jsonrpc: '2.0', id, method: 'eth_getTransactionByHash', params: [h] }))),
    });
    if (!res.ok) throw new Error(`the public node answered ${res.status}`);
    for (const r of (await res.json()) as { id: number; result?: { input?: string } }[]) {
      const h = batch[r.id];
      if (h !== undefined && typeof r.result?.input === 'string') out.set(h, r.result.input);
    }
  }
  return out;
}

/**
 * The story file beside a snapshot: the entry's places and beats, its own
 * messages, and what strangers wrote to it (addresses shortened, links left out).
 * The strangers' transactions themselves (worth nothing, hundreds of them) are
 * then dropped from the snapshot: they live on as the crowd.
 */
async function writeStory(entry: Entry, raw: RawWallet): Promise<RawWallet> {
  const me = raw.address;
  const own = raw.transactions.filter((t) => t.attributes.sent_from.toLowerCase() === me && t.attributes.transfers.length === 0);
  const worth = (t: TransactionResource) => t.attributes.transfers.reduce((s, x) => s + (x.value ?? 0), 0);
  const strangers = raw.transactions.filter((t) => t.attributes.sent_from.toLowerCase() !== me && t.attributes.sent_to.toLowerCase() === me);
  const inputs = await inputsOf([...own, ...strangers].map((t) => t.attributes.hash));
  const notes = own.flatMap((t) => {
    const text = inputText(inputs.get(t.attributes.hash));
    return text === null ? [] : [{ hash: t.attributes.hash.toLowerCase(), text }];
  });
  const seen = new Set<string>();
  const crowd = strangers
    .flatMap((t) => {
      const text = inputText(inputs.get(t.attributes.hash));
      if (text === null || text.startsWith('(') || LINK.test(text) || seen.has(text)) return [];
      seen.add(text);
      return [{ at: Date.parse(t.attributes.mined_at), text: text.slice(0, 280) }];
    })
    .sort((x, y) => x.at - y.at)
    .slice(0, CROWD_MAX);
  const story = { labels: entry.story?.labels ?? [], beats: entry.story?.beats ?? [], notes, crowd };
  await writeFile(resolve(OUT, `${me}.story.json`), `${JSON.stringify(story, null, 1)}\n`, 'utf8');
  console.log(`  story: ${notes.length} own messages, ${crowd.length} from the crowd (of ${strangers.length} strangers' transactions)`);
  const crowdOnly = new Set(strangers.filter((t) => worth(t) < SNAPSHOT_MIN_USD).map((t) => t.attributes.hash));
  return { ...raw, transactions: raw.transactions.filter((t) => !crowdOnly.has(t.attributes.hash)) };
}

/** Pages a full history may take (100 transactions each). */
const FULL_HISTORY_PAGES = 20;

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
        ...(entry.history === 'full' ? { transactions: () => getTransactions(client, address, { pages: FULL_HISTORY_PAGES }) } : {}),
      });
      const raw = entry.story ? await writeStory(entry, trimForSnapshot(full)) : trimForSnapshot(full);
      const text = JSON.stringify(raw);
      await writeFile(resolve(OUT, `${raw.address}.json`), text, 'utf8');
      console.log(
        `  ${raw.simple.length} tokens (of ${full.simple.length}), ${raw.complex.length} protocol positions (of ${full.complex.length}), ` +
          `${raw.nfts.length} NFTs, ${raw.transactions.length} transactions, ${Math.round(text.length / 1024)} KB`,
      );
      index.set(entry.slug, { slug: entry.slug, address: raw.address, name: entry.name, about: entry.about, capturedAt, ...(entry.story ? { story: true } : {}) });
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
