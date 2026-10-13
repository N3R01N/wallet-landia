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
