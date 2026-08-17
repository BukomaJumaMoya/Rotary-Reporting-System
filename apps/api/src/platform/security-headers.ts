import type { RequestHandler } from 'express';
import { config, isProduction } from './config.js';

/**
 * Response headers for a SAME-ORIGIN single-page application.
 *
 * The SPA and the API are one origin (M2 session 2), which is what makes this policy
 * short: there is no CORS to open, no third-party script host to allow, and `connect-src
 * 'self'` covers every request the client makes.
 *
 * Written by hand rather than with helmet. It is twenty lines, every one of which someone
 * should be able to justify in a review, and this repository has one part-time maintainer
 * — a dependency whose defaults change between majors is a policy that changes without
 * anybody deciding to.
 */

/** Extra origins images and fetches may reach — object storage, once it exists (session 8). */
function mediaOrigins(): string[] {
  return config.CSP_MEDIA_ORIGINS.split(/\s+/).filter(Boolean);
}

/**
 * The one inline script in the application: the pre-paint theme and sidebar resolver in
 * `apps/web/index.html`.
 *
 * It is admitted by HASH, not by `'unsafe-inline'`. A hash is at least as strict as `'self'`
 * — it pins these exact bytes, where `'self'` would admit any same-origin file — and it buys
 * the one thing an external script cannot: no render-blocking round trip before the theme is
 * known. On a metered upcountry connection that round trip is the flash.
 *
 * The cost is a coupling between two files in different workspaces, which would otherwise be
 * the kind of thing that silently rots: edit the script, forget the hash, and the theme
 * quietly stops applying in production while every test still passes. `security-headers.test.ts`
 * recomputes this from `index.html` and fails the build on a mismatch, which is the only
 * reason the coupling is acceptable.
 */
export const PREPAINT_SCRIPT_HASH = "'sha256-223ctxZlKwMkwNxL8NfTOzhyv2WemcA1XNCCoXStMrk='";

function contentSecurityPolicy(): string {
  const media = mediaOrigins();

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Vite emits hashed module files and nothing else, so this stays strict.
    // `modulePreload.polyfill` is disabled in vite.config.ts to keep it that way with
    // route-level code splitting. The one hash is the pre-paint script above.
    'script-src': ["'self'", PREPAINT_SCRIPT_HASH],
    // React sets `style` attributes at runtime, which `style-src-attr` governs and which
    // no nonce can cover. Inline STYLE is a far smaller exposure than inline script.
    'style-src': ["'self'", "'unsafe-inline'"],
    // blob: for the client-side image compression in the reporting flow, which hands the
    // preview an object URL before anything is uploaded.
    'img-src': ["'self'", 'data:', 'blob:', ...media],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...media],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Redundant with frame-ancestors for modern browsers, and the one that older Android
  // WebViews actually honour.
  res.setHeader('X-Frame-Options', 'DENY');
  // `same-origin`, not the usual `strict-origin-when-cross-origin`: a URL here can name a
  // club or a person, and this system exists partly because its predecessor was careless
  // about exactly that kind of leak.
  res.setHeader('Referrer-Policy', 'same-origin');
  // Camera is allowed for the club secretary photographing a project (session 9). Nothing
  // else is: the incumbent system's photos carried GPS, and location is not something this
  // application ever needs to ask for.
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=(), payment=()');

  if (isProduction) {
    // Two years, including subdomains. Fly already forces HTTPS at the edge; this stops a
    // member's first request of the day being made in clear over hotel wifi.
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }

  next();
};
