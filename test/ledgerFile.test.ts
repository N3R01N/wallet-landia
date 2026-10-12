import { describe, expect, it } from 'vitest';
import { decodeLedgerFile, encodeLedgerFile, LEDGER_FILE_FORMAT, type LedgerFile } from '../src/data/ledgerFile.js';

const tx = (i: number): unknown => ({ type: 'transactions', id: `id-${i}`, attributes: { hash: `0x${i}`, mined_at: new Date(1_500_000_000_000 + i * 1000).toISOString(), operation_type: 'send', status: 'confirmed', transfers: [] } });
const A = `0x${'ab'.repeat(20)}`;

describe('history files', () => {
  it('round trip, gzipped and small', async () => {
    const f = { format: LEDGER_FILE_FORMAT, scope: 'ethereum+base', exportedAt: 1, wallets: [{ address: A, complete: true, transactions: Array.from({ length: 500 }, (_, i) => tx(i)) }] } as LedgerFile;
    const blob = await encodeLedgerFile(f);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(bytes.length).toBeLessThan(JSON.stringify(f).length / 5);
    const back = await decodeLedgerFile(bytes.buffer);
    expect(back.scope).toBe('ethereum+base');
    expect(back.wallets[0]!.transactions).toHaveLength(500);
    expect(back.wallets[0]!.complete).toBe(true);
  });

  it('reads plain JSON too, and keeps only what looks like a transaction', async () => {
    const f = { format: LEDGER_FILE_FORMAT, scope: 'ethereum', wallets: [{ address: A.toUpperCase().replace('0X', '0x'), transactions: [tx(1), { id: 'x' }, { id: 'y', attributes: { hash: 1 } }, tx(2)] }] };
    const back = await decodeLedgerFile(new TextEncoder().encode(JSON.stringify(f)).buffer);
    expect(back.wallets[0]!.address).toBe(A);
    expect(back.wallets[0]!.transactions.map((t) => t.id)).toEqual(['id-1', 'id-2']);
    expect(back.wallets[0]!.complete).toBe(false);
  });

  it('refuses what is not a history file, in plain words', async () => {
    const enc = (v: unknown): ArrayBuffer => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).buffer as ArrayBuffer;
    await expect(decodeLedgerFile(enc('not json'))).rejects.toThrow('not a history file');
    await expect(decodeLedgerFile(enc({ format: 'other' }))).rejects.toThrow('not a Wallet-landia history file');
    await expect(decodeLedgerFile(enc({ format: LEDGER_FILE_FORMAT, scope: '<script>', wallets: [] }))).rejects.toThrow('names no realm');
    await expect(decodeLedgerFile(enc({ format: LEDGER_FILE_FORMAT, scope: 'ethereum', wallets: [{ address: 'nope', transactions: [] }] }))).rejects.toThrow('valid address');
    await expect(decodeLedgerFile(new Uint8Array([0x1f, 0x8b, 1, 2, 3]).buffer)).rejects.toThrow('could not be read');
  });
});
