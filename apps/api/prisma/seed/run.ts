import { hashPassword } from '../../src/modules/auth/passwords.js';
import { issueInvite } from '../../src/modules/auth/service.js';
import { config, isProduction } from '../../src/platform/config.js';
// The seed is one of the three sanctioned callers of the escape hatch. It writes across
// every district and year on purpose, and — just as deliberately — is NOT audited: three
// hundred seeded members are nobody's action (docs/15-Build-Log.md, session 5).
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
  firstName: string;
  lastName: string;
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
        firstName: person.firstName,
        lastName: person.lastName,
      });
    }
  }

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

  if (TOTAL_MEMBERS !== 300) {
    throw new Error(`Club member counts total ${TOTAL_MEMBERS}, expected 300`);
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
  const signIns = await seedOfficers(members, positionIds, org);

  return {
    members: members.length,
    officers: CLUBS.length * 3 + 6 + 3,
    clubs: CLUBS.length,
    password: SEED_PASSWORD,
    signIns,
  };
}
