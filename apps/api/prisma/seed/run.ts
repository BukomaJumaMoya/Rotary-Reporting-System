import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { issueInvite } from '../../src/modules/auth/service.js';
import { config, isProduction } from '../../src/platform/config.js';
// The seed is one of the three sanctioned callers of the escape hatch. It writes across
// every district and year on purpose, and — just as deliberately — is NOT audited: three
// hundred seeded members are nobody's action (docs/10-Build-Log.md, session 5).
import { unscopedPrisma } from '../../src/platform/db.js';
import {
  ACTIVITY_TYPES,
  AREAS_OF_FOCUS,
  DOCUMENT_TYPES,
  FINANCE_CATEGORIES,
  NOTIFICATION_TEMPLATES,
  PERMISSIONS,
  POSITIONS,
  SOCIAL_PLATFORMS,
} from './reference.js';
import {
  CLUBS,
  CURRENT_YEAR_LABEL,
  DISTRICT,
  PREVIOUS_YEAR_LABEL,
  REGIONS,
  ROTARY_YEARS,
  TOTAL_CLUBS,
  TOTAL_MEMBERS,
} from './organisation.js';
import { random, syntheticPerson } from './synthetic.js';

/**
 * One command to a realistic dataset: `npm run db:seed`.
 *
 * SYNTHETIC DATA ONLY. Never real member data, on any machine. The predecessor system
 * published four thousand members' contact details on an unauthenticated page; a
 * developer laptop holding a copy of the membership register is the same exposure with a
 * smaller blast radius, and it is the reason this file generates rather than imports.
 *
 * Deterministic: the same command produces the same database, so a bug reproduced on one
 * machine reproduces on another.
 */

/** The reset preserves what a MIGRATION inserted, not what this file inserts. */
const PRESERVED_TABLES = ['_prisma_migrations', 'notification_templates'];

/** Development sign-in password for every seeded officer. Never used in production. */
const SEED_PASSWORD = process.env['SEED_PASSWORD'] ?? 'rotaract-dis-dev-password';

/** Midnight UTC today, matching how `findActiveAppointments` compares `DATE` columns. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * When a seeded officer's term begins.
 *
 * An appointment counts only once its term has STARTED — that is what makes rollover
 * automatic, and it is checked on every request. The seeded year is 2027-28, the launch
 * year, so a term dated from 1 July 2027 produces a district that nobody can sign in to
 * until launch day: every context resolves empty and every scoped endpoint answers 403.
 *
 * So the term starts at the Rotary Year, or today if that is still ahead of us. The
 * dataset is meant to be usable on the day the command is run.
 */
