import { z } from 'zod';
import { listResponseSchema, paginationQuerySchema, singleResponseSchema } from './common.js';

/**
 * People.
 *
 * **Axiom 6 lives here.** The predecessor system published ~4,000 members' names, photos,
 * phone numbers, emails, genders and residential areas on an unauthenticated page. Every
 * contact field below is optional in the RESPONSE type, and it is absent — not null, not
 * empty — whenever the caller may not see it. A field that is always present and sometimes
 * empty is a field a careless client renders as a blank line and a careless developer
 * assumes is nullable in the database.
 */

/**
 * What everybody may see of a person: their name.
 *
 * A picker needs to tell two people with the same name apart and has never needed anything
 * else. `photoUrl` and `occupation` join it only when the person has left those flags at
 * their default, and only for an authenticated district caller.
 */
export const personSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  otherNames: z.string().nullable(),

  /** Default-visible to authenticated district users, and closed by the member if they wish. */
  photoUrl: z.string().nullable().optional(),
  occupation: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  employer: z.string().nullable().optional(),

  /**
   * CONTACT. Present only when `person_visibility` permits, or the caller is the person, or
   * the caller holds `person:read:contact` within a scope containing them.
   */
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  altPhone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),

  /** The clubs this person is currently on the roster of, within the caller's district. */
  clubs: z.array(z.object({ id: z.uuid(), name: z.string(), since: z.string() })).optional(),

  /** True when the response was cut down by visibility rather than by the record being empty. */
  isRedacted: z.boolean(),
});
export type Person = z.infer<typeof personSchema>;

export const personListResponseSchema = listResponseSchema(personSchema);
export const personResponseSchema = singleResponseSchema(personSchema);

export const personListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  clubId: z.uuid().optional(),
});
export type PersonListQuery = z.infer<typeof personListQuerySchema>;

const nameField = z.string().trim().min(1).max(120);

export const createPersonRequestSchema = z.object({
  /** Client-generated, so an offline retry is idempotent (ADR-004). */
  id: z.uuid().optional(),
  firstName: nameField,
  lastName: nameField,
  otherNames: z.string().trim().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  altPhone: z.string().trim().max(40).nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  occupation: z.string().trim().max(120).nullable().optional(),
  classification: z.string().trim().max(120).nullable().optional(),
  employer: z.string().trim().max(160).nullable().optional(),
  nationality: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
});
export type CreatePersonRequest = z.infer<typeof createPersonRequestSchema>;

export const updatePersonRequestSchema = createPersonRequestSchema.omit({ id: true }).partial();
export type UpdatePersonRequest = z.infer<typeof updatePersonRequestSchema>;

/**
 * The member's own switches.
 *
 * Every contact flag defaults to FALSE and only the person may change it — not a club
 * secretary, not the DES, not an administrator. `showPhoto` and `showOccupation` default
 * TRUE and are visible to authenticated district users only; no flag here has any effect on
 * an unauthenticated caller, because no endpoint serves one.
 */
export const personVisibilitySchema = z.object({
  showEmail: z.boolean(),
  showPhone: z.boolean(),
  showPhoto: z.boolean(),
  showOccupation: z.boolean(),
  showCity: z.boolean(),
  directoryOptout: z.boolean(),
});
export type PersonVisibility = z.infer<typeof personVisibilitySchema>;

export const personVisibilityResponseSchema = singleResponseSchema(personVisibilitySchema);
export const updateVisibilityRequestSchema = personVisibilitySchema.partial();
export type UpdateVisibilityRequest = z.infer<typeof updateVisibilityRequestSchema>;

/**
 * A subject access request: everything the system holds about one person, for that person.
 *
 * Not a report and not a summary — the actual rows, so a member can check them. Unredacted
 * by definition: the caller IS the subject.
 */
export const personExportSchema = z.object({
  exportedAt: z.string(),
  person: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    otherNames: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    altPhone: z.string().nullable(),
    gender: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    occupation: z.string().nullable(),
    classification: z.string().nullable(),
    employer: z.string().nullable(),
    nationality: z.string().nullable(),
    city: z.string().nullable(),
    photoUrl: z.string().nullable(),
    createdAt: z.string(),
  }),
  visibility: personVisibilitySchema.nullable(),
  consents: z.array(
    z.object({
      consentType: z.string(),
      policyVersion: z.string(),
      grantedAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
    }),
  ),
  membershipEvents: z.array(
    z.object({
      id: z.uuid(),
      eventType: z.string(),
      memberCategory: z.string(),
      effectiveOn: z.string(),
      clubName: z.string(),
      reasonCode: z.string().nullable(),
      supersedesEventId: z.uuid().nullable(),
    }),
  ),
  appointments: z.array(
    z.object({
      id: z.uuid(),
      positionName: z.string(),
      scopeType: z.string(),
      startsOn: z.string(),
      endsOn: z.string().nullable(),
      isActive: z.boolean(),
      rotaryYearLabel: z.string(),
    }),
  ),
});
export type PersonExport = z.infer<typeof personExportSchema>;
export const personExportResponseSchema = singleResponseSchema(personExportSchema);

// ─── Erasure ─────────────────────────────────────────────────────────────────

export const erasureStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
export type ErasureStatusValue = (typeof erasureStatuses)[number];

export const erasureRequestSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  personName: z.string(),
  status: z.enum(erasureStatuses),
  reason: z.string().nullable(),
  reviewNote: z.string().nullable(),
  requestedAt: z.string(),
  reviewedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type ErasureRequest = z.infer<typeof erasureRequestSchema>;

export const erasureRequestResponseSchema = singleResponseSchema(erasureRequestSchema);
export const erasureRequestListResponseSchema = listResponseSchema(erasureRequestSchema);

export const createErasureRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type CreateErasureRequest = z.infer<typeof createErasureRequestSchema>;

/**
 * The review. Approving QUEUES the anonymisation; it does not perform it, because the work
 * touches the roster of every club the member ever belonged to and does not belong on a
 * request thread.
 */
export const reviewErasureRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(1000).optional(),
});
export type ReviewErasureRequest = z.infer<typeof reviewErasureRequestSchema>;

export const erasureListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(erasureStatuses).optional(),
});
export type ErasureListQuery = z.infer<typeof erasureListQuerySchema>;
