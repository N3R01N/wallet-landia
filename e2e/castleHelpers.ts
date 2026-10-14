import { expect, type Page } from '@playwright/test';

interface Hook {
  castleView?: {
    screenPoint(id: string): { x: number; y: number } | null;
    courierPoint(): { x: number; y: number } | null;
    buildingIds(): string[];
    plan: { buildings: { protocol: { id: string; name: string } }[] };
    state(): { bridgeAngle: number; barrierAngle: number; courier: { x: number; z: number } | null; couriers: number; queued: number; zoom: number; yaw: number; pitch: number; ringing: boolean; upcoming: string[] };
  };
}

/**
 * Waits for the castle scene to load its models, then taps a protocol's building
 * (by default the one nearest the gate). Returns the protocol's name.
 */
export async function tapBuilding(page: Page, index = 0): Promise<string> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  const target = await page.evaluate((i) => {
    const v = (window as unknown as Hook).castleView!;
    const b = v.plan.buildings[i];
    return b ? { point: v.screenPoint(b.protocol.id), name: b.protocol.name } : null;
  }, index);
  if (!target?.point) throw new Error(`no building ${index} in town`);
  await page.mouse.click(target.point.x, target.point.y);
  return target.name;
}

export async function sceneState(page: Page): Promise<ReturnType<NonNullable<Hook['castleView']>['state']>> {
  return page.evaluate(() => (window as unknown as Hook).castleView!.state());
}

/** Taps the first courier out (waits for one to set out). */
export async function tapCourier(page: Page): Promise<void> {
  await expect(page.locator('.castle-view[data-ready="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).castleView?.courierPoint() ?? null), { timeout: 20_000 }).not.toBeNull();
  const pt = await page.evaluate(() => (window as unknown as Hook).castleView!.courierPoint());
  await page.mouse.click(pt!.x, pt!.y);
}