function appointmentStart(yearStartsOn: Date): Date {
  const now = today();
  return yearStartsOn.getTime() <= now.getTime() ? yearStartsOn : now;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Refuses to run anywhere that might hold real data.
 *
 * `db:seed` TRUNCATES every table. The failure this guards against is not exotic: it is
 * one `DATABASE_URL` left exported in a shell.
 */
function assertSafeToSeed(): void {
  if (!isProduction) return;

  if (process.env['ALLOW_DESTRUCTIVE_SEED'] !== 'true') {
    throw new Error(
      'Refusing to seed with NODE_ENV=production — db:seed truncates every table. ' +
        'Set ALLOW_DESTRUCTIVE_SEED=true only if you are certain this database is disposable.',
    );
  }
}

async function reset(): Promise<void> {
  const tables = await unscopedPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const list = tables
    .map((table) => table.tablename)
    .filter((name) => !PRESERVED_TABLES.includes(name))
    .map((name) => `"public"."${name}"`)
    .join(', ');

  if (list.length > 0) {
    await unscopedPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

async function seedReferenceData(): Promise<void> {
  await unscopedPrisma.permission.createMany({ data: PERMISSIONS, skipDuplicates: true });
  await unscopedPrisma.areaOfFocus.createMany({ data: AREAS_OF_FOCUS, skipDuplicates: true });
  await unscopedPrisma.documentType.createMany({ data: DOCUMENT_TYPES, skipDuplicates: true });
  await unscopedPrisma.socialPlatform.createMany({ data: SOCIAL_PLATFORMS, skipDuplicates: true });

  // AUTH_PASSWORD_RESET and AUTH_INVITE come from a data migration, because authentication
  // depends on them existing before any district does. skipDuplicates is what lets this
  // run without knowing or caring which of the two sources got there first.
  await unscopedPrisma.notificationTemplate.createMany({
    data: NOTIFICATION_TEMPLATES,
    skipDuplicates: true,
  });

  log(
    `  reference: ${PERMISSIONS.length} permissions, ${AREAS_OF_FOCUS.length} areas of focus, ` +
      `${DOCUMENT_TYPES.length} document types, ${SOCIAL_PLATFORMS.length} social platforms`,
  );
}

interface OrgIds {
  districtId: string;
  currentYearId: string;
  previousYearId: string;
  clusterIdsByName: Map<string, string>;
  clubIdsBySlug: Map<string, string>;
}

async function seedOrganisation(): Promise<OrgIds> {
  const years = new Map<string, string>();
  for (const year of ROTARY_YEARS) {
    const row = await unscopedPrisma.rotaryYear.create({
      data: { label: year.label, startsOn: year.startsOn, endsOn: year.endsOn },
      select: { id: true, label: true },
    });
    years.set(row.label, row.id);
  }

  const currentYearId = years.get(CURRENT_YEAR_LABEL);
  const previousYearId = years.get(PREVIOUS_YEAR_LABEL);
  if (!currentYearId || !previousYearId) throw new Error('Rotary years were not created');

  const district = await unscopedPrisma.district.create({
    data: DISTRICT,
    select: { id: true },
  });

  // Exactly one current year per district — `district_years_one_current` is a partial
  // unique index, so a second would be rejected rather than silently accepted.
  await unscopedPrisma.districtYear.createMany({
    data: [
      {
        districtId: district.id,
        rotaryYearId: previousYearId,
        isCurrent: false,
        isLocked: true,
        openedAt: new Date(Date.UTC(2026, 6, 1)),
        lockedAt: new Date(Date.UTC(2027, 7, 31)),
      },
      {
        districtId: district.id,
        rotaryYearId: currentYearId,
        isCurrent: true,
        isLocked: false,
        openedAt: new Date(Date.UTC(2027, 6, 1)),
      },
    ],
  });

  const clusterIdsByName = new Map<string, string>();
  for (const region of REGIONS) {
    const regionRow = await unscopedPrisma.region.create({
      data: { districtId: district.id, name: region.name },
      select: { id: true },
    });

    for (const clusterName of region.clusters) {
      // Clusters are year-scoped because they are redrawn annually. Only the current
      // year's are seeded; last year's redistricting history is not invented.
      const cluster = await unscopedPrisma.cluster.create({
        data: {
          districtId: district.id,
          rotaryYearId: currentYearId,
          regionId: regionRow.id,
          name: clusterName,
        },
        select: { id: true },
      });
      clusterIdsByName.set(clusterName, cluster.id);
    }
  }

  const clubIdsBySlug = new Map<string, string>();
  for (const club of CLUBS) {
    const row = await unscopedPrisma.club.create({
      data: {
        name: club.name,
        slug: club.slug,
        riClubId: club.riClubId,
        baseType: club.baseType,
        status: 'ACTIVE',
        charteredOn: new Date(Date.UTC(2027, 6, 1)),
        hostInstitution: club.hostInstitution ?? null,
        isVirtual: club.isVirtual ?? false,
        meetingDay: club.meetingDay,
        meetingVenue: club.meetingVenue,
      },
      select: { id: true },
    });
    clubIdsBySlug.set(club.slug, row.id);

    // Affiliation is TEMPORAL — a dated relationship, never a column on the club
    // (axiom 2). This row is what makes the club part of D9218 for 2027-28.
    await unscopedPrisma.clubDistrictAffiliation.create({
      data: {
        clubId: row.id,
        districtId: district.id,
        rotaryYearId: currentYearId,
        tier: club.tier,
        isConfirmed: true,
      },
    });

    const clusterId = clusterIdsByName.get(club.cluster);
    if (!clusterId) throw new Error(`Club ${club.slug} names an unknown cluster: ${club.cluster}`);
    await unscopedPrisma.clubClusterAssignment.create({
      data: { clubId: row.id, clusterId, rotaryYearId: currentYearId },
    });
  }

  log(
    `  organisation: ${DISTRICT.name}, ${REGIONS.length} regions, ${clusterIdsByName.size} clusters, ` +
      `${CLUBS.length} clubs affiliated for ${CURRENT_YEAR_LABEL}`,
  );

  return {
    districtId: district.id,
    currentYearId,
    previousYearId,
    clusterIdsByName,
    clubIdsBySlug,
  };
}

interface SeededMember {
  personId: string;
  clubSlug: string;
  clubId: string;
  firstName: string;
  lastName: string;
}

/** Why members leave, in roughly the proportions a Rotaract district actually sees. */
const LEAVING_REASONS = [
  'RELOCATION',
  'STUDIES_ENDED',
  'NON_PAYMENT',
  'NON_PAYMENT',
  'INACTIVE',
  'PERSONAL',
];

/**
 * A year of membership CHURN on top of the joins.
 *
 * Without it every club retains 100% of its members, every statistic is the same number,
 * and M5 would be calibrated against a district where nobody ever leaves. About one member
 * in fourteen goes — terminated, transferred, or on to Rotary — and one departure in forty
 * is retracted, so the supersede path is exercised by the DATASET rather than only by a test.
 */
async function seedMembershipChurn(
  org: OrgIds,
  members: SeededMember[],
  rng: ReturnType<typeof random>,
): Promise<void> {
  let leavers = 0;
  let transitions = 0;
  let corrections = 0;

  for (const member of members) {
    if (!rng.chance(0.07)) continue;

    const kind = rng.int(1, 10);
    const eventType = kind <= 6 ? 'TERMINATE' : kind <= 8 ? 'TRANSFER_OUT' : 'TRANSITION_TO_ROTARY';

    // Spread across the Rotary Year, so a from/to window and the as-at reconstruction have
    // something to slice.
    const offset = rng.int(1, 10);
    const effectiveOn = new Date(
      Date.UTC(2027 + (6 + offset > 11 ? 1 : 0), (6 + offset) % 12, rng.int(1, 28)),
    );

    const event = await unscopedPrisma.membershipEvent.create({
      data: {
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        personId: member.personId,
        clubId: member.clubId,
        eventType,
        memberCategory: 'ACTIVE',
        effectiveOn,
        reasonCode: eventType === 'TRANSITION_TO_ROTARY' ? null : rng.pick(LEAVING_REASONS),
        ...(eventType === 'TRANSITION_TO_ROTARY'
          ? { rotaryClubName: `Rotary Club of ${member.clubSlug.replace('rc-', '')}` }
          : {}),
      },
      select: { id: true },
    });

    leavers += 1;
    if (eventType === 'TRANSITION_TO_ROTARY') transitions += 1;

    // One in forty is retracted. A CORRECTION supersedes its target and is not itself a
    // state, so the member goes back onto the roster — the behaviour schema v1.9 fixed, and
    // worth having in the dataset rather than only in a test.
    if (rng.chance(0.025)) {
      await unscopedPrisma.membershipEvent.create({
        data: {
          districtId: org.districtId,
          rotaryYearId: org.currentYearId,
          personId: member.personId,
          clubId: member.clubId,
          eventType: 'CORRECTION',
          memberCategory: 'ACTIVE',
          effectiveOn,
          reasonNote: 'Recorded against the wrong member',
          supersedesEventId: event.id,
        },
      });
      corrections += 1;
      leavers -= 1;
    }
  }

  log(
    `  membership churn: ${leavers} departures (${transitions} to Rotary), ` +
      `${corrections} retracted`,
  );
}

/**
 * A year of reported activity.
 *
 * Every club reports something most months. Two thirds are verified, which gives the
 * verification queue and the club summary something to show — and which M5 needs, because a
 * dataset where everything is verified scores identically to one where nothing is.
 */
async function seedActivities(org: OrgIds, members: SeededMember[]): Promise<number> {
  const rng = random(2027);

  const types = await unscopedPrisma.activityType.findMany({
    where: { districtId: org.districtId, isActive: true },
    select: { id: true, code: true, allowedHostScopes: true },
  });
  const clubTypes = types.filter((type) => type.allowedHostScopes.includes('CLUB'));
  if (clubTypes.length === 0) return 0;

  const areas = await unscopedPrisma.areaOfFocus.findMany({ select: { id: true } });

  const membersByClub = new Map<string, SeededMember[]>();
  for (const member of members) {
    membersByClub.set(member.clubId, [...(membersByClub.get(member.clubId) ?? []), member]);
  }

  const activityRows = [];
  const areaRows = [];
  const attendeeRows = [];

  for (const club of CLUBS) {
    const clubId = org.clubIdsBySlug.get(club.slug);
    if (!clubId) continue;

    const roster = membersByClub.get(clubId) ?? [];

    // Ten months of the Rotary Year. A bigger club reports more, which is the correlation
    // M5's per-member criteria depend on.
    for (let month = 0; month < 10; month += 1) {
      const howMany = rng.int(1, club.memberCount > 40 ? 4 : 2);

      for (let n = 0; n < howMany; n += 1) {
        const type = rng.pick(clubTypes);
        const startsAt = new Date(
          Date.UTC(2027 + (6 + month > 11 ? 1 : 0), (6 + month) % 12, rng.int(1, 28), 17, 0),
        );
        const verified = rng.chance(0.66);
        const id = randomUUID();

        activityRows.push({
          id,
          districtId: org.districtId,
          rotaryYearId: org.currentYearId,
          activityTypeId: type.id,
          hostScopeType: 'CLUB' as const,
          hostScopeId: clubId,
          title: `${club.name.replace('Rotaract Club of ', '')}: ${type.code
            .toLowerCase()
            .replace(/_/g, ' ')}`,
          startsAt,
          venue: club.meetingVenue,
          status: 'HELD' as const,
          attendanceMembers: rng.int(5, Math.max(6, club.memberCount)),
          attendanceGuests: rng.int(0, 6),
          beneficiariesCount: rng.chance(0.4) ? rng.int(20, 400) : null,
          verification: verified ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
          verifiedAt: verified ? startsAt : null,
        });

        if (areas.length > 0 && rng.chance(0.5)) {
          areaRows.push({ activityId: id, areaOfFocusId: rng.pick(areas).id });
        }

        // A few attendees, so the roster join the scoring engine makes has rows to find.
        const attending = roster.slice(0, rng.int(0, Math.min(6, roster.length)));
        for (const member of attending) {
          attendeeRows.push({ activityId: id, personId: member.personId, role: 'MEMBER' as const });
        }
      }
    }
  }

  // createMany, not a loop of creates. At this scale the difference is a seed that takes
  // seconds and one that takes minutes, and the seed is run by hand often enough to matter.
  await unscopedPrisma.activity.createMany({ data: activityRows });
  await unscopedPrisma.activityAreaOfFocus.createMany({ data: areaRows, skipDuplicates: true });
  await unscopedPrisma.activityAttendee.createMany({ data: attendeeRows, skipDuplicates: true });

  log(`  activities: ${activityRows.length} reported, ${attendeeRows.length} attendance records`);
  return activityRows.length;
}

/**
 * Budgets and a year of transactions, for the clubs that would plausibly have them.
 *
 * Not every club: about two thirds, because a dataset in which every club has a tidy budget
 * is a dataset that hides the screen the District Treasurer actually needs — the one showing
 * who has not filed one. The same reasoning as the activity seed, where some clubs report
 * nothing.
 *
 * Amounts are strings turned into `Decimal` by Prisma, never JavaScript numbers. A seed that
 * used floats would produce figures the summary could not reproduce, and the first person to
 * notice would reasonably assume the summary was wrong.
 */
async function seedFinance(org: OrgIds): Promise<number> {
  const rng = random(4218);

  const categories = await unscopedPrisma.financeCategory.findMany({
    where: { districtId: org.districtId, isActive: true },
    select: { id: true, direction: true },
  });
  const income = categories.filter((row) => row.direction === 'INCOME');
  const expenditure = categories.filter((row) => row.direction === 'EXPENDITURE');
  if (income.length === 0 || expenditure.length === 0) return 0;

  const clubIds = [...org.clubIdsBySlug.values()];
  const budgetRows: {
    id: string;
    districtId: string;
    rotaryYearId: string;
    ownerScopeType: 'CLUB';
    ownerScopeId: string;
    approvedAt: Date | null;
  }[] = [];
  const lineRows: {
    budgetId: string;
    categoryId: string;
    description: string;
    amountPlanned: string;
  }[] = [];
  const txnRows: {
    districtId: string;
    rotaryYearId: string;
    ownerScopeType: 'CLUB';
    ownerScopeId: string;
    categoryId: string;
    direction: 'INCOME' | 'EXPENDITURE';
    amount: string;
    occurredOn: Date;
    description: string;
  }[] = [];

  /** A round-ish UGX figure, as a STRING. Clubs budget in hundreds of thousands. */
  const ugx = (low: number, high: number): string => String(rng.int(low, high) * 1000);

  for (const clubId of clubIds) {
    // A third of clubs have filed nothing. That is the realistic shape, and it is what
    // makes the treasurer's chase-list screen worth building.
    if (rng.chance(0.33)) continue;

    const budgetId = randomUUID();
    // Roughly half of the filed budgets have been approved. The rest are the queue.
    const isApproved = rng.chance(0.5);

    budgetRows.push({
      id: budgetId,
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      ownerScopeType: 'CLUB',
      ownerScopeId: clubId,
      // Set AFTER the lines are inserted — the DIS03 guard freezes an approved budget's
      // lines, so seeding them in the other order would be refused by the database.
      approvedAt: null,
    });

    for (const category of income.slice(0, rng.int(2, 3))) {
      lineRows.push({
        budgetId,
        categoryId: category.id,
        description: 'Planned income',
        amountPlanned: ugx(800, 4000),
      });
    }
    for (const category of expenditure.slice(0, rng.int(2, 4))) {
      lineRows.push({
        budgetId,
        categoryId: category.id,
        description: 'Planned expenditure',
        amountPlanned: ugx(400, 2500),
      });
    }

    // A year of movement, so the variance table has something to disagree about.
    const months = rng.int(4, 11);
    for (let index = 0; index < months; index += 1) {
      const isIncome = rng.chance(0.45);
      const pool = isIncome ? income : expenditure;
      const category = rng.pick(pool);

      txnRows.push({
        districtId: org.districtId,
        rotaryYearId: org.currentYearId,
        ownerScopeType: 'CLUB',
        ownerScopeId: clubId,
        categoryId: category.id,
        direction: isIncome ? 'INCOME' : 'EXPENDITURE',
        amount: ugx(50, 1200),
        occurredOn: new Date(Date.UTC(2027, 6 + (index % 12), rng.int(1, 27))),
        description: isIncome ? 'Collection' : 'Payment',
      });
    }

    if (isApproved) {
      budgetRows[budgetRows.length - 1]!.approvedAt = new Date(Date.UTC(2027, 7, 15));
    }
  }

  await unscopedPrisma.budget.createMany({
    data: budgetRows.map((row) => ({ ...row, approvedAt: null })),
  });
  await unscopedPrisma.budgetLine.createMany({ data: lineRows });

  // Approval LAST, once every line is in place. The guard is the reason, and the seed
  // running afoul of it would be the guard doing its job.
  const approved = budgetRows.filter((row) => row.approvedAt !== null);
  for (const row of approved) {
    await unscopedPrisma.budget.update({
      where: { id: row.id },
      data: { approvedAt: row.approvedAt },
    });
  }

  await unscopedPrisma.financialTransaction.createMany({ data: txnRows });

  log(
    `  finance: ${budgetRows.length} club budgets (${approved.length} approved), ` +
      `${lineRows.length} lines, ${txnRows.length} transactions`,
  );
  return budgetRows.length;
}

async function seedMembers(org: OrgIds): Promise<SeededMember[]> {
  const rng = random(9218);
  const members: SeededMember[] = [];
  let index = 0;

  for (const club of CLUBS) {
    const clubId = org.clubIdsBySlug.get(club.slug);
    if (!clubId) throw new Error(`No club id for ${club.slug}`);

    for (let i = 0; i < club.memberCount; i += 1) {
      index += 1;
      const person = syntheticPerson(rng, index);

      const row = await unscopedPrisma.person.create({
        data: {
          firstName: person.firstName,
          lastName: person.lastName,
          otherNames: person.otherNames,
          gender: person.gender,
          dateOfBirth: person.dateOfBirth,
          email: person.email,
          phone: person.phone,
          city: person.city,
          countryCode: 'UG',
          nationality: 'Ugandan',
          occupation: person.occupation,
          employer: person.employer,
        },
        select: { id: true },
      });

      // person_visibility is created by the persons_visibility_ins TRIGGER, with contact
      // fields closed. The seed deliberately does not touch it: a seed that wrote its own
      // visibility rows would be a second definition of the default, and the one that
      // drifted would be the one nobody read (axiom 6, ADR-012).

      // Membership is an EVENT LOG and the roster is derived (axiom 3). A member is on a
      // roster because a JOIN event says so, never because a row was written to one.
      await unscopedPrisma.membershipEvent.create({
        data: {
          districtId: org.districtId,
          rotaryYearId: org.currentYearId,
          personId: row.id,
          clubId,
          eventType: rng.chance(0.15) ? 'INDUCT' : 'JOIN',
          memberCategory: 'ACTIVE',
          effectiveOn: new Date(Date.UTC(2027, 6, rng.int(1, 28))),
        },
      });

      members.push({
        personId: row.id,
        clubSlug: club.slug,
        clubId,
        firstName: person.firstName,
        lastName: person.lastName,
      });
    }
  }

  await seedMembershipChurn(org, members, rng);

  // club_rosters is a MATERIALISED view; without this it is empty and every membership
  // read returns nothing, which looks like a bug in the reader.
  await unscopedPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW club_rosters');

  log(`  members: ${members.length} synthetic persons with JOIN events, roster refreshed`);
  return members;
}

async function seedPositions(districtId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const position of POSITIONS) {
    const row = await unscopedPrisma.position.create({
      data: {
        districtId,
        code: position.code,
        name: position.name,
        scope: position.scope,
        sequence: position.sequence,
        isUniquePerScope: position.isUniquePerScope,
        permissions: {
          create: position.permissions.map((permissionCode) => ({ permissionCode })),
        },
      },
      select: { id: true },
    });
    ids.set(position.code, row.id);
  }

  const wired = POSITIONS.reduce((sum, position) => sum + position.permissions.length, 0);
  log(`  governance: ${POSITIONS.length} positions, ${wired} position_permissions wired`);
  return ids;
}

interface OfficerSpec {
  positionCode: string;
  scopeType: 'DISTRICT' | 'REGION' | 'CLUSTER' | 'CLUB';
  scopeId: string | null;
  label: string;
}

/**
 * Creates the account, issues the real invitation, and — outside production — sets a
 * known password so the dataset is usable the moment the command finishes.
 *
 * `issueInvite()` is the real onboarding path and the only one: this does not invent a
 * second. What it adds is a development shortcut, because sixty-nine invitation links in
 * a terminal is not a way to log in and check a scorecard.
 */
async function seedOfficer(
  member: SeededMember,
  spec: OfficerSpec,
  positionIds: Map<string, string>,
  org: OrgIds,
  passwordHash: string,
): Promise<void> {
  const positionId = positionIds.get(spec.positionCode);
  if (!positionId) throw new Error(`No position seeded for ${spec.positionCode}`);

  const user = await unscopedPrisma.user.create({
    data: { personId: member.personId, status: 'INVITED' },
    select: { id: true },
  });

  // The real invitation: a hashed single-use token in user_tokens and a notification row.
  await issueInvite(user.id);

  if (!isProduction) {
    await unscopedPrisma.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'ACTIVE' },
    });
  }

  await unscopedPrisma.appointment.create({
    data: {
      districtId: org.districtId,
      rotaryYearId: org.currentYearId,
      personId: member.personId,
      positionId,
      scopeType: spec.scopeType,
      scopeId: spec.scopeId,
      startsOn: appointmentStart(new Date(Date.UTC(2027, 6, 1))),
      endsOn: new Date(Date.UTC(2028, 5, 30)),
      isActive: true,
    },
  });
}

