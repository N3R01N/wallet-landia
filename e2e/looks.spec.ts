import { expect, test } from '@playwright/test';

test('a bundled pack can be applied everywhere and the choice survives a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await expect(page.locator('.inspector')).toContainText('Ember & Frost');
  await expect(page.locator('.inspector')).toContainText('0 in use');
  await page.locator('.inspector .btn', { hasText: 'Use everywhere' }).click();
  await expect(page.locator('.inspector')).toContainText('10 in use');
  await expect(page.locator('.inspector select[aria-label="Raven"]')).toHaveValue('ember-frost');

  await page.reload();
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await expect(page.locator('.inspector')).toContainText('10 in use');

  // per-slot choice back to built-in
  await page.locator('.inspector select[aria-label="Raven"]').selectOption('default');
  await page.locator('.inspector .close').click();
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await expect(page.locator('.inspector')).toContainText('9 in use');
  expect(errors).toEqual([]);
});

test('importing a pack folder installs it, rejects a bad one, and removal works', async ({ page }) => {
  const { mkdtempSync, cpSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const good = join(mkdtempSync(join(tmpdir(), 'pack-')), 'my-pack');
  cpSync('public/packs/ember-frost', good, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(good, 'pack.json'), 'utf8'));
  writeFileSync(join(good, 'pack.json'), JSON.stringify({ ...manifest, id: 'my-pack', name: 'My Pack', author: 'Tester' }));
  const bad = join(mkdtempSync(join(tmpdir(), 'pack-')), 'bad-pack');
  cpSync('public/packs/ember-frost', bad, { recursive: true });
  writeFileSync(join(bad, 'pack.json'), JSON.stringify({ ...manifest, id: 'bad-pack', slots: { 'npc.raven': { sprite: { src: 'missing.png', ax: 0, ay: 0 } } } }));

  await page.goto('/');
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await expect(page.locator('.inspector')).toContainText('Ember & Frost');

  await page.locator('.inspector input[type=file]').setInputFiles(bad);
  await expect(page.locator('.inspector .form-msg')).toContainText('missing file: missing.png');

  await page.locator('.inspector input[type=file]').setInputFiles(good);
  await expect(page.locator('.inspector')).toContainText('My Pack');
  await expect(page.locator('.inspector')).toContainText('imported');

  // it persists (IndexedDB) and can be removed
  await page.reload();
  await page.locator('.btn', { hasText: 'Looks' }).click();
  await expect(page.locator('.inspector')).toContainText('My Pack');
  await page.locator('.pack-row', { hasText: 'My Pack' }).locator('.btn', { hasText: '✕' }).click();
  await expect(page.locator('.inspector')).not.toContainText('My Pack');
});
