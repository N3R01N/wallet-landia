import { defineConfig } from '@playwright/test';

/**
 * Browser smoke tests: the things node tests cannot see (canvas, WebGL,
 * pointer hit-testing). WebGL runs on SwiftShader so it works headless.
 */
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
  webServer: {
    command: 'npx vite --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: false,
  },
});
