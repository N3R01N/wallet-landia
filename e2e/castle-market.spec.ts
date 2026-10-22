import { expect, test } from './fixtures.js';

/** The market: ETH's move over the last 24 hours, the arrow and the words pointing the way the number does. */

test('the Market panel shows the 24h change, and the arrow and words agree with its sign', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  const chip = page.locator('.conditions-chip');
  await expect(chip).toHaveAttribute('aria-label', /ETH, last 24h: /);
  await chip.click();

  const row = (name: string) => page.locator('table.facts tr', { has: page.locator('th', { hasText: name }) }).locator('td');
  await expect(row('ETH now')).toHaveText(/^\$[\d,]+$/);
  await expect(row('A day ago')).toHaveText(/^\$[\d,]+$/);
  const change = (await row('Change (24h)').textContent()) ?? '';
  const m = /^(▲▲|▲|→|▼|▼▼) ([+-]\d+\.\d)% · (.+)$/.exec(change);
  expect(m, change).not.toBeNull();
  const [, arrow, pctText, words] = m!;
  const pct = Number(pctText);
  const expected = pct >= 8 ? ['▲▲', 'Up a lot'] : pct >= 1.5 ? ['▲', 'Up a little'] : pct > -1.5 ? ['→', 'About the same'] : pct > -8 ? ['▼', 'Down a little'] : ['▼▼', 'Down a lot'];
  expect([arrow, words]).toEqual(expected);

  // the price a day ago sits on the right side of now
  const usd = async (name: string) => Number(((await row(name).textContent()) ?? '').replace(/[$,]/g, ''));
  const now = await usd('ETH now');
  const then = await usd('A day ago');
  if (pct > 0.1) expect(then).toBeLessThan(now);
  if (pct < -0.1) expect(then).toBeGreaterThan(now);

  await expect(page.getByText('last visit')).toHaveCount(0);
  expect(errors).toEqual([]);
});
