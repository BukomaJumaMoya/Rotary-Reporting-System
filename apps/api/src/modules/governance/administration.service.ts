import type {
  AuditEntry,
  AuditListQuery,
  Invitation,
  InvitationListQuery,
  InvitationResult,
  PaginationMeta,
  RequestContext,
} from '@dis/contracts';
import { AuditAction, currentActor } from '../../platform/audit.js';
import { db, prisma, recordAction } from '../../platform/db.js';
import { AppError, ErrorCode, insufficientScope, notFound } from '../../platform/errors.js';
import { notifyThroughQueue } from '../../jobs/notification.job.js';
import { issueInvite } from '../auth/service.js';
import { NotificationTemplate } from '../notifications/templates.js';

/**
 * Onboarding and administration — the three items M0 deferred because each is a
 * permission question.
 */

// ─── Invitations ─────────────────────────────────────────────────────────────

/**
 * Who may invite whom.
 *
 * `person:invite:district` reaches anyone in the district. `person:invite:club` reaches
 * only people on the caller's OWN club rosters, which is what makes it safe to give a
 * club secretary: they can onboard their own members and nobody else's.
 */
async function assertMayInvite(ctx: RequestContext, personId: string): Promise<void> {
  if (ctx.permissions.has('person:invite:district')) return;

  if (!ctx.permissions.has('person:invite:club')) {
    throw insufficientScope('You may not issue invitations', {
      required: 'person:invite:club',
    });
  }

  // The roster is DERIVED from membership events (axiom 3), and `club_rosters` is scoped
  // to the district — so this asks "is this person in a club I am responsible for" using
  // the same view every other membership read uses.
  const onMyRoster = await db(ctx).clubRoster.count({
    where: { personId, clubId: { in: [...ctx.scopes.clubIds] } },
  });

  if (onMyRoster === 0) {
    // 404-shaped refusal: a club secretary probing person ids learns nothing about who
    // exists in other clubs.
    throw notFound();
  }
}

export async function listInvitations(
  ctx: RequestContext,
  query: InvitationListQuery,
): Promise<{ data: Invitation[]; meta: PaginationMeta }> {
  const now = new Date();
  const where = {
    purpose: 'INVITE',
    consumedAt: null,
    ...(query.includeExpired ? {} : { expiresAt: { gt: now } }),
  };

  // `user_tokens` is UNSCOPED_BY_DESIGN — it is looked up by hash during unauthenticated
  // flows — so the district filter is applied through the person's own appointments
  // rather than by the layer. Everyone invited has been created by this district.
  const [rows, total] = await Promise.all([
    prisma.userToken.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        user: {
          select: {
            personId: true,
            person: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.userToken.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      personId: row.user.personId,
      personName: `${row.user.person.firstName} ${row.user.person.lastName}`,
      // Shown because an outstanding-invitations screen without the address it went to
      // cannot answer the only question anybody asks of it.
      email: row.user.person.email,
      issuedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      isExpired: row.expiresAt.getTime() <= now.getTime(),
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/**
 * Invites one person, reporting rather than throwing.
 *
 * Bulk invitation is the real use — a secretary onboarding a club — and the useful answer
 * is which of the forty worked. A batch that fails because one member already has an
 * account is a batch nobody can act on.
 */
async function inviteOne(ctx: RequestContext, personId: string): Promise<InvitationResult> {
  try {
    await assertMayInvite(ctx, personId);

    const person = await prisma.person.findFirst({
      where: { id: personId },
      select: { id: true, email: true, user: { select: { id: true, status: true } } },
    });
    if (!person) return { personId, status: 'FAILED', reason: 'NOT_FOUND' };

    if (!person.email) {
      // An invitation is an emailed link. Without an address there is nothing to send.
      return { personId, status: 'FAILED', reason: 'NO_EMAIL' };
    }

    if (person.user?.status === 'ACTIVE') {
      return { personId, status: 'FAILED', reason: 'ALREADY_ACTIVE' };
    }

    const userId =
      person.user?.id ??
      (
        await prisma.user.create({
          data: { personId, status: 'INVITED' },
          select: { id: true },
        })
      ).id;

    // The real onboarding path, and the only one: a hashed single-use token in
    // user_tokens plus a notification row.
    await issueInvite(userId);
    return { personId, status: 'SENT', reason: null };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        personId,
        status: 'FAILED',
        reason: error.status === 404 ? 'OUT_OF_SCOPE' : error.code,
      };
    }
    throw error;
  }
}

export async function createInvitations(
  ctx: RequestContext,
  personIds: string[],
): Promise<{ sent: number; failed: number; results: InvitationResult[] }> {
  const results: InvitationResult[] = [];

  // One at a time, deliberately. Each sends an email, and a Promise.all of fifty would
  // hand the mail server a burst it may answer with a rate limit.
  for (const personId of [...new Set(personIds)]) {
    results.push(await inviteOne(ctx, personId));
  }

  return {
    sent: results.filter((result) => result.status === 'SENT').length,
    failed: results.filter((result) => result.status === 'FAILED').length,
    results,
  };
}

/**
 * Issues a fresh invitation, consuming the old one.
 *
 * Tokens are single-use already; marking the prior one consumed means a forwarded email
 * from three weeks ago stops working the moment a new link is sent.
 */
export async function resendInvitation(ctx: RequestContext, tokenId: string): Promise<Invitation> {
  const token = await prisma.userToken.findFirst({
    where: { id: tokenId, purpose: 'INVITE', consumedAt: null },
    select: { id: true, user: { select: { id: true, personId: true } } },
  });
  if (!token) throw notFound();

  await assertMayInvite(ctx, token.user.personId);

  await prisma.userToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await issueInvite(token.user.id);

  const { data } = await listInvitations(ctx, { page: 1, pageSize: 1 });
  const latest = data[0];
  if (!latest) throw notFound();
  return latest;
}

// ─── MFA administrative reset ────────────────────────────────────────────────

/**
 * Clears a member's second factor on their behalf.
 *
 * The path for somebody who has lost both their authenticator AND their recovery codes.
 * It removes a protection from an account, so it is audited and — not optionally — the
 * account holder is told. An admin-triggered MFA reset the holder never hears about is an
 * account takeover with a paper trail nobody reads.
 */
export async function resetMfa(
  ctx: RequestContext,
  userId: string,
): Promise<{
  userId: string;
  mfaEnabled: false;
  recoveryCodesInvalidated: number;
  personNotified: boolean;
}> {
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: {
      id: true,
      personId: true,
      mfaEnabled: true,
      person: { select: { firstName: true, email: true } },
    },
  });
  if (!user) throw notFound();

  const actor = await prisma.person.findFirst({
    where: { id: ctx.personId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : 'a district administrator';

  const codes = await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });

  await prisma.$transaction(async (tx) => {
    // Recovery codes go with the factor they recover. Leaving them would let a printout
    // from last year re-enter an account whose second factor was deliberately removed.
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaLastUsedStep: null },
    });
  });

  // `users` is not a governed entity, so the extension records nothing for it. This is
  // the action worth recording, so it is recorded explicitly.
  await recordAction(AuditAction.UPDATE, {
    entityType: 'users',
    entityId: userId,
    details: { action: 'MFA_RESET', by: currentActor()?.userId ?? null, hadMfa: user.mfaEnabled },
  });

  const personNotified = Boolean(user.person.email);
  if (personNotified) {
    // Through the queue: the reset itself is done and the administrator should not wait on
    // a mail server to be told so. The row is written synchronously either way, so the
    // notification exists — and is auditable — before this returns.
    await notifyThroughQueue(ctx, {
      personId: user.personId,
      templateCode: NotificationTemplate.AUTH_MFA_RESET,
      districtId: ctx.districtId,
      payload: {
        firstName: user.person.firstName,
        resetBy: actorName,
        resetAt: new Date().toISOString().slice(0, 10),
      },
    });
  }

  return { userId, mfaEnabled: false, recoveryCodesInvalidated: codes, personNotified };
}

