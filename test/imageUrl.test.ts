import { describe, expect, it } from 'vitest';
import { imageUrl } from '../src/domain/mappers.js';

describe('picture addresses from the API', () => {
  it('keeps a plain https address', () => {
    expect(imageUrl('https://nft2-cdn.alchemy.com/a/b.png')).toBe('https://nft2-cdn.alchemy.com/a/b.png');
  });

  it('takes the quote marks off an address wrapped in them (they made a relative 404)', () => {
    expect(imageUrl('"https://nft2-cdn.alchemy.com/a/b.png"')).toBe('https://nft2-cdn.alchemy.com/a/b.png');
    expect(imageUrl("  'https://example.com/x.png' ")).toBe('https://example.com/x.png');
  });

  it('drops anything that is not an https address', () => {
    expect(imageUrl('http://example.com/x.png')).toBeUndefined();
    expect(imageUrl('javascript:alert(1)')).toBeUndefined();
    expect(imageUrl('not a url')).toBeUndefined();
    expect(imageUrl('')).toBeUndefined();
    expect(imageUrl(undefined)).toBeUndefined();
    expect(imageUrl(42)).toBeUndefined();
  });
});
