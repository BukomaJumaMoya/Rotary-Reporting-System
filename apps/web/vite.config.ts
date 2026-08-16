import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * The PWA (ADR-006, NFR-6.3).
     *
     * The SPA is served from the API container on the same origin (M2 session 2), which
     * makes this much simpler than it usually is: the service worker's scope is the whole
     * origin, `/api` is a same-origin path rather than a cross-origin fetch, and there is no
     * CORS anywhere in the sync path.
     *
     * `injectManifest`, not `generateSW`: the worker is written by hand in `src/sw.ts`
     * because it has to handle a **Background Sync** event, which a generated worker cannot
     * express. The routing and caching rules live there too — see that file for why each
     * cache is shaped the way it is, which is a data-protection argument rather than a
     * performance one.
     */
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Rotaract District 9218',
        short_name: 'Rotaract DIS',
        description: 'Club activity, membership and performance for Rotaract District 9218.',
        // Same origin as the API, so the app starts at the root and the service worker
        // controls everything under it.
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#d41367',
        lang: 'en',
        categories: ['productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // The app shell and every hashed asset. Precaching is safe precisely because the
        // filenames are hashed: a new build is a new name, never a stale hit.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: {
        // Off in development: a service worker caching a dev server is how an afternoon
        // disappears into "why is my change not showing".
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Bound to every interface so the app can be opened from a phone on the same network,
    // which is the only way to test any of this properly.
    host: true,
    proxy: {
      // The API is a separate process in development. Proxying it keeps the browser on a
      // single origin, so the session cookie behaves exactly as it will in production.
      '/api': { target: 'http://localhost:4000' },
    },
  },
  build: {
    // Written so `scripts/bundle-budget.mjs` can tell the INITIAL bundle from the lazy
    // chunks. Guessing from filenames would count an admin screen against a club officer's
    // first load, or miss a static import that genuinely is in it — the manifest states
    // which chunk is the entry and exactly what it pulls in eagerly.
    manifest: true,

    // No inline module-preload polyfill. Vite injects one as an INLINE script once a build
    // has more than one chunk, and the Content-Security-Policy the API serves
    // (platform/security-headers.ts) allows no inline script at all. Every browser this
    // system targets — Android Chrome, current Safari — supports modulepreload natively,
    // so the polyfill would buy nothing and cost the strictest directive in the policy.
    modulePreload: { polyfill: false },

    // Members report from metered Android data. The budget in CLAUDE.md is 250 KB of
    // initial JS, measured GZIPPED — which is what crosses the wire.
    //
    // This limit measures RAW bytes, so it is not the budget: it is an early smell,
    // tuned to fire well before the gzipped figure is anywhere near 250 KB. Roughly
    // 3.3× compression on this bundle means 400 KB raw is about 120 KB gzipped.
    // `npm run build` prints the gzipped number; that is the one to read.
    chunkSizeWarningLimit: 400,
  },
});
