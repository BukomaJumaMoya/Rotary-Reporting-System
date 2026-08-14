import request from 'supertest';
import { TOTP, Secret } from 'otpauth';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import { createUser, errorBody, meBody, resetDatabase } from '../../test/helpers.js';
import { createEnrolment, verifyCode } from './mfa.js';

const app = createApp();

/** Generates a valid code the way an authenticator app would. */
function codeFor(secret: string, label: string, at: Date = new Date()): string {
  return new TOTP({
    issuer: 'Rotaract DIS',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at.getTime() });
}

const PERIOD_MS = 30_000;

/**
 * A code for the NEXT TOTP step, aligned to the step boundary.
 *
 * Enrolment and each sign-in consume a step, and the replay guard requires a strictly
 * greater one — so a test needing a second code cannot reuse the current step. Naively
 * adding 30 seconds is flaky: run the test late in a step and it lands two steps ahead,
 * outside the ±1 drift window. Aligning to the boundary makes it exactly one step, always.
 */
function nextStepCode(secret: string, label: string): string {
  const currentStep = Math.floor(Date.now() / PERIOD_MS);
  const oneSecondIntoNextStep = (currentStep + 1) * PERIOD_MS + 1_000;
  return codeFor(secret, label, new Date(oneSecondIntoNextStep));
}

/** Signs in and returns an agent carrying the session cookie. */
async function signedInAgent(email: string, password: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('TOTP', () => {
  it('accepts a current code and rejects a wrong one', () => {
    const { secret } = createEnrolment('member@example.org');

    expect(
      verifyCode(secret, 'member@example.org', codeFor(secret, 'member@example.org')).valid,
    ).toBe(true);
    expect(verifyCode(secret, 'member@example.org', '000000').valid).toBe(false);
  });

  it('tolerates one step of clock drift either way, but not two', () => {
    const { secret } = createEnrolment('member@example.org');
    const label = 'member@example.org';
    const now = new Date();
    const stepMs = 30_000;

    const oneStepAgo = codeFor(secret, label, new Date(now.getTime() - stepMs));
    const threeStepsAgo = codeFor(secret, label, new Date(now.getTime() - 3 * stepMs));

    expect(verifyCode(secret, label, oneStepAgo, now).valid).toBe(true);
    expect(verifyCode(secret, label, threeStepsAgo, now).valid).toBe(false);
  });

  it('produces an otpauth URI an authenticator app can scan', () => {
    const { otpauthUri, secret } = createEnrolment('grace@d9218.example.org');

    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauthUri).toContain('issuer=Rotaract%20DIS');
    expect(otpauthUri).toContain('digits=6');
    expect(otpauthUri).toContain('period=30');
    // 160-bit secret, base32, per RFC 4226.
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('MFA enrolment', () => {
  it('does not enable MFA until a code proves the app works', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);

    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    expect(enrol.status).toBe(200);

    // Secret stored, but sign-in is unchanged — losing the QR code here must not lock
    // the member out of their own account.
    const staged = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(staged.mfaSecret).not.toBeNull();
    expect(staged.mfaEnabled).toBe(false);

    const body = enrol.body as { data: { secret: string; otpauthUri: string } };
    const verify = await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: codeFor(body.data.secret, user.email) });
    // 200, not 204: confirming enrolment is the one moment recovery codes exist in
    // plaintext, so it must return them.
    expect(verify.status).toBe(200);
    expect((verify.body as { data: { recoveryCodes: string[] } }).data.recoveryCodes).toHaveLength(
      10,
    );

    const enabled = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(enabled.mfaEnabled).toBe(true);
  });

  it('refuses a wrong confirmation code and counts it as a failed attempt', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);
    await agent.post('/api/v1/auth/mfa/enrol');

    const verify = await agent.post('/api/v1/auth/mfa/verify').send({ code: '000000' });

    expect(verify.status).toBe(401);
    expect(errorBody(verify).code).toBe('MFA_INVALID');

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.mfaEnabled).toBe(false);
    // Guessing a six-digit code is only infeasible if the guesses are counted.
    expect(stored.failedAttempts).toBe(1);
  });

  it('requires a session', async () => {
    const response = await request(app).post('/api/v1/auth/mfa/enrol');
    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('UNAUTHENTICATED');
  });

  it('will not re-issue a secret once MFA is on', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);
    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    const body = enrol.body as { data: { secret: string } };
    await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: codeFor(body.data.secret, user.email) });

    // Otherwise a hijacked session could quietly swap the second factor for its own.
    const again = await agent.post('/api/v1/auth/mfa/enrol');
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('MFA_ALREADY_ENABLED');
  });
});

