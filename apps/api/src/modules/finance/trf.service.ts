import type {
  CreateTrfContribution,
  RequestContext,
  TrfClubTotal,
  TrfContribution,
  TrfFundType,
  TrfSummary,
  VerifyTrfContribution,
} from '@dis/contracts';
import type { z } from 'zod';
import type { trfListQuerySchema } from '@dis/contracts';
import { db, prisma } from '../../platform/db.js';
import { notFound } from '../../platform/errors.js';
import { requireClubScope } from '../../platform/context.js';
import { isoDate } from '../../platform/time.js';
import * as assessment from '../assessment/service.js';
import * as governance from '../governance/appointments.service.js';
import * as membership from '../membership/service.js';
import * as clubs from '../org/clubs.service.js';
import { fromMoney, sum, toMoney, ZERO, type Money } from './money.js';

/**
 * The Rotary Foundation (FR-5).
 *
 * Two rules run through everything here.
 *
 * **Dollars, stored as reported, never converted.** Club finances are UGX; TRF reports in
 * USD and the rubric's bands are in USD. Converting at a rate this system chose would make a
 * club's scoring band depend on the day somebody ran an import — not a number anyone could
 * defend when a club misses a threshold by twenty dollars.
 *
 * **Only VERIFIED contributions count.** M5's `trf.contribution_usd` resolver reads verified
 * rows and nothing else, so every total this module produces separates the two. A club
 * typing in a figure it has not evidenced is precisely what verification exists to catch:
 * TRF giving is a scored parameter with award consequences.
 */

type ListQuery = z.infer<typeof trfListQuerySchema>;

const SELECT = {
  id: true,
  clubId: true,
  personId: true,
  fundType: true,
  amountUsd: true,
  contributedOn: true,
  riReceiptRef: true,
  evidenceUrl: true,
  verification: true,
  createdAt: true,
} as const;

interface Row {
  id: string;
  clubId: string;
  personId: string | null;
  fundType: TrfFundType;
  amountUsd: Money;
  contributedOn: Date;
  riReceiptRef: string | null;
  evidenceUrl: string | null;
  verification: TrfContribution['verification'];
  createdAt: Date;
}

