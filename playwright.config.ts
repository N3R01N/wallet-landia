import { defineConfig } from '@playwright/test';

/**
 * Browser tests: the things node tests cannot see (the castle's WebGL scene,
 * taps on it, the shell's layouts, the pages' files). WebGL runs on
 * SwiftShader so it works headless.
 */
/** Heavy specs (picture captures and the like) run before a commit only: name them *.slow.spec.ts. */
const SLOW = /\.slow\.spec\.ts$/;

// The tour already seen (it would cover the page), and low rendering quality (software WebGL is too slow for
// shadows and the environment light; e2e/castle-quality.spec.ts opens the high quality on purpose).
const SEEN_TOUR = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:5198',
      localStorage: [
        { name: 'wallet-landia-v4/castle/tour-seen', value: '1' },
        { name: 'wallet-landia-v4/dev/quality', value: 'low' },
      ],
    },
  ],
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  // Software-rendered WebGL (SwiftShader) is CPU-heavy: too many workers starve each other into timeouts.
  workers: 2,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5198',
    viewport: { width: 1400, height: 860 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // `fast` runs after every change (`npm run check`); `slow` before a commit (`npm run e2e:slow`).
  // Every test starts with the first-visit tour already seen (it would cover the page); the tour's own test clears it.
  projects: [
    { name: 'fast', testIgnore: SLOW, use: { storageState: SEEN_TOUR } },
    { name: 'slow', testMatch: SLOW, use: { storageState: SEEN_TOUR } },
  ],
  webServer: {
    command: 'npx vite --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: false,
  },
});
