import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import {
  createTokenFor,
  createUser,
  errorBody,
  meBody,
  resetDatabase,
  tokenRow,
} from '../../test/helpers.js';
import { TokenPurpose } from './tokens.js';
import { lockoutDuration } from './service.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('POST /api/v1/auth/login', () => {
  it('logs a member in and sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const user = await createUser();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    expect(meBody(response).userId).toBe(user.userId);

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('dis.sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);

    // The session lives in Postgres, not in the cookie — that is what makes it
    // revocable the moment an appointment is withdrawn (ADR-003).
    const sessions = await prisma.session.count();
    expect(sessions).toBe(1);
  });

  it('rejects a wrong password without saying whether the account exists', async () => {
    const user = await createUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not the right password' });

    const unknownAccount = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.org', password: 'not the right password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    // Identical responses: the login form must not be an account-existence oracle.
    expect(wrongPassword.body).toEqual(unknownAccount.body);
    expect(errorBody(wrongPassword).code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('locks the account after 5 failed attempts and reports when to retry', async () => {
    const user = await createUser();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `10.0.0.${attempt}`)
        .send({ email: user.email, password: 'wrong' });
      statuses.push(response.status);
    }

    // First four are ordinary failures; the fifth trips the lock.
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses[4]).toBe(423);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.failedAttempts).toBeGreaterThanOrEqual(5);
    expect(stored.lockedUntil).not.toBeNull();

    // The correct password does not help while the lock holds.
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.99')
      .send({ email: user.email, password: user.password });

    expect(locked.status).toBe(423);
    expect(errorBody(locked).code).toBe('ACCOUNT_LOCKED');
    expect(errorBody(locked).details?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rate-limits repeated attempts from one client before they reach Argon2', async () => {
    const user = await createUser();
    const client = '198.51.100.7';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', client)
        .send({ email: user.email, password: 'wrong' });
    }

    const throttled = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', client)
      .send({ email: user.email, password: 'wrong' });

    expect(throttled.status).toBe(429);
    expect(errorBody(throttled).code).toBe('RATE_LIMITED');

    // Keyed on IP AND email: a different client is unaffected, so one attacker cannot
    // lock out everyone behind a shared office address.
    const otherClient = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.8')
      .send({ email: user.email, password: user.password });

    expect(otherClient.status).not.toBe(429);
  });

  it('backs off exponentially, capped', () => {
    // 5 attempts is the threshold, 5 minutes the base, 1440 minutes the cap.
    expect(lockoutDuration(4)).toBeNull();
    expect(lockoutDuration(5)).toBe(5 * 60 * 1000);
    expect(lockoutDuration(6)).toBe(10 * 60 * 1000);
    expect(lockoutDuration(7)).toBe(20 * 60 * 1000);
    expect(lockoutDuration(50)).toBe(1440 * 60 * 1000);
  });

  it('refuses an account that has not accepted its invitation', async () => {
    const user = await createUser({ status: 'INVITED' });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('is 401 without a session and returns the caller with one', async () => {
    const user = await createUser();
    const agent = request.agent(app);

    const anonymous = await request(app).get('/api/v1/auth/me');
    expect(anonymous.status).toBe(401);
    expect(errorBody(anonymous).code).toBe('UNAUTHENTICATED');

    await agent.post('/api/v1/auth/login').send({ email: user.email, password: user.password });

    const authenticated = await agent.get('/api/v1/auth/me');
    expect(authenticated.status).toBe(200);
    expect(meBody(authenticated).personId).toBe(user.personId);
    // Stub context until session 4 derives it from appointments.
    expect(meBody(authenticated).context.permissions).toEqual([]);
  });

  it('returns no contact details', async () => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: user.email, password: user.password });

    const response = await agent.get('/api/v1/auth/me');
    const body = JSON.stringify(response.body);

    for (const field of ['email', 'phone', 'altPhone', 'dateOfBirth', 'city', 'photoUrl']) {
      expect(body).not.toContain(field);
    }
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('destroys the session row', async () => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: user.email, password: user.password });

    expect(await prisma.session.count()).toBe(1);

    const response = await agent.post('/api/v1/auth/logout');
    expect(response.status).toBe(204);
    expect(await prisma.session.count()).toBe(0);

    const after = await agent.get('/api/v1/auth/me');
    expect(after.status).toBe(401);
  });
});

