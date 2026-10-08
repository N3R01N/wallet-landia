/**
 * The Chronicle's heartbeat: the real chain's latest block, from a free public
 * RPC. No key, no library. Failures are silent — a town without a bell still
 * works.
 */

export const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';

let rpcUrl = DEFAULT_RPC;
let nextId = 1;

export function setRpcUrl(url: string): void {
  rpcUrl = url;
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

export function startHeartbeat(onBeat: (beat: BlockBeat) => void, intervalMs = 4_000): () => void {
  let last = -1;
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
        const body = (await res.json()) as { result?: RpcBlock };
        const b = body.result;
        if (b !== undefined) {
          const number = parseInt(b.number, 16);
          if (number !== last) {
            last = number;
            onBeat({
              number,
              busy: Math.min(1, parseInt(b.gasUsed, 16) / Math.max(1, parseInt(b.gasLimit, 16))),
              baseFeeGwei: b.baseFeePerGas !== undefined ? parseInt(b.baseFeePerGas, 16) / 1e9 : null,
              txCount: b.transactions.length,
              timestamp: parseInt(b.timestamp, 16) * 1000,
            });
          }
        }
      }
    } catch {
      // offline or rate-limited: try again next tick
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
