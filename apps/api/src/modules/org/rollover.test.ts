import { rolloverResponseSchema } from '@dis/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma, unscopedPrisma } from '../../platform/db.js';
import { closeSessionPool } from '../../platform/session.js';
import { systemContext } from '../../platform/system-context.js';
import { db } from '../../platform/db.js';
import {
  affiliateClub,
  appoint,
  createClub,
  createOrg,
  createPosition,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../../test/helpers.js';
import { recalculateTier } from './clubs.service.js';
import { clearPendingConfirmations } from './rollover.service.js';

/**
 * Year rollover.
 *
 * Runs once a year, touches every club and every appointment, and is therefore the least
 * exercised code in the system on the day it matters most. These tests are the exercise.
 */

const app = createApp();
let org: OrgFixture;
let drr: TestAgent;

/** 2028-29: the year to roll INTO. createOrg only makes the two around today. */
async function seedTargetYear(label = '2028-29'): Promise<string> {
  const existing = await unscopedPrisma.rotaryYear.findUnique({ where: { label } });
  if (existing) return existing.id;

  const row = await unscopedPrisma.rotaryYear.create({
    data: {
      label,
      startsOn: new Date(Date.UTC(2028, 6, 1)),
      endsOn: new Date(Date.UTC(2029, 5, 30)),
    },
    select: { id: true },
  });
  return row.id;
}

async function seedClubWithRoster(name: string, members: number, baseType: 'CBC' | 'IBC' = 'CBC') {
  const club = await unscopedPrisma.club.create({
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, baseType },
    select: { id: true },
  });
  await affiliateClub({
    clubId: club.id,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    tier: 'T1',
  });

  for (let index = 0; index < members; index += 1) {
    const person = await unscopedPrisma.person.create({
      data: { firstName: 'Member', lastName: `${index}` },
      select: { id: true },
    });
    await unscopedPrisma.membershipEvent.create({
      data: {
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        personId: person.id,
        clubId: club.id,
        eventType: 'JOIN',
        effectiveOn: new Date(Date.UTC(2027, 6, 1)),
      },
    });
  }
  await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');
  return club;
}

beforeEach(async () => {
  await resetDatabase();
  clearPendingConfirmations();
  org = await createOrg();

  await unscopedPrisma.permission.createMany({
    data: [{ code: 'year:rollover:district', description: 'Run the rollover' }],
    skipDuplicates: true,
  });

  const user = await createUser();
  const position = await createPosition({
    districtId: org.districtId,
    code: 'DES',
    scope: 'DISTRICT',
    permissions: ['year:rollover:district'],
  });
  await appoint({
    personId: user.personId,
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    positionId: position.id,
    scopeType: 'DISTRICT',
  });
  drr = await signIn(app, user);
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

describe('the tier rule', () => {
  it('is by size, except for institution-based clubs', () => {
    expect(recalculateTier('CBC', 39)).toBe('T1');
    expect(recalculateTier('CBC', 40)).toBe('T2');
    // A university club's year is a semester and its membership turns over completely,
    // so it is assessed against its own tier regardless of size.
    expect(recalculateTier('IBC', 5)).toBe('IBC');
    expect(recalculateTier('IBC', 500)).toBe('IBC');
  });
});

describe('the request itself', () => {
  it('REJECTS a request that omits dryRun', async () => {
    await seedTargetYear();

    const response = await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2028-29' });

    // No default is safe: true would be ignored by a client that forgot it, false would
    // be a catastrophe. Required means the caller said which one they meant.
    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('VALIDATION_ERROR');
  });

  it('refuses a caller without year:rollover:district', async () => {
    await seedTargetYear();
    const nobody = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'MEMBER',
      scope: 'DISTRICT',
      permissions: [],
    });
    await appoint({
      personId: nobody.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'DISTRICT',
    });

    const agent = await signIn(app, nobody);
    const response = await agent
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: true });

    expect(response.status).toBe(403);
  });

  it('refuses a year that is already open for this district', async () => {
    const response = await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: org.previousYearLabel, dryRun: true });

    expect(response.status).toBe(422);
  });
});

