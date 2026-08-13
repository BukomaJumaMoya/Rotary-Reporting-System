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
