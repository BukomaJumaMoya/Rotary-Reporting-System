import { prisma } from '../../platform/db.js';
import { mailTransport } from '../../platform/mail.js';
import { missingPlaceholders, render, type NotificationTemplateCode } from './templates.js';

export interface NotifyInput {
  personId: string;
  templateCode: NotificationTemplateCode;
  payload: Record<string, string>;
  districtId?: string | null;
}

/**
 * The row in `notifications` IS the queue and the delivery log: status, attempts, error and
 * sent_at are all recorded, so a member asking "I never got the email" has an answer that
 * is not somebody's memory.
 *
 * Since M2 session 1 the actual sending happens on the WORKER. This module keeps the two
 * halves separate so either can be used on its own:
 *
 *  * `queueNotification` writes the row and stops. The worker's sweep finds it.
 *  * `deliverNotification` sends one row and records what happened.
 *  * `notify` does both on the caller's thread — the inline path, for the flows where a
 *    person is staring at a form waiting for a link and must not wait on a worker.
 *
 * Nothing here throws to its caller. A password reset must not fail because a mail server
 * is down: the token is already stored, the row records the failure, and the member can
 * ask again.
 */

/** Writes the QUEUED row. Delivery is somebody else's problem, deliberately. */
export async function queueNotification(input: NotifyInput): Promise<{ id: string }> {
  // Resolved rather than trusted: `template_code` is a foreign key, so a code with no
  // active template would make the INSERT itself fail — and then there would be no row
  // recording that the district tried to tell somebody something.
  const template = await prisma.notificationTemplate.findFirst({
    where: { code: input.templateCode, isActive: true },
    select: { code: true },
  });

  const notification = await prisma.notification.create({
    data: {
      recipientPersonId: input.personId,
      districtId: input.districtId ?? null,
      channel: 'EMAIL',
      templateCode: template?.code ?? null,
      payload: input.payload,
      status: 'QUEUED',
    },
    select: { id: true },
  });

  return { id: notification.id };
}

/**
 * Sends one queued notification and records the outcome on its row.
 *
 * Returns false rather than throwing for every failure the sender caused — no template, no
 * email address, unfilled placeholders — because none of those get better on a retry.
 * THROWS for a transport failure, which is exactly the case a retry exists for: the job
 * that called this must fail so pg-boss tries again.
 */
export async function deliverNotification(notificationId: string): Promise<boolean> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, status: true, templateCode: true, payload: true, recipientPersonId: true },
  });

  if (!notification) return false;
  // Already sent. A sweep and an enqueued job can both reach the same row — the sweep is a
  // safety net, not a coordinator — and sending twice is worse than sending late.
  if (notification.status === 'SENT') return true;

  const [template, recipient] = await Promise.all([
    notification.templateCode === null
      ? null
      : prisma.notificationTemplate.findFirst({
          where: { code: notification.templateCode, isActive: true },
        }),
    prisma.person.findFirst({
      where: { id: notification.recipientPersonId, deletedAt: null },
      select: { email: true },
    }),
  ]);

  const payload = (notification.payload ?? {}) as Record<string, string>;

  const permanentFailure = ((): string | null => {
    if (!template) return `No active template for code ${notification.templateCode ?? '(none)'}`;
    if (!recipient?.email) return 'Recipient has no email address';
    const missing = missingPlaceholders(template.body, payload);
    // A body still containing {{resetUrl}} is worse than no email at all — the member gets
    // something that looks official and cannot be acted on.
    if (missing.length > 0) return `Template placeholders not supplied: ${missing.join(', ')}`;
    return null;
  })();

  if (permanentFailure !== null || !template || !recipient?.email) {
    await markFailed(notification.id, permanentFailure ?? 'unknown');
    console.error(`[notifications] ${notification.id} not sent: ${permanentFailure ?? 'unknown'}`);
    return false;
  }

  try {
    await mailTransport().send({
      to: recipient.email,
      subject: render(template.subject ?? '', payload),
      text: render(template.body, payload),
    });
  } catch (error) {
    // The transport's error may name the mail host and credentials, so it is recorded for
    // an administrator and never returned to a caller.
    const message = error instanceof Error ? error.message : 'Delivery failed';
    await markFailed(notification.id, message);
    console.error(`[notifications] ${notification.id} delivery failed: ${message}`);
    // Rethrown so the job retries. The row already says FAILED with the attempt count; a
    // later attempt that succeeds overwrites it with SENT.
    throw error;
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
  });

  return true;
}

async function markFailed(id: string, error: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { status: 'FAILED', error, attempts: { increment: 1 } },
  });
}

/**
 * Queues and delivers on the caller's thread.
 *
 * For the unauthenticated flows — password reset and invitation — where a person is
 * waiting on the link and there is no context to build a job payload from anyway. Never
 * throws: a transport failure is recorded on the row and swallowed.
 */
export async function notify(input: NotifyInput): Promise<{ id: string; delivered: boolean }> {
  const { id } = await queueNotification(input);
  try {
    return { id, delivered: await deliverNotification(id) };
  } catch {
    // Already recorded on the row by deliverNotification. The caller's operation stands.
    return { id, delivered: false };
  }
}

/** QUEUED rows that are due, oldest first. The worker's sweep reads this. */
export async function findDueNotifications(limit: number): Promise<
  {
    id: string;
    districtId: string | null;
  }[]
> {
  return prisma.notification.findMany({
    where: { status: 'QUEUED', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
    select: { id: true, districtId: true },
  });
}