describe('login with MFA enabled', () => {
  async function userWithMfa() {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);
    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    const secret = (enrol.body as { data: { secret: string } }).data.secret;
    await agent.post('/api/v1/auth/mfa/verify').send({ code: codeFor(secret, user.email) });
    await agent.post('/api/v1/auth/logout');
    // Enrolment consumed a step; move past it so the next code is a fresh one.
    return { ...user, secret };
  }

  it('asks for a code, then signs in with one', async () => {
    const user = await userWithMfa();

    const withoutCode = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(withoutCode.status).toBe(401);
    expect(errorBody(withoutCode).code).toBe('MFA_REQUIRED');
    expect(withoutCode.headers['set-cookie']).toBeUndefined();

    // A correct password with a missing code is NOT a failed attempt — counting it
    // would lock out every member on every sign-in.
    const afterPrompt = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(afterPrompt.failedAttempts).toBe(0);

    const withCode = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: user.email,
        password: user.password,
        totpCode: nextStepCode(user.secret, user.email),
      });

    expect(withCode.status).toBe(200);
  });

  it('rejects a wrong code even with the right password', async () => {
    const user = await userWithMfa();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, totpCode: '000000' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('MFA_INVALID');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('will not accept the same code twice', async () => {
    const user = await userWithMfa();
    const code = nextStepCode(user.secret, user.email);

    const first = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, totpCode: code });
    expect(first.status).toBe(200);

    // Replay: without the step guard this code stays usable for ~90 seconds, so anyone
    // who glimpsed it once could sign in too.
    const replay = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, totpCode: code });

    expect(replay.status).toBe(401);
    expect(errorBody(replay).code).toBe('MFA_INVALID');
  });
});

describe('disabling MFA', () => {
  it('needs the password and a current code', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);
    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    const secret = (enrol.body as { data: { secret: string } }).data.secret;
    await agent.post('/api/v1/auth/mfa/verify').send({ code: codeFor(secret, user.email) });

    // A hijacked session alone must not be able to strip the second factor.
    const wrongPassword = await agent
      .post('/api/v1/auth/mfa/disable')
      .send({ password: 'not the password', code: codeFor(secret, user.email) });
    expect(wrongPassword.status).toBe(401);

    const stillOn = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stillOn.mfaEnabled).toBe(true);

    const disabled = await agent
      .post('/api/v1/auth/mfa/disable')
      .send({ password: user.password, code: nextStepCode(secret, user.email) });
    expect(disabled.status).toBe(204);

    const off = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(off.mfaEnabled).toBe(false);
    // The secret is cleared too: re-enrolling issues a fresh one.
    expect(off.mfaSecret).toBeNull();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(200);
  });
});

