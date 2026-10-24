import { defineConfig } from '@playwright/test';

/**
 * Browser tests: the things node tests cannot see (the castle's WebGL scene,
 * taps on it, the shell's layouts, the pages' files). WebGL runs on
 * SwiftShader so it works headless.
 */
/** The dev server's port for the tests: E2E_PORT lets runs in several worktrees side by side each have their own. */
const PORT = Number(process.env['E2E_PORT'] ?? 5198);
export const BASE_URL = `http://localhost:${PORT}`;

/** Heavy specs (picture captures and the like) run before a commit only: name them *.slow.spec.ts. */
const SLOW = /\.slow\.spec\.ts$/;

/**
 * How the dev server's castle runs under test (software WebGL draws a few frames a second, slower still with
 * several workers): low quality (no shadows or environment light; e2e/castle-quality.spec.ts opens the high
 * quality on purpose), half the pixels, and the scene's clock at twice real time in steps that keep up however
 * few frames are drawn (a courier walks as far whatever the machine), drawing at most 8 frames a second so several browsers share the
 * CPU without starving each other.
 */
export const TEST_RENDERING = [
  { name: 'zenigard/dev/quality', value: 'low' },
  { name: 'zenigard/dev/pixel-ratio', value: '0.5' },
  { name: 'zenigard/dev/clock', value: '2' },
  { name: 'zenigard/dev/max-fps', value: '8' },
];

/** …and the tour already seen (it would cover the page). */
const SEEN_TOUR = {
  cookies: [],
  origins: [{ origin: BASE_URL, localStorage: [{ name: 'zenigard/castle/tour-seen', value: '1' }, ...TEST_RENDERING] }],
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  // Software-rendered WebGL (SwiftShader) is CPU-heavy: too many workers starve each other into timeouts.
  workers: 2,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
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
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
  },
});
