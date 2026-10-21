import { describe, expect, it } from 'vitest';
import { allowedImageUrl } from '../api/image.js';

describe('the picture proxy only fetches pictures from known hosts', () => {
  it('passes an https picture on a known host', () => {
    expect(allowedImageUrl('https://nft2-cdn.alchemy.com/x/y.png')).toBe('https://nft2-cdn.alchemy.com/x/y.png');
    expect(allowedImageUrl('https://cdn.zerion.io/icons/eth.png')).toBe('https://cdn.zerion.io/icons/eth.png');
  });
  it('refuses other hosts, other schemes and credentials', () => {
    expect(allowedImageUrl('https://evil.example.com/x.png')).toBeNull();
    expect(allowedImageUrl('http://nft2-cdn.alchemy.com/x.png')).toBeNull();
    expect(allowedImageUrl('https://user:pw@nft2-cdn.alchemy.com/x.png')).toBeNull();
    expect(allowedImageUrl('https://nft2-cdn.alchemy.com.evil.example/x.png')).toBeNull();
    expect(allowedImageUrl('javascript:alert(1)')).toBeNull();
    expect(allowedImageUrl(null)).toBeNull();
    expect(allowedImageUrl('not a url')).toBeNull();
  });
});

describe('pictures served without an image type (S3 gives application/octet-stream)', () => {
  it('are judged by their first bytes: PNG, JPEG, GIF, WebP; anything else (an SVG, a page) is refused', async () => {
    const { sniffImage } = await import('../api/image.js');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });
});

describe('an SVG picture (much NFT art is SVG)', () => {
  it('is passed on, sandboxed so that opened as a page it runs no script', async () => {
    const { default: handler, SANDBOX } = await import('../api/image.js');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const real = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }))) as typeof fetch;
    try {
      const res = await handler(new Request(`http://localhost/api/image?u=${encodeURIComponent('https://nft2-cdn.alchemy.com/eth-mainnet/abc')}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(res.headers.get('content-security-policy')).toBe(SANDBOX);
      expect(SANDBOX).toContain('sandbox');
      expect(SANDBOX).toContain("default-src 'none'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      globalThis.fetch = real;
    }
  });
});
