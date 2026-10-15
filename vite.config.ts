import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * A static site. The browser calls api.zerion.io directly with the key the
 * player pastes in, or (production builds) goes through the /api/zerion proxy,
 * which the dev and preview servers stand in for below.
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

/**
 * The dev server's hot reload talks over a WebSocket, so `ws:` joins the
 * pages' connect-src while serving only: a built page never allows sockets
 * (one to any host would let an injected script carry the stored key away).
 */
const devSockets: Plugin = {
  name: 'csp-dev-sockets',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws:"),
};

export default defineConfig({
  plugins: [devSockets],
  // three.js is most of the castle page's code.
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    // Three pages: the castle, the asset gallery and the showroom.
    rollupOptions: { input: { main: 'index.html', assets: 'assets.html', showroom: 'showroom.html' } },
  },
  // Pre-bundle the three.js add-ons the castle uses, so the dev server never
  // finds one mid-session and reloads the page.
  optimizeDeps: { include: ['three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/utils/SkeletonUtils.js', 'three/examples/jsm/environments/RoomEnvironment.js', 'three/examples/jsm/controls/OrbitControls.js', 'three/examples/jsm/libs/meshopt_decoder.module.js'] },
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
