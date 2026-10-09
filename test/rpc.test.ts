import { describe, expect, it } from 'vitest';
import { nextPollDelay, validRpcUrl } from '../src/data/rpc.js';
import { versioned } from '../src/assets/themeBundles.js';

describe('the heartbeat asks about once a block', () => {
  const t0 = 1_000_000_000;
  it('waits for the next block to be due after one arrives', () => {
    // a block stamped 1 s ago: the next is due in ~11 s (+1.5 s to spread)
    expect(nextPollDelay({ lastBlockMs: t0 - 1_000, now: t0, misses: 0, failures: 0 })).toBe(12_500);
    // never sooner than 2 s, never longer than a slot and a bit
    expect(nextPollDelay({ lastBlockMs: t0 - 20_000, now: t0, misses: 0, failures: 0 })).toBe(2_000);
    expect(nextPollDelay({ lastBlockMs: t0 + 60_000, now: t0, misses: 0, failures: 0 })).toBe(14_000);
  });
  it('looks again soon when a block is late, and backs off when the node fails', () => {
    expect(nextPollDelay({ lastBlockMs: t0, now: t0, misses: 1, failures: 0 })).toBe(2_000);
    expect(nextPollDelay({ lastBlockMs: t0, now: t0, misses: 9, failures: 0 })).toBe(12_000);
    expect(nextPollDelay({ lastBlockMs: t0, now: t0, misses: 0, failures: 1 })).toBe(4_000);
    expect(nextPollDelay({ lastBlockMs: t0, now: t0, misses: 0, failures: 3 })).toBe(16_000);
    expect(nextPollDelay({ lastBlockMs: t0, now: t0, misses: 0, failures: 20 })).toBe(120_000);
  });
});

describe('own RPC addresses', () => {
  it('accepts https addresses of the allowed providers only', () => {
    expect(validRpcUrl('https://eth-mainnet.g.alchemy.com/v2/abc')).toBe(true);
    expect(validRpcUrl('https://mainnet.infura.io/v3/abc')).toBe(true);
    expect(validRpcUrl('https://eth.llamarpc.com')).toBe(true);
    expect(validRpcUrl('http://eth.llamarpc.com')).toBe(false); // not https
    expect(validRpcUrl('https://evil.example.com')).toBe(false); // not allowed by the page's security policy
    expect(validRpcUrl('https://g.alchemy.com.evil.io')).toBe(false);
    expect(validRpcUrl('not a url')).toBe(false);
  });
});

describe('versioned file URLs', () => {
  it('stamp the pack version so caches keep a file until a new release', () => {
    expect(versioned('/themes/medieval/a.webp', '1.2.0')).toBe('/themes/medieval/a.webp?v=1.2.0');
    expect(versioned('/x.glb?y=1', '2')).toBe('/x.glb?y=1&v=2');
  });
});
