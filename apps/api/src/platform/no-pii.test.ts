import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma, unscopedPrisma } from './db.js';
import { closeSessionPool } from './session.js';
import { assertAllRoutersDiscovered, concreteUrl, discoverRoutes } from '../test/routes.js';
import { resetDatabase } from '../test/helpers.js';

/**
 * THE NO-PII HARNESS. Mandatory (CLAUDE.md, Testing §5).
 *
 * The predecessor system published roughly four thousand members' names, photographs,
 * phone numbers, email addresses, genders and residential areas on a page that required
 * no login, alongside club meeting venues and times. Several rules in this codebase exist
 * because of that, and this suite is the one that keeps them true after everyone has
 * stopped thinking about it.
 *
 * It walks EVERY registered route, discovers them from the Express router rather than
 * from a list, and asserts that an unauthenticated caller is refused or gets nothing
 * personal. A route added in M4 is covered in M4 without anyone remembering.
 */

const app = createApp();

/**
 * Field names that must never appear in an unauthenticated response body.
 *
 * Both spellings of every column: the API speaks camelCase and the database speaks
 * snake_case, and a handler returning a raw row would leak the second form.
 */
const FORBIDDEN_FIELDS = [
  'email',
  'phone',
  'altPhone',
  'alt_phone',
  'dateOfBirth',
  'date_of_birth',
  'city',
  'photoUrl',
  'photo_url',
  'gender',
  'occupation',
  'employer',
  'classification',
  'nationality',
  'riMemberId',
  'ri_member_id',
  'passwordHash',
  'password_hash',
  'mfaSecret',
  'mfa_secret',
];

/**
 * The only route reachable without a session, and it returns `{ status: 'ok' }` and
 * nothing else — `healthResponseSchema` is `.strict()` precisely so that stays true.
 *
 * An allowlist of ONE. Every addition to it is a decision to serve something to the
 * open internet, and it should read like one.
 */
const UNAUTHENTICATED_ALLOWLIST = new Set(['GET /api/v1/admin/health']);

/** Every string key anywhere in a response, however deeply nested. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysIn(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      found.add(key);
      keysIn(item, found);
    }
  }
  return found;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

const routes = discoverRoutes(app);

describe('route discovery', () => {
  it('finds the routes that exist, so the walk below is not vacuous', () => {
    const signatures = routes.map((route) => `${route.method} ${route.path}`);

    // If discovery silently returned nothing — or returned paths that 404 — every
    // assertion in this file would pass and the harness would be decoration. It did
    // exactly that on the first run: Express 5 compiles a mount path into a matcher and
    // keeps no string, so the walk was hitting `/login` rather than `/api/v1/auth/login`.
    expect(signatures).toContain('GET /api/v1/admin/health');
    expect(signatures).toContain('POST /api/v1/auth/login');
    expect(signatures).toContain('GET /api/v1/auth/me');
    expect(signatures).toContain('POST /api/v1/auth/password/forgot');
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('reaches a real handler on every discovered path', async () => {
    // A 404 from the terminal handler would mean the path was wrong, and a wrong path
    // leaks nothing no matter what the route behind it does.
    for (const route of routes) {
      const method = route.method.toLowerCase() as 'get' | 'post';
      const response = await request(app)[method](concreteUrl(route.path)).send({});
      expect(response.status, `${route.method} ${route.path} did not resolve`).not.toBe(404);
    }
  });

  it('accounts for every router mounted on the app', () => {
    // The prefixes come from a registry, so the registry has to be complete. A router
    // added with app.use() instead of the helper would simply never be walked, and this
    // suite would still pass — the quiet failure mode.
    expect(() => assertAllRoutersDiscovered(app)).not.toThrow();
  });
});

describe('every route, unauthenticated', () => {
  it.each(routes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s returns no personal data',
    async (signature, route) => {
      // A person with every contact field populated, so a handler that leaked one would
      // have something real to leak. Written through the unaudited client: this is a
      // fixture, not anybody's action.
      await unscopedPrisma.person.create({
        data: {
          firstName: 'Ann',
          lastName: 'Nakato',
          email: 'ann.nakato@example.org',
          phone: '+256700000000',
          altPhone: '+256780000000',
          dateOfBirth: new Date('1999-04-01'),
          city: 'Kampala',
          photoUrl: 'https://cdn.example.org/ann.jpg',
          gender: 'F',
          occupation: 'Engineer',
        },
      });

      const url = concreteUrl(route.path);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const response = await request(app)[method](url).send({});

      if (UNAUTHENTICATED_ALLOWLIST.has(signature)) {
        expect(response.body).toEqual({ status: 'ok' });
        return;
      }

      // 401 is the expected answer. 204, 400 and 429 are also fine — they carry no body
      // worth reading — and the field check below covers whatever a route does return.
      const keys = keysIn(response.body as unknown);
      const leaked = FORBIDDEN_FIELDS.filter((field) => keys.has(field));

      expect(
        leaked,
        `${signature} returned ${leaked.join(', ')} to an unauthenticated caller. ` +
          'This is the failure the project exists to correct — see docs/08-Incumbent-Assessment.md.',
      ).toEqual([]);

      // And nothing personal by VALUE either, in case a field is renamed on the way out.
      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('ann.nakato@example.org');
      expect(serialised).not.toContain('+256700000000');
      expect(serialised).not.toContain('cdn.example.org/ann.jpg');
    },
  );

  /**
   * The audit endpoint, specifically.
   *
   * It is the obvious hole and an easy one to miss: `audit_log` holds before/after diffs
   * of governed entities, and `persons` is one of them — so an audit read that returned
   * raw JSON would serve exactly the contact details the rest of the system protects. The
   * walk above covers it unauthenticated; this covers the values it holds.
   */
  it('never serves a person contact value out of an audit diff', async () => {
    const person = await unscopedPrisma.person.create({
      data: {
        firstName: 'Ann',
        lastName: 'Nakato',
        email: 'audit.leak.probe@example.org',
        phone: '+256700111222',
      },
      select: { id: true },
    });

    await unscopedPrisma.auditLogEntry.create({
      data: {
        entityType: 'persons',
        entityId: person.id,
        action: 'UPDATE',
        // Exactly what the audit extension would have written.
        before: { email: 'audit.leak.probe@example.org', phone: '+256700111222' },
        after: { email: 'audit.leak.new@example.org', phone: '+256700333444' },
      },
    });

    const response = await request(app).get('/api/v1/audit');
    const serialised = JSON.stringify(response.body);

    expect(response.status).toBe(401);
    for (const value of [
      'audit.leak.probe@example.org',
      'audit.leak.new@example.org',
      '+256700111222',
      '+256700333444',
    ]) {
      expect(serialised).not.toContain(value);
    }
  });

  it('answers 401 or a bodiless status on everything but the allowlist', () => {
    // Stated separately from the field check so the two failures read differently: this
    // one is "a route became reachable", not "a route leaked a field".
    expect([...UNAUTHENTICATED_ALLOWLIST]).toEqual(['GET /api/v1/admin/health']);
  });
});
