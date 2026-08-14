import {
  PERMISSION_YEAR_READ_HISTORICAL,
  type AppointmentSummary,
  type OrgScopeValue,
  type RequestContext,
  type RequestScopes,
} from '@dis/contracts';
import { insufficientScope, notFound } from '../../platform/errors.js';
import * as repository from './repository.js';
import type { ActiveAppointment, ContextUser, DistrictYearRow } from './repository.js';

/**
 * Context resolution — the governance module's one job for M0.
 *
 * It lives here rather than in `platform/` because permissions ARE governance: they
 * derive from `(person, position, org_unit, rotary_year)` and from nothing else. There is
 * no role column on a user to read, deliberately, because a role column survives the
 * appointment that justified it (docs/02-Architecture.md §4.2).
 *
 * This module is the only one that reads the database without a context, for the obvious
 * reason that it is what produces one.
 */

/**
 * Everything the request needs, plus what `/auth/me` shows the member about it.
 *
 * `context` is null for an authenticated member holding no active appointment in their
 * district's current year. They are not refused a session — they simply have no
 * authority, and every scoped endpoint will tell them so.
 */
export interface ResolvedContext {
  context: RequestContext | null;
  districtId: string | null;
  districtName: string | null;
  rotaryYearId: string | null;
  rotaryYearLabel: string | null;
  isYearLocked: boolean;
  isYearWritable: boolean;
  permissions: string[];
  /**
   * The appointments behind the context, resolved ON DEMAND.
   *
   * A function rather than an array because naming the polymorphic scopes costs up to
   * four more queries — one per kind of org unit — and only `/auth/me` displays them.
   * Paying for that on every authenticated request would be roughly half the cost of
   * resolving a context, spent on something almost nothing reads.
   */
  listAppointments(): Promise<AppointmentSummary[]>;
}

const EMPTY: ResolvedContext = {
  context: null,
  districtId: null,
  districtName: null,
  rotaryYearId: null,
  rotaryYearLabel: null,
  isYearLocked: false,
  isYearWritable: false,
  permissions: [],
  listAppointments: () => Promise.resolve([]),
};

function isoDate(value: Date): string {
  // `@db.Date` columns arrive as midnight UTC, so the date half of the ISO string is the
  // stored date with no timezone arithmetic to get wrong.
  return value.toISOString().slice(0, 10);
}

export async function resolveContext(input: {
  userId: string;
  personId: string;
  /** The `?year=` override, already shape-validated. Undefined means "the current year". */
  yearLabel?: string | undefined;
}): Promise<ResolvedContext> {
  const appointments = await repository.findActiveAppointments(input.personId);
  if (appointments.length === 0) return EMPTY;

  const districtIds = [...new Set(appointments.map((a) => a.districtId))];
  const currentYears = await repository.findCurrentDistrictYears(districtIds);
  if (currentYears.length === 0) return EMPTY;

  const currentByDistrict = new Map(currentYears.map((row) => [row.districtId, row]));

  // Appointments that are BOTH active and in their district's current year. Last year's
  // officers fall out here without anything having to remove them.
  const inCurrentYear = appointments.filter(
    (a) => currentByDistrict.get(a.districtId)?.rotaryYearId === a.rotaryYearId,
  );
  if (inCurrentYear.length === 0) return EMPTY;

  // One district per session. Holding office in two at once is not a case D9218 has, and
  // a district switcher is a feature, not a default — so the choice is made
  // deterministically rather than by whichever row the planner returned first
  // (ADR-010: multi-tenant schema, single tenant in production).
  const districtId = [...new Set(inCurrentYear.map((a) => a.districtId))].sort()[0];
  if (districtId === undefined) return EMPTY;

  const districtYear = currentByDistrict.get(districtId);
  if (!districtYear) return EMPTY;

  const held = inCurrentYear.filter((a) => a.districtId === districtId);
  const permissions = new Set(held.flatMap((a) => a.permissions));

  const year = await resolveYear({
    districtId,
    current: districtYear,
    requested: input.yearLabel,
    permissions,
  });

  const scopes = await resolveScopes(held, districtYear.rotaryYearId);

  // A `?year=` override is a READ door: the permission that opens it is named
  // `year:read:historical`, and nothing grants a right to write into a closed year. A
  // locked year is closed to everyone.
  const isYearWritable = !year.isLocked && year.rotaryYearId === districtYear.rotaryYearId;

  return {
    context: {
      userId: input.userId,
      personId: input.personId,
      districtId,
      rotaryYearId: year.rotaryYearId,
      permissions,
      scopes,
      isYearWritable,
    },
    districtId,
    districtName: districtYear.districtName,
    rotaryYearId: year.rotaryYearId,
    rotaryYearLabel: year.label,
    isYearLocked: year.isLocked,
    isYearWritable,
    permissions: [...permissions].sort(),
    listAppointments: () => summarise(held, districtYear.districtName),
  };
}

