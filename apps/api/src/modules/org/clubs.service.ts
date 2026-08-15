import type {
  Affiliation,
  Club,
  ClubListQuery,
  ClubSummary,
  ClubTierValue,
  CreateAffiliationRequest,
  CreateClubRequest,
  PaginationMeta,
  RequestContext,
  UpdateClubRequest,
} from '@dis/contracts';
import { requireClubScope } from '../../platform/context.js';
import { AppError, ErrorCode, insufficientScope, notFound } from '../../platform/errors.js';
import { isoDate } from '../../platform/time.js';
import * as activity from '../activity/service.js';
import * as membership from '../membership/service.js';
import * as repository from './clubs.repository.js';
import type { AffiliatedClubRow, ClusterPlacement } from './clubs.repository.js';

/**
 * Clubs.
 *
 * The whole module rests on axiom 2: a club is a GLOBAL entity and its district is a dated
 * relationship, never a column. Every read here goes through `clubs.repository`, which owns
 * the affiliation join; nothing in this file writes `districtId` into a query, and the data
 * access layer would not let it if it tried.
 */

/** T1 under forty members, T2 at forty or more; an institution-based club is its own tier. */
const TIER_THRESHOLD = 40;

/**
 * The tier rule, in one place.
 *
 * Called ONLY by rollover. Tier lives on the affiliation and is frozen within the year:
 * a club that recruits its fortieth member in March is not re-tiered in March, because the
 * assessment framework it is being scored against was published for its tier at the start
 * of the year, and moving the goalposts mid-season is how an award becomes an argument.
 */
export function recalculateTier(baseType: string, rosterSize: number): ClubTierValue {
  if (baseType === 'IBC') return 'IBC';
  return rosterSize < TIER_THRESHOLD ? 'T1' : 'T2';
}

/**
 * A URL-safe name. Derived, never supplied: a slug appears in links officers share, and a
 * client-chosen one is a client-chosen collision.
 */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'club'
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!(await repository.slugTaken(base))) return base;

  // Rotaract club names repeat across districts — "Rotaract Club of Makerere University"
  // exists more than once in the world — and `clubs.slug` is globally unique, so a
  // discriminator is the normal case rather than the exceptional one.
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const candidate = `${base}-${attempt}`;
    if (!(await repository.slugTaken(candidate))) return candidate;
  }
  throw new AppError(409, ErrorCode.DUPLICATE_CODE, 'Could not derive a unique slug', { base });
}

function serialiseClub(row: AffiliatedClubRow, placement: ClusterPlacement | undefined): Club {
  const club = row.club;
  return {
    id: club.id,
    // A BigInt on the wire as a string: JSON.parse turns anything past 2^53 into a
    // different number and says nothing about it.
    riClubId: club.riClubId === null ? null : club.riClubId.toString(),
    name: club.name,
    slug: club.slug,
    baseType: club.baseType,
    status: club.status,
    charteredOn: club.charteredOn === null ? null : isoDate(club.charteredOn),
    charteredMemberCount: club.charteredMemberCount,
    sponsorRotaryClub: club.sponsorRotaryClub,
    hostInstitution: club.hostInstitution,
    meetingDay: club.meetingDay,
    // A TIME column comes back as a Date on 1970-01-01; only the clock part means anything.
    meetingTime: club.meetingTime === null ? null : club.meetingTime.toISOString().slice(11, 16),
    meetingVenue: club.meetingVenue,
    isVirtual: club.isVirtual,
    postalAddress: club.postalAddress,
    ursbNumber: club.ursbNumber,
    bankName: club.bankName,
    logoUrl: club.logoUrl,
    affiliation: {
      tier: row.tier,
      isConfirmed: row.isConfirmed,
      clusterId: placement?.clusterId ?? null,
      clusterName: placement?.clusterName ?? null,
      regionId: placement?.regionId ?? null,
      regionName: placement?.regionName ?? null,
    },
  };
}

export async function list(
  ctx: RequestContext,
  query: ClubListQuery,
): Promise<{ data: Club[]; meta: PaginationMeta }> {
  const { rows, total } = await repository.listAffiliatedClubs(ctx, query);
  const placements = await repository.findClusterPlacements(
    ctx,
    rows.map((row) => row.clubId),
  );

  return {
    data: rows.map((row) => serialiseClub(row, placements.get(row.clubId))),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function get(ctx: RequestContext, clubId: string): Promise<Club> {
  const row = await repository.findAffiliatedClub(ctx, clubId);
  // Null covers both "no such club" and "affiliated to another district this year". One
  // answer for both, so walking identifiers teaches a caller nothing.
  if (!row) throw notFound();

  const placements = await repository.findClusterPlacements(ctx, [clubId]);
  return serialiseClub(row, placements.get(clubId));
}

/**
 * The whole club page in one response.
 *
 * Six round trips on a metered Android connection is the difference between a screen that
 * opens and a screen a secretary gives up on. `dues` and `score` are null until M4 and M5
 * fill them, but their SHAPE is fixed now — the client written against this is not rewritten
 * when they arrive.
 */
export async function summary(ctx: RequestContext, clubId: string): Promise<ClubSummary> {
  const club = await get(ctx, clubId);

  // Through each owning module's service, never by querying its tables from here.
  const [rosterCount, activities] = await Promise.all([
    membership.countRoster(ctx, clubId),
    activity.countForClub(ctx, clubId),
  ]);

  return { club, rosterCount, activities, dues: null, score: null };
}

function profileFields(input: UpdateClubRequest | CreateClubRequest): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) fields[key] = value;
  };

  assign('charteredOn', input.charteredOn === null ? null : input.charteredOn);
  assign('charteredMemberCount', input.charteredMemberCount);
  assign('sponsorRotaryClub', input.sponsorRotaryClub);
  assign('hostInstitution', input.hostInstitution);
  assign('meetingDay', input.meetingDay);
  // A TIME column: Prisma wants a Date, and only its clock part is stored.
  assign(
    'meetingTime',
    input.meetingTime === undefined
      ? undefined
      : input.meetingTime === null
        ? null
        : new Date(`1970-01-01T${input.meetingTime}:00.000Z`),
  );
  assign('meetingVenue', input.meetingVenue);
  assign('isVirtual', input.isVirtual);
  assign('postalAddress', input.postalAddress);
  assign('ursbNumber', input.ursbNumber);
  assign('bankName', input.bankName);
  assign('bankAccountRef', input.bankAccountRef);

  return fields;
}

