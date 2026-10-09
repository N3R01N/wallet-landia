import { defineConfig } from '@playwright/test';

/**
 * Browser smoke tests: the things node tests cannot see (canvas, WebGL,
 * pointer hit-testing). WebGL runs on SwiftShader so it works headless.
 */
/** The specs that render themed 3D towns or capture pictures. */
const SLOW = /(themes|sandbox|visual)\.spec\.ts$/;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  // Software-rendered WebGL (SwiftShader) is CPU-heavy; with too many workers
  // the 3D visual captures starve the other tests into timeouts.
  workers: 2,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5198',
    viewport: { width: 1400, height: 860 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // Two groups: `fast` (2D, panels, live data, a 3D smoke check: ~1–2 min) runs after
  // every change; `slow` (themed 3D towns, the look sandbox, visual captures:
  // ~5 min in software WebGL) runs before a commit. `npm run e2e:fast` / `e2e:slow`.
  projects: [
    // fast tests open the town top-down (the app's default is 3D, which costs seconds a page in
    // software WebGL); a test that needs 3D switches to it, or sets its own preferences
    { name: 'fast', testIgnore: SLOW, use: { storageState: { cookies: [], origins: [{ origin: 'http://localhost:5198', localStorage: [{ name: 'wallet-landia-v4/prefs/v1', value: JSON.stringify({ view: 'top' }) }] }] } } },
    { name: 'slow', testMatch: SLOW },
  ],
  webServer: {
    command: 'npx vite --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: false,
  },
});
