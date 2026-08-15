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
     * **The caching rules below are a data-protection requirement, not a performance one.**
     * A response containing contact details must not outlive the session that fetched it —
     * a shared phone is the normal case in a Rotaract club, and a cache that survives logout
     * is the predecessor's failure in a new form. Every API cache is therefore either
     * reference data with no personal content, or short-lived; and `clearAllCaches()` in
     * `lib/offline/caches.ts` runs on sign-out.
     */
    VitePWA({
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
      workbox: {
        // The app shell and every hashed asset. Cache-first is safe precisely because the
        // filenames are hashed: a new build is a new name, never a stale hit.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],

        // `/api` must never be served from the navigation fallback. Without this a request
        // for an endpoint that 404s would be answered with index.html by the SERVICE WORKER
        // — the same failure M2 session 2 designed the server-side catch-all to avoid, and
        // harder to see because it only happens once the worker is installed.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          {
            /**
             * Reference data: activity types, clubs, positions, clusters, regions.
             *
             * Stale-while-revalidate because it changes rarely and the reporting form is
             * unusable without it — a secretary opening `/report` with no signal should get
             * the type list they saw yesterday rather than an empty screen.
             *
             * NONE of these carry personal data. `/clubs` carries meeting venues, which are
             * the district's own record and are already behind a session; that is the
             * furthest this cache goes.
             */
            urlPattern: /^\/api\/v1\/(activity-types|clubs|positions|clusters|regions)(\?|$)/,
            method: 'GET',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'dis-reference',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /**
             * Everything else the API serves, including responses that MAY carry contact
             * details — persons, rosters, activities with attendees.
             *
             * Network-first with a short fallback: the cache exists so a page opened in a
             * lift still renders, not so the device keeps a copy of the district's members.
             * One hour, sixty entries, and cleared entirely on sign-out.
             */
            urlPattern: /^\/api\/v1\//,
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dis-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /**
             * Photographs, fetched from storage through short-lived signed URLs.
             *
             * Cache-first on the URL is safe: the key is immutable and the signature is part
             * of the query, so a new signature is a new cache entry rather than a stale
             * image. Capped hard — a district's photo library is not something a phone
             * should end up holding.
             */
            urlPattern: /\/(activity-media|media)\//,
            method: 'GET',
            handler: 'CacheFirst',
            options: {
              cacheName: 'dis-media',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
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
