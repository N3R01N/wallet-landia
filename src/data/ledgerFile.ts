/**
 * The lifetime history as a file (H4): so a player's gathered history
 * survives a new browser, a new device or cleared site data without asking
 * Zerion again. Gzipped JSON, ~0.3 KB a transaction.
 *
 * A file is untrusted: loading checks its shape strictly and keeps only what
 * looks like a Zerion transaction (the mapper treats every string as text,
 * never markup, as it does for live data).
 */

import type { TransactionResource } from './zerion/types.js';

export const LEDGER_FILE_FORMAT = 'wallet-landia-ledger/1';
/** Far beyond any real history (and a wallet stops walking back at 50,000). */
const MAX_PER_WALLET = 200_000;
const MAX_WALLETS = 50;
/** Unpacked, a file may be at most this big (~2 KB a transaction is plenty): a small gzip can unpack to gigabytes. */
const MAX_BYTES = 512 * 1024 * 1024;

export interface LedgerFile {
  format: typeof LEDGER_FILE_FORMAT;
  /** The realm (chain set) the history was gathered for. */
  scope: string;
  exportedAt: number;
  wallets: { address: string; complete: boolean; transactions: TransactionResource[] }[];
  /** The towns built, by realm (checked again when used: see world/townLayout.ts `sanitizeLayout`). */
  towns?: Record<string, unknown>;
}

export async function encodeLedgerFile(f: LedgerFile): Promise<Blob> {
  const json = new Blob([JSON.stringify(f)], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return json;
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** Read a history file (gzipped or plain JSON). Throws a plain-words error when it is not one. */
export async function decodeLedgerFile(data: ArrayBuffer): Promise<LedgerFile> {
  const bytes = new Uint8Array(data);
  let text: string;
  try {
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    text = gz ? await gunzipCapped(bytes, MAX_BYTES) : new TextDecoder().decode(bytes);
  } catch (error) {
    if (error instanceof TooBig) throw new Error('That file is far too big to be a history file.');
    throw new Error('That file could not be read (not a history file, or damaged).');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a history file.');
  }
  return validate(raw);
}

class TooBig extends Error {}

/** Unzip, counting as it goes, and stop past `max` bytes. */
async function gunzipCapped(bytes: Uint8Array, max: number): Promise<string> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    total += value.byteLength;
    if (total > max) {
      void reader.cancel();
      throw new TooBig();
    }
    out += decoder.decode(value, { stream: true });
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validate(raw: unknown): LedgerFile {
  if (!isObj(raw) || raw.format !== LEDGER_FILE_FORMAT) throw new Error('That file is not a Wallet-landia history file.');
  if (typeof raw.scope !== 'string' || !/^[a-z0-9+-]{1,200}$/.test(raw.scope)) throw new Error('The history file names no realm.');
  if (!Array.isArray(raw.wallets) || raw.wallets.length > MAX_WALLETS) throw new Error('The history file holds no wallets.');
  const wallets = raw.wallets.map((w) => {
    if (!isObj(w) || typeof w.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(w.address)) throw new Error('The history file holds a wallet without a valid address.');
    if (!Array.isArray(w.transactions) || w.transactions.length > MAX_PER_WALLET) throw new Error(`The history of ${w.address} is not a list of transactions.`);
    return { address: w.address.toLowerCase(), complete: w.complete === true, transactions: w.transactions.filter(looksLikeTx) };
  });
  const towns: Record<string, unknown> = {};
  if (isObj(raw.towns)) for (const [realm, t] of Object.entries(raw.towns)) if (/^[a-z0-9-]{1,40}$/.test(realm)) towns[realm] = t;
  return { format: LEDGER_FILE_FORMAT, scope: raw.scope, exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0, wallets, ...(Object.keys(towns).length > 0 ? { towns } : {}) };
}

/** Ethereum's first block: nothing was mined before it. */
const FIRST_BLOCK_AT = Date.parse('2015-07-30T00:00:00Z');

/** The fields the ledger and the mapper rely on, of the right types. */
function looksLikeTx(t: unknown): t is TransactionResource {
  if (!isObj(t) || typeof t.id !== 'string' || !isObj(t.attributes)) return false;
  const a = t.attributes;
  // the chain is read as relationships.chain.data.id: a chain without data would throw there
  const chain = isObj(t.relationships) ? t.relationships.chain : undefined;
  if (chain !== undefined && !(isObj(chain) && isObj(chain.data) && typeof chain.data.id === 'string')) return false;
  if (t.relationships !== undefined && !isObj(t.relationships)) return false;
  // a time from the future would become the ledger's newest, and new activity would never be asked for
  const at = typeof a.mined_at === 'string' ? Date.parse(a.mined_at) : NaN;
  if (!(at >= FIRST_BLOCK_AT && at <= Date.now() + 86_400_000)) return false;
  // the mapper reads every transfer's direction, sender and recipient
  const transfersOk = Array.isArray(a.transfers) && a.transfers.every((x) => isObj(x) && typeof x.direction === 'string' && typeof x.sender === 'string' && typeof x.recipient === 'string');
  return transfersOk && typeof a.hash === 'string' && typeof a.sent_from === 'string' && typeof a.sent_to === 'string' && typeof a.operation_type === 'string' && typeof a.status === 'string';
}
