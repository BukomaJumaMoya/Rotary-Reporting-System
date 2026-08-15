import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { config } from './config.js';

/**
 * Serving the single-page application from the API container.
 *
 * The decision (Build-Conventions §6, taken in M2 session 2): one Fly app, one deploy, one
 * account to hold under district identity, same origin and therefore no CORS. A separate
 * static host would buy a better CDN and cost a second account — and ADR-011 is about
 * there being fewer accounts, each with two administrators, not more.
 *
 * Registered as MIDDLEWARE rather than as a route. `app.get('*', …)` would appear in the
 * route walker the unauthenticated-PII harness uses, which discovers routes so nobody has
 * to maintain a list; a catch-all in that list is noise at best and a route the harness
 * probes forever at worst. Middleware with no `.stack` is invisible to both the walker and
 * `assertAllRoutersDiscovered`.
 */

/** Where `apps/web/dist` sits relative to this file, in `src/` and in `dist/` alike. */
const DEFAULT_DIR = fileURLToPath(new URL('../../../web/dist/', import.meta.url));

export function webClientDir(): string {
  return config.WEB_CLIENT_DIR ?? DEFAULT_DIR;
}

/** True when a built client is present. False in development, where Vite serves it. */
export function hasWebClient(): boolean {
  return existsSync(webClientDir());
}

/**
 * True for a path the API owns. Everything under it belongs to a handler, and an unmatched
 * one must reach `notFoundHandler` and come back as JSON in the standard envelope — never
 * as `index.html` with a 200, which is how a client ends up parsing an HTML page as an API
 * response and reporting "unexpected token <" instead of the 404 it was given.
 */
function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * Mounts the client, if one has been built.
 *
 * Called AFTER every API router and BEFORE the terminal handlers, so nothing here can
 * shadow an endpoint.
 */
export function serveWebClient(app: Express): void {
  const dir = webClientDir();
  if (!existsSync(dir)) {
    console.log(`[api] no web client at ${dir} — serving the API only`);
    return;
  }

  app.use(
    express.static(dir, {
      // The SPA fallback below owns `/`, so express.static must not answer it — otherwise
      // `index.html` would be served with the static handler's cache headers rather than
      // the deliberate ones.
      index: false,
      // Vite hashes every filename in /assets, so those may be cached for a year; the
      // entry point must never be, or a deploy is invisible until the browser gives up on
      // a stale copy. Members are on metered data: this is the difference between a repeat
      // visit costing 80 KB and costing nothing.
      setHeaders: (res, filePath) => {
        // Both separators: this runs on Windows in development and Linux in production.
        const hashed = /[/\\]assets[/\\]/.test(filePath);

        // The SERVICE WORKER and its manifest are never held (M3 session 1). A cached
        // `sw.js` is a deploy the device does not notice until the entry expires — and the
        // service worker is the thing that decides how everything else is cached, so a
        // stale one is a stale application with no way to correct it from the server.
        const isWorker = /[/\\](sw\.js|workbox-[^/\\]+\.js|manifest\.webmanifest)$/.test(filePath);

        res.setHeader(
          'Cache-Control',
          isWorker
            ? 'no-cache'
            : hashed
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
        );
      },
    }),
  );

  app.use((req: Request, res: Response, next) => {
    // The API answers for itself, including its 404s.
    if (isApiPath(req.path)) {
      next();
      return;
    }
    // A missing hashed asset is a missing asset, not a route. Returning index.html for it
    // would answer 200 to a request for JavaScript and leave the browser parsing HTML.
    if (req.path.startsWith('/assets/')) {
      next();
      return;
    }
    // Only a navigation gets the app. A POST to an unknown path is a client bug and should
    // hear so in the envelope every other error uses.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // No-cache, not no-store: the browser may keep it and revalidate, which on a slow
    // connection is a conditional request and a 304 rather than 400 bytes.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: dir }, (error) => {
      if (error) next(error);
    });
  });
}
