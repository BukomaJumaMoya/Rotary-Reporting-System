import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { meResponseSchema } from '@dis/contracts';
import { unscopedPrisma } from '../src/platform/db.js';
import { closeSessionPool } from '../src/platform/session.js';
import { CLUBS, TOTAL_CLUBS, TOTAL_MEMBERS } from './seed/organisation.js';
import { seedDatabase, type SeedSummary } from './seed/run.js';

/**
 * The seed, exercised end to end.
 *
 * This is the session-6 verification written down: seed from clean, sign in as the PIME
 * Chair, and confirm `/auth/me` returns the right context. Doing it by hand once proves
 * it worked on a Tuesday; doing it here proves it still works after the schema moves,
 * which it will, twelve more times before launch.
 *
 * It runs the SAME `seedDatabase()` that `npm run db:seed` runs. A test against a
 * reimplementation would pass while the real seed was broken.
 */

const app = createApp();
let summary: SeedSummary;

beforeAll(async () => {
  summary = await seedDatabase();
}, 120_000);

afterAll(async () => {
  await unscopedPrisma.$disconnect();
  await closeSessionPool();
});

async function signInAs(email: string) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ email, password: summary.password });

  if (response.status !== 200) {
    throw new Error(`Seeded account ${email} could not sign in: ${response.status}`);
  }
  return { agent, body: meResponseSchema.parse(response.body).data };
}

function accountFor(role: string): string {
  const account = summary.signIns.find((entry) => entry.role.startsWith(role));
  if (!account) throw new Error(`The seed reported no account for ${role}`);
  return account.email;
}

