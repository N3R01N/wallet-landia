import { expect, test, type Page } from '@playwright/test';
import { sceneState, tapBuilding } from './castleHelpers.js';

/** Turning and tilting the castle view: keys, a right-drag and the corner buttons move the camera, and buildings can still be tapped after. */

const DEFAULT_YAW = Math.PI / 4;

/** Waits until the camera has settled on this yaw (it eases towards it). */
async function settlesOn(page: Page, yaw: number): Promise<void> {
  await expect
    .poll(async () => {
      const off = (await sceneState(page)).yaw - yaw;
      return Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
    }, { timeout: 40_000 }) // it eases a little each frame: slow frames (software WebGL under load) take longer
    .toBeLessThan(0.01);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Q/E turn the view, R/F tilt it within its limits, a right-drag turns it, Reset brings it back', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
    const start = await sceneState(page);
    expect(start.yaw).toBeCloseTo(DEFAULT_YAW, 3);

    await page.keyboard.press('e');
    await settlesOn(page, DEFAULT_YAW + Math.PI / 12);
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await settlesOn(page, DEFAULT_YAW - Math.PI / 12);

    await page.keyboard.press('r');
    await expect.poll(async () => (await sceneState(page)).pitch).toBeGreaterThan(start.pitch + 0.15);
    // tilting far down stops at 25° above the horizon
    for (let i = 0; i < 8; i++) await page.keyboard.press('f');
    await expect.poll(async () => (await sceneState(page)).pitch).toBeCloseTo((25 * Math.PI) / 180, 3);

    // a right-drag turns the view, and opens no sheet
    const box = (await page.locator('.castle-view canvas').boundingBox())!;
    const before = (await sceneState(page)).yaw;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await expect.poll(async () => Math.abs((await sceneState(page)).yaw - before)).toBeGreaterThan(0.5);
    await expect(page.locator('.sheet')).toBeHidden();

    await page.locator('.camera-reset').click();
    await settlesOn(page, DEFAULT_YAW);
    await expect.poll(async () => (await sceneState(page)).pitch).toBeCloseTo(start.pitch, 3);
    expect(errors).toEqual([]);
  });

  test('after turning the view round, tapping a building still opens its sheet', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab', { hasText: 'Town' }).click();
    await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
    const view = page.locator('.castle-view:visible');
    await view.locator('.camera-right').click();
    await view.locator('.camera-right').click();
    await settlesOn(page, DEFAULT_YAW + Math.PI / 2);
    const name = await tapBuilding(page, 1);
    await expect(page.locator('.sheet .sheet-title')).toHaveText(name);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the turn buttons sit bottom right, big enough to tap, clear of the other buttons; a building can be tapped after turning', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab', { hasText: 'Town' }).click();
    await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
    const view = page.locator('.castle-view:visible');
    const area = (await view.boundingBox())!;
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const others = [];
    for (const sel of ['.chronicle-btn', '.replay-open', '.arrange-open']) {
      const o = view.locator(sel);
      if (await o.count()) others.push((await o.boundingBox())!);
    }
    for (const sel of ['.camera-left', '.camera-reset', '.camera-right']) {
      const b = (await view.locator(sel).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
      expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height);
      expect(b.y).toBeGreaterThan(area.y + area.height / 2);
      for (const o of others) expect(overlaps(b, o)).toBe(false);
    }

    // two fingers (real touches, through the browser's devtools protocol): a twist turns the view, moving both up tilts it
    const cdp = await page.context().newCDPSession(page);
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
    const fingers = (angle: number, dy = 0) => [-1, 1].map((s) => ({ x: cx + s * 60 * Math.cos(angle), y: cy + dy + s * 60 * Math.sin(angle) }));
    const start = await sceneState(page);
    await touch('touchStart', fingers(0));
    for (let i = 1; i <= 6; i++) await touch('touchMove', fingers((i / 6) * 0.6));
    await touch('touchEnd', []);
    // twisted clockwise by 0.6 rad: the scene turns with the fingers
    await settlesOn(page, start.yaw + 0.6);
    await touch('touchStart', fingers(0));
    for (let i = 1; i <= 6; i++) await touch('touchMove', fingers(0, -i * 10));
    await touch('touchEnd', []);
    await expect.poll(async () => (await sceneState(page)).pitch).toBeLessThan(start.pitch - 0.2);
    await expect(page.locator('.sheet')).toBeHidden();

    await view.locator('.camera-reset').tap();
    await settlesOn(page, DEFAULT_YAW);
    await view.locator('.camera-left').tap();
    await settlesOn(page, 0);
    const name = await tapBuilding(page, 0);
    await expect(page.locator('.sheet .sheet-title')).toHaveText(name);
  });
});
