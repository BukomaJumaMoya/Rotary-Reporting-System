import type { RequestContext } from '@dis/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db, prisma, unscopedPrisma } from './db.js';
import { closeSessionPool } from './session.js';
import {
  appoint,
  createActivity,
  createActivityType,
  createClub,
  createOrg,
  createPosition,
  createUser,
  errorBody,
  resetDatabase,
  signIn,
  type OrgFixture,
} from '../test/helpers.js';
import { mountProbeRoutes } from '../test/probe-routes.js';

/**
 * The scoped data access layer.
 *
 * The queries below are written the way a repository writes them — no `districtId`, no
 * `rotaryYearId`, no `deletedAt` — and the assertions are about what comes back anyway.
 * A test that had to pass the scope in order to get the right answer would be testing a
 * helper, not a layer.
 */

const app = createApp(mountProbeRoutes);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeSessionPool();
});

function contextFor(org: OrgFixture, overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    personId: '00000000-0000-4000-8000-000000000002',
    districtId: org.districtId,
    rotaryYearId: org.currentYearId,
    permissions: new Set<string>(),
    scopes: { clubIds: [], clusterIds: [], isDistrictWide: true },
    isYearWritable: true,
    ...overrides,
  };
}

describe('reads', () => {
  it('sees only the context district', async () => {
    const mine = await createOrg({ name: 'District 9218' });
    const theirs = await createOrg({ name: 'District 9214' });
    const club = await createClub();

    const myType = await createActivityType(mine.districtId);
    const theirType = await createActivityType(theirs.districtId);

    await createActivity({
      districtId: mine.districtId,
      rotaryYearId: mine.currentYearId,
      activityTypeId: myType.id,
      hostScopeId: club.id,
      title: 'Ours',
    });
    await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: theirType.id,
      hostScopeId: club.id,
      title: 'Theirs',
    });

    const activities = await db(contextFor(mine)).activity.findMany();

    expect(activities.map((a) => a.title)).toEqual(['Ours']);
  });

  it('sees only the context year', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);

    await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'This year',
    });
    await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.previousYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Last year',
    });

    const activities = await db(contextFor(org)).activity.findMany();

    // Axiom 1 made real: the year was not asked for, and it was applied anyway.
    expect(activities.map((a) => a.title)).toEqual(['This year']);
  });

  it('excludes soft-deleted rows', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);

    await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Live',
    });
    await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Deleted',
      deletedAt: new Date(),
    });

    const activities = await db(contextFor(org)).activity.findMany();
    expect(activities.map((a) => a.title)).toEqual(['Live']);
  });

  it('applies the soft-delete filter on the context-free client too', async () => {
    await createClub('Live club');
    const gone = await createClub('Closed club');
    await unscopedPrisma.club.update({
      where: { id: gone.id },
      data: { deletedAt: new Date() },
    });

    const clubs = await prisma.club.findMany({ select: { name: true } });

    // Clubs are global — no district, no year — but "every query filters deleted_at"
    // has to be true of the client that reads them as well.
    expect(clubs.map((c) => c.name)).toEqual(['Live club']);
  });

  it('narrows a by-id read to the scope, so an out-of-scope row is simply absent', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const type = await createActivityType(theirs.districtId);

    const other = await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
    });

    const found = await db(contextFor(mine)).activity.findFirst({ where: { id: other.id } });

    // Null, not a row and not an error — which is what lets the handler answer 404 and
    // say nothing about whether the id was real.
    expect(found).toBeNull();
  });

  it('keeps a caller-supplied OR from widening the scope', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const theirType = await createActivityType(theirs.districtId);

    const other = await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: theirType.id,
      hostScopeId: club.id,
      title: 'Theirs',
    });

    const activities = await db(contextFor(mine)).activity.findMany({
      where: { OR: [{ id: other.id }, { title: 'Theirs' }] },
    });

    // The scope is AND-ed with the caller's filter rather than merged into it. Merged,
    // a top-level OR would widen the result instead of narrowing it.
    expect(activities).toEqual([]);
  });

  it('shows system-wide templates alongside the district own rows', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();

    await createActivityType(null, 'TEMPLATE_FELLOWSHIP');
    await createActivityType(mine.districtId, 'OUR_FELLOWSHIP');
    await createActivityType(theirs.districtId, 'THEIR_FELLOWSHIP');

    const types = await db(contextFor(mine)).activityType.findMany({ select: { code: true } });

    // A NULL districtId means "available to every district" for positions, activity
    // types and finance categories. Filtering it out would hide the seeded catalogue.
    expect(types.map((t) => t.code).sort()).toEqual(['OUR_FELLOWSHIP', 'TEMPLATE_FELLOWSHIP']);
  });
});