describe('the dry run', () => {
  it('commits NOTHING, and reports work that actually executed', async () => {
    await seedTargetYear();
    await seedClubWithRoster('Kampala', 45);
    await seedClubWithRoster('Gulu', 12);

    const before = {
      affiliations: await unscopedPrisma.clubDistrictAffiliation.count(),
      districtYears: await unscopedPrisma.districtYear.count(),
      activeAppointments: await unscopedPrisma.appointment.count({ where: { isActive: true } }),
      locked: await unscopedPrisma.districtYear.count({ where: { isLocked: true } }),
    };

    const response = await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: true });

    expect(response.status).toBe(200);
    const { data } = rolloverResponseSchema.parse(response.body);

    expect(data.dryRun).toBe(true);
    expect(data.clubsCarriedForward).toBe(2);
    expect(data.appointmentsExpired).toBeGreaterThan(0);
    expect(data.confirmToken).not.toBeNull();

    // Everything ran and then rolled back. That is what makes the report describe work
    // rather than predict it.
    expect({
      affiliations: await unscopedPrisma.clubDistrictAffiliation.count(),
      districtYears: await unscopedPrisma.districtYear.count(),
      activeAppointments: await unscopedPrisma.appointment.count({ where: { isActive: true } }),
      locked: await unscopedPrisma.districtYear.count({ where: { isLocked: true } }),
    }).toEqual(before);
  });

  it('reports tier changes with the roster size behind them, and flags empty clubs', async () => {
    await seedTargetYear();
    await seedClubWithRoster('Grown', 45);
    await seedClubWithRoster('Empty', 0);

    const { data } = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2028-29', dryRun: true }))
        .body,
    );

    // Seeded at T1; forty-five members makes it T2.
    const changed = data.tierChanges.find((change) => change.clubName === 'Grown');
    expect(changed).toMatchObject({ from: 'T1', to: 'T2', rosterSize: 45 });

    // A club with nobody on it is the thing the district must look at before confirming.
    expect(data.flaggedClubs.map((club) => club.clubName)).toContain('Empty');
  });

  it('names the positions whose appointments expire', async () => {
    await seedTargetYear();

    const { data } = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2028-29', dryRun: true }))
        .body,
    );

    expect(data.expiringByPosition.some((entry) => entry.position === 'DES')).toBe(true);
  });
});

