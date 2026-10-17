import { expect, test } from '@playwright/test';

/** The siege gallery: every siege asset, every clip, the team colours, the damage states, the instanced view. */

test('the siege gallery lists every siege asset and plays their clips', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/siege-gallery.html#unit.militia');
  // 18 units, 7 effects, 4 castle pieces, 2 markers
  await expect(page.locator('.sg-item')).toHaveCount(31);
  await expect(page.locator('.sg-info h2')).toHaveText('Militia', { timeout: 60_000 });
  const clips = page.locator('.sg-clip');
  await expect(clips).toHaveCount(6);
  await clips.filter({ hasText: 'death' }).click();
  await expect(clips.filter({ hasText: 'death' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Red (enemy)' }).click();
  await page.getByRole('button', { name: /Single model/ }).click();
  await expect(page.getByRole('button', { name: /As in battle/ })).toBeVisible();
  // a castle piece: its damage states
  await page.locator('.sg-item', { hasText: 'Keep' }).click();
  await expect(page.locator('.sg-info h2')).toHaveText('Keep', { timeout: 60_000 });
  await page.locator('input[aria-label="Damage state"]').fill('4');
  await expect(page.locator('.sg-state')).toHaveText('Collapsed (0)');
  // an effect opens from its link
  await page.goto('/siege-gallery.html#fx.lightning');
  await expect(page.locator('.sg-info h2')).toHaveText('Lightning', { timeout: 60_000 });
  await expect(page.locator('.sg-clip')).toHaveText(['pop · 0.60 s']);
  expect(errors).toEqual([]);
});