describe('POST /api/v1/auth/password/forgot', () => {
  it('returns 204 for an unknown email and issues no token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'nobody@example.org' });

    expect(response.status).toBe(204);
    expect(await prisma.userToken.count()).toBe(0);
  });

  it('returns the same 204 for a known email, and issues a token', async () => {
    const user = await createUser();

    const response = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: user.email });

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const tokens = await prisma.userToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe(TokenPurpose.RESET);
    // Stored hashed: a leaked backup must not contain working reset links.
    expect(tokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /api/v1/auth/password/reset', () => {
  it('sets the new password and consumes the token exactly once', async () => {
    const user = await createUser();
    const token = await createTokenFor(user.userId);
    const newPassword = 'a brand new passphrase';

    const first = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: newPassword });
    expect(first.status).toBe(204);

    expect((await tokenRow(token))?.consumedAt).not.toBeNull();

    // Replaying the same token fails.
    const second = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'yet another passphrase' });
    expect(second.status).toBe(400);
    expect(errorBody(second).code).toBe('TOKEN_INVALID');

    // The first reset took effect, and the second did not.
    const withNew = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword });
    expect(withNew.status).toBe(200);
  });

  it('rejects an expired token', async () => {
    const user = await createUser();
    const token = await createTokenFor(user.userId, TokenPurpose.RESET, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'a brand new passphrase' });

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('TOKEN_INVALID');
    // Still unconsumed: an expired token is rejected, not spent.
    expect((await tokenRow(token))?.consumedAt).toBeNull();
  });

  it('rejects an unknown token with the same response as an expired one', async () => {
    const response = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: 'k'.repeat(43), password: 'a brand new passphrase' });

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('TOKEN_INVALID');
  });

  it('will not accept an invite token', async () => {
    const user = await createUser();
    const token = await createTokenFor(user.userId, TokenPurpose.INVITE);

    const response = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'a brand new passphrase' });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/auth/invite/accept', () => {
  it('activates the account and records DATA_PROCESSING consent with the source IP', async () => {
    const user = await createUser({ status: 'INVITED' });
    const token = await createTokenFor(user.userId, TokenPurpose.INVITE);

    const response = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ token, password: 'a brand new passphrase', acceptsDataProcessing: true });

    expect(response.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.status).toBe('ACTIVE');

    const consents = await prisma.consent.findMany({ where: { personId: user.personId } });
    expect(consents).toHaveLength(1);
    expect(consents[0]?.consentType).toBe('DATA_PROCESSING');
    expect(consents[0]?.policyVersion).toBe('2027-07-01');
    expect(consents[0]?.grantedAt).not.toBeNull();
    expect(consents[0]?.sourceIp).not.toBeNull();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'a brand new passphrase' });
    expect(login.status).toBe(200);
  });

  it('requires explicit consent', async () => {
    const user = await createUser({ status: 'INVITED' });
    const token = await createTokenFor(user.userId, TokenPurpose.INVITE);

    const response = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ token, password: 'a brand new passphrase', acceptsDataProcessing: false });

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');

    // Nothing was written: no account activated, no consent recorded.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.status).toBe('INVITED');
    expect(await prisma.consent.count()).toBe(0);
  });

  it('rejects a password below the policy minimum', async () => {
    const user = await createUser({ status: 'INVITED' });
    const token = await createTokenFor(user.userId, TokenPurpose.INVITE);

    const response = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ token, password: 'short', acceptsDataProcessing: true });

    expect(response.status).toBe(400);
    // The submitted password must never appear in the error.
    expect(JSON.stringify(response.body)).not.toContain('short');
  });
});