/**
 * The current year, or the one `?year=` asked for.
 *
 * Asking for the current year by name is allowed unconditionally — a client that always
 * sends the label it is displaying is doing the right thing, and refusing it would push
 * clients towards omitting the parameter and hoping.
 */
async function resolveYear(input: {
  districtId: string;
  current: DistrictYearRow;
  requested: string | undefined;
  permissions: ReadonlySet<string>;
}): Promise<{ rotaryYearId: string; label: string; isLocked: boolean }> {
  const { current, requested } = input;

  if (requested === undefined || requested === current.yearLabel) {
    return {
      rotaryYearId: current.rotaryYearId,
      label: current.yearLabel,
      isLocked: current.isLocked,
    };
  }

  if (!input.permissions.has(PERMISSION_YEAR_READ_HISTORICAL)) {
    // 403 rather than silently serving the current year. A report read under one year
    // and captioned with another is the kind of error nobody catches until it is quoted
    // in a district assembly.
    throw insufficientScope('Reading another Rotary Year requires year:read:historical', {
      required: PERMISSION_YEAR_READ_HISTORICAL,
    });
  }

  const row = await repository.findDistrictYearByLabel(input.districtId, requested);
  if (!row) throw notFound();

  return { rotaryYearId: row.rotaryYearId, label: row.yearLabel, isLocked: row.isLocked };
}

/**
 * Which records the caller may touch.
 *
 * Cluster and region appointments are expanded to club ids HERE, once per request,
 * rather than left as a graph the record-level check would have to walk every time. The
 * expansion uses the appointments' own year — an ADRR is responsible for the clubs in
 * their cluster now, and clusters are redrawn annually, so a past year's assignments say
 * nothing about who they answer for today.
 */
async function resolveScopes(
  held: ActiveAppointment[],
  appointmentYearId: string,
): Promise<RequestScopes> {
  const isDistrictWide = held.some((a) => a.scopeType === 'DISTRICT');

  const directClubIds = scopeIdsOfType(held, 'CLUB');
  const directClusterIds = scopeIdsOfType(held, 'CLUSTER');
  const regionIds = scopeIdsOfType(held, 'REGION');
  const committeeIds = scopeIdsOfType(held, 'COMMITTEE');

  const regionClusterIds = await repository.findClusterIdsInRegions(regionIds, appointmentYearId);
  const clusterIds = [...new Set([...directClusterIds, ...regionClusterIds])];
  const clusterClubIds = await repository.findClubIdsInClusters(clusterIds, appointmentYearId);

  return {
    // Not expanded for a district-wide caller: enumerating 140 clubs to answer a question
    // that is a boolean is work done 140 times to no purpose.
    clubIds: [...new Set([...directClubIds, ...clusterClubIds])].sort(),
    clusterIds: clusterIds.sort(),
    // The region and committee an appointment names are kept as well as expanded. An
    // LDRR is responsible for their region's clubs AND for the region itself, and
    // documents are owned at both.
    regionIds: [...new Set(regionIds)].sort(),
    committeeIds: [...new Set(committeeIds)].sort(),
    isDistrictWide,
  };
}

function scopeIdsOfType(held: ActiveAppointment[], type: OrgScopeValue): string[] {
  return held
    .filter((a) => a.scopeType === type)
    .map((a) => a.scopeId)
    .filter((id): id is string => id !== null);
}

/** The appointments as `/auth/me` shows them, with the polymorphic scope named. */
async function summarise(
  held: ActiveAppointment[],
  districtName: string,
): Promise<AppointmentSummary[]> {
  const byType: Record<OrgScopeValue, string[]> = {
    DISTRICT: [],
    REGION: [],
    CLUSTER: [],
    CLUB: [],
    COMMITTEE: [],
  };
  for (const appointment of held) {
    if (appointment.scopeId) byType[appointment.scopeType].push(appointment.scopeId);
  }

  const names = await repository.findScopeNames(byType);

  return held.map((appointment) => ({
    id: appointment.id,
    positionCode: appointment.positionCode,
    positionName: appointment.positionName,
    scopeType: appointment.scopeType,
    scopeId: appointment.scopeId,
    scopeName:
      appointment.scopeType === 'DISTRICT'
        ? districtName
        : appointment.scopeId
          ? (names.get(appointment.scopeId) ?? null)
          : null,
    startsOn: isoDate(appointment.startsOn),
    endsOn: appointment.endsOn ? isoDate(appointment.endsOn) : null,
  }));
}

/** The account behind a session, for the context middleware. */
export async function findContextUser(userId: string): Promise<ContextUser | null> {
  return repository.findContextUser(userId);
}
