/**
 * Burns: goods sent to an address nobody holds the key to are gone for ever,
 * and go to the Ember Furnace, not to the stranger at the town's end.
 */

import { describe, expect, it } from 'vitest';
import { buildGuild, FURNACE_ID, isBurnAddress, refineVerb } from '../src/domain/mappers.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import type { TransferResource } from '../src/data/zerion/types.js';

const WALLET = '0x1111111111111111111111111111111111111111';
const out = (recipient: string): TransferResource => ({ direction: 'out', sender: WALLET, recipient, quantity: { int: '1', decimals: 0, float: 1, numeric: '1' }, value: 12, price: null, fungible_info: { name: 'Pepe', symbol: 'PEPE' } }) as unknown as TransferResource;
const ctx = (outs: TransferResource[]) => ({ wallet: WALLET, category: null, initiated: true, ins: [], outs, loanSymbols: new Set<string>() });

describe('burn addresses', () => {
  it('are the zero address, 0x…dEaD and the 0xdead…42069 one, in any case', () => {
    expect(isBurnAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(isBurnAddress('0x000000000000000000000000000000000000dEaD')).toBe(true);
    expect(isBurnAddress('0xdEaD000000000000000042069420694206942069')).toBe(true);
    expect(isBurnAddress('0x2222222222222222222222222222222222222222')).toBe(false);
    expect(isBurnAddress(undefined)).toBe(false);
  });

  it('a send of everything to one is a burn; a send to anyone else stays a send', () => {
    expect(refineVerb('send', ctx([out('0x000000000000000000000000000000000000dEaD')]))).toBe('burn');
    expect(refineVerb('send', ctx([out('0x000000000000000000000000000000000000dEaD'), out('0x2222222222222222222222222222222222222222')]))).toBe('send');
    expect(refineVerb('send', ctx([out('0x2222222222222222222222222222222222222222')]))).toBe('send');
    expect(refineVerb('burn', ctx([]))).toBe('burn');
  });
});

describe('a burn', () => {
  it('goes to the Ember Furnace', () => {
    const raw: RawWallet = {
      address: WALLET,
      currency: 'usd',
      capturedAt: Date.parse('2026-10-20T12:00:00Z'),
      label: 'test',
      portfolio: null,
      simple: [],
      complex: [],
      nfts: [],
      transactions: [
        {
          type: 'transactions',
          id: 'burn-1',
          attributes: {
            operation_type: 'send',
            hash: '0xabc',
            mined_at: '2026-10-20T11:00:00Z',
            mined_at_block: 1,
            sent_from: WALLET,
            sent_to: '0x000000000000000000000000000000000000dead',
            status: 'confirmed',
            nonce: 1,
            fee: null,
            transfers: [out('0x000000000000000000000000000000000000dEaD')],
            approvals: [],
            flags: { is_trash: false },
          },
          relationships: { chain: { data: { id: 'ethereum' } } },
        },
      ],
    } as unknown as RawWallet;
    const journey = buildGuild([raw], { kind: 'count', count: 10 }).journeys[0];
    expect(journey?.verb).toBe('burn');
    expect(journey?.steps[0]?.target).toEqual({ kind: 'building', protocolId: FURNACE_ID });
  });
});
