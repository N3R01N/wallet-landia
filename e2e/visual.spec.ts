import { expect, test } from '@playwright/test';

/**
 * Visual validation captures (threejs-visual-validation skill): fixed camera
 * bookmarks, day and night, final and no-post. They are saved as test
 * attachments for review; the assertions are that each view renders without
 * errors and is not blank.
 */
const VIEWS = [
  { name: 'design-day', q: 'cam=design&hour=12', quality: 'medium' },
  { name: 'design-night', q: 'cam=design&hour=22', quality: 'medium' },
  { name: 'near-night-nopost', q: 'cam=near&hour=22&debug=nopost', quality: 'medium' },
  { name: 'far-day-low', q: 'cam=far&hour=12', quality: 'low' },
] as const;

for (const v of VIEWS) {
  test(`3D ${v.name}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await page.addInitScript((quality) => {
      localStorage.setItem('wallet-landia-v4/prefs/v1', JSON.stringify({ view: '3d', quality }));
    }, v.quality);
    await page.goto(`/?freeze&${v.q}`);
    await page.waitForTimeout(5000);
    const shot = await page.locator('.world').screenshot();
    await info.attach(v.name, { body: shot, contentType: 'image/png' });
    expect(shot.length).toBeGreaterThan(60_000); // a blank canvas compresses to almost nothing
    expect(errors).toEqual([]);
  });
}
