import { describe, expect, it } from 'vitest';
import { MAX_SHARED, decodeShare, encodeShare } from '../src/castle/share.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

describe('sharing a castle', () => {
  it('round-trips the public wallets and a name', () => {
    const hash = encodeShare({ wallets: [A, B], name: 'Ser Bob’s keep' });
    expect(hash.startsWith('#visit=')).toBe(true);
    expect(decodeShare(hash)).toEqual({ wallets: [A, B], name: 'Ser Bob’s keep' });
  });

  it('a hash with nothing to visit shares nothing', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('#foo=1')).toBeNull();
    expect(decodeShare('#visit=not-an-address')).toBeNull();
  });

  it('a link is untrusted: odd entries dropped, addresses lowercased and once each, the name plain and short', () => {
    const shared = decodeShare(`#visit=${A.toUpperCase().replace('0X', '0x')},${A},<script>,0x123&name=${encodeURIComponent('\u0007a'.padEnd(80, 'b'))}`);
    expect(shared?.wallets).toEqual([A]);
    expect(shared?.name.length).toBe(40);
    expect(shared?.name.startsWith('a')).toBe(true);
  });

  it('at most a guild’s worth of wallets', () => {
    const many = Array.from({ length: 20 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'));
    expect(decodeShare(encodeShare({ wallets: many, name: '' }))?.wallets).toHaveLength(MAX_SHARED);
  });
});
