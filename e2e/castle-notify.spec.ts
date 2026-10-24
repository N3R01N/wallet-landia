import { expect, test, type Page } from './fixtures.js';
import { sceneUp } from './castleHelpers.js';

/**
 * Notifications (docs/ENGAGEMENT.md D3), with the browser's Notification API
 * stubbed in the page: the browser is asked only after the Guild tab's
 * button, the choice is kept, and new couriers while the tab is hidden are
 * told in one notification (none while it is in view).
 */

const PREFS = 'zenigard/prefs/v1';

type Stub = { asked: number; shown: { title: string; body: string }[] };

/** A Notification that says yes when asked and records what it shows. */
async function stubNotifications(page: Page, answer: NotificationPermission = 'granted'): Promise<void> {
  await page.addInitScript((answer) => {
    const stub: Stub = { asked: 0, shown: [] };
    (window as unknown as { notifyStub: Stub }).notifyStub = stub;
    let permission: NotificationPermission = 'default';
    class FakeNotification {
      static get permission(): NotificationPermission {
        return permission;
      }
      static async requestPermission(): Promise<NotificationPermission> {
        stub.asked++;
        permission = answer;
        return permission;
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        stub.shown.push({ title, body: options?.body ?? '' });
      }
      close(): void {}
    }
    // after a reload the browser remembers its answer
    if (localStorage.getItem('notify-stub-granted') === '1') permission = answer;
    const ask = FakeNotification.requestPermission;
    FakeNotification.requestPermission = async () => {
      const a = await ask();
      localStorage.setItem('notify-stub-granted', '1');
      return a;
    };
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
  }, answer);
}

const stub = (page: Page) => page.evaluate(() => (window as unknown as { notifyStub: Stub }).notifyStub);

/** The page as if its tab were in the background (or back in view). */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const newCouriers = (page: Page, n: number) => page.evaluate((n) => (window as unknown as { castleNewCouriers(n: number): void }).castleNewCouriers(n), n);

test('the browser is asked only after the click; the choice is kept; couriers in a hidden tab are told in one notification', async ({ page }) => {
  test.setTimeout(180_000);
  await stubNotifications(page);
  await page.goto('/');
  await sceneUp(page);

  // nothing asked on opening, nor on opening the Guild tab
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const section = page.locator('.guild-tab [data-section="notify"]');
  await expect(section.locator('h2')).toHaveText('Notifications');
  await expect(section).toContainText('nothing new about your wallets leaves it');
  await expect(section.locator('.notify-state')).toHaveText('Off.');
  // the dev server has no service worker: the look while closed is not available here, said in one line
  await expect(section.locator('.notify-background')).toHaveText(/only while the tab is open/);
  expect((await stub(page)).asked).toBe(0);

  // couriers before opting in: nothing
  await page.locator('.tab', { hasText: 'Castle' }).click();
  await sceneUp(page);
  await setHidden(page, true);
  await newCouriers(page, 2);
  await page.waitForTimeout(4000);
  expect((await stub(page)).shown).toHaveLength(0);
  await setHidden(page, false);

  // the click asks, and the yes is kept
  await page.locator('.tab', { hasText: 'Guild' }).click();
  await section.getByRole('button', { name: 'Notify me' }).click();
  await expect(section.locator('.notify-state')).toHaveText('On.');
  await expect(section).toHaveAttribute('data-on', 'true');
  expect((await stub(page)).asked).toBe(1);
  expect(await page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as { notify?: boolean }).notify, PREFS)).toBe(true);

  // kept over a reload, with nothing asked again
  await page.reload();
  await sceneUp(page);
  await page.locator('.tab', { hasText: 'Guild' }).click();
  await expect(section.locator('.notify-state')).toHaveText('On.');
  expect((await stub(page)).asked).toBe(0);
  await page.locator('.tab', { hasText: 'Castle' }).click();
  await sceneUp(page);

  // in view: the castle shows them, no notification
  await newCouriers(page, 1);
  await page.waitForTimeout(4000);
  expect((await stub(page)).shown).toHaveLength(0);

  // hidden: a burst of three is one notification, with each one's line
  await setHidden(page, true);
  await newCouriers(page, 3);
  await expect.poll(async () => (await stub(page)).shown.length, { timeout: 10_000 }).toBe(1);
  const note = (await stub(page)).shown[0]!;
  expect(note.title).toMatch(/^3 couriers (came in|went out|came and went|went between your wallets)$/);
  const lines = note.body.split('\n');
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toMatch(/^A courier /);

  // one alone: its own line, and the wallet's name
  await newCouriers(page, 1);
  await expect.poll(async () => (await stub(page)).shown.length, { timeout: 10_000 }).toBe(2);
  const one = (await stub(page)).shown[1]!;
  expect(one.title).toBe(lines[2]);
  expect(one.body).not.toBe('');

  // turned off: nothing more
  await setHidden(page, false);
  await page.locator('.tab', { hasText: 'Guild' }).click();
  await section.getByRole('button', { name: 'Turn off' }).click();
  await expect(section.locator('.notify-state')).toHaveText('Off.');
  await setHidden(page, true);
  await newCouriers(page, 1);
  await page.waitForTimeout(4000);
  expect((await stub(page)).shown).toHaveLength(2);
});

test('a browser that says no: told plainly, and nothing kept', async ({ page }) => {
  await stubNotifications(page, 'denied');
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Guild' }).click();
  const section = page.locator('.guild-tab [data-section="notify"]');
  await section.getByRole('button', { name: 'Notify me' }).click();
  await expect(section.locator('.notify-state')).toContainText('The browser blocks notifications for this site');
  expect((await stub(page)).asked).toBe(1);
  expect(await page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as { notify?: boolean }).notify ?? false, PREFS)).toBe(false);
});