describe('recovery codes', () => {
  /** Enrols, confirms, and returns the codes issued at confirmation. */
  async function enrolWithRecovery(user: { email: string; password: string }) {
    const agent = await signedInAgent(user.email, user.password);
    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    const secret = (enrol.body as { data: { secret: string } }).data.secret;

    const verify = await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: codeFor(secret, user.email) });
    expect(verify.status).toBe(200);

    const codes = (verify.body as { data: { recoveryCodes: string[] } }).data.recoveryCodes;
    return { agent, secret, codes };
  }

  it('issues ten codes when enrolment is confirmed, stored only as hashes', async () => {
    const user = await createUser();
    const { codes } = await enrolWithRecovery(user);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[0-9A-HJ-KM-NP-TV-Z]{5}-[0-9A-HJ-KM-NP-TV-Z]{5}$/);

    const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.userId } });
    expect(stored).toHaveLength(10);
    // Hashed, like a password: this table must not be readable as credentials.
    for (const row of stored) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(codes).not.toContain(row.codeHash);
    }
  });

  it('signs in with a recovery code when the authenticator is gone', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);
    await agent.post('/api/v1/auth/logout');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[0] });

    expect(login.status).toBe(200);

    const remaining = await prisma.mfaRecoveryCode.count({
      where: { userId: user.userId, usedAt: null },
    });
    expect(remaining).toBe(9);
  });

  it('accepts a code however the member types it', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);
    await agent.post('/api/v1/auth/logout');

    // Lower case, no hyphen, stray spaces: formatting is presentation, not the secret.
    const mangled = ` ${(codes[0] ?? '').toLowerCase().replace('-', '')} `;

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: mangled });

    expect(login.status).toBe(200);
  });

  it('will not accept the same recovery code twice', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);
    await agent.post('/api/v1/auth/logout');

    const first = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[0] });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[0] });

    expect(replay.status).toBe(401);
    expect(errorBody(replay).code).toBe('MFA_INVALID');
  });

  it('turns MFA off with a recovery code — the lost-phone path', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);

    // Requiring the authenticator in order to remove the authenticator is a trap.
    const disabled = await agent
      .post('/api/v1/auth/mfa/disable')
      .send({ password: user.password, recoveryCode: codes[0] });
    expect(disabled.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.mfaEnabled).toBe(false);
    // Codes go with the factor they recover: a stale printout must not re-enter later.
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.userId } })).toBe(0);
  });

  it('regenerates a set, invalidating the old one', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);

    const regenerated = await agent
      .post('/api/v1/auth/mfa/recovery-codes')
      .send({ password: user.password, recoveryCode: codes[0] });
    expect(regenerated.status).toBe(200);

    const fresh = (regenerated.body as { data: { recoveryCodes: string[] } }).data.recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(codes[1]);

    await agent.post('/api/v1/auth/logout');

    // An old code no longer works, even one never used.
    const old = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[1] });
    expect(old.status).toBe(401);

    const current = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: fresh[0] });
    expect(current.status).toBe(200);
  });

  it('reports how many are left, so a member can be warned before they run out', async () => {
    const user = await createUser();
    const { agent, codes } = await enrolWithRecovery(user);

    const before = await agent.get('/api/v1/auth/me');
    expect(meBody(before).mfaRecoveryCodesRemaining).toBe(10);

    await agent.post('/api/v1/auth/logout');
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[0] });

    const signedIn = request.agent(app);
    await signedIn
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password, recoveryCode: codes[1] });

    const after = await signedIn.get('/api/v1/auth/me');
    expect(meBody(after).mfaRecoveryCodesRemaining).toBe(8);
  });
});

describe('MFA secret storage', () => {
  it('never stores the shared secret in clear', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email, user.password);

    const enrol = await agent.post('/api/v1/auth/mfa/enrol');
    const secret = (enrol.body as { data: { secret: string } }).data.secret;

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });

    // A database dump must not hand over the second factor along with the first.
    expect(stored.mfaSecret).not.toBe(secret);
    expect(stored.mfaSecret).not.toContain(secret);
    expect(stored.mfaSecret).toMatch(/^test\..+\..+\..+$/);

    // And it still works, so encryption is transparent to the member.
    const verify = await agent
      .post('/api/v1/auth/mfa/verify')
      .send({ code: codeFor(secret, user.email) });
    expect(verify.status).toBe(200);
  });
});