describe('the seeded dataset', () => {
  it('builds the organisation the district is being chartered as', async () => {
    const [district, clubs, regions, clusters, affiliations] = await Promise.all([
      unscopedPrisma.district.findFirstOrThrow({ select: { riDistrictCode: true } }),
      unscopedPrisma.club.count(),
      unscopedPrisma.region.count(),
      unscopedPrisma.cluster.count(),
      unscopedPrisma.clubDistrictAffiliation.count(),
    ]);

    expect(district.riDistrictCode).toBe('9218');
    // D9218's confirmed list. Read from the seed's own constant rather than repeated as a
    // literal, so scaling the dataset again changes one place.
    expect(clubs).toBe(TOTAL_CLUBS);
    expect(regions).toBe(3);
    expect(clusters).toBe(6);
    // Every club affiliated for the current year — the temporal relationship that makes
    // it part of D9218 at all (axiom 2).
    expect(affiliations).toBe(TOTAL_CLUBS);
  });

  it('has exactly one current Rotary Year', async () => {
    const current = await unscopedPrisma.districtYear.findMany({
      where: { isCurrent: true },
      select: { rotaryYear: { select: { label: true } } },
    });

    expect(current).toHaveLength(1);
    expect(current[0]?.rotaryYear.label).toBe('2027-28');
  });

  it('creates every member synthetic, with contact fields closed', async () => {
    const [people, visibility, open] = await Promise.all([
      unscopedPrisma.person.count(),
      unscopedPrisma.personVisibility.count(),
      unscopedPrisma.personVisibility.count({
        where: { OR: [{ showEmail: true }, { showPhone: true }, { showCity: true }] },
      }),
    ]);

    expect(people).toBe(TOTAL_MEMBERS);
    // A visibility row per person, created by the persons_visibility_ins trigger rather
    // than by the seed — so "no row" cannot be mistaken for a permissive default.
    expect(visibility).toBe(TOTAL_MEMBERS);
    expect(open).toBe(0);

    const domains = await unscopedPrisma.person.count({
      where: { email: { endsWith: '@example.org' } },
    });
    // RFC 2606 reserves example.org precisely so test data cannot reach a real inbox.
    expect(domains).toBe(TOTAL_MEMBERS);
  });

  it('derives the roster from membership events rather than writing one', async () => {
    const [events, roster] = await Promise.all([
      unscopedPrisma.membershipEvent.count(),
      unscopedPrisma.clubRoster.count(),
    ]);

    // One JOIN per member, plus a year of churn — departures, transfers, transitions and
    // a handful of retractions. Without churn every club retains 100% of its members and
    // M5 would be calibrated against a district where nobody ever leaves.
    expect(events).toBeGreaterThan(TOTAL_MEMBERS);

    // The materialised view, refreshed by the seed. Without the refresh it is empty and
    // every membership read returns nothing, which reads as a bug in the reader.
    //
    // FEWER than the member count, because the departures took people off it — which is
    // the roster being DERIVED rather than written. A retracted departure puts its member
    // back, so this is not simply members minus departures either.
    expect(roster).toBeGreaterThan(TOTAL_MEMBERS * 0.9);
    expect(roster).toBeLessThan(TOTAL_MEMBERS);
  });

  it('wires the authorisation matrix, not just the positions', async () => {
    const [permissions, positions, wired, appointments] = await Promise.all([
      unscopedPrisma.permission.count(),
      unscopedPrisma.position.count(),
      unscopedPrisma.positionPermission.count(),
      unscopedPrisma.appointment.count({ where: { isActive: true } }),
    ]);

    expect(permissions).toBeGreaterThanOrEqual(25);
    expect(positions).toBe(10);
    expect(wired).toBeGreaterThan(100);
    // Three officers per club, plus six district officers and three ADRRs. From the club
    // count rather than a literal, so the number follows the dataset.
    expect(appointments).toBe(TOTAL_CLUBS * 3 + 6 + 3);
  });

  it('populates the lookup tables that were empty and block every insert', async () => {
    const [documentTypes, socialPlatforms, financeCategories, areas] = await Promise.all([
      unscopedPrisma.documentType.count(),
      unscopedPrisma.socialPlatform.count(),
      unscopedPrisma.financeCategory.count(),
      unscopedPrisma.areaOfFocus.count(),
    ]);

    // documents.doc_type and social_accounts.platform are foreign keys into the first
    // two, so with no rows nothing could be created at all.
    expect(documentTypes).toBeGreaterThan(0);
    expect(socialPlatforms).toBeGreaterThan(0);
    expect(areas).toBe(7);
    expect(financeCategories).toBeGreaterThan(0);

    const categories = await unscopedPrisma.activityType.findMany({ select: { category: true } });
    const covered = new Set(categories.map((type) => type.category));
    expect([...covered].sort()).toEqual([
      'CLUSTER',
      'COMMITTEE',
      'DISTRICT',
      'FELLOWSHIP',
      'GOVERNANCE',
      'INTERNATIONAL',
      'PLD',
      'SERVICE',
      'YOUTH',
    ]);
  });

  it('gives most clubs a budget and some none, with the approved ones fully lined', async () => {
    const [budgets, approved, lines, transactions] = await Promise.all([
      unscopedPrisma.budget.count(),
      unscopedPrisma.budget.count({ where: { approvedAt: { not: null } } }),
      unscopedPrisma.budgetLine.count(),
      unscopedPrisma.financialTransaction.count(),
    ]);

    // Not every club, deliberately: a dataset where everybody has filed hides the screen
    // the District Treasurer actually needs, which is the one showing who has not.
    expect(budgets).toBeGreaterThan(TOTAL_CLUBS * 0.4);
    expect(budgets).toBeLessThan(TOTAL_CLUBS);
    expect(approved).toBeGreaterThan(0);
    expect(transactions).toBeGreaterThan(0);

    // Every budget has lines, INCLUDING the approved ones. That is the interesting half:
    // the DIS03 guard freezes an approved budget's lines, so the seed has to insert them
    // before it approves. An approved budget with no lines would mean the seed had been
    // quietly losing them to a refused write.
    expect(lines).toBeGreaterThan(budgets);
    const approvedWithNoLines = await unscopedPrisma.budget.count({
      where: { approvedAt: { not: null }, lines: { none: {} } },
    });
    expect(approvedWithNoLines).toBe(0);
  });

  it('does not duplicate the notification templates a migration already inserted', async () => {
    const auth = await unscopedPrisma.notificationTemplate.count({
      where: { code: { in: ['AUTH_PASSWORD_RESET', 'AUTH_INVITE'] } },
    });

    expect(auth).toBe(2);
  });

  it('issues a real invitation for every officer account', async () => {
    const [users, invites] = await Promise.all([
      unscopedPrisma.user.count(),
      unscopedPrisma.userToken.count({ where: { purpose: 'INVITE' } }),
    ]);

    // issueInvite() is the real onboarding path, not a second one invented for the seed.
    const officers = TOTAL_CLUBS * 3 + 6 + 3;
    expect(users).toBe(officers);
    expect(invites).toBe(officers);
  });

  it('leaves no audit rows behind', async () => {
    // The seed writes through unscopedPrisma, which carries no audit extension. Three
    // hundred seeded members are nobody's action.
    expect(await unscopedPrisma.auditLogEntry.count()).toBe(0);
  });
});

