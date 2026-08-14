import type {
  PaginationMeta,
  PersonSearchQuery,
  PersonSummary,
  RequestContext,
} from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';

/**
 * Person lookup, for pickers.
 *
 * Names only, deliberately. An appointment picker needs to tell Ann Nakato of Kampala
 * from Ann Nakato of Jinja, and nothing else — so nothing else is selected. This is the
 * whole of the persons surface until M2 builds the real one with visibility handling.
 *
 * Scoped through the ROSTER rather than through the person, because persons are global
 * entities (axiom 2 applies to clubs, and people move between them). A club secretary
 * therefore searches their own members; a district officer searches the district.
 */
export async function searchPersons(
  ctx: RequestContext,
  query: PersonSearchQuery,
): Promise<{ data: PersonSummary[]; meta: PaginationMeta }> {
  const rosterWhere = {
    ...(ctx.scopes.isDistrictWide ? {} : { clubId: { in: [...ctx.scopes.clubIds] } }),
    ...(query.q
      ? {
          person: {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };

  // club_rosters is district-scoped and derived from the event log, so this is the same
  // view every other membership read uses.
  const [rows, total] = await Promise.all([
    db(ctx).clubRoster.findMany({
      where: rosterWhere,
      select: {
        personId: true,
        person: { select: { firstName: true, lastName: true } },
        club: { select: { name: true } },
      },
      orderBy: [{ personId: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).clubRoster.count({ where: rosterWhere }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.personId,
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      clubName: row.club.name,
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/** Exported so the picker can resolve a chosen id back to a name without a second search. */
export async function findPersonSummary(
  ctx: RequestContext,
  personId: string,
): Promise<PersonSummary | null> {
  const roster = await db(ctx).clubRoster.findFirst({
    where: { personId },
    select: {
      personId: true,
      person: { select: { firstName: true, lastName: true } },
      club: { select: { name: true } },
    },
  });
  if (roster) {
    return {
      id: roster.personId,
      firstName: roster.person.firstName,
      lastName: roster.person.lastName,
      clubName: roster.club.name,
    };
  }

  // Somebody with no current club — an incoming officer, or a member between clubs.
  // Reachable only district-wide, because there is no roster to scope them by.
  if (!ctx.scopes.isDistrictWide) return null;

  const person = await prisma.person.findFirst({
    where: { id: personId },
    select: { id: true, firstName: true, lastName: true },
  });
  return person ? { ...person, clubName: null } : null;
}
