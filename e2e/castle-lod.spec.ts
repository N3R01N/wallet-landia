import { expect, test } from './fixtures.js';
import { sceneState, showTown } from './castleHelpers.js';

/** Big buildings draw their far copy (`….lod1`) when they show small, the full one close up. */
test('zoomed out, big buildings switch to their far copies; zoomed in, back to the full ones', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?preview=lido,aave,uniswap');
  await showTown(page);
  await expect(page.locator('.castle-view[data-ready="true"]:visible')).toBeVisible({ timeout: 120_000 });
  const zoomTo = (z: number) => page.evaluate((zoom) => (window as unknown as { castleView: { focusBuilding(id: string, zoom: number): boolean } }).castleView.focusBuilding('lido', zoom), z);
  await zoomTo(0.35);
  await expect.poll(async () => (await sceneState(page)).far).toBe(true);
  expect((await sceneState(page)).lods).toBe(2); // Lido and Aave have one; Uniswap (L) does not
  await zoomTo(2);
  await expect.poll(async () => (await sceneState(page)).far).toBe(false);
});
