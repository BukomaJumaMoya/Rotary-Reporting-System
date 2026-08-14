import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import {
  errorResponseSchema,
  meResponseSchema,
  type ErrorResponse,
  type MeResponse,
  type OrgScopeValue,
} from '@dis/contracts';
// Fixtures build rows across districts and years on purpose — which is exactly what the
// scoped client exists to prevent, so they use the escape hatch. `src/test` is one of the
// three paths ESLint exempts from the no-restricted-imports rule on `unscopedPrisma`.
import { prisma, unscopedPrisma } from '../platform/db.js';
import { CaptureTransport, mailTransport } from '../platform/mail.js';
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
/**
 * Reference data inserted by migrations rather than by a test. Truncating these would
 * delete rows no test creates and every subsequent test depends on — notification
 * templates are the reason password reset can send anything at all.
 */
const PRESERVED_TABLES = ['_prisma_migrations', 'notification_templates'];

export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const list = tables
    .map((t) => t.tablename)
    .filter((name) => !PRESERVED_TABLES.includes(name))
    .map((name) => `"public"."${name}"`)
    .join(', ');

  if (list.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  capturedMail().clear();
}

/** The in-memory transport tests assert against (MAIL_TRANSPORT=capture in vitest.config). */
export function capturedMail(): CaptureTransport {
  const transport = mailTransport();
  if (!(transport instanceof CaptureTransport)) {
    throw new Error('Tests must run with MAIL_TRANSPORT=capture');
  }
  return transport;
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

  const person = await unscopedPrisma.person.create({
    data: { firstName: 'Test', lastName: 'Member', email },
    select: { id: true },
  });

  const user = await unscopedPrisma.user.create({
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
  await unscopedPrisma.userToken.create({
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
  return unscopedPrisma.userToken.findUnique({ where: { tokenHash: hashToken(plaintext) } });
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

/** Logs a seeded member in and returns an agent that carries the session cookie. */
export async function signIn(app: Express, user: SeededUser): Promise<TestAgent> {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });

  if (response.status !== 200) {
    throw new Error(`Sign-in failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Organisation fixtures
//
// Everything below writes through `unscopedPrisma` deliberately: a fixture that could
// only create rows inside the current context could not build the out-of-scope rows
// these tests exist to prove are unreachable.
// ---------------------------------------------------------------------------

/** A Rotary Year label, reused if a previous fixture already made it — labels are unique. */
async function ensureRotaryYear(label: string): Promise<string> {
  const existing = await unscopedPrisma.rotaryYear.findUnique({
    where: { label },
    select: { id: true },
  });
  if (existing) return existing.id;

  const startYear = Number(label.slice(0, 4));
  const created = await unscopedPrisma.rotaryYear.create({
    data: {
      label,
      startsOn: new Date(Date.UTC(startYear, 6, 1)),
      endsOn: new Date(Date.UTC(startYear + 1, 5, 30)),
    },
    select: { id: true },
  });
  return created.id;
}

export interface OrgFixture {
  districtId: string;
  districtName: string;
  currentYearId: string;
  currentYearLabel: string;
  previousYearId: string;
  previousYearLabel: string;
}

/**
 * A district with two Rotary Years: 2027-28 current, 2026-27 closed behind it.
 *
 * Two years rather than one because almost everything worth testing here is about the
 * boundary between them — the year override, the lock, and the fact that last year's
 * rows are invisible without anyone filtering them out.
 */
export async function createOrg(
  options: {
    riDistrictCode?: string;
    name?: string;
    currentYearLabel?: string;
    previousYearLabel?: string;
    isCurrentYearLocked?: boolean;
    isPreviousYearLocked?: boolean;
  } = {},
): Promise<OrgFixture> {
  const currentYearLabel = options.currentYearLabel ?? '2027-28';
  const previousYearLabel = options.previousYearLabel ?? '2026-27';
  const name = options.name ?? 'Rotaract District 9218';

  const [currentYearId, previousYearId] = await Promise.all([
    ensureRotaryYear(currentYearLabel),
    ensureRotaryYear(previousYearLabel),
  ]);

  const district = await unscopedPrisma.district.create({
    data: {
      // Unique per district, so a second fixture in the same test gets its own.
      riDistrictCode: options.riDistrictCode ?? `D-${randomUUID().slice(0, 8)}`,
      name,
    },
    select: { id: true },
  });

  await unscopedPrisma.districtYear.createMany({
    data: [
      {
        districtId: district.id,
        rotaryYearId: previousYearId,
        isCurrent: false,
        isLocked: options.isPreviousYearLocked ?? false,
      },
      {
        districtId: district.id,
        rotaryYearId: currentYearId,
        isCurrent: true,
        isLocked: options.isCurrentYearLocked ?? false,
      },
    ],
  });

  return {
    districtId: district.id,
    districtName: name,
    currentYearId,
    currentYearLabel,
    previousYearId,
    previousYearLabel,
  };
}

export async function createClub(name = `Rotaract Club of ${randomUUID().slice(0, 8)}`) {
  return unscopedPrisma.club.create({
    data: { name, slug: `club-${randomUUID()}`, baseType: 'CBC' },
    select: { id: true, name: true },
  });
}

export async function createRegion(
  districtId: string,
  name = `Region ${randomUUID().slice(0, 6)}`,
) {
  return unscopedPrisma.region.create({
    data: { districtId, name },
    select: { id: true, name: true },
  });
}

export async function createCluster(input: {
  districtId: string;
  rotaryYearId: string;
  regionId?: string;
  name?: string;
}) {
  return unscopedPrisma.cluster.create({
    data: {
      districtId: input.districtId,
      rotaryYearId: input.rotaryYearId,
      regionId: input.regionId ?? null,
      name: input.name ?? `Cluster ${randomUUID().slice(0, 6)}`,
    },
    select: { id: true, name: true },
  });
}

export async function createCommittee(input: {
  districtId: string;
  rotaryYearId: string;
  name?: string;
  parentCommitteeId?: string;
}) {
  return unscopedPrisma.committee.create({
    data: {
      districtId: input.districtId,
      rotaryYearId: input.rotaryYearId,
      name: input.name ?? `Committee ${randomUUID().slice(0, 6)}`,
      parentCommitteeId: input.parentCommitteeId ?? null,
    },
    select: { id: true, name: true },
  });
}

export async function assignClubToCluster(input: {
  clubId: string;
  clusterId: string;
  rotaryYearId: string;
}): Promise<void> {
  await unscopedPrisma.clubClusterAssignment.create({ data: input });
}

/**
 * A position with its permissions wired, creating any permission rows it needs.
 *
 * Permissions are reference data seeded by `prisma/seed.ts` in production, so the
 * fixture creates them on demand rather than requiring every test to know the catalogue.
 */
export async function createPosition(input: {
  districtId: string | null;
  code?: string;
  name?: string;
  scope: OrgScopeValue;
  permissions?: string[];
}) {
  const code = input.code ?? `POS_${randomUUID().slice(0, 8)}`;
  const permissions = input.permissions ?? [];

  for (const permissionCode of permissions) {
    await unscopedPrisma.permission.upsert({
      where: { code: permissionCode },
      update: {},
      create: { code: permissionCode, description: permissionCode },
    });
  }

  return unscopedPrisma.position.create({
    data: {
      districtId: input.districtId,
      code,
      name: input.name ?? code,
      scope: input.scope,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
    select: { id: true, code: true, name: true },
  });
}

/** Wires a person to a position, for a scope, for a year. The unit of authorisation. */
export async function appoint(input: {
  personId: string;
  districtId: string;
  rotaryYearId: string;
  positionId: string;
  scopeType: OrgScopeValue;
  scopeId?: string | null;
  startsOn?: Date;
  endsOn?: Date | null;
  isActive?: boolean;
}) {
  return unscopedPrisma.appointment.create({
    data: {
      personId: input.personId,
      districtId: input.districtId,
      rotaryYearId: input.rotaryYearId,
      positionId: input.positionId,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      // Well in the past: the term must already have started for the appointment to
      // count, and a fixture dated "today" is a test that fails at midnight.
      startsOn: input.startsOn ?? new Date(Date.UTC(2020, 0, 1)),
      endsOn: input.endsOn ?? null,
      isActive: input.isActive ?? true,
    },
    select: { id: true },
  });
}

export async function createActivityType(districtId: string | null, code?: string) {
  return unscopedPrisma.activityType.create({
    data: {
      districtId,
      code: code ?? `TYPE_${randomUUID().slice(0, 8)}`,
      name: 'Fellowship',
      category: 'FELLOWSHIP',
    },
    select: { id: true },
  });
}

export async function createActivity(input: {
  districtId: string;
  rotaryYearId: string;
  activityTypeId: string;
  hostScopeType?: OrgScopeValue;
  hostScopeId: string;
  title?: string;
  deletedAt?: Date | null;
}) {
  return unscopedPrisma.activity.create({
    data: {
      districtId: input.districtId,
      rotaryYearId: input.rotaryYearId,
      activityTypeId: input.activityTypeId,
      hostScopeType: input.hostScopeType ?? 'CLUB',
      hostScopeId: input.hostScopeId,
      title: input.title ?? 'Weekly fellowship',
      startsAt: new Date(Date.UTC(2027, 8, 1, 17, 0)),
      deletedAt: input.deletedAt ?? null,
    },
    select: { id: true, title: true },
  });
}
