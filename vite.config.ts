import { defineConfig } from 'vitest/config';

/**
 * A static site. The browser calls api.zerion.io directly with the key the
 * player pastes in (CORS was verified in v3), so there is no proxy here.
 */
const zerionProxy = {
  target: 'https://api.zerion.io',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/zerion/, ''),
  // Zerion refuses requests that carry a non-localhost Origin
  configure: (proxy: { on(event: 'proxyReq', fn: (req: { removeHeader(name: string): void }) => void): void }) => {
    proxy.on('proxyReq', (req) => {
      req.removeHeader('origin');
      req.removeHeader('referer');
    });
  },
};

export default defineConfig({
  // three.js + post-processing is ~650 kB but only loads when the 3D view opens.
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    // Two pages: the town, and the look sandbox.
    rollupOptions: { input: { main: 'index.html', sandbox: 'sandbox.html' } },
  },
  // Pre-bundle three.js add-ons that are only reached through the lazily loaded
  // 3D view, so the dev server never finds one mid-session and reloads the page.
  optimizeDeps: { include: ['three/addons/environments/RoomEnvironment.js'] },
  // /api/zerion → api.zerion.io for `vite preview` (production builds use the
  // proxy transport; on Vercel the edge function in api/ answers instead).
  server: { proxy: { '/api/zerion': zerionProxy } },
  preview: { proxy: { '/api/zerion': zerionProxy } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**'],
  },
});
