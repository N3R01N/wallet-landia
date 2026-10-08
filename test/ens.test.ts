import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from '../src/util/keccak.js';
import { isEnsName, namehash } from '../src/data/ens.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('keccak256', () => {
  it('matches known vectors', () => {
    expect(toHex(keccak256(enc('')))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(toHex(keccak256(enc('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
    // a multi-block input (> 136 bytes)
    expect(toHex(keccak256(enc('a'.repeat(200))))).toHaveLength(64);
  });
  it('produces the ENS function selectors used', () => {
    expect(toHex(keccak256(enc('resolver(bytes32)'))).slice(0, 8)).toBe('0178b8bf');
    expect(toHex(keccak256(enc('addr(bytes32)'))).slice(0, 8)).toBe('3b3b57de');
    expect(toHex(keccak256(enc('name(bytes32)'))).slice(0, 8)).toBe('691f3431');
  });
});

describe('namehash', () => {
  it('matches EIP-137', () => {
    expect(namehash('')).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
    expect(namehash('foo.eth')).toBe('0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f');
  });
  it('tells names from addresses', () => {
    expect(isEnsName('vitalik.eth')).toBe(true);
    expect(isEnsName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
    expect(isEnsName('hello')).toBe(false);
  });
});
