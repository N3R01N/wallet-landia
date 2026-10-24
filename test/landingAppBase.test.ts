/** The landing page's links: to app.zenigard.cc from the real site, else to this site's front page. */

import { describe, expect, it } from 'vitest';
import { appBase } from '../src/landing/appBase.js';

describe('the landing page’s way to the app', () => {
  it('goes to app.zenigard.cc from the real site, else to this site', () => {
    expect(appBase('zenigard.cc')).toBe('https://app.zenigard.cc/');
    expect(appBase('www.zenigard.cc')).toBe('https://app.zenigard.cc/');
    expect(appBase('localhost')).toBe('/');
    expect(appBase('zenigard.vercel.app')).toBe('/');
  });
});
