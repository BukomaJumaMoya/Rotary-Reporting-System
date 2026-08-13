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
 * Queues a notification and attempts delivery.
 *
 * The row in `notifications` IS the queue and the delivery log: status, attempts, error
 * and sent_at are all recorded, so a member asking "I never got the email" has an answer
 * that is not somebody's memory.
 *
 * Delivery is attempted INLINE for now because there is no worker process yet. When
 * pg-boss arrives, the change is to stop calling deliver() here and let the worker drain
 * rows where status = 'QUEUED' — the queue table and its partial index (notif_due)
 * already exist for exactly that.
 *
 * Never throws to its caller. A password reset must not fail because a mail server is
 * down: the token is already stored, the row records the failure, and the member can ask
 * again.
 */
export async function notify(input: NotifyInput): Promise<{ id: string; delivered: boolean }> {
  const template = await prisma.notificationTemplate.findFirst({
    where: { code: input.templateCode, isActive: true },
  });

  const recipient = await prisma.person.findFirst({
    where: { id: input.personId, deletedAt: null },
    select: { email: true },
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

  const failure = ((): string | null => {
    if (!template) return `No active template for code ${input.templateCode}`;
    if (!recipient?.email) return 'Recipient has no email address';
    const missing = missingPlaceholders(template.body, input.payload);
    // A body still containing {{resetUrl}} is worse than no email at all — the member
    // gets something that looks official and cannot be acted on.
    if (missing.length > 0) return `Template placeholders not supplied: ${missing.join(', ')}`;
    return null;
  })();

  if (failure !== null || !template || !recipient?.email) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', error: failure, attempts: { increment: 1 } },
    });
    console.error(`[notifications] ${input.templateCode} not sent: ${failure ?? 'unknown'}`);
    return { id: notification.id, delivered: false };
  }

  try {
    await mailTransport().send({
      to: recipient.email,
      subject: render(template.subject ?? '', input.payload),
      text: render(template.body, input.payload),
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
    });

    return { id: notification.id, delivered: true };
  } catch (error) {
    // The transport's error may name the mail host and credentials, so it is recorded
    // for an administrator and never returned to the caller.
    const message = error instanceof Error ? error.message : 'Delivery failed';
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', error: message, attempts: { increment: 1 } },
    });
    console.error(`[notifications] ${input.templateCode} delivery failed: ${message}`);
    return { id: notification.id, delivered: false };
  }
}
