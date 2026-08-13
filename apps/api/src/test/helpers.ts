import { randomUUID } from 'node:crypto';
import {
  errorResponseSchema,
  meResponseSchema,
  type ErrorResponse,
  type MeResponse,
} from '@dis/contracts';
import { prisma } from '../platform/db.js';
import { hashPassword } from '../modules/auth/passwords.js';
import { hashToken, issueToken, TokenPurpose } from '../modules/auth/tokens.js';
import type { TokenPurposeValue } from '../modules/auth/tokens.js';

/**
 * Empties every table between tests.
 *
 * TRUNCATE ... CASCADE rather than deleting per table, so ordering does not have to be
 * maintained by hand as the schema grows. `_prisma_migrations` is excluded — dropping it
 * would make the next run reapply everything.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

export interface SeededUser {
  userId: string;
  personId: string;
  email: string;
  password: string;
}

/**
 * One person with one account. Deliberately minimal: this session has no appointments,
 * districts or clubs to attach, and inventing them would couple these tests to
 * governance work that has not happened yet.
 */
export async function createUser(
  overrides: {
    email?: string;
    password?: string;
    status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
    failedAttempts?: number;
    lockedUntil?: Date | null;
  } = {},
): Promise<SeededUser> {
  const email = overrides.email ?? `member-${randomUUID()}@example.org`;
  const password = overrides.password ?? 'correct horse battery staple';
  const status = overrides.status ?? 'ACTIVE';

  const person = await prisma.person.create({
    data: { firstName: 'Test', lastName: 'Member', email },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      personId: person.id,
      passwordHash: await hashPassword(password),
      status,
      failedAttempts: overrides.failedAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
    },
    select: { id: true },
  });

  return { userId: user.id, personId: person.id, email, password };
}

/** Issues a token for a user and returns the plaintext, as the email would carry it. */
export async function createTokenFor(
  userId: string,
  purpose: TokenPurposeValue = TokenPurpose.RESET,
  options: { expiresAt?: Date; consumedAt?: Date } = {},
): Promise<string> {
  const token = issueToken(60);
  await prisma.userToken.create({
    data: {
      userId,
      purpose,
      tokenHash: token.hash,
      expiresAt: options.expiresAt ?? token.expiresAt,
      consumedAt: options.consumedAt ?? null,
    },
  });
  return token.plaintext;
}

export async function tokenRow(plaintext: string) {
  return prisma.userToken.findUnique({ where: { tokenHash: hashToken(plaintext) } });
}

/**
 * Reads a response body through the shared contract schema.
 *
 * supertest types `body` as `any`, so `response.body.error.code` is unchecked. Parsing
 * with the contract instead of casting does double duty: the test gets typed access,
 * and every assertion also proves the response matches the envelope the client is
 * written against. A handler that returned the wrong shape would fail here.
 */
export function errorBody(response: { body: unknown }): ErrorResponse['error'] {
  return errorResponseSchema.parse(response.body).error;
}

export function meBody(response: { body: unknown }): MeResponse['data'] {
  return meResponseSchema.parse(response.body).data;
}
