import type { OrgScopeValue } from '@dis/contracts';
// The escape hatch, used deliberately: this module RESOLVES the context, so it is the
// one place that cannot already hold one. ESLint's no-restricted-imports rule exempts
// `modules/governance` for exactly this reason and refuses the import everywhere else.
import { unscopedPrisma } from '../../platform/db.js';
import { isTermCurrent } from '../../platform/time.js';

export interface ActiveAppointment {
  id: string;
  districtId: string;
  rotaryYearId: string;
  positionCode: string;
  positionName: string;
  scopeType: OrgScopeValue;
  scopeId: string | null;
  startsOn: Date;
  endsOn: Date | null;
  permissions: string[];
}

/**
 * Every appointment the person currently holds, in any district and any year, with the
 * permissions its position carries.
 *
 * "Currently" means `is_active` AND the date falls inside the term, compared against
 * midnight in the DISTRICT'S timezone. Both parts matter: `is_active` is how an
 * appointment is revoked mid-year, and the dates are how it expires without anyone doing
 * anything — which is what makes rollover automatic rather than a job that has to
 * remember to strip last year's officers.
 *
 * The term filter is applied in TypeScript rather than in SQL, because the comparison
 * needs each row's own district timezone and a person may hold appointments in more than
 * one district. `is_active` and the person narrow it to a handful of rows first.
 */
export async function findActiveAppointments(personId: string): Promise<ActiveAppointment[]> {
  const rows = await unscopedPrisma.appointment.findMany({
    where: { personId, isActive: true },
    select: {
      id: true,
      districtId: true,
      rotaryYearId: true,
      scopeType: true,
      scopeId: true,
      startsOn: true,
      endsOn: true,
      district: { select: { timezone: true } },
      position: {
        select: {
          code: true,
          name: true,
          isActive: true,
          permissions: { select: { permissionCode: true } },
        },
      },
    },
    orderBy: { startsOn: 'asc' },
  });

  return rows
    .filter((row) => row.position.isActive)
    .filter((row) => isTermCurrent(row, row.district.timezone))
    .map((row) => ({
      id: row.id,
      districtId: row.districtId,
      rotaryYearId: row.rotaryYearId,
      positionCode: row.position.code,
      positionName: row.position.name,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      permissions: row.position.permissions.map((p) => p.permissionCode),
    }));
}

export interface DistrictYearRow {
  districtId: string;
  rotaryYearId: string;
  isCurrent: boolean;
  isLocked: boolean;
  districtName: string;
  yearLabel: string;
}

/** The current year of each of the given districts. At most one row per district. */
export async function findCurrentDistrictYears(districtIds: string[]): Promise<DistrictYearRow[]> {
  if (districtIds.length === 0) return [];

  const rows = await unscopedPrisma.districtYear.findMany({
    where: { districtId: { in: districtIds }, isCurrent: true },
    select: {
      districtId: true,
      rotaryYearId: true,
      isCurrent: true,
      isLocked: true,
      district: { select: { name: true } },
      rotaryYear: { select: { label: true } },
    },
  });

  return rows.map(toDistrictYearRow);
}

/**
 * One district's year, looked up by the Rotary Year LABEL a `?year=` override carries.
 *
 * Null when the district never had that year — which the caller answers with 404, not
 * 403: a year a district did not run is indistinguishable from one that does not exist,
 * and saying which would map out the district's history to anyone guessing labels.
 */
export async function findDistrictYearByLabel(
  districtId: string,
  label: string,
): Promise<DistrictYearRow | null> {
  const row = await unscopedPrisma.districtYear.findFirst({
    where: { districtId, rotaryYear: { label } },
    select: {
      districtId: true,
      rotaryYearId: true,
      isCurrent: true,
      isLocked: true,
      district: { select: { name: true } },
      rotaryYear: { select: { label: true } },
    },
  });

  return row ? toDistrictYearRow(row) : null;
}

function toDistrictYearRow(row: {
  districtId: string;
  rotaryYearId: string;
  isCurrent: boolean;
  isLocked: boolean;
  district: { name: string };
  rotaryYear: { label: string };
}): DistrictYearRow {
  return {
    districtId: row.districtId,
    rotaryYearId: row.rotaryYearId,
    isCurrent: row.isCurrent,
    isLocked: row.isLocked,
    districtName: row.district.name,
    yearLabel: row.rotaryYear.label,
  };
}

/** The clusters of the given regions, for the year. */
export async function findClusterIdsInRegions(
  regionIds: string[],
  rotaryYearId: string,
): Promise<string[]> {
  if (regionIds.length === 0) return [];

  const rows = await unscopedPrisma.cluster.findMany({
    where: { regionId: { in: regionIds }, rotaryYearId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** The clubs assigned to the given clusters, for the year. */
export async function findClubIdsInClusters(
  clusterIds: string[],
  rotaryYearId: string,
): Promise<string[]> {
  if (clusterIds.length === 0) return [];

  const rows = await unscopedPrisma.clubClusterAssignment.findMany({
    where: { clusterId: { in: clusterIds }, rotaryYearId },
    select: { clubId: true },
  });
  return rows.map((row) => row.clubId);
}

/**
 * Display names for the org units an appointment can point at.
 *
 * `appointments.scope_id` is a bare UUID rather than a foreign key — it may reference a
 * club, cluster, region or committee, and it is the one place the schema trades
 * referential integrity for polymorphism. Resolving the name therefore means asking each
 * table for the ids of its own kind, which is what this does in one round trip per kind.
 */
export async function findScopeNames(
  scopeIds: Record<OrgScopeValue, string[]>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const [clubs, clusters, regions, committees] = await Promise.all([
    scopeIds.CLUB.length
      ? unscopedPrisma.club.findMany({
          where: { id: { in: scopeIds.CLUB }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [],
    scopeIds.CLUSTER.length
      ? unscopedPrisma.cluster.findMany({
          where: { id: { in: scopeIds.CLUSTER } },
          select: { id: true, name: true },
        })
      : [],
    scopeIds.REGION.length
      ? unscopedPrisma.region.findMany({
          where: { id: { in: scopeIds.REGION } },
          select: { id: true, name: true },
        })
      : [],
    scopeIds.COMMITTEE.length
      ? unscopedPrisma.committee.findMany({
          where: { id: { in: scopeIds.COMMITTEE } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  for (const row of [...clubs, ...clusters, ...regions, ...committees]) {
    names.set(row.id, row.name);
  }
  return names;
}

export interface ContextUser {
  id: string;
  personId: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
}

/** The account behind a session, and whether it is still allowed to hold a context. */
export async function findContextUser(userId: string): Promise<ContextUser | null> {
  return unscopedPrisma.user.findFirst({
    where: { id: userId, person: { deletedAt: null } },
    select: { id: true, personId: true, status: true },
  });
}