describe('signing in as a seeded officer', () => {
  it('gives the PIME Chair a district-wide context', async () => {
    const { body } = await signInAs(accountFor('PIME_CHAIR'));

    expect(body.context.districtId).not.toBeNull();
    expect(body.context.rotaryYearLabel).toBe('2027-28');
    expect(body.context.isYearWritable).toBe(true);
    expect(body.context.scopes.isDistrictWide).toBe(true);
    expect(body.context.permissions).toContain('framework:manage:district');
    expect(body.context.permissions).toContain('assessment:finalise:district');
    expect(body.context.permissions).toContain('year:read:historical');
    expect(body.appointments[0]?.positionCode).toBe('PIME_CHAIR');
  });

  it('gives a club secretary exactly one club and no district-wide sight', async () => {
    const { body } = await signInAs(accountFor('CLUB_SECRETARY'));

    expect(body.context.scopes.isDistrictWide).toBe(false);
    expect(body.context.scopes.clubIds).toHaveLength(1);
    expect(body.context.permissions).toContain('activity:create:club');
    // The district's logged complaint, answered in configuration.
    expect(body.context.permissions).toContain('finance:read:club');
    expect(body.context.permissions).not.toContain('assessment:finalise:district');
    expect(body.appointments[0]?.scopeName).toBe('Rotaract Club of Kampala');
  });

  it('expands an ADRR to the clubs of their cluster', async () => {
    const { body } = await signInAs(accountFor('ADRR, Kampala Metro'));

    expect(body.context.scopes.clusterIds).toHaveLength(1);
    // Kampala Metro's clubs, counted from the seed rather than written down: the list grew
    // from five to fifteen when the dataset reached its real shape, and a literal here
    // would have been a test that failed for the right reason with the wrong message.
    expect(body.context.scopes.clubIds).toHaveLength(
      CLUBS.filter((club) => club.cluster === 'Kampala Metro').length,
    );
    expect(body.context.scopes.isDistrictWide).toBe(false);
  });

  it('lets the DRR read a locked past year but not write to it', async () => {
    const { agent } = await signInAs(accountFor('DRR'));

    const historical = await agent.get('/api/v1/auth/me?year=2026-27');
    const body = meResponseSchema.parse(historical.body).data;

    expect(historical.status).toBe(200);
    expect(body.context.rotaryYearLabel).toBe('2026-27');
    // Locked at rollover AND reached through an override — read-only twice over.
    expect(body.context.isYearLocked).toBe(true);
    expect(body.context.isYearWritable).toBe(false);
  });

  it('refuses the same override to a club treasurer, who lacks the permission', async () => {
    const { agent } = await signInAs(accountFor('CLUB_TREASURER'));

    const response = await agent.get('/api/v1/auth/me?year=2026-27');
    expect(response.status).toBe(403);
  });
});

describe('rerunning', () => {
  it('is idempotent — the second run leaves the same dataset as the first', async () => {
    await seedDatabase();

    const [clubs, people, appointments] = await Promise.all([
      unscopedPrisma.club.count(),
      unscopedPrisma.person.count(),
      unscopedPrisma.appointment.count(),
    ]);

    // Rerunnable means resets and reseeds, not accumulates. Twice the clubs would be the
    // obvious failure; twice the district-year rows would trip a partial unique index and
    // be the confusing one.
    expect(clubs).toBe(TOTAL_CLUBS);
    expect(people).toBe(TOTAL_MEMBERS);
    expect(appointments).toBe(TOTAL_CLUBS * 3 + 6 + 3);
  }, 120_000);
});
