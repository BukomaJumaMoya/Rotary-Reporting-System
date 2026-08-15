import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db, unscopedPrisma } from '../platform/db.js';
import type { SystemContext } from '../platform/system-context.js';
import {
  affiliateClub,
  createActivity,
  createActivityType,
  createClubIn,
  createOrg,
  createClub,
  resetDatabase,
} from '../test/helpers.js';
import { defineJob, jobContextSchema } from './define.js';
import { InvalidJobPayloadError, runJob } from './runner.js';

/**
 * What a job is allowed to do, tested without a queue.
 *
 * pg-boss delivers the payload; everything that matters happens after that, and it is all
 * here: the payload is validated, a system context is built from it, the reason reaches
 * the audit log, and the handler cannot see past its own district.
 */

describe('runJob', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('hands the handler a system context built from the payload', async () => {
    const org = await createOrg();
    let seen: SystemContext | undefined;

    const job = defineJob({
      name: 'test-context',
      schema: jobContextSchema,
      describe: () => 'a test job',
      handler: async ({ ctx }) => {
        seen = ctx;
        await Promise.resolve();
      },
    });

    await runJob(job, { districtId: org.districtId, rotaryYearId: org.currentYearId });

    expect(seen?.districtId).toBe(org.districtId);
    expect(seen?.rotaryYearId).toBe(org.currentYearId);
    expect(seen?.isSystem).toBe(true);
    // The reason is what `audit_log` records for every write the job makes, and a job with
    // an empty one is a log entry nobody can act on.
    expect(seen?.reason).toBe('a test job');
    expect(seen?.isYearWritable).toBe(true);
  });

  it('names the job in the reason, from the payload', async () => {
    const org = await createOrg();
    const club = await createClubIn(org);
    let reason = '';

    const job = defineJob({
      name: 'test-reason',
      schema: jobContextSchema.extend({ clubId: z.uuid() }),
      describe: (payload) => `rescore club ${payload.clubId}`,
      handler: async ({ ctx }) => {
        reason = ctx.reason;
        await Promise.resolve();
      },
    });

    await runJob(job, {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      clubId: club.id,
    });

    expect(reason).toBe(`rescore club ${club.id}`);
  });

  it('refuses a payload that does not match the schema, without running the handler', async () => {
    let ran = false;

    const job = defineJob({
      name: 'test-invalid',
      schema: jobContextSchema.extend({ clubId: z.uuid() }),
      describe: () => 'never runs',
      handler: async () => {
        ran = true;
        await Promise.resolve();
      },
    });

    await expect(
      runJob(job, { districtId: randomUUID(), rotaryYearId: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(ran).toBe(false);
  });

  it('cannot reach another district through db(ctx)', async () => {
    const mine = await createOrg({ riDistrictCode: 'D-MINE' });
    const theirs = await createOrg({ riDistrictCode: 'D-THEIRS' });

    const myClub = await createClubIn(mine);
    const theirClub = await createClub();
    await affiliateClub({
      clubId: theirClub.id,
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
    });

    const [myType, theirType] = await Promise.all([
      createActivityType(mine.districtId),
      createActivityType(theirs.districtId),
    ]);

    await createActivity({
      districtId: mine.districtId,
      rotaryYearId: mine.currentYearId,
      activityTypeId: myType.id,
      hostScopeId: myClub.id,
      title: 'Mine',
    });
    await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: theirType.id,
      hostScopeId: theirClub.id,
      title: 'Theirs',
    });

    let titles: string[] = [];

    const job = defineJob({
      name: 'test-scope',
      schema: jobContextSchema,
      describe: () => 'read every activity it can see',
      handler: async ({ ctx }) => {
        // Deliberately unfiltered: the point is that the scope is applied by the layer,
        // not by the handler remembering to ask for it.
        const rows = await db(ctx).activity.findMany({ select: { title: true } });
        titles = rows.map((row) => row.title);
      },
    });

    await runJob(job, { districtId: mine.districtId, rotaryYearId: mine.currentYearId });

    expect(titles).toEqual(['Mine']);
  });

  it('refuses to write to a locked year, exactly as a request context would', async () => {
    const org = await createOrg({ isCurrentYearLocked: true });
    const club = await createClubIn(org);
    const type = await createActivityType(org.districtId);

    const job = defineJob({
      name: 'test-locked',
      schema: jobContextSchema,
      describe: () => 'write into a locked year',
      handler: async ({ ctx }) => {
        await db(ctx).activity.create({
          data: {
            activityTypeId: type.id,
            hostScopeType: 'CLUB',
            hostScopeId: club.id,
            title: 'Should not exist',
            startsAt: new Date(),
          },
        });
      },
    });

    await expect(
      runJob(job, { districtId: org.districtId, rotaryYearId: org.currentYearId }),
    ).rejects.toMatchObject({ code: 'YEAR_LOCKED' });
  });

  it('attributes the job’s writes in the audit log', async () => {
    const org = await createOrg();
    const club = await createClubIn(org);
    const type = await createActivityType(org.districtId);

    const job = defineJob({
      name: 'test-audit',
      schema: jobContextSchema,
      describe: () => 'create one activity',
      handler: async ({ ctx }) => {
        await db(ctx).activity.create({
          data: {
            activityTypeId: type.id,
            hostScopeType: 'CLUB',
            hostScopeId: club.id,
            title: 'Written by a job',
            startsAt: new Date(),
          },
        });
      },
    });

    await runJob(job, { districtId: org.districtId, rotaryYearId: org.currentYearId });

    const entries = await unscopedPrisma.auditLogEntry.findMany({
      where: { entityType: 'activities', action: 'CREATE' },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.districtId).toBe(org.districtId);
    // No account did this. A fabricated user id would be worse than a null one:
    // actor_user_id is a foreign key to a real person's account.
    expect(entries[0]?.actorUserId).toBeNull();
    expect(entries[0]?.userAgent).toBe('system:create one activity');
  });
});
