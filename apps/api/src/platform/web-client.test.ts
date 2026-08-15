import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { errorBody } from '../test/helpers.js';
import { assertAllRoutersDiscovered, discoverRoutes } from '../test/routes.js';
import { config } from './config.js';

/**
 * The SPA served from the API container.
 *
 * The assertion that matters is the third one. A catch-all that returns `index.html` for
 * everything is one line, works, and quietly turns every unmatched `/api/...` into a 200
 * with an HTML body — which reaches the client as "unexpected token <" and sends whoever
 * is debugging it looking at their JSON parser rather than at the 404 the server meant to
 * send.
 */

const INDEX_HTML = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';

let webDir: string;
let previousDir: string | undefined;

beforeAll(() => {
  webDir = mkdtempSync(join(tmpdir(), 'dis-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), INDEX_HTML);
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'export const built = true;\n');

  // `config` is parsed once at start-up, so the directory is swapped on the frozen object
  // rather than through the environment, which would already have been read.
  previousDir = config.WEB_CLIENT_DIR;
  (config as { WEB_CLIENT_DIR?: string }).WEB_CLIENT_DIR = webDir;
});

afterAll(() => {
  (config as { WEB_CLIENT_DIR?: string }).WEB_CLIENT_DIR = previousDir;
  rmSync(webDir, { recursive: true, force: true });
});

describe('the web client, served from the API', () => {
  it('returns index.html for a deep client route, so a refresh works', async () => {
    const response = await request(createApp()).get('/clubs/00000000-0000-4000-8000-000000000000');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('id="root"');
    // A cached entry point is a deploy nobody sees until the browser gives up on it.
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets immutably', async () => {
    const response = await request(createApp()).get('/assets/index-abc123.js');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('does NOT shadow the API — an unmatched /api path is still a JSON 404', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(errorBody(response).code).toBe('NOT_FOUND');
  });

  it('leaves a real API route alone', async () => {
    const response = await request(createApp()).get('/api/v1/admin/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('404s a missing asset rather than answering it with HTML', async () => {
    const response = await request(createApp()).get('/assets/index-deadbeef.js');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('404s a non-navigation to an unknown path', async () => {
    const response = await request(createApp()).post('/clubs').send({});

    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('NOT_FOUND');
  });

  it('does not confuse the route walker the PII harness reads', () => {
    const app = createApp();

    // The client is middleware, not a route, so discovery still sees only real endpoints.
    // A catch-all registered with app.get('*') would appear here and be probed forever.
    const paths = discoverRoutes(app).map((route) => route.path);
    expect(paths.every((path) => path.startsWith('/api/'))).toBe(true);
    expect(paths).toContain('/api/v1/admin/health');

    // And it is not a router, so the mount registry still accounts for every one.
    expect(() => {
      assertAllRoutersDiscovered(app);
    }).not.toThrow();
  });

  it('sends a same-origin content security policy with no inline script', async () => {
    const response = await request(createApp()).get('/');
    const csp = response.headers['content-security-policy'] ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('same-origin');
  });
});