/**
 * The RI Club ID identifies one club to Rotary International, and two rows claiming it is
 * two clubs that will be assessed as one.
 */
async function assertRiIdFree(riClubId: bigint, exceptClubId?: string): Promise<void> {
  const existing = await repository.findClubByRiId(riClubId);
  if (existing && existing.id !== exceptClubId) {
    throw new AppError(
      409,
      ErrorCode.RI_ID_ALREADY_CLAIMED,
      'Another club already holds that RI Club ID',
      { riClubId: riClubId.toString(), clubName: existing.name },
    );
  }
}

export async function create(ctx: RequestContext, input: CreateClubRequest): Promise<Club> {
  // Offline clients generate their own ids so a retry is safe. A replay is an answer, not
  // a failure: the caller gets the record it already created rather than a second one.
  if (input.id) {
    const existing = await repository.findClubById(input.id);
    if (existing) {
      throw new AppError(409, ErrorCode.IDEMPOTENT_REPLAY, 'That club has already been created', {
        clubId: input.id,
      });
    }
  }

  const riClubId = input.riClubId ? BigInt(input.riClubId) : null;
  if (riClubId !== null) await assertRiIdFree(riClubId);

  const created = await repository.createClubWithAffiliation(ctx, {
    id: input.id,
    name: input.name,
    slug: await uniqueSlug(input.name),
    riClubId,
    baseType: input.baseType,
    status: input.status ?? 'ACTIVE',
    profile: profileFields(input),
    // A brand new club has no roster to compute a tier from, so the caller says — or it
    // starts at T1, which is where a chartering club is. Rollover recalculates it.
    tier: input.tier ?? recalculateTier(input.baseType, 0),
  });

  return get(ctx, created.id);
}

/**
 * Who may edit which club.
 *
 * `club:update:district` reaches any club affiliated to the district — the affiliation
 * lookup in `get()` is what bounds it. `club:update:own` reaches the clubs the caller's
 * appointments name, and a club outside them answers 404 rather than 403: the caller is
 * holding an identifier, and confirming it exists hands them the shape of the dataset.
 */
function assertMayEdit(ctx: RequestContext, clubId: string): void {
  if (ctx.permissions.has('club:update:district')) return;
  if (!ctx.permissions.has('club:update:own')) {
    throw insufficientScope('You do not hold the permission this action requires', {
      requiredAnyOf: ['club:update:own', 'club:update:district'],
    });
  }
  requireClubScope(ctx, clubId);
}

export async function update(
  ctx: RequestContext,
  clubId: string,
  input: UpdateClubRequest,
): Promise<Club> {
  const row = await repository.findAffiliatedClub(ctx, clubId);
  if (!row) throw notFound();
  assertMayEdit(ctx, clubId);

  const data: Record<string, unknown> = profileFields(input);
  if (input.name !== undefined) data['name'] = input.name;
  if (input.baseType !== undefined) data['baseType'] = input.baseType;
  if (input.status !== undefined) data['status'] = input.status;

  if (input.riClubId !== undefined) {
    const riClubId = input.riClubId === null ? null : BigInt(input.riClubId);
    if (riClubId !== null) await assertRiIdFree(riClubId, clubId);
    data['riClubId'] = riClubId;
  }

  // The slug deliberately does NOT follow a rename. Officers share links.
  if (Object.keys(data).length > 0) await repository.updateClub(clubId, data);

  return get(ctx, clubId);
}

/**
 * Affiliates a club to the caller's district for the caller's year.
 *
 * THE endpoint axiom 2 exists for. A club moving from D9214 to D9218 is a new row for the
 * new year, not an edit to the club — so last year still says D9214, which is what makes
 * the redistricting reconstructable.
 */
export async function affiliate(
  ctx: RequestContext,
  clubId: string,
  input: CreateAffiliationRequest,
): Promise<Affiliation> {
  const club = await repository.findClubById(clubId);
  if (!club) throw notFound();

  const rosterCount = await membership
    .countRoster(ctx, clubId)
    // A club arriving from another district has no roster in THIS district's year yet, so
    // the count is zero and the tier is a starting position the DES confirms.
    .catch(() => 0);

  try {
    const row = await repository.upsertAffiliation(ctx, clubId, {
      tier: input.tier ?? recalculateTier(club.baseType, rosterCount),
      isConfirmed: input.isConfirmed ?? false,
    });
    if (!row) throw notFound();

    return {
      id: row.id,
      clubId: row.clubId,
      districtId: row.districtId,
      rotaryYearId: row.rotaryYearId,
      tier: row.tier,
      isConfirmed: row.isConfirmed,
    };
  } catch (error) {
    if (repository.isAffiliationConflict(error)) {
      throw new AppError(
        409,
        ErrorCode.CLUB_AFFILIATED_ELSEWHERE,
        'That club is already affiliated to a district for this Rotary Year',
        { clubId },
      );
    }
    throw error;
  }
}
