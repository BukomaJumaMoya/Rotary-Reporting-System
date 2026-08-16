import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@dis/contracts';
import { createApp } from './app.js';

describe('GET /api/v1/admin/health', () => {
  it('returns exactly { status: "ok" }', async () => {
    const response = await request(createApp()).get('/api/v1/admin/health');

    expect(response.status).toBe(200);
    // Deep equality, not a subset match. This is the one route reachable without a
    // session, so the test fails the moment anything is added to its payload.
    expect(response.body).toEqual({ status: 'ok' });
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('does not advertise the runtime', async () => {
    const response = await request(createApp()).get('/api/v1/admin/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('404s an unknown route', async () => {
    const response = await request(createApp()).get('/api/v1/admin/nope');

    expect(response.status).toBe(404);
  });
});

describe('response compression (NFR-1.1)', () => {
  /**
   * Gzip was missing until M3 session 3, and it was the largest single payload cost in the
   * system: a page of 25 activities is 22.8 KB of JSON uncompressed and 3.1 KB gzipped.
   * Members pay per megabyte, so removing this middleware would be a seven-fold traffic
   * increase on the busiest screen — and completely invisible without a test that looks at
   * the header.
   */
  it('gzips a response large enough to be worth it', async () => {
    const app = createApp((mount) => {
      mount('/api/v1/test-compression', createLargeRouter());
    });

    const response = await request(app)
      .get('/api/v1/test-compression')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('leaves a small response alone', async () => {
    // Below the threshold, compressing costs more than it saves.
    const response = await request(createApp())
      .get('/api/v1/admin/health')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBeUndefined();
  });
});

/** A router whose body is comfortably over the 1 KB threshold. */
function createLargeRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      rows: Array.from({ length: 200 }, (_, index) => ({ index, note: 'a'.repeat(40) })),
    });
  });
  return router;
}