describe('tables with no scope column of their own', () => {
  /** A framework with one period, one criterion and one club assessment, for a year. */
  async function seedAssessment(org: OrgFixture, rotaryYearId: string, label: string) {
    const club = await createClub();
    const framework = await unscopedPrisma.assessmentFramework.create({
      data: {
        districtId: org.districtId,
        rotaryYearId,
        name: `Rubric ${label}`,
        version: 1,
        totalPoints: 100,
      },
      select: { id: true },
    });
    const parameter = await unscopedPrisma.assessmentParameter.create({
      data: { frameworkId: framework.id, sequence: 1, name: 'Service', maxPoints: 100 },
      select: { id: true },
    });
    const criterion = await unscopedPrisma.assessmentCriterion.create({
      data: {
        parameterId: parameter.id,
        sequence: 1,
        description: 'Service projects held',
        points: 10,
        // ASSESSOR, not AUTO: the criterion_resolver_required guard insists an AUTO
        // criterion names a resolver, and this fixture is about scoping, not scoring.
        evaluationMode: 'ASSESSOR',
      },
      select: { id: true },
    });
    const period = await unscopedPrisma.assessmentPeriod.create({
      data: {
        frameworkId: framework.id,
        periodType: 'MONTHLY',
        label,
        startsOn: new Date(),
        endsOn: new Date(),
        submissionDeadline: new Date(),
      },
      select: { id: true },
    });
    const assessment = await unscopedPrisma.clubAssessment.create({
      data: { districtId: org.districtId, periodId: period.id, clubId: club.id, tier: 'T1' },
      select: { id: true },
    });
    const score = await unscopedPrisma.assessmentScore.create({
      data: {
        clubAssessmentId: assessment.id,
        criterionId: criterion.id,
        pointsAwarded: 8,
        pointsPossible: 10,
        source: 'AUTO',
      },
      select: { id: true },
    });
    return { club, framework, parameter, criterion, period, assessment, score };
  }

  it('scopes a child by its parent, across districts', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    await seedAssessment(theirs, theirs.currentYearId, 'AUG');

    const ctx = contextFor(mine);

    // None of these tables has a district_id. Every one of them is another district's
    // assessment data, and every one of them used to be readable without a context.
    expect(await db(ctx).assessmentPeriod.findMany()).toEqual([]);
    expect(await db(ctx).assessmentParameter.findMany()).toEqual([]);
    expect(await db(ctx).assessmentScore.findMany()).toEqual([]);
    expect(await db(ctx).clubAssessment.findMany()).toEqual([]);
  });

  it('follows a two-hop chain to the framework', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    await seedAssessment(theirs, theirs.currentYearId, 'AUG');
    const ours = await seedAssessment(mine, mine.currentYearId, 'SEP');

    // criterion → parameter → framework → (district, year). Two hops from a table whose
    // only column is a foreign key.
    const criteria = await db(contextFor(mine)).assessmentCriterion.findMany({
      select: { id: true },
    });

    expect(criteria.map((c) => c.id)).toEqual([ours.criterion.id]);
  });

  it('scopes club assessments by YEAR, through the period', async () => {
    const org = await createOrg();
    const lastYear = await seedAssessment(org, org.previousYearId, 'AUG-26');
    const thisYear = await seedAssessment(org, org.currentYearId, 'AUG-27');

    const found = await db(contextFor(org)).clubAssessment.findMany({ select: { id: true } });

    // club_assessments has no rotary_year_id — the year reaches it through
    // period → framework. Scoped by district alone, a current-year scorecard read
    // returned every year ever assessed, which in an award system is the difference
    // between a standing and an argument.
    expect(found.map((a) => a.id)).toEqual([thisYear.assessment.id]);
    expect(found.map((a) => a.id)).not.toContain(lastYear.assessment.id);
  });

  it('hides the children of a soft-deleted parent', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);
    const activity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      deletedAt: new Date(),
    });
    await unscopedPrisma.activityMedia.create({
      data: { activityId: activity.id, storageKey: 'k', mediaType: 'PHOTO' },
    });

    // The parent's deleted_at reaches the child through the same chain, so an attendee
    // list or a photo gallery cannot outlive the activity it belonged to.
    expect(await db(contextFor(org)).activityMedia.findMany()).toEqual([]);
  });

  it('is a compile error to reach a child table without a context', () => {
    // @ts-expect-error — assessment_scores has no district_id, and is scoped all the same.
    void prisma.assessmentScore;
    // @ts-expect-error — as is every other child of a scoped parent.
    void prisma.assessmentPeriod;
    expect(typeof unscopedPrisma.assessmentScore.findMany).toBe('function');
  });
});