function serialise(row: Row, clubName: string | null, personName: string | null): TrfContribution {
  return {
    id: row.id,
    clubId: row.clubId,
    clubName,
    personId: row.personId,
    personName,
    fundType: row.fundType,
    amountUsd: fromMoney(row.amountUsd),
    contributedOn: isoDate(row.contributedOn),
    riReceiptRef: row.riReceiptRef,
    evidenceUrl: row.evidenceUrl,
    verification: row.verification,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Names for a page of rows.
 *
 * A contributor's NAME is not a contact field, and a giving list is not a directory — but a
 * page showing bare UUIDs is a page nobody can read, and resolving them client-side would be
 * one request per row.
 */
async function names(
  ctx: RequestContext,
  rows: readonly Row[],
): Promise<{ club: Map<string, string>; person: Map<string, string> }> {
  const personIds = rows.map((row) => row.personId).filter((id): id is string => id !== null);

  const [club, people] = await Promise.all([
    governance.scopeNames(
      ctx,
      rows.map((row) => ({ scopeType: 'CLUB' as const, scopeId: row.clubId })),
    ),
    personIds.length === 0
      ? []
      : prisma.person.findMany({
          where: { id: { in: [...new Set(personIds)] }, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        }),
  ]);

  return {
    club,
    person: new Map(people.map((person) => [person.id, `${person.firstName} ${person.lastName}`])),
  };
}

// ─── Reads and writes ────────────────────────────────────────────────────────

export async function list(
  ctx: RequestContext,
  query: ListQuery,
): Promise<{ data: TrfContribution[]; total: number }> {
  const scopeWhere = ctx.scopes.isDistrictWide ? {} : { clubId: { in: [...ctx.scopes.clubIds] } };

  const where = {
    ...scopeWhere,
    ...(query.clubId ? { clubId: query.clubId } : {}),
    ...(query.personId ? { personId: query.personId } : {}),
    ...(query.fundType ? { fundType: query.fundType } : {}),
    ...(query.verification ? { verification: query.verification } : {}),
    ...(query.from || query.to
      ? {
          contributedOn: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db(ctx).trfContribution.findMany({
      where,
      select: SELECT,
      orderBy: [{ contributedOn: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db(ctx).trfContribution.count({ where }),
  ]);

  const resolved = await names(ctx, rows);
  return {
    data: rows.map((row) =>
      serialise(
        row,
        resolved.club.get(row.clubId) ?? null,
        row.personId ? (resolved.person.get(row.personId) ?? null) : null,
      ),
    ),
    total,
  };
}

export async function get(ctx: RequestContext, id: string): Promise<TrfContribution> {
  const row = await db(ctx).trfContribution.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound();
  requireClubScope(ctx, row.clubId);

  const resolved = await names(ctx, [row]);
  return serialise(
    row,
    resolved.club.get(row.clubId) ?? null,
    row.personId ? (resolved.person.get(row.personId) ?? null) : null,
  );
}

export async function create(
  ctx: RequestContext,
  input: CreateTrfContribution,
): Promise<TrfContribution> {
  requireClubScope(ctx, input.clubId);

  const created = await db(ctx).trfContribution.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      clubId: input.clubId,
      // Null is a CLUB-LEVEL gift, not a missing value. The distinction matters to the
      // contributing-member rate: one club cheque is not every member giving.
      personId: input.personId ?? null,
      fundType: input.fundType,
      amountUsd: toMoney(input.amountUsd),
      contributedOn: new Date(input.contributedOn),
      riReceiptRef: input.riReceiptRef ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      // UNVERIFIED by default, and nothing here may set it otherwise. A club recording its
      // own verified contribution would be a club scoring itself.
    },
  });

  return get(ctx, created.id);
}

/**
 * Verification, by a district officer.
 *
 * This is where a contribution starts counting, so it is also where the scorecard becomes
 * stale. QUERIED rather than REJECTED is the useful middle: a club that mistyped a receipt
 * reference should be asked, not refused.
 *
 * The comment is not stored — there is no `trf_comments` table, and adding one for a single
 * string belongs with M5's dispute surface where comments already have a home. It is
 * required by the contract so the officer has to articulate the objection, and it reaches
 * the club through the audit log until then. Recorded in §5 as deliberately unfinished.
 */
export async function verify(
  ctx: RequestContext,
  id: string,
  input: VerifyTrfContribution,
): Promise<TrfContribution> {
  const existing = await get(ctx, id);

  await db(ctx).trfContribution.updateMany({
    where: { id },
    data: {
      verification: input.decision,
      verifiedByUserId: input.decision === 'VERIFIED' ? ctx.userId : null,
    },
  });

  // Verified or un-verified, the club's TRF total has changed and its scorecard with it.
  await assessment.markStale(ctx, {
    clubId: existing.clubId,
    reason: `TRF contribution ${input.decision.toLowerCase()}`,
  });

  return get(ctx, id);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * By club, by fund, and cumulative year-to-date.
 *
 * Verified and pending are reported SEPARATELY throughout rather than netted. The verified
 * figure is the one a scorecard uses; the pending figure is the District Foundation Chair's
 * work queue. A single total would answer neither question.
 */
export async function summary(ctx: RequestContext): Promise<TrfSummary> {
  const visible = ctx.scopes.isDistrictWide
    ? await clubs.affiliatedClubIds(ctx)
    : [...ctx.scopes.clubIds];

  const rows = await db(ctx).trfContribution.findMany({
    where: { clubId: { in: visible } },
    select: { clubId: true, personId: true, fundType: true, amountUsd: true, verification: true },
  });

  const isVerified = (row: { verification: string }): boolean => row.verification === 'VERIFIED';
  const verified = rows.filter(isVerified);
  const pending = rows.filter((row) => row.verification === 'UNVERIFIED');

  // ── By fund ──
  const funds = [...new Set(rows.map((row) => row.fundType))].sort();
  const byFund = funds.map((fundType) => ({
    fundType,
    verifiedUsd: fromMoney(
      sum(verified.filter((row) => row.fundType === fundType).map((row) => row.amountUsd)),
    ),
    pendingUsd: fromMoney(
      sum(pending.filter((row) => row.fundType === fundType).map((row) => row.amountUsd)),
    ),
  }));

  // ── By club ──
  const clubNames = await governance.scopeNames(
    ctx,
    visible.map((clubId) => ({ scopeType: 'CLUB' as const, scopeId: clubId })),
  );

  const byClub: TrfClubTotal[] = [];
  for (const clubId of visible) {
    const mine = rows.filter((row) => row.clubId === clubId);
    // Only clubs that have done something appear. A district of 68 clubs mostly at zero is
    // a table nobody reads; the ones with nothing are the dues grid's job, not this one's.
    if (mine.length === 0) continue;

    const contributors = new Set(
      mine
        .filter(isVerified)
        .map((row) => row.personId)
        // A club-level gift has no person. Counting it toward the contributing-member rate
        // would say every member gave when one cheque was written.
        .filter((personId): personId is string => personId !== null),
    );

    const rosterSize = await membership.countRoster(ctx, clubId);

    byClub.push({
      clubId,
      clubName: clubNames.get(clubId) ?? 'Unknown club',
      verifiedUsd: fromMoney(sum(mine.filter(isVerified).map((row) => row.amountUsd))),
      pendingUsd: fromMoney(
        sum(mine.filter((row) => row.verification === 'UNVERIFIED').map((row) => row.amountUsd)),
      ),
      contributingMembers: contributors.size,
      rosterSize,
      // A rate, not a percentage, and zero rather than a division by zero for a club with
      // an empty roster.
      contributingMemberRate:
        rosterSize === 0 ? 0 : Number((contributors.size / rosterSize).toFixed(4)),
    });
  }

  byClub.sort((a, b) => a.clubName.localeCompare(b.clubName));

  return {
    rotaryYearId: ctx.rotaryYearId,
    verifiedUsd: fromMoney(sum(verified.map((row) => row.amountUsd)) || ZERO),
    pendingUsd: fromMoney(sum(pending.map((row) => row.amountUsd)) || ZERO),
    byFund,
    byClub,
  };
}