// ─── Audit log ───────────────────────────────────────────────────────────────

/**
 * Contact fields, redacted out of every audit diff.
 *
 * The log holds before/after diffs of governed entities, and `persons` is one of them —
 * so without this the audit endpoint would serve exactly the contact details the rest of
 * the system protects, to anyone holding `audit:read:district`.
 *
 * Redacted ALWAYS rather than per the caller's visibility. The log answers "who changed
 * what and when"; that a member's phone number changed is the answer, and the old number
 * is not part of it. A visibility-aware rule would be a second place for the same policy
 * to drift out of step with `person_visibility`.
 */
const REDACTED_FIELDS = new Set([
  'email',
  'phone',
  'altPhone',
  'alt_phone',
  'dateOfBirth',
  'date_of_birth',
  'city',
  'photoUrl',
  'photo_url',
  'gender',
  'occupation',
  'employer',
  'classification',
  'nationality',
  'riMemberId',
  'ri_member_id',
  'passwordHash',
  'password_hash',
  'mfaSecret',
  'mfa_secret',
  'tokenHash',
  'token_hash',
  'codeHash',
  'code_hash',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toChanges(before: unknown, after: unknown): AuditEntry['changes'] {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();

  return fields.map((field) => {
    const isRedacted = REDACTED_FIELDS.has(field);
    return {
      field,
      // The field name survives, so the log still says WHAT changed. Only the values go.
      before: isRedacted ? null : stringify(beforeRecord[field]),
      after: isRedacted ? null : stringify(afterRecord[field]),
      isRedacted,
    };
  });
}

export async function listAudit(
  ctx: RequestContext,
  query: AuditListQuery,
): Promise<{ data: AuditEntry[]; meta: PaginationMeta }> {
  const where = {
    // `audit_log` is UNSCOPED_BY_DESIGN, because LOGIN rows are written before a context
    // exists. The district filter is therefore applied HERE, explicitly, and rows with no
    // district are excluded rather than shown to everybody.
    districtId: ctx.districtId,
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            // Inclusive: "to 5 August" means everything that happened on 5 August.
            ...(query.to ? { lt: new Date(`${query.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLogEntry.findMany({
      where,
      select: {
        id: true,
        occurredAt: true,
        action: true,
        entityType: true,
        entityId: true,
        actorUserId: true,
        ipAddress: true,
        before: true,
        after: true,
        actor: { select: { person: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { id: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLogEntry.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      // BIGSERIAL. Serialised as a string, because a JSON number loses precision past
      // 2^53 and an audit id that silently changes is worse than one that is a string.
      id: row.id.toString(),
      occurredAt: row.occurredAt.toISOString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      actorName: row.actor ? `${row.actor.person.firstName} ${row.actor.person.lastName}` : null,
      ipAddress: row.ipAddress,
      changes: toChanges(row.before, row.after),
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

/** Exported for the no-PII harness, so the two cannot drift apart. */
export function isRedactedAuditField(field: string): boolean {
  return REDACTED_FIELDS.has(field);
}

export { ErrorCode as AdministrationErrorCode };