describe('writes', () => {
  it('stamps the district and year onto a create', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);

    const created = await db(contextFor(org)).activity.create({
      data: {
        activityTypeId: type.id,
        hostScopeType: 'CLUB',
        hostScopeId: club.id,
        title: 'Fellowship',
        startsAt: new Date(),
      },
    });

    expect(created.districtId).toBe(org.districtId);
    expect(created.rotaryYearId).toBe(org.currentYearId);
  });

  it('overrides a forged district and year rather than trusting them', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const type = await createActivityType(mine.districtId);

    const forged = {
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: type.id,
      hostScopeType: 'CLUB' as const,
      hostScopeId: club.id,
      title: 'Forged',
      startsAt: new Date(),
    };

    // Passed as a variable, not a literal: TypeScript's excess-property check fires on
    // object literals only, so building `data` a line earlier is enough to carry fields
    // the scoped delegate never declared. The type stops the obvious spelling of this
    // bug (see the @ts-expect-error below); the runtime stops the rest.
    const created = await db(contextFor(mine)).activity.create({ data: forged });

    expect(created.districtId).toBe(mine.districtId);
    expect(created.rotaryYearId).toBe(mine.currentYearId);
  });

  it('scopes updateMany, so another district row is not matched', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const type = await createActivityType(theirs.districtId);

    const other = await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
      title: 'Theirs',
    });

    const result = await db(contextFor(mine)).activity.updateMany({
      where: { id: other.id },
      data: { title: 'Renamed' },
    });

    // Zero rows, which the repository turns into a 404. The alternative — update() on a
    // unique id — would have renamed another district's record.
    expect(result.count).toBe(0);

    const untouched = await unscopedPrisma.activity.findUniqueOrThrow({ where: { id: other.id } });
    expect(untouched.title).toBe('Theirs');
  });

  it('scopes deleteMany', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const type = await createActivityType(theirs.districtId);

    const other = await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: type.id,
      hostScopeId: club.id,
    });

    const result = await db(contextFor(mine)).activity.deleteMany({ where: { id: other.id } });

    expect(result.count).toBe(0);
    expect(await unscopedPrisma.activity.count({ where: { id: other.id } })).toBe(1);
  });

  it('refuses every write when the year is not writable', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);
    const ctx = contextFor(org, { isYearWritable: false });

    const create = db(ctx).activity.create({
      data: {
        activityTypeId: type.id,
        hostScopeType: 'CLUB',
        hostScopeId: club.id,
        title: 'Too late',
        startsAt: new Date(),
      },
    });

    await expect(create).rejects.toMatchObject({ code: 'YEAR_LOCKED' });
    await expect(
      db(ctx).activity.updateMany({ where: {}, data: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'YEAR_LOCKED' });
    await expect(db(ctx).activity.deleteMany({ where: {} })).rejects.toMatchObject({
      code: 'YEAR_LOCKED',
    });

    // Reads are never restricted. A locked year is read-only, not invisible.
    await expect(db(ctx).activity.findMany()).resolves.toEqual([]);
  });
});