async function seedOfficers(
  members: SeededMember[],
  positionIds: Map<string, string>,
  org: OrgIds,
): Promise<{ email: string; role: string }[]> {
  // One hash, reused. Every seeded account shares the development password, and Argon2 at
  // OWASP cost is ~50ms — sixty-nine of them is four seconds of nothing.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const byClub = new Map<string, SeededMember[]>();
  for (const member of members) {
    const list = byClub.get(member.clubSlug) ?? [];
    list.push(member);
    byClub.set(member.clubSlug, list);
  }

  const taken = new Set<string>();
  const claim = (clubSlug: string): SeededMember => {
    const candidate = byClub.get(clubSlug)?.find((member) => !taken.has(member.personId));
    if (!candidate) throw new Error(`No unassigned member left in ${clubSlug}`);
    taken.add(candidate.personId);
    return candidate;
  };

  const signIns: { email: string; role: string }[] = [];
  const emailOf = async (personId: string): Promise<string> => {
    const person = await unscopedPrisma.person.findUniqueOrThrow({
      where: { id: personId },
      select: { email: true },
    });
    return person.email ?? '';
  };

  // Club officers: a president, a secretary and a treasurer for every club.
  for (const club of CLUBS) {
    const clubId = org.clubIdsBySlug.get(club.slug);
    if (!clubId) throw new Error(`No club id for ${club.slug}`);

    for (const positionCode of ['CLUB_PRESIDENT', 'CLUB_SECRETARY', 'CLUB_TREASURER']) {
      const member = claim(club.slug);
      await seedOfficer(
        member,
        { positionCode, scopeType: 'CLUB', scopeId: clubId, label: club.name },
        positionIds,
        org,
        passwordHash,
      );
      if (club.slug === CLUBS[0]?.slug) {
        signIns.push({
          email: await emailOf(member.personId),
          role: `${positionCode}, ${club.name}`,
        });
      }
    }
  }

  // District officers. Drawn from the largest clubs, which is where they come from.
  const districtRoles = ['DRR', 'DES', 'DISTRICT_TREASURER', 'PIME_CHAIR', 'ASSESSOR', 'ASSESSOR'];
  const districtHomes = [
    'rc-kampala',
    'rc-kololo',
    'rc-entebbe',
    'rc-jinja',
    'rc-mbarara',
    'rc-mbale',
  ];

  for (const [index, positionCode] of districtRoles.entries()) {
    const home = districtHomes[index] ?? 'rc-kampala';
    const member = claim(home);
    await seedOfficer(
      member,
      { positionCode, scopeType: 'DISTRICT', scopeId: null, label: DISTRICT.name },
      positionIds,
      org,
      passwordHash,
    );
    signIns.push({ email: await emailOf(member.personId), role: positionCode });
  }

  // Three ADRRs, each over one cluster.
  const adrrClusters = ['Kampala Metro', 'Busoga', 'Ankole and Kigezi'];
  const adrrHomes = ['rc-nakawa', 'rc-iganga', 'rc-kabale'];

  for (const [index, clusterName] of adrrClusters.entries()) {
    const clusterId = org.clusterIdsByName.get(clusterName);
    const home = adrrHomes[index];
    if (!clusterId || !home) throw new Error(`No cluster or home club for ADRR ${clusterName}`);

    const member = claim(home);
    await seedOfficer(
      member,
      { positionCode: 'ADRR', scopeType: 'CLUSTER', scopeId: clusterId, label: clusterName },
      positionIds,
      org,
      passwordHash,
    );
    signIns.push({ email: await emailOf(member.personId), role: `ADRR, ${clusterName}` });
  }

  const total = CLUBS.length * 3 + districtRoles.length + adrrClusters.length;
  log(`  officers: ${total} accounts invited and appointed for ${CURRENT_YEAR_LABEL}`);
  return signIns;
}

