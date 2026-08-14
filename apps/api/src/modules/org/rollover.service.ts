import { randomUUID } from 'node:crypto';
import type { RequestContext, RolloverReport, RolloverRequest } from '@dis/contracts';
import { AuditAction } from '../../platform/audit.js';
import { db, prisma, recordAction, scopedTransaction } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';
import { systemContext, withSystemActor } from '../../platform/system-context.js';

/**
 * Year rollover.
 *
 * The riskiest operation in the system: it runs once a year, touches every club and every
 * appointment, and is therefore the least exercised code in the codebase on the day it
 * matters most. So it is designed defensively — dry run by default, a diff report to
 * read, and a confirmation token that expires.
 *
 * ONE DEPARTURE FROM THE SPECIFIED ORDER. The prompt lists "lock the prior year" before
 * "deactivate prior-year appointments". Those cannot happen in that order: the data
 * access layer refuses every write to a locked year, so deactivation would be refused by
 * the very guard this operation exists to set. Deactivating first reaches the same end
 * state while respecting the guard rather than tunnelling under it — and the guard is
 * then genuinely tested, because the run's own last act is to become unable to write.
 */

/** T1 under forty members, T2 at forty or more; an institution-based club is its own tier. */
export function tierFor(baseType: string, rosterSize: number): 'T1' | 'T2' | 'IBC' {
  if (baseType === 'IBC') return 'IBC';
  return rosterSize < 40 ? 'T1' : 'T2';
}

interface PendingConfirmation {
  token: string;
  districtId: string;
  targetYearLabel: string;
  expiresAt: number;
}

/**
 * Confirmation tokens from the most recent dry run, in memory.
 *
 * In memory deliberately: a token that survived a restart would let somebody commit a
 * rollover against a diff computed before a deployment changed the rules. Thirty minutes,
 * one process, and a restart means read the diff again.
 */
const pending = new Map<string, PendingConfirmation>();
const CONFIRM_TTL_MS = 30 * 60 * 1000;

function issueConfirmToken(districtId: string, targetYearLabel: string): string {
  const token = randomUUID();
  pending.set(token, {
    token,
    districtId,
    targetYearLabel,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  });
  return token;
}

function consumeConfirmToken(
  districtId: string,
  targetYearLabel: string,
  token: string | undefined,
): void {
  const refuse = (message: string): never => {
    throw new AppError(422, ErrorCode.ROLLOVER_NOT_CONFIRMED, message);
  };

  if (!token) refuse('Run a dry run first and pass its confirmToken to commit');

  const found = pending.get(token ?? '');
  if (!found) refuse('That confirmation token is not recognised. Run the dry run again.');
  if (!found) return;

  if (found.expiresAt <= Date.now()) {
    pending.delete(found.token);
    refuse('That confirmation token has expired. Run the dry run again.');
  }
  if (found.districtId !== districtId || found.targetYearLabel !== targetYearLabel) {
    // A token issued for a different target year would commit a diff nobody read.
    refuse('That confirmation token was issued for a different rollover.');
  }

  pending.delete(found.token);
}

/** For tests: the token store is process memory and must not leak between cases. */
export function clearPendingConfirmations(): void {
  pending.clear();
}

async function assertNoOpenPeriods(ctx: RequestContext): Promise<void> {
  // Scoring a period whose year is about to be locked would produce a scorecard nobody
  // can correct. Refuse rather than close them silently.
  const open = await db(ctx).assessmentFramework.findMany({
    select: { periods: { where: { status: 'OPEN' }, select: { id: true, label: true } } },
  });

  const openPeriods = open.flatMap((framework) => framework.periods);
  if (openPeriods.length > 0) {
    throw new AppError(
      422,
      ErrorCode.PERIOD_OPEN,
      'Close every assessment period for the current year before rolling over',
      { openPeriods: openPeriods.map((period) => period.label) },
    );
  }
}

export async function rollover(
  ctx: RequestContext,
  input: RolloverRequest,
): Promise<RolloverReport> {
  const districtId = ctx.districtId;

  const [targetYear, priorDistrictYear] = await Promise.all([
    // `rotary_years` is global reference data — 1 July to 30 June is the same everywhere
    // — so it needs no context.
    prisma.rotaryYear.findUnique({
      where: { label: input.targetYearLabel },
      select: { id: true, label: true },
    }),
    // `district_years` is district-scoped but NOT year-scoped, so the caller's own
    // context reaches every year this district has. No escape hatch required: a job that
    // skips the scope is a job that will one day run against the wrong district.
    db(ctx).districtYear.findFirst({
      where: { isCurrent: true },
      select: { rotaryYearId: true, rotaryYear: { select: { label: true } } },
    }),
  ]);

  if (!targetYear) throw notFound();
  if (!priorDistrictYear) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'This district has no current year');
  }

  if (targetYear.id === priorDistrictYear.rotaryYearId) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'That year is already the current one', {
      targetYearLabel: input.targetYearLabel,
    });
  }

  const alreadyOpen = await db(ctx).districtYear.count({
    where: { rotaryYearId: targetYear.id },
  });
  if (alreadyOpen > 0) {
    throw new AppError(
      422,
      ErrorCode.VALIDATION_ERROR,
      'That year is already open for this district',
      {
        targetYearLabel: input.targetYearLabel,
      },
    );
  }

  const priorYearId = priorDistrictYear.rotaryYearId;
  const priorCtx = await systemContext({
    districtId,
    rotaryYearId: priorYearId,
    reason: `rollover ${priorDistrictYear.rotaryYear.label} → ${targetYear.label}`,
  });
  // No systemContext() for the TARGET year here: it reads district_years to learn the
  // lock state, and that row does not exist until the transaction creates it. Inside the
  // transaction the target context is derived from the prior one instead.
  await assertNoOpenPeriods(priorCtx);

  if (!input.dryRun) {
    consumeConfirmToken(districtId, input.targetYearLabel, input.confirmToken);
  }

  const report = await withSystemActor(priorCtx, () =>
    runRollover({
      priorCtx,
      districtId,
      priorYearId,
      priorYearLabel: priorDistrictYear.rotaryYear.label,
      targetYearId: targetYear.id,
      targetYearLabel: targetYear.label,
      dryRun: input.dryRun,
    }),
  );

  if (input.dryRun) {
    report.confirmToken = issueConfirmToken(districtId, input.targetYearLabel);
  } else {
    await recordAction(AuditAction.UPDATE, {
      entityType: 'district_years',
      entityId: null,
      details: { action: 'ROLLOVER', reason: priorCtx.reason, report },
    });
  }

  return report;
}