describe('a query without a context', () => {
  it('does not compile, which is the enforcement', () => {
    const org = {
      districtId: '00000000-0000-4000-8000-0000000000d1',
      currentYearId: '00000000-0000-4000-8000-0000000000y1',
    } as unknown as OrgFixture;
    const ctx = contextFor(org);

    // Each line below is a compile-time assertion. `@ts-expect-error` is itself an error
    // when the expression it guards becomes legal, so the day someone widens the client
    // type, `npm run typecheck` fails here rather than a query quietly losing its scope.
    // @ts-expect-error — scoped models are absent from the context-free client's type.
    void prisma.activity;
    // @ts-expect-error — all of them, not a special case for activities.
    void prisma.membershipEvent;
    // @ts-expect-error — findUnique cannot carry the scope filter, so it is not offered.
    void db(ctx).activity.findUnique;
    // @ts-expect-error — nor update: its where clause takes unique fields only.
    void db(ctx).activity.update;
    // @ts-expect-error — nor createManyAndReturn, which narrows its result with a select.
    void db(ctx).activity.createManyAndReturn;

    // The one runtime fact worth stating: the operations are still there on the escape
    // hatch, which is what the seed and the fixtures reach for.
    expect(typeof unscopedPrisma.activity.findUnique).toBe('function');
  });

  it('rejects a create that names the columns the layer owns', async () => {
    const org = await createOrg();
    const club = await createClub();
    const type = await createActivityType(org.districtId);

    const created = await db(contextFor(org)).activity.create({
      data: {
        // @ts-expect-error — districtId is not part of a scoped create. It is supplied.
        districtId: org.districtId,
        activityTypeId: type.id,
        hostScopeType: 'CLUB',
        hostScopeId: club.id,
        title: 'Fellowship',
        startsAt: new Date(),
      },
    });

    expect(created.districtId).toBe(org.districtId);
  });

  it('throws when handed a context with no district or year', () => {
    const empty = { districtId: '', rotaryYearId: '' } as unknown as RequestContext;

    // An empty scope would match nothing silently, which is worse than failing.
    expect(() => db(empty)).toThrow(/requires a resolved RequestContext/);
  });

  it('holds inside a transaction, in the types and at runtime', async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const club = await createClub();
    const theirType = await createActivityType(theirs.districtId);

    await createActivity({
      districtId: theirs.districtId,
      rotaryYearId: theirs.currentYearId,
      activityTypeId: theirType.id,
      hostScopeId: club.id,
      title: 'Theirs',
    });

    const ctx = contextFor(mine);
    const rows = await db(ctx).$transaction(async (tx) => {
      // @ts-expect-error — the transaction client is scoped too, so findUnique is absent.
      void tx.activity.findUnique;
      // @ts-expect-error — and update, exactly as outside the transaction.
      void tx.activity.update;
      return tx.activity.findMany();
    });

    // Prisma applies a query extension inside an interactive transaction started from
    // the extended client, so the filter is there as well as the type.
    expect(rows).toEqual([]);
  });

  it('throws if an unscopable operation is reached by casting', async () => {
    const org = await createOrg();
    const escaped = db(contextFor(org)) as unknown as {
      activity: { findUnique(args: unknown): Promise<unknown> };
    };

    await expect(escaped.activity.findUnique({ where: { id: 'x' } })).rejects.toThrow(
      /cannot be scoped/,
    );
  });
});

