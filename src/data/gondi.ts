/**
 * Gondi loans, read from the chain: what NFT a loan the guild lent stands on
 * (its collateral), and when the loan ended.
 *
 * Zerion shows a lender's side only (WETH out to Gondi, WETH back), so the
 * collateral comes from each transaction's receipt:
 * - Gondi's loan events (emitted, refinanced) carry the loan itself: the
 *   borrower, the collateral's token id and collection, the principal token
 *   and amount, and further on the lenders' addresses. Found by shape (four
 *   words: an address, an id, an address, a known principal token), so a new
 *   Gondi version with the same loan layout reads too.
 * - The collateral leaves Gondi's escrow (an ERC-721 Transfer from the pool)
 *   when the loan is repaid (to the borrower) or foreclosed (to the lender).
 *
 * The receipts never change: what's read is kept in localStorage per hash.
 */

import { rpcPost } from './rpc.js';

/** ERC-20 and ERC-721 Transfer(address,address,uint256). */
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Tokens Gondi lends in (the loan's principal). */
const PRINCIPALS = new Set([
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
]);

export interface ReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

export interface Receipt {
  transactionHash: string;
  to: string | null;
  logs: ReceiptLog[];
}

/** A Gondi loan as its event states it. */
export interface GondiLoan {
  collection: string;
  tokenId: string;
  borrower: string;
  principal: string;
  /** In the principal's smallest unit (wei for WETH), as a decimal string. */
  amount: string;
  /** Every address after the loan's head: the lenders (and anything else the event lists). */
  lenders: string[];
}

/** What one transaction did to Gondi loans. */
export interface GondiTx {
  hash: string;
  loans: GondiLoan[];
  /** Collateral that left an escrow (the pool that held it, where it went). */
  released: { collection: string; tokenId: string; from: string; to: string }[];
}

const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const asAddress = (w: string) => (w.length === 64 && w.startsWith('000000000000000000000000') && BigInt(`0x${w}`) > 2n ** 100n ? `0x${w.slice(24)}` : null);
const asId = (w: string) => (w.length === 64 ? BigInt(`0x${w}`) : null);

/** The loans in an event's data, found by the loan's head (borrower, token id, collection, principal token). Pure. */
export function loansIn(data: string): GondiLoan[] {
  const n = Math.floor((data.length - 2) / 64);
  const out: GondiLoan[] = [];
  for (let i = 0; i + 4 < n; i++) {
    const borrower = asAddress(word(data, i));
    const id = asId(word(data, i + 1));
    const collection = asAddress(word(data, i + 2));
    const principal = asAddress(word(data, i + 3));
    if (!borrower || id === null || id > 2n ** 128n || !collection || !principal || !PRINCIPALS.has(principal)) continue;
    const lenders: string[] = [];
    for (let k = i + 4; k < n; k++) {
      const a = asAddress(word(data, k));
      if (a && a !== borrower && a !== collection && !PRINCIPALS.has(a)) lenders.push(a);
    }
    out.push({ collection, tokenId: id.toString(), borrower, principal, amount: (asId(word(data, i + 4)) ?? 0n).toString(), lenders });
  }
  return out;
}

/** What a receipt did to Gondi loans; `pools` are Gondi's contracts (the loan events come from them too). Pure. */
export function readGondiTx(r: Receipt, pools: ReadonlySet<string>): GondiTx {
  const gondi = new Set([...pools].map((p) => p.toLowerCase()));
  const loans: GondiLoan[] = [];
  for (const l of r.logs) {
    if (l.topics[0] === TRANSFER) continue;
    const found = loansIn(l.data);
    if (found.length) {
      gondi.add(l.address.toLowerCase());
      loans.push(...found);
    }
  }
  const released: GondiTx['released'] = [];
  for (const l of r.logs) {
    // an ERC-721 Transfer: from, to and the token id all indexed
    if (l.topics[0] !== TRANSFER || l.topics.length !== 4) continue;
    const from = `0x${l.topics[1]!.slice(26)}`.toLowerCase();
    if (!gondi.has(from)) continue;
    released.push({ collection: l.address.toLowerCase(), tokenId: BigInt(l.topics[3]!).toString(), from, to: `0x${l.topics[2]!.slice(26)}`.toLowerCase() });
  }
  return { hash: r.transactionHash.toLowerCase(), loans, released };
}

/** A loan the guild lent, from its first transaction to its end (or still running). */
export interface LentLoan {
  wallet: string;
  collection: string;
  tokenId: string;
  borrower: string;
  principal: string;
  amount: string;
  /** The transaction it began with (the guild lent). */
  startedBy: string;
  /** How it ended, and in which transaction; null while it runs. */
  end: { how: 'repaid' | 'foreclosed' | 'refinanced'; by: string } | null;
}

/** A wallet's Gondi loans from its transactions, oldest first. Pure. */
export function lentLoans(wallet: string, txs: readonly GondiTx[]): LentLoan[] {
  const me = wallet.toLowerCase();
  const all: LentLoan[] = [];
  const running = new Map<string, LentLoan>();
  for (const tx of txs) {
    for (const l of tx.loans) {
      const key = `${l.collection}:${l.tokenId}`;
      const mine = l.lenders.includes(me);
      const was = running.get(key);
      if (mine && !was) {
        const loan: LentLoan = { wallet: me, collection: l.collection, tokenId: l.tokenId, borrower: l.borrower, principal: l.principal, amount: l.amount, startedBy: tx.hash, end: null };
        all.push(loan);
        running.set(key, loan);
      } else if (!mine && was) {
        // someone else's loan on it now: ours was paid out
        was.end = { how: 'refinanced', by: tx.hash };
        running.delete(key);
      }
    }
    for (const r of tx.released) {
      const key = `${r.collection}:${r.tokenId}`;
      const was = running.get(key);
      if (!was) continue;
      was.end = { how: r.to === me ? 'foreclosed' : 'repaid', by: tx.hash };
      running.delete(key);
    }
  }
  return all;
}

const CACHE = 'gondi:tx:';
/** Rounds of asking for the receipts a busy node left out. */
const READ_PASSES = 4;

/** Gondi's reading of these transactions (from the receipts; kept, as receipts never change). Missing ones are left out. */
export async function gondiTxs(hashes: readonly string[], pools: ReadonlySet<string>, rpcUrl: string): Promise<Map<string, GondiTx>> {
  const out = new Map<string, GondiTx>();
  const todo: string[] = [];
  for (const h of hashes) {
    const kept = load(h);
    if (kept) out.set(h.toLowerCase(), kept);
    else todo.push(h);
  }
  // a few at a time (public nodes limit batches); what a busy node left out is asked again, a little later
  for (let pass = 0; pass < READ_PASSES && todo.length; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 1500 * pass));
    const missed: string[] = [];
    for (let i = 0; i < todo.length; i += 8) {
      const chunk = todo.slice(i, i + 8);
      let body: unknown;
      try {
        body = await rpcPost(
          rpcUrl,
          chunk.map((h, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_getTransactionReceipt', params: [h] })),
        );
      } catch {
        body = null;
      }
      const got = new Set<number>();
      if (Array.isArray(body)) {
        for (const res of body as { id: number; result?: Receipt | null }[]) {
          if (!res.result) continue;
          const tx = readGondiTx(res.result, pools);
          out.set(tx.hash, tx);
          save(tx);
          got.add(res.id);
        }
      }
      chunk.forEach((h, k) => {
        if (!got.has(k)) missed.push(h);
      });
    }
    todo.splice(0, todo.length, ...missed);
  }
  return out;
}

function load(hash: string): GondiTx | null {
  try {
    const raw = localStorage.getItem(CACHE + hash.toLowerCase());
    return raw ? (JSON.parse(raw) as GondiTx) : null;
  } catch {
    return null;
  }
}

function save(tx: GondiTx): void {
  try {
    localStorage.setItem(CACHE + tx.hash, JSON.stringify(tx));
  } catch {
    // storage full or off: read again next time
  }
}
