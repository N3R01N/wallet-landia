import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blockFullness, nextPollDelay, PROVINCE_RPC, validRpcUrl } from '../src/data/rpc.js';

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

describe('province towers', () => {
  it('ask at a steady, slow pace (and still back off when the node fails)', () => {
    expect(nextPollDelay({ lastBlockMs: 0, now: 0, misses: 0, failures: 0, every: 10_000 })).toBe(10_000);
    expect(nextPollDelay({ lastBlockMs: 0, now: 0, misses: 5, failures: 0, every: 10_000 })).toBe(10_000);
    expect(nextPollDelay({ lastBlockMs: 0, now: 0, misses: 0, failures: 2, every: 10_000 })).toBe(8_000);
  });

  it('measure fullness per chain: against the gas limit, or Arbitrum’s speed limit', () => {
    expect(blockFullness('ethereum', 15_000_000, 30_000_000)).toBe(0.5);
    // Base targets a sixth of its limit: 25M of 400M is a little under half of target-and-again
    expect(blockFullness('base', 400_000_000 / 6, 400_000_000)).toBeCloseTo(0.5);
    expect(blockFullness('base', 25_201_735, 400_000_000)).toBeCloseTo(0.19, 2);
    expect(blockFullness('optimism', 300_000_000, 40_000_000)).toBe(1);
    // Arbitrum's limit is vast: a block with 1.75M gas (its speed limit's worth for a ¼ s block) is half full
    expect(blockFullness('arbitrum', 1_750_000, 1_125_899_906_842_624)).toBe(0.5);
  });

  it('are allowed by the page’s security policy', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    for (const url of Object.values(PROVINCE_RPC)) expect(html).toContain(url);
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
