import { describe, expect, it } from 'vitest';
import {
  DIRECT_BASE,
  PROXY_BASE,
  authHeader,
  baseUrl,
  buildUrl,
} from '../src/data/zerion/transport.js';

describe('authHeader', () => {
  it('uses the key as username with an empty password', () => {
    // Zerion's docs: base64 of "KEY:" — the trailing colon is load-bearing.
    expect(authHeader('zk_dev_abc')).toBe(`Basic ${btoa('zk_dev_abc:')}`);
  });
});

describe('baseUrl', () => {
  it('maps each transport to its origin', () => {
    expect(baseUrl('direct')).toBe(DIRECT_BASE);
    expect(baseUrl('proxy')).toBe(PROXY_BASE);
  });
});

describe('buildUrl', () => {
  it('builds a bare path when there are no params', () => {
    expect(buildUrl('direct', '/wallets/0xabc/portfolio')).toBe(
      'https://api.zerion.io/v1/wallets/0xabc/portfolio',
    );
  });

  it('leaves JSON:API brackets unencoded so URLs stay readable', () => {
    const url = buildUrl('direct', '/wallets/0xabc/positions/', {
      currency: 'usd',
      'filter[positions]': 'only_complex',
      'page[size]': 100,
    });
    expect(url).toBe(
      'https://api.zerion.io/v1/wallets/0xabc/positions/?currency=usd&filter[positions]=only_complex&page[size]=100',
    );
  });

  it('drops undefined params rather than sending "undefined"', () => {
    const url = buildUrl('proxy', '/wallets/0xabc/transactions/', {
      currency: 'usd',
      'filter[chain_ids]': undefined,
    });
    expect(url).toBe('/api/zerion/v1/wallets/0xabc/transactions/?currency=usd');
  });
});
