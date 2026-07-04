import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, users } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { NotificationProvider } from '@infra/providers/notification-provider.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import { NOTIFY_CONSUMER } from '@/constants/index.js';
import {
  makeNotificationsService,
  type NotifyPayload,
} from '@modules/notifications/notifications-service.js';

interface HandlerDeps {
  db: DB;
  providers: Record<string, NotificationProvider>;
  log: FastifyBaseLogger;
}

/**
 * Channel-agnostic notification consumer. Maps an event type → route (channels + template),
 * looks up the order owner's address, renders once, and fans out to each channel's provider.
 *
 * Dedup + recipient lookup run in ONE short transaction with NO external I/O, so the DB connection
 * is never held open across an SMTP call. The dedup row is committed BEFORE sending, which makes
 * delivery **at-most-once**: a redelivery hits the committed row and no-ops, and a failed send is
 * logged rather than retried (a duplicate confirmation email is worse UX than a rare miss, and the
 * transport itself can retry). If the dedup/lookup tx fails nothing was sent and the row was not
 * committed, so the message is safely retried. Unrouted events are acked without side effect.
 */
export function makeNotificationDispatcher({ db, providers, log }: HandlerDeps) {
  const notifications = makeNotificationsService();
  return async (msg: ConsumeMessage): Promise<HandlerResult> => {
    const envelope = parseEnvelope<NotifyPayload>(msg, log);
    if (!envelope) return 'ack';
    const eventId = envelope.eventId;

    const route = notifications.route(envelope.eventType);
    if (!route) return 'ack'; // not a notification-worthy event → no-op

    let claimed = false;
    let recipientEmail: string | undefined;
    try {
      await db.transaction(async (tx) => {
        if (!(await claimOnce(tx, NOTIFY_CONSUMER, eventId))) return; // already processed
        claimed = true;
        const [recipient] = await tx
          .select({ email: users.email })
          .from(orders)
          .innerJoin(users, eq(users.id, orders.userId))
          .where(eq(orders.id, envelope.payload.orderId));
        recipientEmail = recipient?.email;
      });
    } catch (err) {
      log.error({ err, eventId }, 'notification dedup/lookup failed'); // nothing sent → safe retry
      return 'retry';
    }

    if (!claimed) {
      log.info({ eventId }, 'duplicate notification delivery, skipped');
      return 'ack';
    }
    if (!recipientEmail) {
      log.warn({ orderId: envelope.payload.orderId }, 'no recipient for notification; skipping');
      return 'ack';
    }

    // Send OUTSIDE the transaction. Per-channel best-effort: one channel failing does not stop the
    // others, and the already-committed dedup means none of them is re-sent on redelivery.
    const message = route.render(envelope.payload);
    for (const channel of route.channels) {
      const provider = providers[channel];
      if (!provider) {
        log.warn({ channel }, 'no provider registered for channel; skipping');
        continue;
      }
      try {
        await provider.send(recipientEmail, message);
      } catch (err) {
        log.error(
          { err, eventId, channel },
          'notification send failed (dedup committed, not retried)',
        );
      }
    }
    return 'ack';
  };
}
