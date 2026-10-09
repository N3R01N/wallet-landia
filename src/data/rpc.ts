/**
 * The Chronicle's heartbeat: the real chain's latest block, from a free public
 * RPC. No key, no library. Failures are silent — a town without a bell still
 * works.
 */

export const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';

let rpcUrl = DEFAULT_RPC;
let nextId = 1;

/** Use another node (the player's own, from the Guild panel); empty for the default. */
export function setRpcUrl(url: string): void {
  rpcUrl = url.trim() === '' ? DEFAULT_RPC : url.trim();
}

export function currentRpcUrl(): string {
  return rpcUrl;
}

/**
 * Nodes the player may switch to. The page's security policy only lets it
 * talk to these (so a script injected into the page could not send the
 * stored Zerion key anywhere else); keep this list and index.html's
 * connect-src in step.
 */
export const ALLOWED_RPC_HOSTS = [
  'ethereum-rpc.publicnode.com',
  'eth.llamarpc.com',
  'rpc.ankr.com',
  'eth.drpc.org',
  'cloudflare-eth.com',
  'mainnet.infura.io',
  '*.g.alchemy.com',
  '*.quiknode.pro',
  'rpc.flashbots.net',
  '*.blastapi.io',
] as const;

/** Is this a usable RPC address: https, on one of the allowed providers? */
export function validRpcUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return false;
    return ALLOWED_RPC_HOSTS.some((h) => (h.startsWith('*.') ? u.hostname.endsWith(h.slice(1)) : u.hostname === h));
  } catch {
    return false;
  }
}

export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error !== undefined || body.result === undefined) throw new Error(`rpc ${method}: ${body.error?.message ?? 'no result'}`);
  return body.result;
}

/** Several calls in one HTTP request. Results in order; null where one failed. */
export async function rpcBatch(calls: { method: string; params: unknown[] }[]): Promise<(string | null)[]> {
  if (calls.length === 0) return [];
  const base = nextId;
  nextId += calls.length;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: base + i, method: c.method, params: c.params }))),
  });
  const body = (await res.json()) as { id: number; result?: string }[];
  const byId = new Map(body.map((r) => [r.id, r.result ?? null]));
  return calls.map((_, i) => byId.get(base + i) ?? null);
}

/**
 * Has anything happened to these wallets? Nonce (they sent something) and ETH
 * balance (something arrived) — free to ask every block, unlike Zerion.
 */
export async function walletFingerprints(addresses: readonly string[]): Promise<Map<string, string>> {
  const calls = addresses.flatMap((a) => [
    { method: 'eth_getTransactionCount', params: [a, 'latest'] },
    { method: 'eth_getBalance', params: [a, 'latest'] },
  ]);
  const results = await rpcBatch(calls);
  const out = new Map<string, string>();
  addresses.forEach((a, i) => {
    const nonce = results[i * 2];
    const balance = results[i * 2 + 1];
    if (nonce != null && balance != null) out.set(a, `${nonce}:${balance}`);
  });
  return out;
}

export interface BlockBeat {
  number: number;
  /** gasUsed / gasLimit, 0..1 — how crowded the tower gate is. */
  busy: number;
  baseFeeGwei: number | null;
  txCount: number;
  timestamp: number;
}

interface RpcBlock {
  number: string;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string;
  timestamp: string;
  transactions: unknown[];
}

/** Ethereum seals a block every 12 seconds. */
const SLOT_MS = 12_000;

/**
 * When to ask again. Right after a block, wait for the next one to be due
 * (12 s after this one's timestamp, plus a moment for it to spread); when it
 * is late, look again soon; when the node fails or limits us, back off.
 * About one request a block instead of three, a tenth of that when failing.
 */
export function nextPollDelay(o: { lastBlockMs: number | null; now: number; misses: number; failures: number }): number {
  if (o.failures > 0) return Math.min(120_000, 4_000 * 2 ** (o.failures - 1));
  if (o.lastBlockMs === null) return 4_000;
  if (o.misses > 0) return Math.min(SLOT_MS, 2_000 * o.misses); // a late or missed slot
  const due = o.lastBlockMs + SLOT_MS + 1_500 - o.now;
  return Math.min(SLOT_MS + 2_000, Math.max(2_000, due));
}

export function startHeartbeat(onBeat: (beat: BlockBeat) => void): () => void {
  let last = -1;
  let lastBlockMs: number | null = null;
  let misses = 0;
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (document.visibilityState === 'visible') {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
        });
        if (!res.ok) throw new Error(`rpc ${res.status}`); // 429: rate-limited
        const body = (await res.json()) as { result?: RpcBlock };
        const b = body.result;
        if (b === undefined) throw new Error('rpc: no block');
        failures = 0;
        const number = parseInt(b.number, 16);
        if (number !== last) {
          last = number;
          misses = 0;
          lastBlockMs = parseInt(b.timestamp, 16) * 1000;
          onBeat({
            number,
            busy: Math.min(1, parseInt(b.gasUsed, 16) / Math.max(1, parseInt(b.gasLimit, 16))),
            baseFeeGwei: b.baseFeePerGas !== undefined ? parseInt(b.baseFeePerGas, 16) / 1e9 : null,
            txCount: b.transactions.length,
            timestamp: lastBlockMs,
          });
        } else misses++;
      }
    } catch {
      // offline, or the node is limiting us: back off
      failures++;
    }
    // a hidden tab asks nothing; look again every so often to see if it is back
    const delay = document.visibilityState === 'visible' ? nextPollDelay({ lastBlockMs, now: Date.now(), misses, failures }) : 5_000;
    timer = setTimeout(() => void tick(), delay);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
