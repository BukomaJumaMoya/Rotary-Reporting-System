import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import { capturedMail, createUser, resetDatabase } from '../../test/helpers.js';
import { issueInvite } from '../auth/service.js';
import { missingPlaceholders, render } from './templates.js';
import { notify } from './service.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('template rendering', () => {
  it('substitutes known keys and nothing else', () => {
    expect(
      render('Hello {{firstName}}, open {{url}}', { firstName: 'Ann', url: 'https://x' }),
    ).toBe('Hello Ann, open https://x');
    // Whitespace inside the braces is tolerated — officers edit these by hand.
    expect(render('{{ a }}-{{b}}', { a: '1', b: '2' })).toBe('1-2');
  });

  it('does not evaluate anything a template author writes', () => {
    // No expressions, no conditionals, no property traversal into the payload object.
    const payload = { name: 'Ann' };
    expect(render('{{constructor}}', payload)).toBe('');
    expect(render('{{name.length}}', payload)).toBe('');
  });

  it('reports placeholders the caller did not supply', () => {
    expect(missingPlaceholders('{{a}} {{b}}', { a: '1' })).toEqual(['b']);
    expect(missingPlaceholders('{{a}}', { a: '1' })).toEqual([]);
  });
});

describe('notify', () => {
  it('records a delivery log row and sends the mail', async () => {
    const user = await createUser();

    const result = await notify({
      personId: user.personId,
      templateCode: 'AUTH_PASSWORD_RESET',
      payload: { firstName: 'Ann', resetUrl: 'https://dis.example.org/x', ttlMinutes: '60' },
    });

    expect(result.delivered).toBe(true);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.templateCode).toBe('AUTH_PASSWORD_RESET');

    const sent = capturedMail().sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(user.email);
    expect(sent[0]?.text).toContain('https://dis.example.org/x');
    expect(sent[0]?.text).not.toContain('{{');
  });

  it('records a FAILED row rather than sending a half-rendered email', async () => {
    const user = await createUser();

    // resetUrl deliberately omitted.
    const result = await notify({
      personId: user.personId,
      templateCode: 'AUTH_PASSWORD_RESET',
      payload: { firstName: 'Ann' },
    });

    expect(result.delivered).toBe(false);
    expect(capturedMail().sent).toHaveLength(0);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('resetUrl');
  });

  it('records a FAILED row when the recipient has no email address', async () => {
    const person = await prisma.person.create({
      data: { firstName: 'No', lastName: 'Address' },
      select: { id: true },
    });

    const result = await notify({
      personId: person.id,
      templateCode: 'AUTH_PASSWORD_RESET',
      payload: { firstName: 'No', resetUrl: 'https://x', ttlMinutes: '60' },
    });

    expect(result.delivered).toBe(false);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('no email');
  });
});

describe('password reset email, end to end', () => {
  it('emails a working link, and the link resets the password', async () => {
    const user = await createUser();

    const forgot = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: user.email });
    expect(forgot.status).toBe(204);

    const sent = capturedMail().sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Reset your Rotaract DIS password');

    // Pull the token out of the email exactly as a member's browser would.
    const link = /https:\/\/\S+/.exec(sent[0]?.text ?? '')?.[0] ?? '';
    expect(link).toContain('https://dis.example.org/auth/reset');
    const token = new URL(link).searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'a brand new passphrase' });
    expect(reset.status).toBe(204);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'a brand new passphrase' });
    expect(login.status).toBe(200);

    const log = await prisma.notification.findFirstOrThrow();
    expect(log.status).toBe('SENT');
  });

  it('sends nothing for an address with no account', async () => {
    const response = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'nobody@example.org' });

    expect(response.status).toBe(204);
    expect(capturedMail().sent).toHaveLength(0);
    // No delivery-log row either: nothing happened, and the log should not imply it did.
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('invitations', () => {
  it('emails an invite link that activates the account and records consent', async () => {
    const user = await createUser({ status: 'INVITED' });

    await issueInvite(user.userId);

    const sent = capturedMail().sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Your Rotaract DIS account');

    const link = /https:\/\/\S+/.exec(sent[0]?.text ?? '')?.[0] ?? '';
    expect(link).toContain('/auth/accept-invite');
    const token = new URL(link).searchParams.get('token');

    const accept = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ token, password: 'a brand new passphrase', acceptsDataProcessing: true });
    expect(accept.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.status).toBe('ACTIVE');
    expect(await prisma.consent.count()).toBe(1);
  });
});
