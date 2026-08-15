import type { Person, RequestContext } from '@dis/contracts';
import { isoDate } from '../../platform/time.js';

/**
 * THE person serialiser. One function, used by EVERY endpoint that returns a person —
 * including the nested ones inside activities, rosters, attendees and appointments.
 *
 * Contact data leaks through relations, not through the endpoint you were thinking about.
 * `GET /persons` is the one everybody reviews; `GET /activities/:id` with its attendees
 * expanded is the one that ships a phone number, because whoever wrote it was thinking
 * about activities. So there is one gate and no way past it: a module that wants to return
 * a person calls this, and the row it passes in is the only place the decision is made.
 *
 * The M1 audit endpoint does NOT use this, deliberately. It redacts contact fields
 * unconditionally rather than per the caller's visibility, because the log answers "who
 * changed what and when" — that a member's phone number changed is the answer, and the old
 * number is not part of it. Two different questions, two different rules, both written down.
 */

/** Exactly what the serialiser needs. A caller selecting less gets less, which is fine. */
export interface PersonRecord {
  id: string;
  firstName: string;
  lastName: string;
  otherNames?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  email?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  occupation?: string | null;
  classification?: string | null;
  employer?: string | null;
  nationality?: string | null;
  city?: string | null;
  photoUrl?: string | null;
  /**
   * `person_visibility`, created for every person by the `persons_visibility_ins` trigger.
   *
   * `null` or `undefined` here means FULLY CLOSED, never "use the defaults". The trigger
   * makes the row's absence impossible, so this branch is defence against a caller that
   * simply did not select the relation — and defaulting open in that case is the exact
   * failure mode this project exists to correct.
   */
  visibility?: PersonVisibilityRecord | null;
}

export interface PersonVisibilityRecord {
  showEmail: boolean;
  showPhone: boolean;
  showPhoto: boolean;
  showOccupation: boolean;
  showCity: boolean;
  directoryOptout: boolean;
}

/** Fully closed. What a person with no visibility row is treated as. */
const CLOSED: PersonVisibilityRecord = {
  showEmail: false,
  showPhone: false,
  showPhoto: false,
  showOccupation: false,
  showCity: false,
  directoryOptout: true,
};

export interface SerialiseOptions {
  /**
   * Clubs this person is currently on the roster of. Used ONLY to decide whether a
   * caller holding `person:read:contact` has that person inside their scope.
   *
   * Omitted means an empty list, which means a club-scoped caller falls back to the
   * visibility flags. That is the safe direction: a serialiser that assumed the caller's
   * scope covered anybody it was not told about would open every nested person on the
   * system to a club secretary.
   */
  rosterClubIds?: readonly string[];
  /** Rendered into the response when the caller asked for them. */
  clubs?: { id: string; name: string; since: string }[];
}

/**
 * Whether the caller sees this person's contact details at all, regardless of their flags.
 *
 * Three ways in, and only three:
 *
 *  * you are the person;
 *  * you hold `person:read:contact` and are district-wide;
 *  * you hold `person:read:contact` and one of their clubs is in your scope.
 *
 * A club secretary holding it therefore reaches their own members — which is the whole
 * point of the permission and the reason it is safe to grant — and nobody else's.
 */
export function mayReadContact(
  ctx: RequestContext,
  person: { id: string },
  rosterClubIds: readonly string[] = [],
): boolean {
  if (person.id === ctx.personId) return true;
  if (!ctx.permissions.has('person:read:contact')) return false;
  if (ctx.scopes.isDistrictWide) return true;
  return rosterClubIds.some((clubId) => ctx.scopes.clubIds.includes(clubId));
}

/**
 * A person, cut to what this caller may see.
 *
 * Fields the caller may not see are ABSENT, not null. A field that is always present and
 * sometimes empty is one a client renders as a blank line and a developer later assumes is
 * nullable in the database; absence says "not for you" and cannot be mistaken for "not set".
 */
export function serialisePerson(
  ctx: RequestContext,
  record: PersonRecord,
  options: SerialiseOptions = {},
): Person {
  const visibility = record.visibility ?? CLOSED;
  const full = mayReadContact(ctx, record, options.rosterClubIds ?? []);

  const person: Person = {
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    otherNames: record.otherNames ?? null,
    // True whenever anything was withheld — so a client can say "this member keeps their
    // details private" instead of silently rendering a page that looks broken.
    isRedacted: false,
  };

  let redacted = false;
  const include = <K extends keyof Person>(key: K, allowed: boolean, value: Person[K]): void => {
    if (allowed) person[key] = value;
    else if (value !== null && value !== undefined) redacted = true;
  };

  // Default-visible to an authenticated district caller, and closable by the member.
  include('photoUrl', full || visibility.showPhoto, record.photoUrl ?? null);
  include('occupation', full || visibility.showOccupation, record.occupation ?? null);
  include('classification', full || visibility.showOccupation, record.classification ?? null);
  include('employer', full || visibility.showOccupation, record.employer ?? null);

  // Contact. Closed by default, and only the member opens them.
  include('email', full || visibility.showEmail, record.email ?? null);
  include('phone', full || visibility.showPhone, record.phone ?? null);
  include('altPhone', full || visibility.showPhone, record.altPhone ?? null);
  include('city', full || visibility.showCity, record.city ?? null);

  // No flag of their own, and no default that shows them. A date of birth is what a
  // birthday feature would want and this system deliberately does not have one; gender and
  // nationality were published by the incumbent and are nobody's business here.
  include('dateOfBirth', full, record.dateOfBirth ? isoDate(record.dateOfBirth) : null);
  include('gender', full, record.gender ?? null);
  include('nationality', full, record.nationality ?? null);

  if (options.clubs) person.clubs = options.clubs;
  person.isRedacted = redacted;

  return person;
}

/** The member's own switches, as the API states them. Absent row means fully closed. */
export function serialiseVisibility(record: PersonVisibilityRecord | null | undefined) {
  const visibility = record ?? CLOSED;
  return {
    showEmail: visibility.showEmail,
    showPhone: visibility.showPhone,
    showPhoto: visibility.showPhoto,
    showOccupation: visibility.showOccupation,
    showCity: visibility.showCity,
    directoryOptout: visibility.directoryOptout,
  };
}