/** Sentinel thrown to roll a dry run back. Never escapes this module. */
class DryRunComplete extends Error {
  constructor(readonly report: RolloverReport) {
    super('dry run');
  }
}

async function runRollover(input: {
  priorCtx: RequestContext;
  districtId: string;
  priorYearId: string;
  priorYearLabel: string;
  targetYearId: string;
  targetYearLabel: string;
  dryRun: boolean;
}): Promise<RolloverReport> {
  try {
    return await scopedTransaction(async (scopedFor) => {
      const prior = scopedFor(input.priorCtx);

      // 1. Closing rosters, through club_rosters — the view, which since schema v1.6
      //    handles corrections correctly rather than discarding them.
      const [affiliations, rosterRows, assignments] = await Promise.all([
        prior.clubDistrictAffiliation.findMany({
          select: { clubId: true, tier: true, club: { select: { name: true, baseType: true } } },
        }),
        prior.clubRoster.groupBy({ by: ['clubId'], _count: { personId: true } }),
        prior.clubClusterAssignment.findMany({ select: { clubId: true, clusterId: true } }),
      ]);

      const rosterSize = new Map(
        rosterRows.map((row) => [row.clubId, row._count.personId] as const),
      );

      // 2. Appointments expiring, counted by position for the report.
      const expiring = await prior.appointment.findMany({
        where: { isActive: true },
        select: { id: true, position: { select: { name: true } } },
      });

      const expiringByPosition = new Map<string, number>();
      for (const appointment of expiring) {
        const name = appointment.position.name;
        expiringByPosition.set(name, (expiringByPosition.get(name) ?? 0) + 1);
      }

      // 3. Deactivate prior-year appointments — BEFORE the lock, because the lock is
      //    what makes this impossible. See the note at the top of this file.
      await prior.appointment.updateMany({ where: { isActive: true }, data: { isActive: false } });

      // 4. Lock the prior year and stand it down as current. `district_years` is
      //    district-scoped and not year-scoped, so any context in this district reaches
      //    it — which is what lets one transaction touch both years.
      await prior.districtYear.updateMany({
        where: { rotaryYearId: input.priorYearId },
        data: { isCurrent: false, isLocked: true, lockedAt: new Date() },
      });

      // 5. Open the target year.
      await prior.districtYear.create({
        data: {
          rotaryYearId: input.targetYearId,
          isCurrent: true,
          isLocked: false,
          openedAt: new Date(),
        },
      });

      // From here the writes belong to the NEW year, so they go through a context bound
      // to it — the reason this transaction needs two.
      const target = scopedFor({
        ...input.priorCtx,
        rotaryYearId: input.targetYearId,
        isYearWritable: true,
      });

      // 6. Carry affiliations forward, with tier recalculated from the closing roster and
      //    is_confirmed FALSE: a tier the district has not looked at is a proposal.
      const tierChanges: RolloverReport['tierChanges'] = [];
      const flagged: RolloverReport['flaggedClubs'] = [];

      for (const affiliation of affiliations) {
        const size = rosterSize.get(affiliation.clubId) ?? 0;
        const tier = tierFor(affiliation.club.baseType, size);

        if (tier !== affiliation.tier) {
          tierChanges.push({
            clubId: affiliation.clubId,
            clubName: affiliation.club.name,
            from: affiliation.tier,
            to: tier,
            rosterSize: size,
          });
        }
        if (size === 0) {
          flagged.push({
            clubId: affiliation.clubId,
            clubName: affiliation.club.name,
            reason: 'ZERO_ROSTER',
          });
        }

        await target.clubDistrictAffiliation.create({
          data: { clubId: affiliation.clubId, tier, isConfirmed: false },
        });
      }

      // 7. Cluster assignments carried forward as proposals — but only where the cluster
      //    itself was carried. Clusters are redrawn annually and this year's do not exist
      //    yet, so the assignment has nothing to point at until the DES draws them.
      const carriedAssignments = 0;
      void assignments;

      const report: RolloverReport = {
        dryRun: input.dryRun,
        fromYearLabel: input.priorYearLabel,
        toYearLabel: input.targetYearLabel,
        clubsCarriedForward: affiliations.length,
        clusterAssignmentsCarried: carriedAssignments,
        appointmentsExpired: expiring.length,
        expiringByPosition: [...expiringByPosition.entries()]
          .map(([position, count]) => ({ position, count }))
          .sort((a, b) => b.count - a.count),
        tierChanges,
        flaggedClubs: flagged,
        confirmToken: null,
      };

      // A dry run runs EVERYTHING and then throws, so the transaction rolls back. The
      // report therefore describes work that actually executed rather than work that was
      // predicted — which is the only kind of dry run worth reading.
      if (input.dryRun) throw new DryRunComplete(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRunComplete) return error.report;
    throw error;
  }
}