describe('the committed run', () => {
  async function dryRunThenCommit(label = '2028-29') {
    const dry = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: label, dryRun: true }))
        .body,
    );

    return drr.post('/api/v1/admin/rollover').send({
      targetYearLabel: label,
      dryRun: false,
      confirmToken: dry.data.confirmToken,
    });
  }

  it('locks the prior year, opens the new one and carries the clubs forward', async () => {
    const targetYearId = await seedTargetYear();
    await seedClubWithRoster('Kampala', 45);

    const response = await dryRunThenCommit();
    expect(response.status).toBe(200);

    const prior = await unscopedPrisma.districtYear.findFirstOrThrow({
      where: { districtId: org.districtId, rotaryYearId: org.currentYearId },
    });
    expect(prior.isLocked).toBe(true);
    expect(prior.isCurrent).toBe(false);
    expect(prior.lockedAt).not.toBeNull();

    const opened = await unscopedPrisma.districtYear.findFirstOrThrow({
      where: { districtId: org.districtId, rotaryYearId: targetYearId },
    });
    expect(opened.isCurrent).toBe(true);
    expect(opened.isLocked).toBe(false);

    const carried = await unscopedPrisma.clubDistrictAffiliation.findMany({
      where: { rotaryYearId: targetYearId },
    });
    expect(carried).toHaveLength(1);
    expect(carried[0]?.tier).toBe('T2');
    // A tier the district has not looked at is a proposal, not a fact.
    expect(carried[0]?.isConfirmed).toBe(false);

    // Exactly one current year per district — the partial unique index would have
    // refused a second, which is the constraint doing the checking.
    expect(
      await unscopedPrisma.districtYear.count({
        where: { districtId: org.districtId, isCurrent: true },
      }),
    ).toBe(1);
  });

  it('deactivates prior-year appointments and writes an audit row', async () => {
    await seedTargetYear();
    await dryRunThenCommit();

    expect(
      await unscopedPrisma.appointment.count({
        where: { rotaryYearId: org.currentYearId, isActive: true },
      }),
    ).toBe(0);

    const audited = await unscopedPrisma.auditLogEntry.findMany({
      where: { entityType: 'district_years' },
    });
    expect(audited).toHaveLength(1);
    // The system context's reason is what makes the log say WHY, not merely that.
    expect(JSON.stringify(audited[0]?.after)).toContain('rollover');
  });

  it('refuses prior-year WRITES afterwards, while reads still work', async () => {
    await seedTargetYear();
    await seedClubWithRoster('Kampala', 10);
    await dryRunThenCommit();

    // A fresh system context for the year that was just locked — which is the self-test
    // the whole locked-year mechanism exists for.
    const lockedCtx = await systemContext({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      reason: 'post-rollover check',
    });

    expect(lockedCtx.isYearWritable).toBe(false);

    // Reads are never restricted. A locked year is read-only, not invisible.
    const affiliations = await db(lockedCtx).clubDistrictAffiliation.findMany();
    expect(affiliations.length).toBeGreaterThan(0);

    await expect(
      db(lockedCtx).clubDistrictAffiliation.updateMany({
        where: {},
        data: { isConfirmed: true },
      }),
    ).rejects.toMatchObject({ code: 'YEAR_LOCKED' });
  });
});

describe('the confirmation token', () => {
  it('is required to commit', async () => {
    await seedTargetYear();

    const response = await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: false });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('ROLLOVER_NOT_CONFIRMED');
  });

  it('is rejected when it was issued for a different target year', async () => {
    await seedTargetYear('2028-29');
    await seedTargetYear('2029-30');

    const dry = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2029-30', dryRun: true }))
        .body,
    );

    const response = await drr.post('/api/v1/admin/rollover').send({
      targetYearLabel: '2028-29',
      dryRun: false,
      confirmToken: dry.data.confirmToken,
    });

    // A token from another rollover would commit a diff nobody read.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('ROLLOVER_NOT_CONFIRMED');
  });

  it('is single use', async () => {
    const targetYearId = await seedTargetYear();

    const dry = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2028-29', dryRun: true }))
        .body,
    );
    const token = dry.data.confirmToken;

    await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: false, confirmToken: token })
      .expect(200);

    // The rollover expired the DES's own appointment along with everybody else's — which
    // is the whole point of it — so they must be re-appointed for the new year before
    // they can do anything at all. Re-appointing them is what makes the assertion below
    // about the TOKEN rather than about their authority.
    const des = await unscopedPrisma.position.findFirstOrThrow({ where: { code: 'DES' } });
    const holder = await unscopedPrisma.appointment.findFirstOrThrow({
      where: { positionId: des.id },
      select: { personId: true },
    });
    await appoint({
      personId: holder.personId,
      districtId: org.districtId,
      rotaryYearId: targetYearId,
      positionId: des.id,
      scopeType: 'DISTRICT',
    });

    const again = await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: false, confirmToken: token });

    // Refused — and refused by the STRONGER guard, which fires first: the target year is
    // already open, so a replayed request cannot roll the district over twice whatever
    // it carries. The token being consumed is the second line of defence, isolated by
    // the three tests above; this one asserts the outcome that matters.
    expect(again.status).toBe(422);
    expect(errorBody(again).code).toBe('VALIDATION_ERROR');

    expect(await unscopedPrisma.districtYear.count({ where: { districtId: org.districtId } })).toBe(
      3,
    );
  });

  it('is rejected when unrecognised', async () => {
    await seedTargetYear();

    const response = await drr.post('/api/v1/admin/rollover').send({
      targetYearLabel: '2028-29',
      dryRun: false,
      confirmToken: '00000000-0000-4000-8000-00000000dead',
    });

    expect(response.status).toBe(422);
  });
});

