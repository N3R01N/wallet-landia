import { defineConfig } from 'vitest/config';

/**
 * A static site. The browser calls api.zerion.io directly with the key the
 * player pastes in (CORS was verified in v3), so there is no proxy here.
 */
export default defineConfig({
  // three.js + post-processing is ~650 kB but only loads when the 3D view opens.
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**'],
  },
});