export interface SeedSummary {
  members: number;
  officers: number;
  clubs: number;
  password: string;
  signIns: { email: string; role: string }[];
}

/**
 * Builds the whole dataset and returns what it built.
 *
 * Exported rather than run on import, so `seed.test.ts` can drive it against the test
 * database and assert the result. A seed nobody checks is a seed that quietly stops
 * matching the schema, and the first person to notice is whoever demonstrates the system
 * to the district.
 */
export async function seedDatabase(): Promise<SeedSummary> {
  assertSafeToSeed();

  // Credentials stripped: the seed prints in terminals and CI logs.
  log(`Seeding ${config.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@')}`);

  // The real shape (M2 session 10): 68 clubs and 3,000 members. Asserted rather than
  // merely computed — M5's scoring and the load test both need a dataset of a KNOWN size,
  // and a seed that quietly produced 2,847 members would make every performance number an
  // answer to a different question.
  if (TOTAL_CLUBS !== 68) {
    throw new Error(`Seed has ${TOTAL_CLUBS} clubs, expected D9218's confirmed 68`);
  }
  if (TOTAL_MEMBERS !== 3000) {
    throw new Error(`Club member counts total ${TOTAL_MEMBERS}, expected 3000`);
  }

  await reset();
  await seedReferenceData();

  const org = await seedOrganisation();
  const positionIds = await seedPositions(org.districtId);

  // Activity types and finance categories belong to the district, not to the catalogue:
  // both are `sharedWhenNull` in the scope registry, and a NULL districtId would make
  // them system-wide templates rather than this district's configuration.
  await unscopedPrisma.activityType.createMany({
    data: ACTIVITY_TYPES.map((type) => ({ ...type, districtId: org.districtId })),
    skipDuplicates: true,
  });
  await unscopedPrisma.financeCategory.createMany({
    data: FINANCE_CATEGORIES.map((category) => ({ ...category, districtId: org.districtId })),
    skipDuplicates: true,
  });
  log(
    `  configuration: ${ACTIVITY_TYPES.length} activity types, ` +
      `${FINANCE_CATEGORIES.length} finance categories`,
  );

  const members = await seedMembers(org);
  await seedActivities(org, members);
  await seedFinance(org);
  const signIns = await seedOfficers(members, positionIds, org);

  return {
    members: members.length,
    officers: CLUBS.length * 3 + 6 + 3,
    clubs: CLUBS.length,
    password: SEED_PASSWORD,
    signIns,
  };
}