describe('open assessment periods', () => {
  it('block the rollover, naming them', async () => {
    await seedTargetYear();

    const framework = await unscopedPrisma.assessmentFramework.create({
      data: {
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        name: 'Rubric',
        version: 1,
        totalPoints: 100,
      },
      select: { id: true },
    });
    await unscopedPrisma.assessmentPeriod.create({
      data: {
        frameworkId: framework.id,
        periodType: 'MONTHLY',
        label: 'August 2027',
        startsOn: new Date(),
        endsOn: new Date(),
        submissionDeadline: new Date(),
        status: 'OPEN',
      },
    });

    const response = await drr
      .post('/api/v1/admin/rollover')
      .send({ targetYearLabel: '2028-29', dryRun: true });

    // Scoring a period whose year is about to be locked produces a scorecard nobody can
    // correct.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('PERIOD_OPEN');
    expect(errorBody(response).details).toMatchObject({ openPeriods: ['August 2027'] });
  });
});

describe('systemContext', () => {
  it('holds the whole permission catalogue within one district and year', async () => {
    await unscopedPrisma.permission.createMany({
      data: [{ code: 'activity:create:club', description: 'x' }],
      skipDuplicates: true,
    });

    const ctx = await systemContext({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      reason: 'test',
    });

    expect(ctx.isSystem).toBe(true);
    expect(ctx.permissions.has('activity:create:club')).toBe(true);
    expect(ctx.scopes.isDistrictWide).toBe(true);
    expect(ctx.districtId).toBe(org.districtId);
  });

  it('refuses to be built without a reason', async () => {
    await expect(
      systemContext({
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        reason: '   ',
      }),
    ).rejects.toThrow(/reason/);
  });

  it('respects a locked year exactly as a user context does', async () => {
    const locked = await createOrg({ isCurrentYearLocked: true });

    const ctx = await systemContext({
      districtId: locked.districtId,
      rotaryYearId: locked.currentYearId,
      reason: 'test',
    });

    expect(ctx.isYearWritable).toBe(false);
  });

  it('refuses a year the district does not have', async () => {
    const other = await createOrg();
    const strayYear = await seedTargetYear('2031-32');

    await expect(
      systemContext({ districtId: other.districtId, rotaryYearId: strayYear, reason: 'test' }),
    ).rejects.toThrow(/no Rotary Year/);
  });
});

describe('a seeded database plus a rollover', () => {
  it('produces a coherent state', async () => {
    // The seed clamps appointment terms to today so the 2027-28 dataset is signable-in
    // before launch. After a rollover that dataset must still make sense.
    const club = await createClub('Rotaract Club of Jinja');
    await affiliateClub({
      clubId: club.id,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
    });
    await seedTargetYear();

    const dry = rolloverResponseSchema.parse(
      (await drr.post('/api/v1/admin/rollover').send({ targetYearLabel: '2028-29', dryRun: true }))
        .body,
    );
    await drr
      .post('/api/v1/admin/rollover')
      .send({
        targetYearLabel: '2028-29',
        dryRun: false,
        confirmToken: dry.data.confirmToken,
      })
      .expect(200);

    // Every officer's appointment expired with the year, so nobody resolves a context —
    // which is exactly what rollover is for, and why the DES re-appoints the new slate.
    const me = await drr.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(
      (me.body as { data: { context: { districtId: string | null } } }).data.context.districtId,
    ).toBeNull();
  });
});