describe('record-level scope, end to end', () => {
  async function seedTwoClubs(org: OrgFixture) {
    const user = await createUser();
    const mine = await createClub('Rotaract Club of Mine');
    const theirs = await createClub('Rotaract Club of Theirs');
    const type = await createActivityType(org.districtId);

    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_SECRETARY',
      scope: 'CLUB',
      permissions: ['activity:read:club', 'activity:create:club'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: mine.id,
    });

    const ownActivity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: mine.id,
      title: 'Our fellowship',
    });
    const otherActivity = await createActivity({
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      activityTypeId: type.id,
      hostScopeId: theirs.id,
      title: 'Their fellowship',
    });

    return { user, mine, theirs, type, ownActivity, otherActivity };
  }

  it('gives a club secretary 404 for another club record — never 403', async () => {
    const org = await createOrg();
    const { user, ownActivity, otherActivity } = await seedTwoClubs(org);
    const agent = await signIn(app, user);

    const own = await agent.get(`/api/v1/__probe/activities/${ownActivity.id}`);
    expect(own.status).toBe(200);

    const other = await agent.get(`/api/v1/__probe/activities/${otherActivity.id}`);
    // Same district, same year, so the data access layer found it. The record-level
    // check is what refuses it — and 403 would confirm it exists, which hands the shape
    // of the dataset to anyone walking a list of identifiers.
    expect(other.status).toBe(404);
    expect(errorBody(other).code).toBe('NOT_FOUND');

    const missing = await agent.get(
      '/api/v1/__probe/activities/00000000-0000-4000-8000-00000000dead',
    );
    expect(missing.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it('filters a list rather than refusing it', async () => {
    const org = await createOrg();
    const { user, ownActivity } = await seedTwoClubs(org);
    const agent = await signIn(app, user);

    const response = await agent.get('/api/v1/__probe/activities/mine');
    const titles = (response.body as { data: { id: string }[] }).data.map((row) => row.id);

    expect(response.status).toBe(200);
    expect(titles).toEqual([ownActivity.id]);
  });

  it('refuses a caller without the permission, before any record is read', async () => {
    const org = await createOrg();
    const user = await createUser();
    const position = await createPosition({
      districtId: org.districtId,
      code: 'CLUB_TREASURER',
      scope: 'CLUB',
      permissions: ['finance:write:club'],
    });
    const club = await createClub();
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: position.id,
      scopeType: 'CLUB',
      scopeId: club.id,
    });

    const agent = await signIn(app, user);
    const response = await agent.get('/api/v1/__probe/activities');

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('INSUFFICIENT_SCOPE');
    expect(errorBody(response).details).toMatchObject({ required: 'activity:read:club' });
  });

  it('stamps a created record with the context, not with what the client sent', async () => {
    const org = await createOrg();
    const other = await createOrg();
    const { user, mine, type } = await seedTwoClubs(org);
    const agent = await signIn(app, user);

    const response = await agent.post('/api/v1/__probe/activities/forged').send({
      activityTypeId: type.id,
      hostScopeId: mine.id,
      title: 'Forged',
      districtId: other.districtId,
      rotaryYearId: other.previousYearId,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      data: { districtId: org.districtId, rotaryYearId: org.currentYearId },
    });
  });

  it('rejects a write to a locked year with YEAR_LOCKED', async () => {
    const org = await createOrg({ isCurrentYearLocked: true });
    const { user, mine, type } = await seedTwoClubs(org);
    const agent = await signIn(app, user);

    const response = await agent
      .post('/api/v1/__probe/activities')
      .send({ activityTypeId: type.id, hostScopeId: mine.id, title: 'Too late' });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('YEAR_LOCKED');
  });

  it('rejects a write made under a ?year= override', async () => {
    const org = await createOrg();
    const { user, mine, type } = await seedTwoClubs(org);

    // Give the secretary the historical read as well, so the refusal below is about the
    // override being a read door rather than about a missing permission.
    const historian = await createPosition({
      districtId: org.districtId,
      code: 'HISTORIAN',
      scope: 'DISTRICT',
      permissions: ['year:read:historical'],
    });
    await appoint({
      personId: user.personId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      positionId: historian.id,
      scopeType: 'DISTRICT',
    });

    const agent = await signIn(app, user);
    const response = await agent
      .post(`/api/v1/__probe/activities?year=${org.previousYearLabel}`)
      .send({ activityTypeId: type.id, hostScopeId: mine.id, title: 'Backdated' });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('YEAR_LOCKED');

    // And nothing was written into last year.
    expect(
      await unscopedPrisma.activity.count({ where: { rotaryYearId: org.previousYearId } }),
    ).toBe(0);
  });
});
