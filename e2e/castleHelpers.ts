import { expect, type Page } from '@playwright/test';

interface Hook {
  castleView?: {
    screenPoint(id: string): { x: number; y: number } | null;
    focusBuilding(id: string, zoom?: number): boolean;
    courierPoint(): { x: number; y: number } | null;
    personPoint(): { x: number; y: number } | null;
    focusPerson(): boolean;
    buildingIds(): string[];
    plan: { buildings: { protocol: { id: string; name: string } }[] };
    state(): { bridgeAngle: number; barrierAngle: number; courier: { x: number; z: number } | null; couriers: number; queued: number; zoom: number; yaw: number; pitch: number; ringing: boolean; upcoming: string[]; lods: number; far: boolean; collateral: number };
  };
}

/**
 * Waits for the castle scene to load its models, then taps a protocol's building
 * (by default the one nearest the gate). Returns the protocol's name.
 */
export async function tapBuilding(page: Page, index = 0): Promise<string> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  // in the middle of the view first: nothing in front of it
  const found = await page.evaluate((i) => {
    const v = (window as unknown as Hook).castleView!;
    const b = v.plan.buildings[i];
    return b ? v.focusBuilding(b.protocol.id, 2) : false;
  }, index);
  // the camera eases there: wait until the building stands still on the screen
  const at = () => page.evaluate((i) => {
    const v = (window as unknown as Hook).castleView!;
    const b = v.plan.buildings[i];
    return b ? v.screenPoint(b.protocol.id) : null;
  }, index);
  if (found) {
    let last = await at();
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(300);
      const now = await at();
      if (now && last && Math.hypot(now.x - last.x, now.y - last.y) < 1) break;
      last = now;
    }
  }
  let target = await page.evaluate((i) => {
    const v = (window as unknown as Hook).castleView!;
    const b = v.plan.buildings[i];
    return b ? { point: v.screenPoint(b.protocol.id), name: b.protocol.name } : null;
  }, index);
  // hidden behind a bigger building from this side: turn the view round until it shows
  for (let k = 0; k < 3 && target && !target.point; k++) {
    await page.evaluate(() => (window as unknown as { castleView: { turn(r: number): void } }).castleView.turn(Math.PI / 2));
    await page.waitForTimeout(1500);
    target = await page.evaluate((i) => {
      const v = (window as unknown as Hook).castleView!;
      const b = v.plan.buildings[i];
      return b ? { point: v.screenPoint(b.protocol.id), name: b.protocol.name } : null;
    }, index);
  }
  if (!target?.point) throw new Error(`no building ${index} in town`);
  await page.mouse.click(target.point.x, target.point.y);
  return target.name;
}

export async function sceneState(page: Page): Promise<ReturnType<NonNullable<Hook['castleView']>['state']>> {
  return page.evaluate(() => (window as unknown as Hook).castleView!.state());
}

/** Taps the first courier out (waits for one to set out and leave the castle: inside, the walls may hide it). */
export async function tapCourier(page: Page): Promise<void> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await expect.poll(async () => (await sceneState(page)).courier?.z ?? -99, { timeout: 40_000 }).toBeGreaterThan(3);
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).castleView?.courierPoint() ?? null), { timeout: 20_000 }).not.toBeNull();
  const pt = await page.evaluate(() => (window as unknown as Hook).castleView!.courierPoint());
  await page.mouse.click(pt!.x, pt!.y);
}

/** Taps a townsperson out walking (waits for one in view). */
export async function tapPerson(page: Page): Promise<void> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Hook).castleView!.focusPerson())).toBe(true);
  await page.waitForTimeout(2000); // the camera eases there
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).castleView?.personPoint() ?? null), { timeout: 20_000 }).not.toBeNull();
  const pt = await page.evaluate(() => (window as unknown as Hook).castleView!.personPoint());
  await page.mouse.click(pt!.x, pt!.y);
}

/** Turns the scene to the town (once one tab, castle and town; the camera eases there). */
export async function showTown(page: Page): Promise<void> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => (window as unknown as { castleView: { lookAt(w: 'town'): void } }).castleView.lookAt('town'));
  await page.waitForTimeout(1500);
}

/** Taps a soldier by the keep (0: the Knight, Siege; 1: the Vault Warden, Ledger Wars); their invitation shows. */
export async function tapGuard(page: Page, i: number): Promise<void> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
  type View = { castleView: { lookAt(w: 'castle'): void; guardPoint(i: number): { x: number; y: number } | null } };
  await page.evaluate(() => (window as unknown as View).castleView.lookAt('castle'));
  // the camera eases there: wait until the guard stands still on the screen
  let last: { x: number; y: number } | null = null;
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(300);
    const now = await page.evaluate((n) => (window as unknown as View).castleView.guardPoint(n), i);
    if (now && last && Math.hypot(now.x - last.x, now.y - last.y) < 1) break;
    last = now;
  }
  const pt = await page.evaluate((n) => (window as unknown as View).castleView.guardPoint(n), i);
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await expect(page.locator(`.guard-invite[data-guard="${i}"]`)).toBeVisible();
}
