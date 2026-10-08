/**
 * The Chronicle's heartbeat: the real chain's latest block, from a free public
 * RPC. No key, no library. Failures are silent — a town without a bell still
 * works.
 */

export const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';

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

export function startHeartbeat(onBeat: (beat: BlockBeat) => void, url = DEFAULT_RPC, intervalMs = 4_000): () => void {
  let last = -1;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (document.visibilityState === 'visible') {
        const res = await fetch(url, {
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
