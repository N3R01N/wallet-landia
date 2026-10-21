/**
 * Famous castles: the list the page reads is untrusted (a file, possibly old
 * or hand-edited), and a link names one by its slug.
 */

import { describe, expect, it } from 'vitest';
import { famousLink, famousSlugOf, parseFamousIndex, trimForSnapshot } from '../src/data/famous.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const GOOD = { slug: 'vitalik', address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', name: 'vitalik.eth', about: 'Co-founder of Ethereum', capturedAt: 1_792_000_000_000 };

describe('the famous castles list', () => {
  it('keeps well-formed entries as they are', () => {
    expect(parseFamousIndex([GOOD])).toEqual([GOOD]);
  });

  it('drops what is not an entry, and an entry with a bad slug, address, name or date', () => {
    expect(parseFamousIndex({ not: 'a list' })).toEqual([]);
    expect(
      parseFamousIndex([
        null,
        'vitalik',
        { ...GOOD, slug: 'Has Spaces' },
        { ...GOOD, address: '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045' },
        { ...GOOD, address: 'vitalik.eth' },
        { ...GOOD, name: '' },
        { ...GOOD, capturedAt: 'yesterday' },
        GOOD,
      ]),
    ).toEqual([GOOD]);
  });

  it('shortens long words and treats a missing about as none', () => {
    const [c] = parseFamousIndex([{ ...GOOD, name: 'n'.repeat(100), about: undefined }]);
    expect(c?.name).toHaveLength(60);
    expect(c?.about).toBe('');
  });
});

describe('a famous castle’s link', () => {
  it('names it by slug, and reads back', () => {
    expect(famousLink('ens-dao')).toBe('#famous=ens-dao');
    expect(famousSlugOf(famousLink('ens-dao'))).toBe('ens-dao');
  });

  it('is not a link to a famous castle without a good slug', () => {
    expect(famousSlugOf('')).toBeNull();
    expect(famousSlugOf('#visit=0x1234567890abcdef1234567890abcdef12345678')).toBeNull();
    expect(famousSlugOf('#famous=../index')).toBeNull();
  });
});

describe('a snapshot of a whale', () => {
  it('keeps the positions worth a dollar or more, and everything else as it was', () => {
    const pos = (value: number | null) => ({ attributes: { value } });
    const raw = { address: GOOD.address, simple: [pos(5000), pos(0.4), pos(null), pos(1)], complex: [pos(0.01), pos(120)], nfts: [{}], transactions: [{}] };
    const trimmed = trimForSnapshot(raw as unknown as RawWallet);
    expect(trimmed.simple.map((p) => p.attributes.value)).toEqual([5000, 1]);
    expect(trimmed.complex.map((p) => p.attributes.value)).toEqual([120]);
    expect(trimmed.nfts).toHaveLength(1);
    expect(trimmed.transactions).toHaveLength(1);
  });
});
